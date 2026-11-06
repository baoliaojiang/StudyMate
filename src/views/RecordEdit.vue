<script setup lang="ts">
/**
 * 单篇研究记录（独立页面）
 *
 * 为什么不做抽屉：记录是要反复改的东西，抽屉里只看得见半屏，
 * 底部按钮还会被手势条压住。这里改成整页，进得去、出得来、能单独导出。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import type { Attachment, StudyRecord } from '../core/types';
import { RECORD_FIELDS } from '../reports/templates';
import {
  buildRecordFlow,
  recordPrompt,
  repairRecordDraft,
  recorderOf,
  type RecordDraftFields,
} from '../core/record-content';
import { useAiProgress } from '../core/ai-progress';
import AiProgress from '../components/AiProgress.vue';
import { cleanRecord, hasAiMarks, AI_CLEAN_WARNING } from '../core/ai-clean';
import { askConfirm } from '../core/task-guard';
import { buildRecordsDocx } from '../docx/builder';
import DocxPreview from '../components/DocxPreview.vue';
import { resizeImage } from '../core/image';
import { getAgent } from '../agents/definitions';
import { AgentRuntime } from '../agents/runtime';
import { exportRecordDocx, shareRecordDocx } from '../export/record';
import { isNativePlatform } from '../export/save';

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const store = useProjectStore();

const draft = ref<StudyRecord | null>(null);
const generating = ref(false);
const warnings = ref<string[]>([]);
const saving = ref(false);
const exporting = ref(false);
const canShare = isNativePlatform();

const progress = useAiProgress();

const previewBlob = ref<Blob | null>(null);
const previewOpen = ref(false);
const previewLoading = ref(false);

const index = computed(() => Number(route.params.index ?? 0));

onMounted(async () => {
  try {
    if (!store.current || store.current.id !== String(route.params.id)) {
      await store.open(String(route.params.id));
    }
    const found = store.records.find((r) => r.index === index.value);
    if (!found) {
      app.toast('找不到这一篇记录', 'error');
      router.replace(`/project/${route.params.id}?tab=records`);
      return;
    }
    const loaded: StudyRecord = JSON.parse(JSON.stringify(found));
    if (!loaded.recorder && store.current) loaded.recorder = recorderOf(store.current);
    if (!loaded.recordedAt) loaded.recordedAt = new Date().toISOString().slice(0, 10);
    draft.value = loaded;
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '打不开这一篇', 'error', 5000);
    router.replace(`/project/${route.params.id}?tab=records`);
  }
});

const termText = computed(() => (draft.value?.term === 1 ? '上学期' : '下学期'));

/** 参与成员用顿号串输入 */
const participantsText = computed({
  get: () => (draft.value?.participants ?? []).join('、'),
  set: (v: string) => {
    if (!draft.value) return;
    draft.value.participants = v
      .split(/[、,，;；\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  },
});

function back() {
  router.replace(`/project/${route.params.id}?tab=records`);
}

async function save(alsoConfirm = false) {
  if (!draft.value) return;
  if (alsoConfirm && !draft.value.work.trim()) {
    app.toast('「本阶段主要研究工作」为空，不能确认为真实记录', 'warn');
    return;
  }
  saving.value = true;
  try {
    if (draft.value.sourceType === 'simulated' && !draft.value.work.includes('（AI 模拟示例）')) {
      draft.value.work = `（AI 模拟示例）\n${draft.value.work}`;
    }
    if (alsoConfirm) draft.value.confirmed = true;
    await store.saveRecord(draft.value);
    app.toast(alsoConfirm ? '已保存并确认为真实记录' : '已保存', 'ok', 1600);
    if (alsoConfirm) back();
  } catch (e) {
    // 保存失败必须说出来：以前这里只有 finally，写库报错会静默丢掉整页内容
    app.toast(`保存失败：${e instanceof Error ? e.message : String(e)}`, 'error', 6000);
  } finally {
    saving.value = false;
  }
}

/**
 * 让 AI 起草：提示词、承上启下与兜底都走 core/record-content，
 * 上下文只给本篇之前的记录，正文经 repairRecordDraft 逐栏补齐。
 */
async function generate() {
  const rec = draft.value;
  if (!rec || !store.current) return;
  const project = store.current;
  generating.value = true;
  warnings.value = [];
  progress.start('record', `正在起草第 ${rec.index} 篇记录`);
  try {
    progress.to('collect');
    const agent = getAgent('report-writer')!;
    const runtime = new AgentRuntime(app.gateway);

    const flow = buildRecordFlow(project, store.records, rec.index);
    progress.to('history');
    progress.to('scope', '已确定要承接上一篇的下一步');

    const prompt = recordPrompt(
      flow,
      {
        activityName: rec.activityName,
        stageName: rec.stageName,
        goal: rec.goal,
        work: rec.work,
        outputs: rec.outputs,
        summary: rec.summary,
        recorder: rec.recorder,
      },
      project,
      ['goal', 'work', 'materials', 'outputs', 'summary', 'nextPlan'],
    );

    progress.to('model', '模型正在写…');
    const result = await runtime.run(
      'report-writer',
      agent,
      {
        project,
        records: store.records.filter((r) => r.index < rec.index),
        activities: [],
        datasets: [],
        sources: store.sources,
      },
      prompt,
    );

    progress.to('verify', '检查占位词与收尾');
    const json = extractJson(result.text);
    if (!json) throw new Error('模型返回格式无法解析，请手动填写或重试');
    const { fields, repaired } = repairRecordDraft(json as RecordDraftFields, flow);
    rec.goal = fields.goal ?? rec.goal;
    rec.work = fields.work ?? rec.work;
    rec.materials = fields.materials ?? rec.materials;
    rec.outputs = fields.outputs ?? rec.outputs;
    rec.summary = fields.summary ?? rec.summary;
    rec.nextPlan = fields.nextPlan ?? rec.nextPlan;
    rec.recorder = fields.recorder ?? rec.recorder;
    if (!rec.activityName && fields.activityName) rec.activityName = fields.activityName;
    if (!rec.stageName && fields.stageName) rec.stageName = fields.stageName;
    warnings.value = result.warnings;
    progress.to('write');
    if (repaired.length) {
      app.toast(`有 ${repaired.length} 栏被自动补成完整内容，请核对`, 'ok', 4200);
    } else {
      app.toast('草稿已填入，请逐项核对', 'ok');
    }
    progress.finish('已写好，记得核对');
  } catch (e) {
    progress.fail(e instanceof Error ? e.message : String(e));
    app.toast(e instanceof Error ? e.message : String(e), 'error', 6000);
  } finally {
    generating.value = false;
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return null;
  }
}

/** 一键清理 AI 生成标注：只改草稿，不自动落库，用户自己点保存 */
async function cleanAiMarks() {
  const rec = draft.value;
  if (!rec) return;
  const keys = ['goal', 'work', 'materials', 'outputs', 'summary', 'nextPlan'] as const;
  const textOf = rec as unknown as Record<string, string>;
  if (!keys.some((k) => hasAiMarks(textOf[k] ?? ''))) {
    app.toast('这一篇里没有可清理的 AI 标注', 'info');
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
  const out = cleanRecord(rec);
  draft.value = out.record;
  app.toast(`已清理 ${out.removed} 处，点「保存」后生效`, 'ok', 4200);
}

async function previewOne(rec: StudyRecord) {
  if (!store.current) return;
  const project = store.current;
  previewLoading.value = true;
  previewBlob.value = null;
  previewOpen.value = true;
  try {
    previewBlob.value = await buildRecordsDocx(project, [rec], store.sources);
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '预览生成失败', 'error', 5000);
  } finally {
    previewLoading.value = false;
  }
}

async function addAttachments(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!draft.value) return;
  for (const file of files) {
    if (draft.value.attachments.length >= 8) {
      app.toast('一篇记录最多 8 个附件', 'warn');
      break;
    }
    const isImage = file.type.startsWith('image/');
    if (file.size > 12 * 1024 * 1024) {
      app.toast(`${file.name} 超过 12MB，已跳过`, 'warn', 3000);
      continue;
    }
    const item: Attachment = {
      id: `att-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      name: file.name,
      size: file.size,
      kind: isImage ? 'image' : 'file',
    };
    if (isImage) {
      try {
        item.dataUrl = await resizeImage(file, 1200);
      } catch {
        app.toast(`${file.name} 读取失败`, 'warn');
        continue;
      }
    }
    draft.value.attachments.push(item);
  }
  input.value = '';
}

function removeAttachment(id: string) {
  if (!draft.value) return;
  draft.value.attachments = draft.value.attachments.filter((a) => a.id !== id);
}

async function doExport(pick: boolean) {
  if (!draft.value || !store.current) return;
  exporting.value = true;
  try {
    const r = await exportRecordDocx(store.current, draft.value, store.sources, { pick });
    app.toast(r.note, r.how === 'cancelled' ? 'info' : 'ok', 3200);
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '导出失败', 'error', 5000);
  } finally {
    exporting.value = false;
  }
}

async function doShare() {
  if (!draft.value || !store.current) return;
  exporting.value = true;
  try {
    const r = await shareRecordDocx(store.current, draft.value, store.sources);
    app.toast(r.note, 'ok', 3200);
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '分享失败', 'error', 5000);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div class="head">
      <button class="back" type="button" aria-label="返回" @click="back">←</button>
      <div class="grow">
        <div class="eyebrow">第 {{ index }} 篇 · {{ termText }}</div>
        <h1>{{ draft?.stageName || draft?.activityName || '研究记录' }}</h1>
      </div>
      <span class="chip" :class="draft?.confirmed ? 'chip-ok' : draft?.work ? 'chip-accent' : ''">
        {{ draft?.confirmed ? '已确认' : draft?.work ? '已填' : '空' }}
      </span>
    </div>

    <div v-if="!draft" class="loading-page muted small">正在打开…</div>

    <template v-else>
      <div class="pane">
        <div class="board">
          <AiProgress :progress="progress" />

          <label class="field">
            <span class="field-label">这次做了什么</span>
            <input v-model="draft.activityName" class="input" placeholder="一句话说明这一篇的活动" />
          </label>

          <label class="field">
            <span class="field-label">阶段名称</span>
            <input v-model="draft.stageName" class="input" placeholder="例如：第一阶段 资料准备" />
          </label>

          <div class="two">
            <label class="field">
              <span class="field-label">起迄时间 · 开始</span>
              <input v-model="draft.startDate" class="input" type="date" />
            </label>
            <label class="field">
              <span class="field-label">起迄时间 · 结束</span>
              <input v-model="draft.endDate" class="input" type="date" />
            </label>
          </div>

          <div class="two">
            <label class="field">
              <span class="field-label">地点</span>
              <input v-model="draft.place" class="input" placeholder="选填" />
            </label>
            <label class="field">
              <span class="field-label">参与成员</span>
              <input v-model="participantsText" class="input" placeholder="用顿号分开：张三、李四" />
            </label>
          </div>

          <div class="two">
            <label class="field">
              <span class="field-label">记录人</span>
              <input v-model="draft.recorder" class="input" placeholder="选填" />
            </label>
            <label class="field">
              <span class="field-label">记录时间</span>
              <input v-model="draft.recordedAt" class="input" type="date" />
            </label>
          </div>

          <label v-for="f in RECORD_FIELDS" :key="f.key" class="field">
            <span class="field-label">{{ f.label }}</span>
            <textarea
              v-model="(draft as any)[f.key]"
              class="textarea"
              :style="{ minHeight: f.key === 'work' || f.key === 'summary' ? '132px' : '84px' }"
              :placeholder="f.hint"
            />
          </label>

          <div v-if="warnings.length" class="banner banner-warn">
            <div v-for="w in warnings" :key="w">{{ w }}</div>
          </div>

          <div class="attach">
            <div class="row-between">
              <b>附件</b>
              <label class="btn btn-sm" style="cursor: pointer">
                加附件
                <input type="file" accept="image/*,.pdf,.docx,.txt" hidden multiple @change="addAttachments" />
              </label>
            </div>
            <ul v-if="draft.attachments.length" class="att-list">
              <li v-for="a in draft.attachments" :key="a.id">
                <span class="grow">{{ a.name }}</span>
                <button class="x" type="button" @click="removeAttachment(a.id)">移除</button>
              </li>
            </ul>
            <p v-else class="muted small">照片、问卷照片可以放这里，导出时不会带出去。</p>
          </div>
        </div>
      </div>

      <div class="foot">
        <button class="btn btn-sm" type="button" :disabled="exporting" @click="doExport(false)">
          {{ exporting ? '导出中…' : '导出 DOCX' }}
        </button>
        <button class="btn btn-sm" type="button" :disabled="exporting" @click="doExport(true)">另存为…</button>
        <button class="btn btn-sm" type="button" :disabled="previewLoading" @click="previewOne(draft)">
          {{ previewLoading ? '预览生成中…' : '预览 DOCX' }}
        </button>
        <button v-if="canShare" class="btn btn-sm" type="button" :disabled="exporting" @click="doShare">分享</button>
        <button class="btn btn-sm" type="button" @click="cleanAiMarks">清理 AI 标注</button>
        <div class="grow" />
        <button class="btn btn-sm btn-primary" type="button" :disabled="generating" @click="generate">
          {{ generating ? '正在起草…' : 'AI 生成初稿' }}
        </button>
        <button class="btn btn-sm" type="button" :disabled="saving" @click="save(false)">保存</button>
        <button class="btn btn-sm btn-primary" type="button" :disabled="saving" @click="save(true)">保存并确认真实</button>
      </div>
    </template>

    <DocxPreview
      :open="previewOpen"
      :blob="previewBlob"
      :loading="previewLoading"
      :title="`第 ${index} 篇 · 研究记录`"
      @close="previewOpen = false"
    />
  </div>
</template>

<style scoped>
.page { padding: 0 0 96px; }
.head {
  display: flex; align-items: flex-start; gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5) var(--sp-3);
}
.head .grow { min-width: 0; }
.head h1 { font-size: var(--fs-4); letter-spacing: -0.02em; margin-top: 2px; }
.eyebrow { font-size: var(--fs-1); color: var(--text-3); }
.back {
  width: 36px; height: 36px; flex: 0 0 36px;
  border-radius: 50%; border: none;
  background: var(--surface-2); color: var(--text); cursor: pointer;
}
.back:hover { background: var(--surface-3); }
.loading-page { padding: var(--sp-5); }
.pane { padding: 0 var(--sp-5) var(--sp-6); }
.board {
  display: flex; flex-direction: column; gap: var(--sp-3);
  background: var(--surface); border-radius: var(--r-4); padding: var(--sp-4);
}
.two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: var(--fs-1); color: var(--text-2); }
.attach { border-top: 1px solid var(--line); padding-top: var(--sp-3); }
.att-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.att-list li { display: flex; align-items: center; gap: 8px; font-size: var(--fs-1); }
.x { background: none; border: none; color: var(--danger); cursor: pointer; font-size: var(--fs-1); }
.foot {
  position: sticky; bottom: 0; z-index: 5;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px var(--sp-5) calc(10px + var(--safe-bottom, env(safe-area-inset-bottom, 0px)));
  background: var(--bg);
  border-top: 1px solid var(--line);
}
@media (max-width: 720px) {
  .two { grid-template-columns: 1fr; }
  .head { padding: var(--sp-3) var(--sp-4) var(--sp-2); }
  .pane { padding: 0 var(--sp-4) var(--sp-5); }
  .foot { padding: 10px var(--sp-4) calc(10px + var(--safe-bottom, env(safe-area-inset-bottom, 0px))); }
}
</style>
