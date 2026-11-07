<script setup lang="ts">
/**
 * 报告编辑器
 *
 * 结构：章节树（可改名、可增删）+ 正文 + AI 起草 + 导出。
 * AI 只能拿到「已有事实 + 缺口清单」，缺信息就写「待补充」，不许编。
 */
import { computed, ref, watch } from 'vue';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import type { Report, ReportSection, ReportStatus } from '../core/types';
import { REPORT_STATUS_LABEL, REPORT_STATUS_ORDER, SOURCE_TYPE_LABEL } from '../core/types';
import { templateFor, NON_AI_SECTIONS } from '../reports/templates';
import { FILL_DISCLAIMER, contextText, gapsFor, sectionPrompt } from '../reports/context';
import { projectProgress, progressSummary } from '../reports/progress';
import { prefetchReferences } from '../reports/prefetch';
import { detectHeadings, type DetectedHeading } from '../reports/importTemplate';
import { buildReportDocx, reportToMarkdown } from '../docx/builder';
import { printReport } from '../export/pdf';
import { saveFile } from '../export/save';
import MarkdownText from './MarkdownText.vue';
import DocxPreview from './DocxPreview.vue';
import AiProgress from './AiProgress.vue';
import { useAiProgress } from '../core/ai-progress';
import { cleanReport, hasAiMarks, AI_CLEAN_WARNING } from '../core/ai-clean';
import { looksLikePlanning, stripInlineThink } from '../reports/guard';
import { uid } from '../core/id';
import { getAgent } from '../agents/definitions';
import { AgentRuntime } from '../agents/runtime';
import { TEMPLATE_NOTE } from '../core/settings';
import { askConfirm, askPrompt } from '../core/task-guard';

const props = defineProps<{ report: Report }>();
const app = useAppStore();
const store = useProjectStore();

const draft = ref<Report>(JSON.parse(JSON.stringify(props.report)));
const active = ref<string>(draft.value.sections[0]?.id ?? '');
const dirty = ref(false);
const lastWarnings = ref<string[]>([]);
const generating = ref<string | null>(null);
const progress = useAiProgress();

const previewOpen = ref(false);
const importOpen = ref(false);
const importFile = ref<HTMLInputElement | null>(null);
const importName = ref('');
const detected = ref<DetectedHeading[]>([]);
const importing = ref(false);
const exportName = ref('');
const exporting = ref(false);
/** 结题是否加封面与目录（学校范例没有，默认不加） */
const addCover = ref(false);

watch(
  () => props.report,
  (r) => {
    draft.value = JSON.parse(JSON.stringify(r));
    if (!draft.value.sections.some((s) => s.id === active.value)) {
      active.value = draft.value.sections[0]?.id ?? '';
    }
    dirty.value = false;
  },
  { deep: true },
);

const section = computed<ReportSection | undefined>(() =>
  draft.value.sections.find((s) => s.id === active.value),
);

const tpl = computed(() => templateFor(draft.value.kind));
const spec = computed(() => tpl.value.sections.find((s) => s.heading === section.value?.heading));

const wordCount = computed(() => (section.value?.body ?? '').replace(/\s+/g, '').length);

function specFor(s: ReportSection) {
  return tpl.value.sections.find((x) => x.heading === s.heading);
}

function filled(s: ReportSection) {
  return s.body.trim().length > 0;
}

const filledCount = computed(() => draft.value.sections.filter(filled).length);

/** 事实底座与缺口：每次渲染都按 store 里的真实数据重算 */
const ctx = computed(() => ({
  project: store.current!,
  records: store.records,
  sources: store.sources,
  datasets: store.datasets,
}));

const gaps = computed(() =>
  store.current ? gapsFor(draft.value.kind, ctx.value, app.settings.gapMode) : [],
);
/** 硬阻断：成员为空这类，没有讨论余地 */
const blocking = computed(() => gaps.value.filter((g) => g.level === 'block' && !g.gate));
/** 进度门禁：记录没写完就想写中期/结题，可以让用户确认后按现有记录先写 */
const gateBlock = computed(() => gaps.value.filter((g) => g.level === 'block' && g.gate));

/** 项目整体进度，侧栏常显，让用户知道现在写到哪一步 */
const prog = computed(() =>
  store.current ? projectProgress(store.current, store.records) : null,
);
const progPct = computed(() => {
  const p = prog.value;
  if (!p || !p.total) return 0;
  return Math.round((Math.min(p.filled, p.total) / p.total) * 100);
});

/**
 * 起草前先检索一次。
 *
 * 只在「项目来源还很少」时做，且同一课题、同一次打开只搜一遍：
 * 检索是补线索，不是每节都重新联网。结果只进提示词当参考，
 * 不写进来源表——来源得由用户自己确认。
 */
const prefetchCache = ref<{ topic: string; text: string } | null>(null);

function needPrefetch(): boolean {
  if (!app.settings.prefetchBeforeWrite) return false;
  if (store.sources.length >= 3) return false;
  return Boolean(store.current?.topic?.trim());
}

async function maybePrefetch(): Promise<string> {
  if (!needPrefetch()) return '';
  const topic = store.current!.topic.trim();
  if (prefetchCache.value?.topic === topic) return prefetchCache.value.text;
  progress.to('search', '按课题名找相关文献');
  const out = await prefetchReferences(topic, app.settings.searchProviders);
  prefetchCache.value = { topic, text: out.text };
  if (out.count) app.toast(out.message, 'info', 3200);
  return out.text;
}

async function togglePrefetch(e: Event) {
  const on = (e.target as HTMLInputElement).checked;
  await app.saveSettings({ prefetchBeforeWrite: on });
  app.toast(on ? '起草前会按课题名检索一次文献' : '已关闭起草前检索', 'info', 2200);
}

/**
 * 进度门禁的确认出口。
 * 默认劝用户先去补记录；确实赶时间时允许「按现有记录先写」，
 * 生成时提示词里会写明只据实有记录写、不足处留白。
 */
async function passGate(): Promise<boolean> {
  if (!gateBlock.value.length) return true;
  return askConfirm({
    title: '记录还没写完',
    message: `${gateBlock.value.map((g) => g.text).join('\n\n')}\n\n建议先去补齐研究记录，报告才站得住。\n如果确实要先写，AI 只会按已有的几篇写，缺的部分留「待补充」。`,
    confirmText: '按现有记录先写',
    cancelText: '先去补记录',
    tone: 'warn',
  });
}

/** 本节点名关联的来源：生成时排在事实清单前面，避免引用与段落对不上 */
const sectionSources = computed(() =>
  store.sources.filter((s) =>
    s.linkedSections?.some((l) => l.reportId === draft.value.id && l.sectionId === active.value),
  ),
);

function ctxTextForSection(): string {
  const base = contextText(ctx.value, draft.value.kind);
  if (!sectionSources.value.length) return base;
  const lines = sectionSources.value.map(
    (s) =>
      `- ${s.authors || s.institution || '作者未填'}《${s.title}》${s.date || ''}${s.doi ? ` DOI:${s.doi}` : s.url ? ` ${s.url}` : ''}；${s.verifyStatus === 'verified' ? '已核验' : '待核实'}`,
  );
  return [
    '【本节已关联来源（优先引用，未核验的要标注「待核实」）】',
    ...lines,
    '',
    base,
  ].join('\n');
}


/** 留白 / 写满：默认留白，用户可在侧栏临时切换，写进设置 */
const gapMode = computed(() => app.settings.gapMode);
async function setGapMode(mode: 'strict' | 'fill') {
  if (mode === 'fill') {
    const ok = await askConfirm({
      title: '关闭留白',
      message: '关闭留白后，AI 会把缺材料的章节尽量写满：推断处标「需核实」，具体数据仍留横线，结尾附免责声明。\n\n提交前必须逐条核对，不能直接交。继续？',
      confirmText: '仍然继续',
      tone: 'warn',
    });
    if (!ok) return;
  }
  await app.saveSettings({ gapMode: mode });
}


const simSections = computed(() => draft.value.sections.filter((s) => s.containsSimulated));

const defaultName = computed(() => {
  const topic = store.current?.topic || '研究性学习';
  return `${topic}-${draft.value.title}-v${draft.value.version}`;
});

watch(defaultName, (v) => {
  if (!exportName.value) exportName.value = v;
}, { immediate: true });

function markDirty() {
  dirty.value = true;
  if (section.value) section.value.updatedAt = Date.now();
}

async function save() {
  draft.value.version += 1;
  await store.saveReport(draft.value);
  dirty.value = false;
  app.toast('已保存', 'ok', 1600);
}

/** 一键生成时只问一次进度门禁，不要每节弹一遍 */
let gatePassedInBatch = false;

async function generateSection() {
  const s = section.value;
  if (!s || !spec.value || !store.current) return;
  if (NON_AI_SECTIONS.includes(s.heading)) {
    app.toast('这一栏由教师填写，AI 不代写', 'warn');
    return;
  }
  if (blocking.value.length) {
    app.toast(`还不能生成：${blocking.value[0].text}`, 'warn', 5200);
    return;
  }
  if (!gatePassedInBatch && !(await passGate())) return;

  const sp = spec.value;
  generating.value = s.id;
  progress.start('report', `正在起草「${s.heading}」`);
  try {
    progress.to('collect');
    const agent = getAgent('report-writer')!;
    const runtime = new AgentRuntime(app.gateway);
    const ctx = {
      project: store.current,
      report: draft.value,
      section: s,
      records: store.records,
      sources: store.sources,
      datasets: store.datasets,
      activities: [],
    };
    const prefetched = await maybePrefetch();
    const base = () =>
      sectionPrompt({
        kind: draft.value.kind,
        heading: s.heading,
        hint: sp.hint,
        words: sp.words,
        ctxText: [prefetched, ctxTextForSection()].filter(Boolean).join('\n\n'),
        gaps: gaps.value,
        existing: s.body,
        mode: gapMode.value,
      });
    /** 重试时把「上一版是计划不是正文」说清楚，并要求直接从第一句写 */
    const strict = (hits: string[]) =>
      `${base()}\n\n【再次强调】上一次的输出是「写作计划」，出现了「${hits.slice(0, 2).join(
        '」「',
      )}」这类句子，不是正文。这次直接从正文第一句写起，不要任何关于「怎么写」「还缺什么」的描述。`;

    progress.to('model', '模型正在写这一节…');
    let result = await runtime.run('report-writer', agent, ctx, base());
    progress.to('verify', '检查正文与事实边界');
    // 内联 <think> 标签先剥出来：思考归思考，正文归正文
    let clean = stripInlineThink(result.text);
    let verdict = looksLikePlanning(clean.text);

    if (verdict.bad) {
      progress.setDetail('返回的是写作思路，正在重写一次');
      app.toast('这次返回的是写作思路而不是正文，正在重写一次', 'info', 3200);
      result = await runtime.run('report-writer', agent, ctx, strict(verdict.hits));
      clean = stripInlineThink(result.text);
      verdict = looksLikePlanning(clean.text);
    }

    if (!clean.text.trim()) {
      lastWarnings.value = [
        '这次只拿到了思考过程，没有正文。可以关闭深度思考、换个模型，或把输出额度调大再试。',
      ];
      progress.fail('这次只返回了思考过程，正文是空的，没有写入');
      app.toast('这次只返回了思考过程，正文是空的，没有写入', 'warn', 6000);
      return;
    }
    // 仍然像思路：宁可不写，也不把 AI 的自言自语留在正文里
    if (verdict.bad) {
      lastWarnings.value = [`模型连续两次只给了写作思路（${verdict.hits.slice(0, 2).join('、')}），已丢弃，未覆盖原内容。`];
      progress.fail('模型连续两次只给了思路，已丢弃，原内容没动');
      app.toast('模型连续两次只给了思路而不是正文，已丢弃，原内容没动。换个更强的模型再试。', 'warn', 7000);
      return;
    }

    s.body = clean.text;
    s.origin = 'ai';
    s.updatedAt = Date.now();
    s.containsSimulated = /（AI 模拟示例）|AI 模拟/.test(s.body);
    lastWarnings.value = result.warnings;
    dirty.value = true;
    await save();
    progress.finish(`已写入「${s.heading}」，记得核对`);
    app.toast(
      result.reasoning
        ? `已生成「${s.heading}」（思考过程没有写入正文）`
        : `已生成「${s.heading}」（${result.calls} 次调用）`,
      'ok',
    );
  } catch (e) {
    progress.fail(e instanceof Error ? e.message : String(e));
    app.toast(e instanceof Error ? e.message : String(e), 'error', 6000);
  } finally {
    generating.value = null;
  }
}

async function generateAll() {
  if (!store.current) return;
  if (blocking.value.length) {
    app.toast(`先补齐：${blocking.value.map((g) => g.text).join('；')}`, 'warn', 6000);
    return;
  }
  if (!(await passGate())) return;
  gatePassedInBatch = true;
  try {
    for (const s of draft.value.sections) {
      if (NON_AI_SECTIONS.includes(s.heading)) continue;
      if (s.body.trim()) {
        const ok = await askConfirm({
          title: '重新生成会覆盖',
          message: `「${s.heading}」已有内容，重新生成会覆盖。继续？`,
          confirmText: '仍然继续',
          tone: 'warn',
        });
        if (!ok) continue;
      }
      active.value = s.id;
      await generateSection();
    }
  } finally {
    gatePassedInBatch = false;
  }
}

function insertSimTag() {
  if (!section.value) return;
  section.value.body = `（AI 模拟示例）\n${section.value.body}`;
  section.value.containsSimulated = true;
  dirty.value = true;
}

function insertPlaceholder() {
  if (!section.value) return;
  const p = spec.value?.placeholder ?? '待补充：';
  section.value.body = section.value.body.trim()
    ? `${section.value.body}\n\n${p}`
    : p;
  dirty.value = true;
}

async function fillPlaceholders() {
  let n = 0;
  for (const s of draft.value.sections) {
    if (filled(s)) continue;
    const sp = specFor(s);
    if (!sp) continue;
    s.body = sp.placeholder ?? `待补充：本节内容尚未填写。`;
    s.origin = 'template';
    n++;
  }
  dirty.value = true;
  await save();
  app.toast(n ? `已为 ${n} 个空章节写入「待补充」说明` : '没有空章节', 'info', 2600);
}

/** 一键清理补全模式写进正文的 AI 标注，删除后不可撤销 */
async function cleanAiMarks() {
  if (!draft.value.sections.some((s) => hasAiMarks(s.body))) {
    app.toast('这一份报告里没有可清理的 AI 标注', 'info');
    return;
  }
  const ok = await askConfirm({
    title: '清理 AI 生成标注',
    message: AI_CLEAN_WARNING,
    confirmText: '仍然清理',
    cancelText: '先不清理',
    tone: 'warn',
  });
  if (!ok) return;
  const out = cleanReport(draft.value);
  draft.value = out.report;
  dirty.value = true;
  await save();
  app.toast(`已清理 ${out.removed} 处标注，删除后无法撤销`, 'ok', 4200);
}

/* ---------------- 章节字段编辑 ---------------- */

async function renameSection() {
  const s = section.value;
  if (!s) return;
  const name = await askPrompt({
    title: '章节标题',
    initialValue: s.heading,
    placeholder: '输入新的章节标题',
  });
  if (!name?.trim() || name.trim() === s.heading) return;
  s.heading = name.trim();
  markDirty();
}

async function addSection() {
  const name = await askPrompt({
    title: '新增章节标题',
    placeholder: '输入章节标题',
  });
  if (!name?.trim()) return;
  const sec: ReportSection = {
    id: uid('sec'),
    heading: name.trim(),
    level: 1,
    body: '',
    origin: 'user',
    updatedAt: Date.now(),
  };
  draft.value.sections.push(sec);
  active.value = sec.id;
  markDirty();
}

async function removeSection() {
  const s = section.value;
  if (!s) return;
  if (draft.value.sections.length <= 1) {
    app.toast('至少保留一个章节', 'warn');
    return;
  }
  const ok = await askConfirm({
    title: '删除章节',
    message: `删除章节「${s.heading}」及其正文？`,
    confirmText: '删除',
    tone: 'warn',
  });
  if (!ok) return;
  draft.value.sections = draft.value.sections.filter((x) => x.id !== s.id);
  active.value = draft.value.sections[0]?.id ?? '';
  markDirty();
}

async function move(dir: -1 | 1) {
  const i = draft.value.sections.findIndex((x) => x.id === active.value);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= draft.value.sections.length) return;
  const list = [...draft.value.sections];
  [list[i], list[j]] = [list[j], list[i]];
  draft.value.sections = list;
  markDirty();
}

/* ---------------- 模板导入 ---------------- */

async function onImportFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    detected.value = await detectHeadings(file);
    importName.value = file.name;
    if (!detected.value.length) {
      app.toast('没识别出标题。可先用 Word 给标题套「标题 1/2」样式，或改用 .md', 'warn', 6000);
    }
  } catch (err) {
    app.toast(err instanceof Error ? err.message : '识别失败', 'error', 5000);
  } finally {
    if (importFile.value) importFile.value.value = '';
  }
}

async function applyTemplate() {
  if (!detected.value.length) return;
  importing.value = true;
  try {
    const old = new Map(draft.value.sections.map((s) => [s.heading, s]));
    draft.value.sections = detected.value.map((h) => {
      const prev = old.get(h.text);
      return {
        id: prev?.id ?? uid('sec'),
        heading: h.text,
        level: h.level,
        body: prev?.body ?? '',
        containsSimulated: prev?.containsSimulated,
        origin: prev ? prev.origin : ('user' as const),
        updatedAt: Date.now(),
      };
    });
    draft.value.templateId = `imported:${importName.value}`;
    draft.value.templateNote = `章节结构导入自 ${importName.value}，仅套用标题，样式与表格需在 Word 中手动调整。`;
    active.value = draft.value.sections[0]?.id ?? '';
    importOpen.value = false;
    detected.value = [];
    dirty.value = true;
    await save();
    app.toast('已套用导入的章节结构', 'ok', 3000);
  } finally {
    importing.value = false;
  }
}

async function resetTemplate() {
  const ok = await askConfirm({
    title: '恢复内置通用模板',
    message: '恢复为内置通用模板？已写的正文会按标题保留，标题不一致的章节会丢失。',
    confirmText: '仍然恢复',
    tone: 'warn',
  });
  if (!ok) return;
  const t = templateFor(draft.value.kind);
  const old = new Map(draft.value.sections.map((s) => [s.heading, s]));
  draft.value.sections = t.sections.map((sp) => ({
    id: old.get(sp.heading)?.id ?? uid('sec'),
    heading: sp.heading,
    level: sp.level,
    body: old.get(sp.heading)?.body ?? '',
    origin: old.get(sp.heading) ? old.get(sp.heading)!.origin : ('template' as const),
    updatedAt: Date.now(),
  }));
  draft.value.templateId = undefined;
  draft.value.templateNote = undefined;
  active.value = draft.value.sections[0]?.id ?? '';
  dirty.value = true;
  await save();
}

/* ---------------- 导出 ---------------- */

/**
 * 真实 DOCX 预览
 *
 * 「预览版式」是拿数据自己画的纸样，跟导出的文件可能差一点点；
 * 这里直接把要下载的那份 blob 交给 DocxPreview 组件渲染，所见即所得。
 */
const docxPreviewOpen = ref(false);
const docxBlob = ref<Blob | null>(null);
const docxLoading = ref(false);

async function previewDocx() {
  if (!store.current) return;
  if (!app.settings.features.docExport) {
    app.toast('文档导出已在「功能管理」中关闭', 'warn');
    return;
  }
  docxPreviewOpen.value = true;
  docxLoading.value = true;
  // 先清掉上一次的 blob：本次生成失败时不要把旧文件留在预览里
  docxBlob.value = null;
  try {
    if (dirty.value) await save();
    const kind = draft.value.kind === 'progress' ? 'proposal' : (draft.value.kind as 'proposal' | 'midterm' | 'final');
    const blob = await buildReportDocx(kind, store.current, draft.value, store.sources, store.records, {
      cover: kind === 'final' && addCover.value,
    });
    docxBlob.value = blob;
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '预览失败，可以先导出到 Word 打开', 'error', 5200);
  } finally {
    docxLoading.value = false;
  }
}

async function exportDocx() {
  if (!store.current) return;
  if (!app.settings.features.docExport) {
    app.toast('文档导出已在「功能管理」中关闭', 'warn');
    return;
  }
  exporting.value = true;
  try {
    if (dirty.value) await save();
    const kind = draft.value.kind === 'progress' ? 'proposal' : (draft.value.kind as 'proposal' | 'midterm' | 'final');
    const blob = await buildReportDocx(kind, store.current, draft.value, store.sources, store.records, {
      cover: kind === 'final' && addCover.value,
    });
    const res = await saveFile(blob, `${(exportName.value || defaultName.value).replace(/[\\/:*?"<>|]/g, '_')}.docx`);
    app.toast(res.how === 'cancelled' ? '没有保存' : res.note, res.how === 'cancelled' ? 'info' : 'ok', 3200);
    if (res.how !== 'cancelled' && kind === 'final' && addCover.value) {
      app.toast('目录是 Word 域，首次打开需右键「更新域」。', 'info', 5200);
    }
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '导出失败', 'error', 5000);
  } finally {
    exporting.value = false;
  }
}

async function exportMarkdown() {
  if (!store.current) return;
  try {
    const md = reportToMarkdown(store.current, draft.value, store.sources);
    const res = await saveFile(
      new Blob([md], { type: 'text/markdown;charset=utf-8' }),
      `${(exportName.value || defaultName.value).replace(/[\\/:*?"<>|]/g, '_')}.md`,
    );
    app.toast(res.note, res.how === 'cancelled' ? 'info' : 'ok');
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '导出失败', 'error', 5000);
  }
}

/** PDF 导出：走系统打印，在打印对话框里选「另存为 PDF」 */
function exportPdf() {
  if (!store.current) return;
  if (!app.settings.features.docExport) {
    app.toast('文档导出已在「功能管理」中关闭', 'warn');
    return;
  }
  const md = reportToMarkdown(store.current, draft.value, store.sources);
  const name = (exportName.value || defaultName.value).replace(/[\\/:*?"<>|]/g, '_');
  const simNote = simSections.value.length
    ? '本报告含 AI 模拟 / 虚拟示例内容，已按导出规范保留标识，不作为真实研究数据使用。'
    : '';
  printReport(name, `${store.current.topic} · ${store.current.groupName || ''}`, md, simNote);
  app.toast('已打开打印窗口：目标打印机选「另存为 PDF」即可导出', 'info', 5200);
}

const previewSections = computed(() => draft.value.sections);

/* ---------------- 状态 ---------------- */

async function setStatus(next: ReportStatus) {
  if (next === draft.value.status) return;
  if (next === 'confirmed' && !filledCount.value) {
    app.toast('还没有任何正文，不能标记为已确认', 'warn');
    return;
  }
  if (next === 'confirmed') {
    const emptyRequired = draft.value.sections.filter((s) => specFor(s)?.required && !filled(s));
    if (emptyRequired.length) {
      app.toast(`还有必填章节没写：${emptyRequired.map((s) => s.heading).join('、')}`, 'warn', 5200);
      return;
    }
    const placeholders = draft.value.sections.filter((s) => /待补充/.test(s.body));
    if (placeholders.length) {
      const ok = await askConfirm({
        title: '仍有「待补充」章节',
        message: `还有 ${placeholders.length} 节写着「待补充」。确认仍要标记为已确认？`,
        confirmText: '仍然确认',
        tone: 'warn',
      });
      if (!ok) return;
    }
  }
  draft.value.status = next;
  await store.saveReport(draft.value);
  await store.setReportStatus(draft.value.kind, next);
  app.toast(`状态已改为「${REPORT_STATUS_LABEL[next]}」`, 'ok', 1800);
}
</script>

<template>
  <div class="editor">
    <aside class="toc">
      <div class="toc-head">
        <span class="toc-title">章节</span>
        <span class="chip" :class="draft.status === 'confirmed' ? 'chip-ok' : ''">{{ REPORT_STATUS_LABEL[draft.status] }} · v{{ draft.version }}</span>
      </div>
      <button
        v-for="s in draft.sections"
        :key="s.id"
        class="toc-item"
        :class="{ on: s.id === active, done: filled(s) }"
        @click="active = s.id"
      >
        <span class="toc-dot" />
        <span class="toc-name">{{ s.heading }}</span>
        <span v-if="specFor(s)?.required && !filled(s)" class="toc-req">必填</span>
      </button>

      <div class="toc-actions">
        <button class="mini" type="button" @click="addSection">+ 章节</button>
        <button class="mini" type="button" @click="importOpen = true">导入模板</button>
      </div>
    </aside>

    <div class="body">
      <!-- 模板说明：不冒充学校官方格式 -->
      <div class="tpl-note">
        <span class="tpl-dot" />
        <p>
          {{ draft.templateNote || TEMPLATE_NOTE }}
        </p>
      </div>

      <div v-if="section" class="body-inner">
        <AiProgress :progress="progress" />

        <div class="body-head">
          <div class="grow">
            <h2 class="sec-title">{{ section.heading }}</h2>
            <div class="sec-meta">
              <span v-if="spec">建议 {{ spec.words }} 字</span>
              <span class="num">当前 {{ wordCount }} 字</span>
              <span v-if="section.origin === 'ai'" class="chip chip-accent">AI 生成</span>
              <span v-if="section.containsSimulated" class="chip chip-sim">含模拟内容</span>
            </div>
          </div>
          <div class="row" style="gap: 6px">
            <button class="btn btn-sm" type="button" @click="move(-1)" aria-label="上移">↑</button>
            <button class="btn btn-sm" type="button" @click="move(1)" aria-label="下移">↓</button>
            <button class="btn btn-sm" type="button" @click="renameSection">改名</button>
            <button class="btn btn-sm btn-danger" type="button" @click="removeSection">删除</button>
          </div>
        </div>

        <div class="hint-row">
          <div v-if="spec" class="hint">{{ spec.hint }}</div>
          <button class="btn btn-sm" type="button" @click="insertPlaceholder">插入「待补充」</button>
          <button
            class="btn btn-sm btn-primary"
            type="button"
            :disabled="generating !== null"
            @click="generateSection"
          >
            {{ generating === section.id ? '生成中…' : section.body ? '重新生成' : 'AI 起草本节' }}
          </button>
        </div>

        <textarea
          v-model="section.body"
          class="textarea main-input"
          placeholder="在这里写正文。缺材料的地方就写「待补充：<缺什么>」，不要用推测填空。"
          @input="markDirty"
        />

        <div class="row wrap" style="margin-top: 12px">
          <button class="btn btn-sm" type="button" @click="insertSimTag">标记为 AI 模拟示例</button>
          <button class="btn btn-sm" type="button" @click="section.containsSimulated = !section.containsSimulated; dirty = true">
            {{ section.containsSimulated ? '取消模拟标记' : '本节含模拟内容' }}
          </button>
          <div class="grow" />
          <button class="btn btn-sm btn-primary" type="button" :disabled="!dirty" @click="save">保存</button>
        </div>

        <div v-for="w in lastWarnings" :key="w" class="banner banner-warn" style="margin-top: 12px; font-size: calc(12.5px * var(--font-scale))">
          {{ w }}
        </div>

        <div v-if="section.containsSimulated" class="banner banner-sim" style="margin-top: 12px; font-size: calc(12px * var(--font-scale))">
          本节已标模拟。导出时文首会有提示框，正文保留「（AI 模拟示例）」标识，不会被当成真实数据。
        </div>
      </div>

      <div v-else class="blank">
        这份报告还没有章节。左侧可以新增，或导入学校模板。
      </div>
    </div>

    <div class="side">
      <!-- 缺口 -->
      <div class="card card-pad">
        <div class="side-title">写作前检查</div>
        <div v-if="prog" class="prog">
          <div class="prog-track"><i :style="{ width: `${progPct}%` }" /></div>
          <span class="prog-text">{{ progressSummary(prog) }}</span>
        </div>
        <label class="pref-row">
          <input
            type="checkbox"
            :checked="app.settings.prefetchBeforeWrite"
            @change="togglePrefetch"
          />
          <span>起草前先检索相关文献</span>
        </label>
        <ul v-if="gaps.length" class="gaps">
          <li v-for="g in gaps" :key="g.text" :class="g.level">
            <b>{{ g.level === 'block' ? '缺' : '建议补' }}</b>
            <span>{{ g.text }}<i>{{ g.where }}</i></span>
          </li>
        </ul>
        <p v-else class="muted small" style="margin: 0">材料齐了，可以直接起草。记得逐段核对事实。</p>
        <p v-if="sectionSources.length" class="muted small" style="margin: 8px 0 0; line-height: 1.6">
          本节已关联 {{ sectionSources.length }} 条来源，生成时会优先引用。
        </p>
        <button class="btn btn-sm btn-block" style="margin-top: 10px" type="button" @click="fillPlaceholders">
          给空章节写「待补充」
        </button>
      </div>

      <!-- 生成方式：留白 / 写满 -->
      <div class="card card-pad" style="margin-top: 12px">
        <div class="side-title">缺材料时</div>
        <div class="row" style="gap: 6px">
          <button
            class="btn btn-sm grow"
            :class="{ 'btn-primary': gapMode === 'strict' }"
            type="button"
            @click="setGapMode('strict')"
          >
            留白待补充
          </button>
          <button
            class="btn btn-sm grow"
            :class="{ 'btn-primary': gapMode === 'fill' }"
            type="button"
            @click="setGapMode('fill')"
          >
            写满再核对
          </button>
        </div>
        <p v-if="gapMode === 'strict'" class="muted small" style="margin: 8px 0 0; line-height: 1.65">
          缺事实就写「待补充」，不替你编数据、访谈或实验结果。
        </p>
        <div v-else class="fill-note">
          <MarkdownText :text="FILL_DISCLAIMER" />
        </div>
      </div>

      <!-- 状态 -->
      <div class="card card-pad" style="margin-top: 12px">
        <div class="side-title">状态</div>
        <div class="status-seg" role="group" aria-label="报告状态">
          <button
            v-for="s in REPORT_STATUS_ORDER"
            :key="s"
            class="status-btn"
            :class="{ on: draft.status === s }"
            type="button"
            @click="setStatus(s)"
          >
            {{ REPORT_STATUS_LABEL[s] }}
          </button>
        </div>
        <p class="muted small status-hint">
          {{ draft.status === 'confirmed' ? '已作为后续材料的既定事实。' : '确认前请自己通读一遍，AI 不代你确认。' }}
        </p>
      </div>

      <!-- 导出 -->
      <div class="card card-pad" style="margin-top: 12px">
        <div class="side-title">导出</div>
        <label class="field">
          <span class="field-label">文件名</span>
          <input v-model="exportName" class="input" :placeholder="defaultName" />
        </label>
        <div class="row" style="gap: 6px; margin-top: 8px">
          <button class="btn btn-sm btn-primary grow" type="button" :disabled="exporting" @click="exportDocx">
            {{ exporting ? '生成中…' : 'DOCX' }}
          </button>
          <button class="btn btn-sm grow" type="button" @click="exportMarkdown">Markdown</button>
          <button class="btn btn-sm grow" type="button" @click="exportPdf">PDF</button>
        </div>
        <p class="muted small" style="margin: 6px 0 0">
          PDF 走系统打印：在打印窗口把目标打印机选为「另存为 PDF」。版式以打印预览为准，交学校仍以 DOCX 为准。
        </p>
        <div class="row" style="gap: 6px; margin-top: 8px">
          <button class="btn btn-sm grow" type="button" @click="previewOpen = true">预览版式</button>
          <button class="btn btn-sm grow" type="button" :disabled="docxLoading" @click="previewDocx">
            {{ docxLoading ? '渲染中…' : '预览 DOCX' }}
          </button>
        </div>
        <label v-if="draft.kind === 'final'" class="chk" style="margin-top: 10px">
          <input v-model="addCover" type="checkbox" />
          <span>加封面和目录</span>
        </label>
        <p class="muted small" style="margin: 8px 0 0; line-height: 1.65">
          <template v-if="draft.kind === 'final'">
            学校范例是纯长文，默认不加封面目录。勾上后会在正文前插入封面与目录域（首次打开需右键「更新域」）。
          </template>
          <template v-else>
            行数、列宽、标签文字、字号都按学校下发的表格原样导出，不改格式。
          </template>
        </p>
      </div>

      <div class="card card-pad" style="margin-top: 12px">
        <div class="side-title">模拟内容</div>
        <p class="muted small" style="margin: 0; line-height: 1.7">
          {{ simSections.length ? `本报告有 ${simSections.length} 节含模拟内容，导出时会加提示框。` : '本报告暂无模拟内容标记。' }}
        </p>
        <button class="btn btn-sm btn-block" style="margin-top: 10px" type="button" @click="cleanAiMarks">
          清理 AI 标注
        </button>
      </div>

      <button class="btn btn-sm btn-block" style="margin-top: 12px" type="button" :disabled="generating !== null || blocking.length > 0" @click="generateAll">
        逐节起草（跳过教师栏）
      </button>
    </div>

    <!-- 预览 -->
    <DocxPreview
      :open="docxPreviewOpen"
      :blob="docxBlob"
      :loading="docxLoading"
      title="DOCX 预览"
      @close="docxPreviewOpen = false"
    />

    <div v-if="previewOpen" class="modal-scrim" @click.self="previewOpen = false">
      <div class="preview">
        <div class="preview-bar">
          <b>版式预览</b>
          <span class="muted small">近似效果，分页与字体以 Word 为准</span>
          <button class="x" type="button" aria-label="关闭" @click="previewOpen = false">×</button>
        </div>
        <div class="paper">
          <div class="paper-head">
            <div class="paper-school">{{ store.current?.school || '研究性学习' }}</div>
            <h1>{{ draft.title }}</h1>
            <div class="paper-meta">
              <span>课题：{{ store.current?.topic }}</span>
              <span>成员：{{ store.current?.members.map((m) => m.name).join('、') }}</span>
              <span>指导教师：{{ store.current?.teacher }}</span>
            </div>
          </div>
          <div v-for="s in previewSections" :key="s.id" class="paper-sec">
            <h2 :class="`lv${s.level}`">{{ s.heading }}</h2>
            <!-- 正文本身是 Markdown：预览里也要按格式显示，不能露出 ** 和 - -->
            <div class="paper-body">
              <MarkdownText :text="s.body || '（本节尚未填写）'" />
            </div>
            <span v-if="s.containsSimulated" class="paper-sim">（AI 模拟示例）</span>
          </div>
          <div class="paper-refs">
            <h2>参考文献</h2>
            <p v-if="!store.sources.length">（暂无来源，导出时会提示补充）</p>
            <p v-for="(s, i) in store.sources" :key="s.id">
              [{{ i + 1 }}] {{ s.authors || '作者未填' }}. {{ s.title }}. {{ s.date || '' }}
              <template v-if="s.verifyStatus !== 'verified'">【待核实】</template>
              <span class="ref-type">{{ SOURCE_TYPE_LABEL[s.sourceType] }}</span>
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 模板导入 -->
    <div v-if="importOpen" class="modal-scrim" @click.self="importOpen = false">
      <div class="import">
        <div class="preview-bar">
          <b>导入模板</b>
          <button class="x" type="button" aria-label="关闭" @click="importOpen = false">×</button>
        </div>
        <p class="muted small" style="margin: 0 0 12px; line-height: 1.7">
          支持 .docx / .md / .txt。只识别标题结构，不复制原文档样式、表格与图片；套用后仍可在 Word 里手动调整。
        </p>
        <button class="btn btn-sm btn-primary" type="button" @click="importFile?.click()">选择文件</button>
        <input ref="importFile" type="file" accept=".docx,.md,.txt" hidden @change="onImportFile" />

        <div v-if="detected.length" class="detected">
          <div class="detected-head">识别到 {{ detected.length }} 个标题 · {{ importName }}</div>
          <ul>
            <li v-for="(h, i) in detected" :key="i" :style="{ paddingLeft: (h.level - 1) * 16 + 'px' }">
              <span class="det-lv">H{{ h.level }}</span>
              <span class="det-text">{{ h.text }}</span>
              <span class="det-via">{{ h.via }}</span>
            </li>
          </ul>
          <div class="row" style="margin-top: 12px">
            <button class="btn btn-sm btn-primary" type="button" :disabled="importing" @click="applyTemplate">
              {{ importing ? '套用中…' : '套用到本报告' }}
            </button>
            <button class="btn btn-sm" type="button" @click="detected = []">重新选择</button>
          </div>
        </div>
        <div class="row" style="margin-top: 14px">
          <button class="btn btn-sm" type="button" @click="resetTemplate">恢复内置通用模板</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor { display: grid; grid-template-columns: 196px 1fr 224px; gap: 16px; padding: 18px 20px 40px; }
.toc { display: flex; flex-direction: column; gap: 2px; position: sticky; top: 12px; align-self: start; }
.toc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; padding: 0 4px; gap: 6px; }
.toc-title { font-size: calc(12px * var(--font-scale)); color: var(--text-3); font-weight: var(--fw-medium); }
.toc-item {
  display: flex; align-items: center; gap: 8px; text-align: left;
  padding: 8px 10px; border-radius: var(--r-1); border: none; background: transparent;
  color: var(--text-3); font-size: calc(12.5px * var(--font-scale)); cursor: pointer; line-height: 1.4;
  transition: background var(--dur-2), color var(--dur-2);
}
.toc-item:hover { background: var(--surface); color: var(--text-2); }
.toc-item.on { background: var(--surface-2); color: var(--text); }
.toc-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; opacity: 0.45; flex: 0 0 5px; }
.toc-item.done .toc-dot { opacity: 1; background: var(--ok); }
.toc-name { flex: 1; min-width: 0; }
.toc-req { font-size: calc(9.5px * var(--font-scale)); color: var(--danger); flex: 0 0 auto; }
.toc-actions { display: flex; gap: 4px; margin-top: 8px; }
.mini {
  flex: 1; height: 28px; border: 1px solid var(--line); border-radius: var(--r-full);
  background: transparent; color: var(--text-3); font: inherit; font-size: calc(10.5px * var(--font-scale)); cursor: pointer;
}
.mini:hover { border-color: var(--line-strong); color: var(--text-2); }

.body { min-width: 0; }
.tpl-note {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 9px 12px; margin-bottom: 12px;
  background: var(--surface-2); border-radius: var(--r-1);
}
.tpl-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--warn); margin-top: 7px; flex: 0 0 5px; }
.tpl-note p { margin: 0; font-size: calc(11.5px * var(--font-scale)); line-height: 1.65; color: var(--text-3); }

.body-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
.sec-title { font-size: calc(18px * var(--font-scale)); margin: 0; }
.sec-meta { display: flex; align-items: center; gap: 10px; margin-top: 5px; font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); flex-wrap: wrap; }
.hint-row { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 10px; }
.hint {
  flex: 1; font-size: calc(12px * var(--font-scale)); color: var(--text-3); line-height: 1.7; padding: 9px 12px;
  background: var(--surface-2); border-radius: var(--r-1);
}
.main-input { min-height: 380px; font-size: calc(14px * var(--font-scale)); line-height: 1.85; }
.blank { padding: 40px; text-align: center; font-size: calc(12.5px * var(--font-scale)); color: var(--text-3); }

.side { position: sticky; top: 12px; align-self: start; }
.side-title { font-size: calc(12.5px * var(--font-scale)); font-weight: var(--fw-medium); color: var(--text-2); margin-bottom: 10px; }
.fill-note {
  margin: 8px 0 0; padding: 8px 10px;
  font-size: calc(11px * var(--font-scale)); line-height: 1.65; color: var(--warn);
  background: color-mix(in srgb, var(--warn) 10%, transparent);
  border-radius: var(--r-2);
}
/* 项目进度：一条 3px 的细线，别喧宾夺主 */
.prog { margin-bottom: 12px; }
.prog-track {
  height: 3px; border-radius: var(--r-full); overflow: hidden;
  background: var(--surface-2);
}
.prog-track i {
  display: block; height: 100%; min-width: 3px;
  background: var(--brand);
  transition: width 400ms cubic-bezier(0.215, 0.61, 0.355, 1);
}
.prog-text {
  display: block; margin-top: 6px;
  font-size: var(--fs-1); color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.gaps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.gaps li { display: flex; align-items: flex-start; gap: 7px; font-size: var(--fs-1); line-height: 1.7; }
/* 起草前检索：一行小勾选，别做成大开关把侧栏撑开 */
.pref-row {
  display: flex; align-items: center; gap: 7px;
  margin-bottom: 12px; cursor: pointer;
  font-size: var(--fs-1); color: var(--text-3); line-height: 1.5;
}
.pref-row input { flex: 0 0 auto; width: 14px; height: 14px; margin: 0; accent-color: var(--brand); }
/* 标签不再抢走正文宽度：钉在小胶囊里且不换行，文字列可以正常折行 */
.gaps b {
  flex: 0 0 auto; white-space: nowrap;
  padding: 1px 7px; border-radius: var(--r-full);
  background: var(--surface-2);
  color: var(--warn); font-weight: var(--fw-strong); font-size: var(--fs-1); line-height: 1.6;
}
.gaps li.block b { color: var(--danger); }
.gaps span { flex: 1 1 auto; min-width: 0; color: var(--text-2); overflow-wrap: anywhere; word-break: break-word; text-wrap: pretty; }
.gaps i { display: block; font-style: normal; font-size: var(--fs-1); color: var(--text-3); margin-top: 3px; }

.status-seg {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px;
  padding: 4px; border-radius: var(--r-2); background: var(--surface-2);
}
.status-btn {
  height: 30px; border: none; border-radius: var(--r-full); background: transparent;
  color: var(--text-3); font-size: calc(11.5px * var(--font-scale)); cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.status-btn:hover { color: var(--text); }
.status-btn.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-1); font-weight: var(--fw-medium); }
.status-hint { margin: 8px 0 0; line-height: 1.6; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: calc(11px * var(--font-scale)); color: var(--text-3); }

.modal-scrim {
  position: fixed; inset: 0; z-index: 110;
  background: var(--scrim);
  display: grid; place-items: center; padding: 20px;
}
.preview, .import {
  width: min(760px, 100%); max-height: 86dvh;
  background: var(--bg); border-radius: var(--r-4);
  box-shadow: var(--shadow-3); overflow: hidden;
  display: flex; flex-direction: column;
  animation: pop var(--dur-3) var(--spring-over);
}
@keyframes pop { from { opacity: 0; transform: translateY(10px) scale(0.985); } to { opacity: 1; transform: none; } }
.preview-bar { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--line); }
.preview-bar b { flex: 1; font-size: calc(14px * var(--font-scale)); }
.import { padding-bottom: 16px; }
.import > :not(.preview-bar) { margin-left: 18px; margin-right: 18px; }
.import > .preview-bar { margin: 0 0 14px; }
.x { width: 30px; height: 30px; border: none; background: transparent; color: var(--text-3); font-size: calc(20px * var(--font-scale)); border-radius: 50%; cursor: pointer; }

.paper {
  flex: 1; overflow-y: auto;
  background: #fff; color: #1a1a1a;
  padding: 32px 40px 48px;
  font-family: var(--font-serif);
}
.paper-head { text-align: center; margin-bottom: 26px; }
.paper-body { font-size: calc(12.5px * var(--font-scale)); line-height: 1.9; color: #1a1a1a; }
.paper-body :deep(.md) { color: inherit; font-size: inherit; line-height: inherit; }
.paper-school { font-size: calc(13px * var(--font-scale)); color: #444; margin-bottom: 6px; }
.paper-head h1 { font-size: calc(22px * var(--font-scale)); margin: 0 0 10px; color: #1a1a1a; }
.paper-meta { display: flex; flex-direction: column; gap: 3px; font-size: calc(11.5px * var(--font-scale)); color: #444; }
.paper-sec { margin-bottom: 16px; }
.paper-sec h2 { font-size: calc(14px * var(--font-scale)); margin: 0 0 6px; color: #1a1a1a; }
.paper-sec h2.lv2 { font-size: calc(13px * var(--font-scale)); margin-left: 12px; }
.paper-sec p { margin: 0 0 6px; font-size: calc(12.5px * var(--font-scale)); line-height: 1.9; text-indent: 2em; color: #1a1a1a; }
.paper-sim { font-size: calc(10.5px * var(--font-scale)); color: #a33; }
.paper-refs { margin-top: 24px; padding-top: 14px; border-top: 1px solid #e6e6e2; }
.paper-refs h2 { font-size: calc(14px * var(--font-scale)); margin: 0 0 8px; color: #1a1a1a; }
.paper-refs p { margin: 0 0 5px; font-size: calc(11.5px * var(--font-scale)); line-height: 1.7; color: #1a1a1a; }
.ref-type { margin-left: 6px; color: #666; }

.detected { margin-top: 14px; border-top: 1px solid var(--line); padding-top: 12px; }
.detected-head { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); margin-bottom: 8px; }
.detected ul { list-style: none; margin: 0; padding: 0; max-height: 240px; overflow-y: auto; }
.detected li { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: calc(12.5px * var(--font-scale)); }
.det-lv { font-size: calc(9.5px * var(--font-scale)); color: var(--text-3); background: var(--surface-2); padding: 1px 5px; border-radius: var(--r-full); }
.det-text { flex: 1; }
.det-via { font-size: calc(10px * var(--font-scale)); color: var(--text-3); }

@media (max-width: 1180px) {
  .editor { grid-template-columns: 170px 1fr; }
  .side { grid-column: 1 / -1; position: static; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .side > * { margin-top: 0 !important; }
}
@media (max-width: 760px) {
  .editor { grid-template-columns: 1fr; padding: 12px 14px 60px; }
  .toc { position: static; flex-direction: row; overflow-x: auto; gap: 6px; padding-bottom: 6px; }
  .toc-head, .toc-actions { display: none; }
  .toc-item { flex: 0 0 auto; background: var(--surface); white-space: nowrap; }
  .main-input { min-height: 300px; }
  .side { grid-template-columns: 1fr; }
  .hint-row { flex-direction: column; }
  .modal-scrim { padding: 0; }
  .preview { width: 100%; max-height: none; height: 100dvh; border-radius: 0; }
  .preview-bar { padding-top: calc(14px + env(safe-area-inset-top, 0px)); }
  .paper { padding: 18px 16px 40px; }
}
</style>
