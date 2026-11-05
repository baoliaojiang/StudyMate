<script setup lang="ts">
/**
 * 检索服务
 *
 * 多服务并存：顺序可调、可单独停用、可各自填 Key 与限流。
 * 检索按模式选服务（网页 / 学术 / 新闻 / 本地文件），结果合并去重。
 * 学术接口遵守各家的速率要求；商业搜索需要用户自己的 Key，Key 加密存在本机。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { backOr } from '../../core/nav';
import { useAppStore } from '../../stores/app';
import { maskKey, open_, seal } from '../../core/crypto';
import {
  CAPABILITY_LABEL,
  SEARCH_MODE_LABEL,
  SEARCH_PRESETS,
  type SearchMode,
} from '../../search/presets';
import {
  runCombinedSearch,
  testSearchProvider,
  type CombinedSearch,
  type SearchHit,
} from '../../search/providers';
import {
  importLocalFile,
  listLocalFiles,
  removeLocalFile,
} from '../../search/local';
import { db, type LocalFileRow } from '../../core/db';
import type { SearchCapability, SearchProviderConfig } from '../../core/types';
import SubPage from '../../components/settings/SubPage.vue';

const app = useAppStore();
const router = useRouter();

const providers = computed(() => app.settings.searchProviders);
const localFiles = ref<LocalFileRow[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

const busyId = ref('');
const notices = ref<Record<string, string>>({});

const expanded = ref<string | null>(null);
const keyDraft = ref('');
const showKey = ref(false);

const mode = ref<SearchMode>('academic');
const query = ref('');
const site = ref('');
const fulltext = ref(false);
const searching = ref(false);
const result = ref<CombinedSearch | null>(null);

const enabledCount = computed(() => providers.value.filter((p) => p.enabled).length);

function back() {
  backOr(router, '/settings');
}

async function persist(next: SearchProviderConfig[]) {
  await app.setSearchProviders(next.map((p) => ({ ...p, apiKey: undefined })));
}

function patch(id: string, changes: Partial<SearchProviderConfig>) {
  void persist(providers.value.map((p) => (p.id === id ? { ...p, ...changes } : p)));
}

async function toggle(id: string, on: boolean) {
  patch(id, { enabled: on });
}

async function move(id: string, delta: number) {
  const list = providers.value.slice().sort((a, b) => a.priority - b.priority);
  const i = list.findIndex((p) => p.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i];
  const b = list[j];
  const pa = a.priority;
  a.priority = b.priority;
  b.priority = pa;
  // 相同优先级时用顺序兜底，避免调不动
  list.forEach((p, idx) => (p.priority = idx * 10 + 10));
  await persist(list);
}

function capabilityOf(p: SearchProviderConfig) {
  return p.capabilities ?? [];
}

async function addPreset(kind: string) {
  const preset = SEARCH_PRESETS.find((p) => p.kind === kind);
  if (!preset) return;
  if (providers.value.some((p) => p.kind === preset.kind && !p.baseUrl === !preset.baseUrl)) {
    app.toast('该服务已在列表中', 'warn');
    return;
  }
  const maxPriority = providers.value.reduce((m, p) => Math.max(m, p.priority), 0);
  const next: SearchProviderConfig = {
    id: `${preset.kind}-${Date.now().toString(36)}`,
    label: preset.label,
    kind: preset.kind,
    baseUrl: preset.baseUrl || undefined,
    enabled: false,
    priority: maxPriority + 10,
    capabilities: [...preset.capabilities],
    rateLimitPerMin: preset.rateLimitPerMin,
    needsKey: preset.needsKey,
    docs: preset.docs,
  };
  await persist([...providers.value, next]);
  expanded.value = next.id;
  app.toast('已添加，填好配置后手动启用', 'ok', 2600);
}

function removeProvider(id: string) {
  const p = providers.value.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`从列表移除「${p.label}」？已保存的密钥会一并删除。`)) return;
  void persist(providers.value.filter((x) => x.id !== id));
}

async function resolveKey(p: SearchProviderConfig): Promise<string> {
  if (p.apiKey) return p.apiKey;
  if (p.apiKeySealed) {
    try {
      return await open_(p.apiKeySealed);
    } catch {
      return '';
    }
  }
  return '';
}

async function saveKey(p: SearchProviderConfig) {
  const raw = keyDraft.value.trim();
  if (!raw) {
    app.toast('请先输入密钥', 'warn');
    return;
  }
  if (raw.length < 6) {
    app.toast('密钥长度异常，请核对后重试', 'warn');
    return;
  }
  const sealed = await seal(raw);
  await persist(
    providers.value.map((x) =>
      x.id === p.id
        ? { ...x, apiKey: undefined, apiKeySealed: sealed, apiKeyPreview: maskKey(raw) }
        : x,
    ),
  );
  keyDraft.value = '';
  showKey.value = false;
  app.toast('密钥已加密保存到本机', 'ok');
}

async function clearKey(p: SearchProviderConfig) {
  if (!confirm(`删除「${p.label}」的密钥？`)) return;
  await persist(
    providers.value.map((x) =>
      x.id === p.id ? { ...x, apiKey: undefined, apiKeySealed: undefined, apiKeyPreview: '' } : x,
    ),
  );
}

async function test(p: SearchProviderConfig) {
  busyId.value = p.id;
  notices.value[p.id] = '测试中…';
  try {
    const key = await resolveKey(p);
    if (p.needsKey && !key) {
      notices.value[p.id] = '尚未填写密钥，无法测试。';
      return;
    }
    const res = await testSearchProvider(p, key);
    notices.value[p.id] = `${res.ok ? '通过' : '未通过'} · ${res.latencyMs} ms · ${res.message}`;
    await persist(
      providers.value.map((x) =>
        x.id === p.id
          ? { ...x, lastTest: { at: Date.now(), ok: res.ok, message: res.message, latencyMs: res.latencyMs } }
          : x,
      ),
    );
  } finally {
    busyId.value = '';
  }
}

/** 把密钥解密出来参与组合检索，但不写回 settings */
async function withKeys(list: SearchProviderConfig[]): Promise<SearchProviderConfig[]> {
  return Promise.all(
    list
      .filter((p) => p.enabled)
      .map(async (p) => ({ ...p, apiKey: p.apiKey ?? (await resolveKey(p)) })),
  );
}

async function search() {
  const q = query.value.trim();
  if (!q) {
    app.toast('请输入检索关键词', 'warn');
    return;
  }
  searching.value = true;
  result.value = null;
  try {
    const ready = await withKeys(providers.value);
    result.value = await runCombinedSearch(ready, {
      query: q,
      mode: mode.value,
      site: site.value.trim() || undefined,
      fulltext: fulltext.value,
      limit: 10,
    });
    if (!result.value.hits.length) app.toast('没有结果，看看各服务的提示', 'info', 3000);
  } finally {
    searching.value = false;
  }
}

function loadFiles() {
  void listLocalFiles().then((f) => (localFiles.value = f));
}

async function pickFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  for (const f of files) {
    try {
      await importLocalFile(f);
    } catch (err) {
      app.toast(err instanceof Error ? err.message : '导入失败', 'warn', 3600);
    }
  }
  loadFiles();
}

async function dropFile(id: string) {
  await removeLocalFile(id);
  loadFiles();
}

function sizeText(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** 未添加的预设，用于底部快速添加 */
const candidates = computed(() =>
  SEARCH_PRESETS.filter((p) => !providers.value.some((x) => x.kind === p.kind)),
);

onMounted(loadFiles);
</script>

<template>
  <SubPage
    title="检索服务"
    subtitle="同时使用多个检索服务：网页、学术、新闻、指定域名与本地文件。检索结果不等于事实，保存后默认为「待核实」。"
    @back="back"
  >
    <div class="summary">
      <div><b class="tnum">{{ enabledCount }}</b><span>已启用</span></div>
      <div><b class="tnum">{{ providers.length }}</b><span>已配置</span></div>
      <div><b class="tnum">{{ localFiles.length }}</b><span>本地文件</span></div>
    </div>

    <div class="sec-head">
      <h3>服务与优先级</h3>
      <span class="muted small">从上到下依次检索，结果按顺序轮转合并</span>
    </div>

    <div class="list">
      <div v-for="(p, i) in providers" :key="p.id" class="card">
        <div class="row-top">
          <span class="order tnum">{{ i + 1 }}</span>
          <div class="grow">
            <div class="title">
              {{ p.label }}
              <span v-if="p.needsKey" class="tag" :class="p.apiKeyPreview ? 'ok' : 'warn'">
                {{ p.apiKeyPreview ? '已配置密钥' : '需密钥' }}
              </span>
            </div>
            <div class="caps">
              <span v-for="c in capabilityOf(p)" :key="c" class="cap">{{ CAPABILITY_LABEL[c] }}</span>
            </div>
          </div>
          <label class="switch" @click.stop>
            <input type="checkbox" :checked="p.enabled" @change="toggle(p.id, ($event.target as HTMLInputElement).checked)" />
            <span />
          </label>
        </div>

        <div class="meta">
          <span>限流 {{ p.rateLimitPerMin ?? 20 }} 次/分</span>
          <a v-if="p.docs" :href="p.docs" target="_blank" rel="noopener noreferrer">官方文档</a>
          <span v-if="p.apiKeyPreview" class="mono">{{ p.apiKeyPreview }}</span>
        </div>

        <div class="acts">
          <button class="mini" type="button" :disabled="i === 0" @click="move(p.id, -1)">上移</button>
          <button class="mini" type="button" :disabled="i === providers.length - 1" @click="move(p.id, 1)">下移</button>
          <button class="mini" type="button" :disabled="busyId === p.id" @click="test(p)">
            {{ busyId === p.id ? '测试中…' : '测试' }}
          </button>
          <button class="mini" type="button" @click="expanded = expanded === p.id ? null : p.id">
            {{ expanded === p.id ? '收起配置' : '配置' }}
          </button>
          <button class="mini danger" type="button" @click="removeProvider(p.id)">移除</button>
        </div>

        <p v-if="notices[p.id]" class="notice" :class="{ bad: notices[p.id].includes('未通过') }">
          {{ notices[p.id] }}
        </p>
        <p v-else-if="p.lastTest" class="notice">
          上次测试 {{ new Date(p.lastTest.at).toLocaleString('zh-CN', { hour12: false }) }} ·
          {{ p.lastTest.ok ? '通过' : '未通过' }} · {{ p.lastTest.latencyMs }} ms
        </p>

        <div v-if="expanded === p.id" class="config">
          <label class="field">
            <span class="field-label">接口地址</span>
            <input
              class="input mono"
              :value="p.baseUrl"
              placeholder="https://example.com"
              spellcheck="false"
              @change="patch(p.id, { baseUrl: ($event.target as HTMLInputElement).value.trim() || undefined })"
            />
          </label>

          <label v-if="p.needsKey" class="field">
            <span class="field-label">API Key</span>
            <div class="key-row">
              <input
                v-model="keyDraft"
                class="input grow mono"
                :type="showKey ? 'text' : 'password'"
                :placeholder="p.apiKeyPreview ? `已保存 ${p.apiKeyPreview}，留空则不修改` : '输入密钥，仅保存于本机'"
                autocomplete="off"
                spellcheck="false"
              />
              <button class="mini" type="button" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button>
              <button class="mini" type="button" @click="saveKey(p)">保存</button>
              <button v-if="p.apiKeyPreview" class="mini danger" type="button" @click="clearKey(p)">删除</button>
            </div>
            <span class="hint">AES-GCM 加密后写入本机数据库，不写入日志、链接或导出文件。</span>
          </label>

          <label class="field">
            <span class="field-label">每分钟请求上限</span>
            <input
              class="input"
              type="number"
              min="0"
              max="600"
              :value="p.rateLimitPerMin"
              @change="patch(p.id, { rateLimitPerMin: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })"
            />
            <span class="hint">按各服务条款设置；0 表示不限流（不建议）。</span>
          </label>

          <div class="field">
            <span class="field-label">能力</span>
            <div class="caps edit">
              <label v-for="(label, key) in CAPABILITY_LABEL" :key="key" class="cap-chk">
                <input
                  type="checkbox"
                  :checked="capabilityOf(p).includes(key as SearchCapability)"
                  @change="
                    patch(p.id, {
                      capabilities: ($event.target as HTMLInputElement).checked
                        ? [...capabilityOf(p), key as SearchCapability]
                        : capabilityOf(p).filter((c) => c !== key),
                    })
                  "
                />
                <span>{{ label }}</span>
              </label>
            </div>
            <span class="hint">勾选的能力决定这个服务在哪种模式下会被调用；接口本身不支持的能力勾了也不会生效。</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="candidates.length" class="add-block">
      <div class="sec-head"><h3>添加服务</h3></div>
      <div class="preset-row">
        <button v-for="c in candidates" :key="c.kind" class="preset" type="button" :title="c.note" @click="addPreset(c.kind)">
          + {{ c.label }}
        </button>
      </div>
      <p class="hint">OpenAlex、Crossref、arXiv 无需密钥；商业搜索需要你自己的 Key，免费额度以官网为准。</p>
    </div>

    <div class="sec-head" style="margin-top: 26px">
      <h3>组合检索预览</h3>
      <span class="muted small">按当前启用的服务与优先级执行，结果不自动保存</span>
    </div>

    <div class="search-box">
      <input v-model="query" class="input grow" placeholder="关键词，如 校园食品安全 中学生 认知" @keydown.enter="search" />
      <button class="btn btn-sm btn-primary" type="button" :disabled="searching" @click="search">
        {{ searching ? '检索中…' : '检索' }}
      </button>
    </div>
    <div class="chips">
      <button
        v-for="(label, key) in SEARCH_MODE_LABEL"
        :key="key"
        class="chip"
        :class="{ on: mode === key }"
        type="button"
        @click="mode = key as SearchMode"
      >
        {{ label }}
      </button>
    </div>
    <div class="opts">
      <label class="inline">
        <span>限定域名</span>
        <input v-model="site" class="input" placeholder="如 gov.cn，留空不限" />
      </label>
      <label class="chk">
        <input v-model="fulltext" type="checkbox" />
        <span>尝试抓取网页正文（受 CORS 限制，失败只保留摘要）</span>
      </label>
    </div>

    <div v-if="result" class="results">
      <div v-for="o in result.outcomes" :key="o.provider" class="outcome">
        <b>{{ o.provider }}</b>
        <span>{{ o.message }}</span>
        <span v-if="o.error" class="err">{{ o.error }}</span>
      </div>
      <div v-for="(h, i) in result.hits" :key="i" class="hit card">
        <div class="hit-title">{{ h.title }}</div>
        <div class="hit-meta">
          <span v-if="h.authors">{{ h.authors }}</span>
          <span v-if="h.institution">· {{ h.institution }}</span>
          <span v-if="h.date">· {{ h.date }}</span>
          <span v-if="h.doi" class="mono">· DOI {{ h.doi }}</span>
          <span class="src">· {{ h.provider }}</span>
        </div>
        <p v-if="h.abstract" class="hit-abs">{{ h.abstract }}</p>
        <div class="hit-foot">
          <a v-if="h.url" :href="h.url" target="_blank" rel="noopener noreferrer" class="mini-link">打开原文</a>
          <span class="hint">保存到来源请在项目的「资料」里操作，保存后默认待核实</span>
        </div>
      </div>
      <p v-if="!result.hits.length" class="empty">没有合并后的结果。看上面各服务的提示。</p>
    </div>

    <div class="sec-head" style="margin-top: 26px">
      <h3>本地文件</h3>
      <span class="muted small">只检索本机导入的纯文本，不联网</span>
    </div>
    <div class="file-row">
      <button class="btn btn-sm" type="button" @click="fileInput?.click()">导入 txt / md</button>
      <input ref="fileInput" type="file" multiple accept=".txt,.md,.markdown,.csv,.log" hidden @change="pickFiles" />
      <span class="hint">单个文件不超过 2 MB；内容原样存在本机 IndexedDB。</span>
    </div>
    <div v-if="localFiles.length" class="files">
      <div v-for="f in localFiles" :key="f.id" class="file">
        <span class="grow">{{ f.name }}</span>
        <span class="hint">{{ sizeText(f.size) }}</span>
        <button class="mini danger" type="button" @click="dropFile(f.id)">删除</button>
      </div>
    </div>
    <p v-else class="empty">还没有导入文件。导入后可在「本地文件」模式下检索。</p>
  </SubPage>
</template>

<style scoped>
.summary {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 1px; background: var(--line); overflow: hidden;
  border-radius: var(--r-3); margin-bottom: 18px;
}
.summary > div {
  background: var(--surface); padding: 12px 14px;
  display: flex; flex-direction: column; gap: 2px;
}
.summary b { font-size: 19px; font-weight: var(--fw-strong); }
.summary span { font-size: 11px; color: var(--text-3); }

.sec-head {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 10px; margin-bottom: 10px; flex-wrap: wrap;
}
.sec-head h3 { margin: 0; font-size: 13px; color: var(--text-2); font-weight: var(--fw-strong); }

.list { display: flex; flex-direction: column; gap: 8px; }
.card {
  background: var(--surface); border-radius: var(--r-3);
  padding: 12px 14px;
}
.row-top { display: flex; align-items: flex-start; gap: 10px; }
.order {
  width: 22px; height: 22px; flex: 0 0 22px; display: grid; place-items: center;
  border-radius: 7px; background: var(--surface-3);
  font-size: 11px; color: var(--text-3);
}
.title { font-size: 13.5px; font-weight: var(--fw-strong); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tag { font-size: 9.5px; padding: 2px 6px; border-radius: 4px; background: var(--surface-3); color: var(--text-3); font-weight: var(--fw-normal); }
.tag.ok { background: rgba(47, 107, 87, 0.14); color: #2f6b57; }
.tag.warn { background: rgba(138, 90, 0, 0.14); color: #8a5a00; }
.caps { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.cap {
  font-size: 10.5px; padding: 2px 7px; border-radius: var(--r-full);
  background: var(--surface-2); color: var(--text-3);
}
.meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; font-size: 11px; color: var(--text-3); }
.meta a { color: var(--primary); }
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.mini {
  border: none; border-radius: var(--r-full); padding: 4px 11px;
  background: var(--surface-2); color: var(--text-2);
  font-size: 11.5px; cursor: pointer;
  transition: background var(--dur-1) var(--ease-out);
}
.mini:hover { background: var(--surface-3); }
.mini:disabled { opacity: 0.45; cursor: default; }
.mini.danger { color: var(--danger); }
.notice { margin: 8px 0 0; font-size: 11px; color: var(--text-3); line-height: 1.6; }
.notice.bad { color: var(--danger); }

.config { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: 11.5px; color: var(--text-3); }
.key-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.key-row .input { min-width: 160px; }
.hint { font-size: 11px; color: var(--text-3); line-height: 1.6; }
.caps.edit { gap: 8px 14px; }
.cap-chk { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text-2); cursor: pointer; }
.cap-chk input { accent-color: var(--primary); }

.add-block { margin-top: 18px; }
.preset-row { display: flex; flex-wrap: wrap; gap: 6px; }
.preset {
  border: 1px solid var(--line); background: var(--surface); color: var(--text-2);
  border-radius: var(--r-full); padding: 5px 12px; font-size: 11.5px; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out);
}
.preset:hover { background: var(--surface-2); border-color: var(--line-strong); }

.search-box { display: flex; gap: 8px; }
.chips { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.chip {
  border: none; background: var(--surface-2); color: var(--text-3);
  border-radius: var(--r-full); padding: 5px 13px; font-size: 12px; cursor: pointer;
}
.chip.on { background: var(--text); color: var(--bg); }
.opts { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.inline { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-3); }
.inline .input { max-width: 220px; }
.chk { display: flex; align-items: flex-start; gap: 8px; font-size: 11.5px; color: var(--text-3); line-height: 1.6; }
.chk input { margin-top: 2px; accent-color: var(--primary); }

.results { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }
.outcome { font-size: 11.5px; color: var(--text-3); display: flex; flex-direction: column; gap: 2px; }
.outcome b { color: var(--text-2); font-weight: var(--fw-medium); }
.outcome .err { color: var(--danger); }
.hit { padding: 11px 13px; }
.hit-title { font-size: 13px; font-weight: var(--fw-strong); line-height: 1.5; }
.hit-meta { font-size: 11px; color: var(--text-3); margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }
.hit-abs {
  margin: 7px 0 0; font-size: 11.5px; color: var(--text-2); line-height: 1.65;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.hit-foot { display: flex; align-items: center; gap: 12px; margin-top: 8px; flex-wrap: wrap; }
.mini-link { font-size: 11.5px; color: var(--primary); }

.file-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.files { display: flex; flex-direction: column; gap: 1px; background: var(--line); border-radius: var(--r-2); overflow: hidden; margin-top: 10px; }
.file { display: flex; align-items: center; gap: 10px; padding: 9px 12px; background: var(--surface); font-size: 12px; }
.empty { color: var(--text-3); font-size: 12px; padding: 10px 0; }

@media (max-width: 620px) {
  .summary b { font-size: 17px; }
  .search-box { flex-direction: column; }
  .key-row .input { min-width: 0; flex: 1 1 100%; }
}
</style>
