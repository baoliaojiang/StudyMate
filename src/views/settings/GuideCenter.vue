<script setup lang="ts">
/**
 * 免费 API 指引
 *
 * 按 AI 模型 / 网页搜索 / 学术检索 / 本地模型 / 文档工具分类。
 * 每个服务给出官网、注册入口、免费额度、是否要信用卡、Key 教程、Base URL、
 * 模型示例、配置步骤、限制与最后核对日期；额度一律以官方页面为准。
 * 目录支持从 GitHub 上的 JSON / Markdown 更新，失败时退回缓存与内置数据。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { backOr } from '../../core/nav';
import { useAppStore } from '../../stores/app';
import { CATEGORY_LABEL, type ServiceCategory, type ServiceEntry } from '../../guides/catalog';
import { builtinCatalog, loadCatalog, clearCatalogCache, type CatalogLoad } from '../../guides/load';
import { useCopyFeedback } from '../../core/copy';
import SubPage from '../../components/settings/SubPage.vue';

const app = useAppStore();
const router = useRouter();

const data = ref<CatalogLoad>(builtinCatalog());
const loading = ref(false);
const kw = ref('');
const cat = ref<ServiceCategory | ''>('');
const openId = ref<string | null>(null);
const urlDraft = ref(app.settings.catalog.url);
const urlOpen = ref(false);
const { copied, copy } = useCopyFeedback();

const cats = Object.keys(CATEGORY_LABEL) as ServiceCategory[];

const counts = computed(() => {
  const m = {} as Record<ServiceCategory, number>;
  for (const c of cats) m[c] = data.value.items.filter((x) => x.category === c).length;
  return m;
});

const list = computed(() => {
  const q = kw.value.trim().toLowerCase();
  return data.value.items
    .filter((s) => (!cat.value || s.category === cat.value) && (!q || `${s.name}${s.freeQuota}${s.keyGuide}`.toLowerCase().includes(q)))
    // 推荐的排最前，其余按名称
    .sort((a, b) => {
      const r = Number(Boolean(b.recommended)) - Number(Boolean(a.recommended));
      if (r) return r;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
});

const sourceLabel = computed(
  () => ({ remote: '远端目录', cache: '本机缓存', builtin: '内置数据' })[data.value.source],
);

const creditLabel = (v: ServiceEntry['creditCard']) =>
  v === 'no' ? '无需信用卡' : v === 'yes' ? '需要信用卡' : '信用卡要求未知';

async function sync() {
  loading.value = true;
  try {
    data.value = await loadCatalog(urlDraft.value);
    if (data.value.source === 'remote') {
      await app.setCatalog({ url: urlDraft.value.trim(), lastSyncAt: Date.now(), source: 'remote' });
      app.toast('目录已更新', 'ok');
    } else if (data.value.error) {
      app.toast(data.value.error, 'warn', 5200);
    }
  } finally {
    loading.value = false;
  }
}

async function useBuiltin() {
  clearCatalogCache();
  urlDraft.value = '';
  data.value = builtinCatalog();
  await app.setCatalog({ url: '', lastSyncAt: 0, source: 'builtin' });
  app.toast('已切回内置目录', 'info');
}

async function copySnippet(s: ServiceEntry) {
  if (!s.configSnippet) {
    app.toast('该服务没有可复制的配置示例', 'info');
    return;
  }
  const ok = await copy(s.configSnippet);
  app.toast(ok ? '配置示例已复制' : '复制失败，请手动选择文本', ok ? 'ok' : 'warn');
}

function back() {
  backOr(router, '/settings');
}

onMounted(async () => {
  data.value = await loadCatalog(app.settings.catalog.url);
  urlDraft.value = app.settings.catalog.url;
});
</script>

<template>
  <SubPage
    title="免费 API 指引"
    subtitle="额度、价格与政策随时会变，均以服务商官方页面为准；本软件不承诺任何服务永久免费。"
    @back="back"
  >
    <div class="bar">
      <input v-model="kw" class="input grow" placeholder="搜索服务名、额度或取 Key 方式" />
      <button class="btn btn-sm" type="button" :disabled="loading" @click="sync">
        {{ loading ? '更新中…' : '更新目录' }}
      </button>
    </div>

    <div class="chips">
      <button class="chip" :class="{ on: cat === '' }" type="button" @click="cat = ''">
        全部 {{ data.items.length }}
      </button>
      <button v-for="c in cats" :key="c" class="chip" :class="{ on: cat === c }" type="button" @click="cat = c">
        {{ CATEGORY_LABEL[c] }} {{ counts[c] }}
      </button>
    </div>

    <div class="meta">
      <span>数据来源：{{ sourceLabel }} · 更新于 {{ data.updatedAt || '—' }}</span>
      <button class="link" type="button" @click="urlOpen = !urlOpen">{{ urlOpen ? '收起设置' : '目录设置' }}</button>
    </div>

    <div v-if="urlOpen" class="url-box">
      <label class="field">
        <span class="field-label">远端目录地址（GitHub raw / 静态托管）</span>
        <input
          v-model="urlDraft"
          class="input mono"
          placeholder="https://raw.githubusercontent.com/<owner>/<repo>/main/catalog/services.json"
          spellcheck="false"
        />
      </label>
      <p class="hint">
        支持 JSON，也支持 Markdown 里放一个 ```json 代码块。文件只需写要覆盖或新增的条目，其余继续用内置数据；
        加载失败时自动退回本机缓存。仓库模板见 <code>public/catalog/services.json</code>。
      </p>
      <div class="row">
        <button class="btn btn-sm btn-primary" type="button" @click="sync">保存并更新</button>
        <button class="btn btn-sm" type="button" @click="useBuiltin">恢复内置目录</button>
      </div>
    </div>

    <p class="note">
      索引里的「免费额度」只描述是否存在免费档，不给出可能过期的具体数字；
      需要精确额度时请点开官网核对。标「信用卡要求未知」表示未能从官方页面确认，不代表一定不需要。
    </p>

    <div class="list">
      <article v-for="s in list" :key="s.id" class="item">
        <button class="head" type="button" @click="openId = openId === s.id ? null : s.id">
          <div class="grow">
            <div class="name">
              {{ s.name }}
              <span v-if="s.recommended" class="tag rec">推荐</span>
              <span v-if="s.beta" class="tag">Beta</span>
              <span class="tag plain">{{ CATEGORY_LABEL[s.category] }}</span>
            </div>
            <div class="quota">{{ s.freeQuota }}</div>
          </div>
          <span class="credit" :class="s.creditCard">{{ creditLabel(s.creditCard) }}</span>
          <span class="chev" :class="{ on: openId === s.id }">›</span>
        </button>

        <div v-if="openId === s.id" class="detail">
          <div class="links">
            <a :href="s.site" target="_blank" rel="noopener noreferrer">官网</a>
            <a v-if="s.signup" :href="s.signup" target="_blank" rel="noopener noreferrer">注册 / 控制台</a>
            <a v-if="s.docs" :href="s.docs" target="_blank" rel="noopener noreferrer">官方文档</a>
          </div>

          <dl class="kv">
            <dt>取 Key</dt>
            <dd>{{ s.keyGuide }}</dd>
            <template v-if="s.baseUrl">
              <dt>Base URL</dt>
              <dd class="mono">{{ s.baseUrl }}</dd>
            </template>
            <template v-if="s.models?.length">
              <dt>模型示例</dt>
              <dd class="models">
                <code v-for="m in s.models" :key="m">{{ m }}</code>
              </dd>
            </template>
            <dt>核对日期</dt>
            <dd class="tnum">{{ s.verifiedAt }}</dd>
          </dl>

          <div class="block">
            <div class="block-title">配置步骤</div>
            <ol class="steps">
              <li v-for="(x, i) in s.steps" :key="i">{{ x }}</li>
            </ol>
          </div>

          <div class="block">
            <div class="block-title">限制与注意</div>
            <ul class="limits">
              <li v-for="(x, i) in s.limits" :key="i">{{ x }}</li>
            </ul>
          </div>

          <button
            v-if="s.configSnippet"
            class="btn btn-sm btn-block"
            type="button"
            @click="copySnippet(s)"
          >
            <span class="copy-swap" :class="{ on: copied }">
              <span class="copy-a">复制配置示例</span>
              <span class="copy-b">已复制</span>
            </span>
          </button>
        </div>
      </article>
      <p v-if="!list.length" class="empty">没有匹配的服务，换个关键词或切回「全部」。</p>
    </div>
  </SubPage>
</template>

<style scoped>
/* 推荐标记：跟 Beta 区分开，用强调色 */
.tag.rec {
  background: var(--primary-soft);
  color: var(--primary);
}
.bar { display: flex; gap: 8px; }
.chips { display: flex; gap: 6px; overflow-x: auto; padding: 12px 0 4px; scrollbar-width: none; }
.chips::-webkit-scrollbar { display: none; }
.chip {
  flex: 0 0 auto; border: none; border-radius: var(--r-full);
  background: var(--surface-2); color: var(--text-3);
  padding: 5px 13px; font-size: calc(12px * var(--font-scale)); cursor: pointer;
}
.chip.on { background: var(--text); color: var(--bg); }

.meta {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin: 10px 0 0; font-size: calc(11px * var(--font-scale)); color: var(--text-3);
}
.link { border: none; background: none; color: var(--primary); font-size: calc(11px * var(--font-scale)); cursor: pointer; }
.url-box { margin-top: 10px; padding: 12px 14px; background: var(--surface); border-radius: var(--r-3); }
.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); }
.hint { font-size: calc(11px * var(--font-scale)); color: var(--text-3); line-height: 1.65; margin: 8px 0 0; }
.row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.note { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); line-height: 1.7; margin: 14px 0 6px; }

.list { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.item { background: var(--surface); border-radius: var(--r-3); overflow: hidden; }
.head {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 12px 14px; border: none; background: none; text-align: left; cursor: pointer;
}
.name { font-size: calc(13.5px * var(--font-scale)); font-weight: var(--fw-strong); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tag {
  font-size: calc(9.5px * var(--font-scale)); padding: 2px 6px; border-radius: 4px;
  background: rgba(138, 90, 0, 0.14); color: #8a5a00; font-weight: var(--fw-normal);
}
.tag.plain { background: var(--surface-3); color: var(--text-3); }
.quota { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); margin-top: 4px; line-height: 1.55; }
.credit { flex: 0 0 auto; font-size: calc(10px * var(--font-scale)); padding: 3px 7px; border-radius: var(--r-full); background: var(--surface-2); color: var(--text-3); }
.credit.no { background: rgba(47, 107, 87, 0.12); color: #2f6b57; }
.credit.yes { background: rgba(169, 80, 47, 0.12); color: #a9502f; }
.chev { flex: 0 0 auto; color: var(--text-3); font-size: calc(17px * var(--font-scale)); transition: transform var(--dur-2) var(--ease-out); }
.chev.on { transform: rotate(90deg); }

.detail { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 12px; }
.links { display: flex; gap: 14px; flex-wrap: wrap; }
.links a { font-size: calc(11.5px * var(--font-scale)); color: var(--primary); }
.kv { display: grid; grid-template-columns: 66px 1fr; gap: 6px 10px; margin: 0; }
.kv dt { font-size: calc(11px * var(--font-scale)); color: var(--text-3); }
.kv dd { margin: 0; font-size: calc(12px * var(--font-scale)); color: var(--text-2); line-height: 1.6; word-break: break-all; }
.models { display: flex; flex-wrap: wrap; gap: 5px; }
.models code {
  font-family: var(--font-mono); font-size: calc(10.5px * var(--font-scale)); padding: 1px 6px;
  border-radius: 4px; background: var(--surface-2); color: var(--text-2);
}
.block-title { font-size: calc(11px * var(--font-scale)); color: var(--text-3); margin-bottom: 5px; }
.steps, .limits { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.steps li, .limits li { font-size: calc(11.5px * var(--font-scale)); color: var(--text-2); line-height: 1.7; }
.empty { color: var(--text-3); font-size: calc(12px * var(--font-scale)); padding: 14px 0; }
@media (max-width: 620px) {
  .credit { display: none; }
}
</style>
