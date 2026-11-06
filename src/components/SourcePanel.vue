<script setup lang="ts">
/**
 * 资料与来源
 *
 * 每条来源要能回答：谁写的、哪年、从哪来、什么时候查到的、核验没有、
 * 被哪一段报告用上了。字段留空就显示「未填」，不用「暂无」糊过去。
 * 检索结果默认「待核实」——搜索结果不是事实证明。
 */
import { computed, reactive, ref } from 'vue';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import { hitToSource, runSearch, type SearchHit } from '../search/providers';
import { db } from '../core/db';
import { uid } from '../core/id';
import { REPORT_KIND_LABEL, SOURCE_TYPE_LABEL, type Source, type SourceType } from '../core/types';

const app = useAppStore();
const store = useProjectStore();

const query = ref('');
const searching = ref(false);
const hits = ref<SearchHit[]>([]);
const messages = ref<string[]>([]);
const expanded = ref<string | null>(null);

const SOURCE_TYPES = Object.keys(SOURCE_TYPE_LABEL) as SourceType[];

const blankForm = () => ({
  title: '',
  authors: '',
  institution: '',
  date: '',
  url: '',
  doi: '',
  abstract: '',
  sourceType: 'literature' as SourceType,
});
const manual = ref(false);
const form = ref(blankForm());

/** DOI 只做格式判断，能不能解析要看出版方 */
const DOI_RE = /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/;
function doiIssue(doi: string): string {
  if (!doi.trim()) return '';
  return DOI_RE.test(doi.trim()) ? '' : 'DOI 格式不完整（形如 10.xxxx/xxxxx）';
}

async function search() {
  const q = query.value.trim();
  if (!q) {
    app.toast('先输入检索词', 'warn', 2000);
    return;
  }
  const enabled = app.settings.searchProviders.filter((p) => p.enabled);
  hits.value = [];
  messages.value = [];
  if (!enabled.length) {
    messages.value = [
      '没有启用任何检索服务。到「设置 → 检索与来源」打开 OpenAlex / Crossref / arXiv（学术）或通用网页搜索，也可以直接点右上角「手动添加」。',
    ];
    return;
  }

  searching.value = true;
  try {
    const outcomes = await runSearch(app.settings.searchProviders, q, 8);
    for (const o of outcomes) {
      hits.value.push(...o.hits);
      messages.value.push(`【${o.provider}】${o.message}${o.error ? `（${o.error}）` : ''}`);
    }
    // 一条结果都没有时也要说清楚，不能让界面看起来「点了没反应」
    if (!hits.value.length) {
      messages.value.push(
        `没有检索到「${q}」的结果。可以换更通用的关键词，或到设置里测试这些服务的连通性（部分学术接口在境内访问会超时）。`,
      );
    }
  } catch (e) {
    messages.value = [
      `检索失败：${e instanceof Error ? e.message : String(e)}。检查网络后重试，或先用「手动添加」把已知来源录进来。`,
    ];
  } finally {
    searching.value = false;
  }
}

async function addHit(h: SearchHit) {
  if (!store.current) return;
  const exists = store.sources.some((s) => (h.doi && s.doi === h.doi) || (h.url && s.url === h.url));
  if (exists) {
    app.toast('这条来源已经在列表里了', 'warn', 1800);
    return;
  }
  const src = hitToSource(store.current.id, h);
  await store.addSource(src);
  expanded.value = src.id;
  app.toast('已加入来源，状态为「待核实」', 'ok');
}

async function addManual() {
  if (!store.current || !form.value.title.trim()) {
    app.toast('至少填标题', 'warn');
    return;
  }
  const f = form.value;
  await store.addSource({
    id: uid('src'),
    projectId: store.current.id,
    title: f.title.trim(),
    authors: f.authors.trim(),
    institution: f.institution.trim(),
    date: f.date.trim(),
    url: f.url.trim(),
    doi: f.doi.trim(),
    abstract: f.abstract.trim(),
    retrievedAt: Date.now(),
    sourceType: f.sourceType,
    verifyStatus: 'unverified',
    provider: 'manual',
    query: '',
    fullText: '',
    notes: '',
    linkedSections: [],
  });
  manual.value = false;
  form.value = blankForm();
  app.toast('已添加，状态为「待核实」', 'ok');
}

async function persist(s: Source) {
  await db.sources.put(JSON.parse(JSON.stringify(s)));
}

async function verify(s: Source) {
  s.verifyStatus = s.verifyStatus === 'verified' ? 'unverified' : 'verified';
  await persist(s);
  app.toast(s.verifyStatus === 'verified' ? '已标记为已核验' : '已改回待核实', 'ok', 1600);
}

async function remove(id: string) {
  if (expanded.value === id) expanded.value = null;
  await store.removeSource(id);
}

function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id;
}

/* ---------------- 关联报告段落 ---------------- */

interface SectionRef {
  key: string;
  reportId: string;
  reportTitle: string;
  sectionId: string;
  heading: string;
  on: boolean;
}

/** 当前项目所有报告的章节，勾选后写进 linkedSections */
function sectionRefs(s: Source): SectionRef[] {
  const out: SectionRef[] = [];
  for (const r of store.reports) {
    for (const sec of r.sections) {
      out.push({
        key: `${r.id}:${sec.id}`,
        reportId: r.id,
        reportTitle: `${REPORT_KIND_LABEL[r.kind] ?? r.kind} · ${r.title}`,
        sectionId: sec.id,
        heading: sec.heading,
        on: Boolean(s.linkedSections?.some((l) => l.reportId === r.id && l.sectionId === sec.id)),
      });
    }
  }
  return out;
}

async function toggleLink(s: Source, ref_: SectionRef) {
  const list = s.linkedSections ? [...s.linkedSections] : [];
  const i = list.findIndex((l) => l.reportId === ref_.reportId && l.sectionId === ref_.sectionId);
  if (i >= 0) list.splice(i, 1);
  else list.push({ reportId: ref_.reportId, sectionId: ref_.sectionId });
  s.linkedSections = list;
  await persist(s);
}

function linkedCount(s: Source) {
  return s.linkedSections?.length ?? 0;
}

/* ---------------- 其余 ---------------- */

function timeLabel(ts: number) {
  if (!ts) return '未记录';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 导出可粘贴的引用行，没有的字段不硬凑 */
function citation(s: Source) {
  const who = s.authors || s.institution || '作者未填';
  const year = s.date ? `（${s.date}）` : '';
  const tail = s.doi ? `DOI: ${s.doi}` : s.url ? s.url : '无 DOI / URL';
  return `${who}${year}. ${s.title}[EB/OL]. ${tail}. 检索于 ${timeLabel(s.retrievedAt).slice(0, 10)}.`;
}

const copied = ref('');
async function copyCitation(s: Source) {
  try {
    await navigator.clipboard.writeText(citation(s));
    copied.value = s.id;
    window.setTimeout(() => (copied.value = ''), 1600);
  } catch {
    app.toast('复制失败，请手动选中文本', 'warn', 3000);
  }
}

const editing = reactive<Record<string, Partial<Source>>>({});
function startEdit(s: Source) {
  editing[s.id] = {
    title: s.title,
    authors: s.authors,
    institution: s.institution ?? '',
    date: s.date,
    url: s.url,
    doi: s.doi,
    abstract: s.abstract,
    sourceType: s.sourceType,
  };
}
function cancelEdit(id: string) {
  delete editing[id];
}

async function saveEdit(s: Source) {
  const e = editing[s.id];
  if (!e) return;
  if (!String(e.title ?? '').trim()) {
    app.toast('标题不能为空', 'warn');
    return;
  }
  Object.assign(s, {
    title: String(e.title).trim(),
    authors: String(e.authors ?? '').trim(),
    institution: String(e.institution ?? '').trim(),
    date: String(e.date ?? '').trim(),
    url: String(e.url ?? '').trim(),
    doi: String(e.doi ?? '').trim(),
    abstract: String(e.abstract ?? '').trim(),
    sourceType: e.sourceType ?? s.sourceType,
  });
  await persist(s);
  delete editing[s.id];
  app.toast('已保存', 'ok', 1500);
}

const verifiedCount = computed(() => store.sources.filter((s) => s.verifyStatus === 'verified').length);
</script>

<template>
  <div class="wrap">
    <div class="head-row">
      <div>
        <h2 class="h">资料与来源</h2>
        <p class="muted small sub">
          {{ store.sources.length }} 条 · 已核验 {{ verifiedCount }} 条 · 检索结果默认「待核实」，看过原文再标已核验
        </p>
      </div>
      <button class="btn btn-sm" type="button" @click="manual = !manual">
        {{ manual ? '收起' : '手动添加' }}
      </button>
    </div>

    <div class="row search-row">
      <input
        v-model="query"
        class="input grow"
        placeholder="关键词，如 校园食品安全 中学生 认知"
        @keydown.enter="search"
      />
      <button class="btn btn-sm btn-primary" type="button" :disabled="searching" @click="search">
        {{ searching ? '检索中…' : '检索' }}
      </button>
    </div>

    <div class="sources-note">
      检索走你启用的服务（OpenAlex、Crossref、arXiv、通用网页搜索等），结果只是线索，不是事实证明。引用前请打开原文核对。
    </div>

    <div v-for="m in messages" :key="m" class="banner" style="margin-bottom: 8px; font-size: calc(12px * var(--font-scale))">{{ m }}</div>

    <!-- 手动添加 -->
    <div v-if="manual" class="card card-pad form-card">
      <div class="grid2">
        <label class="field full"><span class="field-label">标题 *</span><input v-model="form.title" class="input" /></label>
        <label class="field"><span class="field-label">作者</span><input v-model="form.authors" class="input" placeholder="多人用「、」分隔" /></label>
        <label class="field"><span class="field-label">机构 / 出版方</span><input v-model="form.institution" class="input" placeholder="学校、期刊社、机构名" /></label>
        <label class="field"><span class="field-label">发布日期</span><input v-model="form.date" class="input" placeholder="2025-03-01" /></label>
        <label class="field">
          <span class="field-label">来源类型</span>
          <select v-model="form.sourceType" class="input">
            <option v-for="t in SOURCE_TYPES" :key="t" :value="t">{{ SOURCE_TYPE_LABEL[t] }}</option>
          </select>
        </label>
        <label class="field full">
          <span class="field-label">DOI</span>
          <input v-model="form.doi" class="input" placeholder="10.xxxx/xxxxx" />
          <span v-if="doiIssue(form.doi)" class="field-err">{{ doiIssue(form.doi) }}</span>
        </label>
        <label class="field full"><span class="field-label">URL</span><input v-model="form.url" class="input" /></label>
        <label class="field full">
          <span class="field-label">摘要 / 要点</span>
          <textarea v-model="form.abstract" class="textarea" style="min-height: 76px" />
        </label>
      </div>
      <button class="btn btn-sm btn-primary" type="button" @click="addManual">保存来源</button>
    </div>

    <!-- 检索结果 -->
    <div v-if="hits.length" class="hits">
      <div class="sub-title">检索结果</div>
      <div v-for="(h, i) in hits" :key="i" class="hit card card-pad">
        <div class="hit-title">{{ h.title }}</div>
        <div class="hit-meta">
          <span v-if="h.authors">{{ h.authors }}</span>
          <span v-if="h.institution">· {{ h.institution }}</span>
          <span v-if="h.date">· {{ h.date }}</span>
          <span v-if="h.doi" class="mono">· DOI {{ h.doi }}</span>
          <span v-if="h.via">· via {{ h.via }}</span>
        </div>
        <div v-if="h.abstract" class="hit-abs">{{ h.abstract }}</div>
        <div class="row" style="margin-top: 8px">
          <a v-if="h.url" :href="h.url" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-ghost">打开原文</a>
          <button class="btn btn-sm" type="button" @click="addHit(h)">加入来源</button>
        </div>
      </div>
    </div>

    <!-- 本地来源表 -->
    <div class="sub-title" style="margin-top: 20px">来源表</div>
    <div v-if="!store.sources.length" class="empty-guide">
      <b>还没有来源</b>
      <p>三条路，任选一条：</p>
      <ol>
        <li>上面输入关键词点「检索」，结果默认标「待核实」，看过原文再改成已核验。</li>
        <li>点右上角「手动添加」，把老师给的文献、书、网页逐条录进来。</li>
        <li>检索一直不出结果，多半是学术接口在境内访问超时：到「设置 → 检索与来源」里点「测试」看连通性。</li>
      </ol>
      <p class="muted small">检索结果只是线索，不是事实证明；引用前必须打开原文核对。</p>
    </div>
    <div v-else class="list">
      <div v-for="(s, i) in store.sources" :key="s.id" class="src card">
        <!-- 折叠态 -->
        <button class="src-head" type="button" :aria-expanded="expanded === s.id" @click="toggle(s.id)">
          <span class="src-idx">[{{ i + 1 }}]</span>
          <span class="src-main">
            <span class="src-title">{{ s.title }}</span>
            <span class="src-meta">
              {{ s.authors || s.institution || '作者未填' }}
              <template v-if="s.institution && s.authors"> · {{ s.institution }}</template>
              · {{ s.date || '日期未填' }} · {{ SOURCE_TYPE_LABEL[s.sourceType] }}
              <template v-if="linkedCount(s)"> · 关联 {{ linkedCount(s) }} 段</template>
            </span>
          </span>
          <span class="chip" :class="s.verifyStatus === 'verified' ? 'chip-ok' : 'chip-warn'">
            {{ s.verifyStatus === 'verified' ? '已核验' : '待核实' }}
          </span>
        </button>

        <!-- 展开态 -->
        <div v-if="expanded === s.id" class="src-body">
          <!-- 只读信息 -->
          <dl class="facts">
            <div><dt>作者 / 机构</dt><dd>{{ s.authors || '未填' }}<template v-if="s.institution"> · {{ s.institution }}</template></dd></div>
            <div><dt>发布日期</dt><dd>{{ s.date || '未填' }}</dd></div>
            <div><dt>来源类型</dt><dd>{{ SOURCE_TYPE_LABEL[s.sourceType] }}</dd></div>
            <div><dt>检索时间</dt><dd>{{ timeLabel(s.retrievedAt) }}</dd></div>
            <div v-if="s.query"><dt>检索词</dt><dd class="mono">{{ s.query }}</dd></div>
            <div><dt>来源服务</dt><dd>{{ s.provider === 'manual' ? '手动录入' : s.provider }}</dd></div>
            <div class="full"><dt>DOI</dt><dd class="mono">{{ s.doi || '未填' }}<span v-if="doiIssue(s.doi)" class="field-err inline"> · {{ doiIssue(s.doi) }}</span></dd></div>
            <div class="full">
              <dt>URL</dt>
              <dd>
                <a v-if="s.url" :href="s.url" target="_blank" rel="noopener noreferrer" class="src-url">{{ s.url }}</a>
                <span v-else>未填</span>
              </dd>
            </div>
          </dl>

          <div v-if="s.abstract" class="block">
            <div class="block-title">摘要</div>
            <p class="block-text">{{ s.abstract }}</p>
          </div>
          <div v-if="s.fullText" class="block">
            <div class="block-title">正文摘录</div>
            <p class="block-text clamp">{{ s.fullText }}</p>
          </div>
          <div v-if="s.notes" class="block">
            <div class="block-title">我的备注</div>
            <p class="block-text">{{ s.notes }}</p>
          </div>

          <!-- 关联报告段落 -->
          <div class="block">
            <div class="block-title">
              关联报告段落
              <span class="block-hint">勾选的段落生成时会带上这条来源</span>
            </div>
            <div v-if="!sectionRefs(s).length" class="muted small">这份项目还没有报告章节。</div>
            <div v-else class="links">
              <label v-for="ref_ in sectionRefs(s)" :key="ref_.key" class="link-row">
                <input type="checkbox" :checked="ref_.on" @change="toggleLink(s, ref_)" />
                <span>
                  <b>{{ ref_.heading }}</b>
                  <i>{{ ref_.reportTitle }}</i>
                </span>
              </label>
            </div>
          </div>

          <!-- 编辑 -->
          <div v-if="editing[s.id]" class="edit">
            <div class="grid2">
              <label class="field full"><span class="field-label">标题</span><input v-model="editing[s.id].title" class="input" /></label>
              <label class="field"><span class="field-label">作者</span><input v-model="editing[s.id].authors" class="input" /></label>
              <label class="field"><span class="field-label">机构</span><input v-model="editing[s.id].institution" class="input" /></label>
              <label class="field"><span class="field-label">发布日期</span><input v-model="editing[s.id].date" class="input" /></label>
              <label class="field">
                <span class="field-label">类型</span>
                <select v-model="editing[s.id].sourceType" class="input">
                  <option v-for="t in SOURCE_TYPES" :key="t" :value="t">{{ SOURCE_TYPE_LABEL[t] }}</option>
                </select>
              </label>
              <label class="field full">
                <span class="field-label">DOI</span>
                <input v-model="editing[s.id].doi" class="input" />
                <span v-if="doiIssue(String(editing[s.id].doi ?? ''))" class="field-err">{{ doiIssue(String(editing[s.id].doi ?? '')) }}</span>
              </label>
              <label class="field full"><span class="field-label">URL</span><input v-model="editing[s.id].url" class="input" /></label>
              <label class="field full">
                <span class="field-label">摘要</span>
                <textarea v-model="editing[s.id].abstract" class="textarea" style="min-height: 70px" />
              </label>
            </div>
            <div class="row">
              <button class="btn btn-sm btn-primary" type="button" @click="saveEdit(s)">保存修改</button>
              <button class="btn btn-sm" type="button" @click="cancelEdit(s.id)">取消</button>
            </div>
          </div>

          <div class="row wrap actions">
            <a v-if="s.url" :href="s.url" target="_blank" rel="noopener noreferrer" class="mini-link">打开原文</a>
            <button class="mini-link" type="button" @click="verify(s)">
              {{ s.verifyStatus === 'verified' ? '改回待核实' : '我看过原文，标为已核验' }}
            </button>
            <button class="mini-link" type="button" @click="copyCitation(s)">
              {{ copied === s.id ? '已复制引用' : '复制引用' }}
            </button>
            <button class="mini-link" type="button" @click="editing[s.id] ? cancelEdit(s.id) : startEdit(s)">
              {{ editing[s.id] ? '收起编辑' : '编辑字段' }}
            </button>
            <button class="mini-link danger" type="button" @click="remove(s.id)">删除</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.empty-guide {
  padding: 18px 16px;
  border-radius: var(--r-3);
  background: var(--surface);
  color: var(--text-2);
  font-size: calc(12.5px * var(--font-scale));
  line-height: 1.75;
}
.empty-guide b { display: block; margin-bottom: 6px; font-size: calc(13.5px * var(--font-scale)); color: var(--text); }
.empty-guide p { margin: 0 0 6px; }
.empty-guide ol { margin: 0 0 8px; padding-left: 1.3em; }
.empty-guide li { margin: 3px 0; }
.wrap { padding: 18px 20px 40px; }
.h { font-size: calc(17px * var(--font-scale)); margin: 0; }
.sub { margin: 4px 0 0; }
.head-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.search-row { margin-bottom: 10px; }
.sources-note { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); line-height: 1.65; margin-bottom: 14px; }
.sub-title { font-size: calc(12.5px * var(--font-scale)); font-weight: var(--fw-strong); color: var(--text-2); margin-bottom: 10px; }

.form-card { margin-bottom: 16px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.grid2 .full { grid-column: 1 / -1; }
.field-err { font-size: calc(10.5px * var(--font-scale)); color: var(--danger); margin-top: 3px; }
.field-err.inline { margin: 0; }

.hits { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.hit-title { font-size: calc(14px * var(--font-scale)); font-weight: var(--fw-strong); line-height: 1.5; }
.hit-meta { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap; }
.hit-abs {
  font-size: calc(12px * var(--font-scale)); color: var(--text-2); line-height: 1.65; margin-top: 7px;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}

.list { display: flex; flex-direction: column; gap: 8px; }
.src { overflow: hidden; }
.src-head {
  display: flex; align-items: flex-start; gap: 10px; width: 100%;
  padding: 12px 14px; border: none; background: transparent; color: var(--text);
  font: inherit; text-align: left; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out);
}
.src-head:hover { background: var(--surface-2); }
.src-idx { font-size: calc(11px * var(--font-scale)); color: var(--text-3); font-family: var(--font-mono); padding-top: 2px; flex: 0 0 auto; }
.src-main { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.src-title { font-size: calc(13.5px * var(--font-scale)); font-weight: var(--fw-strong); line-height: 1.5; }
.src-meta { font-size: calc(11px * var(--font-scale)); color: var(--text-3); line-height: 1.5; }
.src-body { padding: 0 14px 14px; border-top: 1px solid var(--line); }

.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; margin: 12px 0 0; }
.facts > div { min-width: 0; }
.facts .full { grid-column: 1 / -1; }
.facts dt { font-size: calc(10.5px * var(--font-scale)); color: var(--text-3); margin-bottom: 3px; }
.facts dd { margin: 0; font-size: calc(12.5px * var(--font-scale)); line-height: 1.55; color: var(--text); word-break: break-word; }
.src-url { color: var(--primary); text-decoration: none; font-size: calc(12px * var(--font-scale)); }
.src-url:hover { text-decoration: underline; }

.block { margin-top: 14px; }
.block-title { font-size: calc(11.5px * var(--font-scale)); font-weight: var(--fw-medium); color: var(--text-2); display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.block-hint { font-weight: 400; font-size: calc(10.5px * var(--font-scale)); color: var(--text-3); }
.block-text { margin: 6px 0 0; font-size: calc(12.5px * var(--font-scale)); line-height: 1.75; color: var(--text-2); white-space: pre-wrap; }
.block-text.clamp { display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }

.links { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.link-row {
  display: flex; align-items: flex-start; gap: 8px; padding: 6px 0;
  font-size: calc(12.5px * var(--font-scale)); cursor: pointer;
}
.link-row + .link-row { border-top: 1px solid var(--line); }
.link-row input { margin-top: 3px; flex: 0 0 auto; }
.link-row b { font-weight: var(--fw-medium); display: block; line-height: 1.5; }
.link-row i { font-style: normal; font-size: calc(10.5px * var(--font-scale)); color: var(--text-3); }

.edit { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.edit .row { gap: 8px; margin-top: 10px; }
.actions { gap: 0; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--line); }
.mini-link {
  background: none; border: none; padding: 4px 0; cursor: pointer;
  font-size: calc(11.5px * var(--font-scale)); color: var(--primary); margin-right: 14px;
}
.mini-link.danger { color: var(--danger); }

@media (max-width: 600px) {
  .wrap { padding: 12px 14px 60px; }
  .grid2 { grid-template-columns: 1fr; }
  .facts { grid-template-columns: 1fr; }
}
</style>
