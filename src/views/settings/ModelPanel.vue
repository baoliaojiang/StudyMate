<script setup lang="ts">
/** 模型服务：服务商、Key、模型列表、预算与检索服务 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { backOr } from '../../core/nav';
import { db, type ProviderRow } from '../../core/db';
import { maskKey, open_, seal } from '../../core/crypto';
import { useAppStore } from '../../stores/app';
import { adapterFor } from '../../ai/providers';
import { ModelListUnsupportedError } from '../../ai/types';
import { uid } from '../../core/id';
import type { ProviderKind } from '../../core/types';
import SettingGroup from '../../components/settings/SettingGroup.vue';
import SubPage from '../../components/settings/SubPage.vue';
import { askConfirm, askPrompt } from '../../core/task-guard';

const app = useAppStore();
const router = useRouter();

/** 返回上一级：有历史原路返回，没有则回设置首页 */
function back() {
  backOr(router, '/settings');
}

const providers = ref<ProviderRow[]>([]);
const editing = ref<ProviderRow | null>(null);
const adding = ref(false);
const apiKeyInput = ref('');
const testing = ref<string | null>(null);
const usage = ref({ calls: 0, failed: 0, cost: 0, tokens: 0, avgDuration: 0 });
const budget = reactive({ ...app.settings.budget });

const presets: { label: string; kind: ProviderKind; baseUrl: string; hint: string }[] = [
  { label: 'OpenAI 兼容', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', hint: '大多数服务商都兼容这套接口' },
  { label: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', hint: '国内直连，价格低' },
  { label: '月之暗面 Kimi', kind: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', hint: '长上下文见长' },
  { label: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', hint: 'Claude 系列' },
  { label: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', hint: 'Key 走 header，不进 URL' },
  { label: '本地 Ollama', kind: 'local', baseUrl: 'http://localhost:11434/v1', hint: '需本机已运行 Ollama' },
  { label: '本地 LM Studio', kind: 'local', baseUrl: 'http://localhost:1234/v1', hint: '需开启本地服务' },
];

const form = reactive({
  label: '',
  kind: 'openai-compatible' as ProviderKind,
  baseUrl: '',
  supportsModelList: true,
  timeoutMs: 60000,
  maxRetries: 1,
});

onMounted(async () => {
  await loadProviders();
  usage.value = await app.gateway.usageSummary();
});

async function loadProviders() {
  providers.value = await db.providers.toArray();
}

function startAdd(preset?: (typeof presets)[number]) {
  adding.value = true;
  editing.value = null;
  apiKeyInput.value = '';
  form.label = preset?.label ?? '';
  form.kind = preset?.kind ?? 'openai-compatible';
  form.baseUrl = preset?.baseUrl ?? '';
  form.supportsModelList = preset?.kind !== 'local';
}

async function startEdit(p: ProviderRow) {
  adding.value = false;
  editing.value = p;
  apiKeyInput.value = '';
  form.label = p.label;
  form.kind = p.kind;
  form.baseUrl = p.baseUrl;
  form.supportsModelList = p.supportsModelList;
  form.timeoutMs = p.timeoutMs;
  form.maxRetries = p.maxRetries;
}

async function saveProvider() {
  if (!form.label.trim() || !form.baseUrl.trim()) {
    app.toast('服务商名称和 Base URL 都要填', 'warn');
    return;
  }
  if (editing.value) {
    const row: ProviderRow = {
      ...editing.value,
      label: form.label,
      kind: form.kind,
      baseUrl: form.baseUrl,
      supportsModelList: form.supportsModelList,
      timeoutMs: form.timeoutMs,
      maxRetries: form.maxRetries,
    };
    if (apiKeyInput.value) {
      row.apiKeySealed = await seal(apiKeyInput.value);
      row.apiKeyPreview = maskKey(apiKeyInput.value);
      row.apiKeyLen = apiKeyInput.value.length;
    }
    await db.providers.put(row);
    app.toast('已保存', 'ok');
  } else {
    const row: ProviderRow = {
      id: uid('prov'),
      kind: form.kind,
      label: form.label,
      baseUrl: form.baseUrl,
      models: [],
      supportsModelList: form.supportsModelList,
      timeoutMs: form.timeoutMs,
      maxRetries: form.maxRetries,
      createdAt: Date.now(),
      apiKeySealed: await seal(apiKeyInput.value),
      apiKeyPreview: maskKey(apiKeyInput.value),
      apiKeyLen: apiKeyInput.value.length,
    };
    await db.providers.add(row);
    app.toast('已添加服务商', 'ok');
    await loadProviders();
    editing.value = row;
  }
  await loadProviders();
  adding.value = false;
}

async function testConnection(p: ProviderRow) {
  testing.value = p.id;
  try {
    const key = await open_(p.apiKeySealed);
    const model = p.defaultModel || p.models[0]?.name;
    if (!model) {
      try {
        const list = await adapterFor(p.kind).listModels(p as any, key);
        app.toast(`连接成功，拉取到 ${list.length} 个模型`, 'ok');
        p.models = list.map((n) => ({ id: n, name: n }));
        await db.providers.put(JSON.parse(JSON.stringify(p)));
        await loadProviders();
      } catch (e) {
        app.toast(
          e instanceof ModelListUnsupportedError
            ? '连接可能正常，但该服务商不提供模型列表接口。请手动添加模型名。'
            : `测试失败：${e instanceof Error ? e.message : String(e)}`,
          e instanceof ModelListUnsupportedError ? 'warn' : 'error',
          6000,
        );
      }
      return;
    }
    const res = await adapterFor(p.kind).chat(p as any, key, model, [{ role: 'user', content: '回复两个字：可用' }], {
      maxTokens: 16,
      timeoutMs: 30000,
    });
    app.toast(`连接成功（${res.model}）：${res.text.slice(0, 20)}`, 'ok');
  } catch (e) {
    app.toast(`测试失败：${e instanceof Error ? e.message : String(e)}`, 'error', 7000);
  } finally {
    testing.value = null;
  }
}

async function refreshModels(p: ProviderRow) {
  testing.value = p.id;
  try {
    const key = await open_(p.apiKeySealed);
    const list = await adapterFor(p.kind).listModels(p as any, key);
    const existing = new Set(p.models.map((m) => m.name));
    for (const n of list) if (!existing.has(n)) p.models.push({ id: n, name: n });
    await db.providers.put(JSON.parse(JSON.stringify(p)));
    await loadProviders();
    app.toast(`已更新，共 ${p.models.length} 个模型`, 'ok');
  } catch (e) {
    app.toast(
      e instanceof ModelListUnsupportedError
        ? '该服务商不支持 /models 拉取，请手动添加模型名'
        : `拉取失败：${e instanceof Error ? e.message : String(e)}`,
      'warn',
      6000,
    );
  } finally {
    testing.value = null;
  }
}

async function addManualModel(p: ProviderRow) {
  const name = await askPrompt({
    title: '输入模型名称',
    message: '与服务商文档一致',
  });
  if (!name?.trim()) return;
  if (p.models.some((m) => m.name === name.trim())) {
    app.toast('已存在', 'warn');
    return;
  }
  p.models.push({ id: uid('m'), name: name.trim(), manual: true });
  if (!p.defaultModel) p.defaultModel = name.trim();
  await db.providers.put(JSON.parse(JSON.stringify(p)));
  await loadProviders();
}

async function setDefault(p: ProviderRow, model: string) {
  p.defaultModel = model;
  await db.providers.put(JSON.parse(JSON.stringify(p)));
  await loadProviders();
}

async function removeProvider(id: string) {
  const ok = await askConfirm({
    title: '删除服务商配置',
    message: '删除这个服务商配置？API Key 也会一并删除。',
    confirmText: '删除',
    tone: 'warn',
  });
  if (!ok) return;
  await db.providers.delete(id);
  await loadProviders();
  if (editing.value?.id === id) editing.value = null;
}

async function saveBudget() {
  await app.saveSettings({ budget: { ...budget } });
  app.toast('预算设置已保存', 'ok');
}

const hasModels = computed(() => providers.value.some((p) => p.models.length > 0 && p.apiKeyLen > 0));
</script>

<template>
  <SubPage
    title="模型服务"
    subtitle="API Key 加密后只存本机，不会进入日志、URL 或导出文件。没有配置模型时，AI 按钮会明说不可用。"
    @back="back"
  >
    <div class="usage">
      <div><b>{{ usage.calls }}</b><span>今日调用</span></div>
      <div><b>¥{{ usage.cost.toFixed(3) }}</b><span>今日估算</span></div>
      <div><b>{{ usage.failed }}</b><span>失败</span></div>
      <div><b>{{ hasModels ? '可用' : '未配置' }}</b><span>状态</span></div>
    </div>

    <SettingGroup title="服务商">
      <div class="providers">
        <div class="preset-row">
          <button v-for="p in presets" :key="p.label" class="preset" type="button" :title="p.hint" @click="startAdd(p)">
            + {{ p.label }}
          </button>
        </div>

        <div v-if="!providers.length" class="banner">
          还没有服务商。添加后拉取模型列表，顶栏的模型选择才会出现可选项。
        </div>

        <div v-for="p in providers" :key="p.id" class="prov">
          <div class="prov-head">
            <div class="grow">
              <b>{{ p.label }}</b>
              <span class="chip">{{ p.kind }}</span>
              <div class="muted small mono">{{ p.baseUrl }}</div>
              <div class="muted small">Key：{{ p.apiKeyPreview }} · {{ p.models.length }} 个模型</div>
            </div>
          </div>
          <div class="row wrap" style="gap: 6px; margin-top: 10px">
            <button class="btn btn-sm" type="button" :disabled="testing === p.id" @click="testConnection(p)">
              {{ testing === p.id ? '测试中' : '测试连接' }}
            </button>
            <button class="btn btn-sm" type="button" :disabled="testing === p.id" @click="refreshModels(p)">拉取模型</button>
            <button class="btn btn-sm" type="button" @click="startEdit(p)">编辑</button>
            <button class="btn btn-sm btn-danger" type="button" @click="removeProvider(p.id)">删除</button>
          </div>
          <div v-if="p.models.length" class="models">
            <button
              v-for="m in p.models"
              :key="m.name"
              class="model-chip"
              :class="{ on: p.defaultModel === m.name }"
              type="button"
              @click="setDefault(p, m.name)"
            >
              {{ m.name }}<i v-if="m.manual">·手</i>
            </button>
            <button class="model-chip add" type="button" @click="addManualModel(p)">+ 手动添加</button>
          </div>
          <p v-else class="muted small" style="margin: 8px 0 0">
            还没有模型。点「拉取模型」；不支持 /v1/models 的服务商请手动添加模型名。
          </p>
        </div>
      </div>
    </SettingGroup>

    <div v-if="adding || editing" class="card card-pad form">
      <div class="form-title">{{ editing ? '编辑服务商' : '添加服务商' }}</div>
      <div class="grid2">
        <label class="field"><span class="field-label">显示名称</span><input v-model="form.label" class="input" /></label>
        <label class="field">
          <span class="field-label">接口类型</span>
          <select v-model="form.kind" class="select">
            <option value="openai-compatible">OpenAI 兼容</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Gemini</option>
            <option value="local">本地模型</option>
          </select>
        </label>
        <label class="field" style="grid-column: 1 / -1">
          <span class="field-label">Base URL</span>
          <input v-model="form.baseUrl" class="input mono" placeholder="https://api.example.com/v1" />
        </label>
        <label class="field" style="grid-column: 1 / -1">
          <span class="field-label">API Key</span>
          <input v-model="apiKeyInput" type="password" class="input mono" :placeholder="editing?.apiKeyLen ? '留空则不修改' : 'sk-...'" />
        </label>
        <label class="field"><span class="field-label">超时（毫秒）</span><input v-model.number="form.timeoutMs" type="number" class="input" /></label>
        <label class="field"><span class="field-label">失败重试次数</span><input v-model.number="form.maxRetries" type="number" class="input" /></label>
      </div>
      <label class="check-row">
        <input v-model="form.supportsModelList" type="checkbox" class="cb" />
        <span>该服务商支持 GET /v1/models</span>
      </label>
      <div class="row" style="margin-top: 12px">
        <button class="btn btn-sm btn-primary" type="button" @click="saveProvider">保存</button>
        <button class="btn btn-sm" type="button" @click="adding = false; editing = null">取消</button>
      </div>
    </div>

    <SettingGroup title="预算与调用上限">
      <div class="card-pad-inner">
        <div class="grid2">
          <label class="field"><span class="field-label">每日调用次数上限（0 = 不限）</span><input v-model.number="budget.dailyCalls" type="number" class="input" /></label>
          <label class="field"><span class="field-label">每日预算（元，0 = 不限）</span><input v-model.number="budget.dailyCost" type="number" step="0.5" class="input" /></label>
          <label class="field"><span class="field-label">单任务最大循环</span><input v-model.number="budget.maxLoops" type="number" class="input" /></label>
          <label class="field"><span class="field-label">单任务最大调用</span><input v-model.number="budget.maxCallsPerTask" type="number" class="input" /></label>
        </div>
        <label class="check-row">
          <input :checked="app.settings.autoAssign" type="checkbox" class="cb" @change="app.saveSettings({ autoAssign: ($event.target as HTMLInputElement).checked })" />
          <span>自动分配模型（简单任务用便宜模型）</span>
        </label>
        <button class="btn btn-sm btn-primary" type="button" style="margin-top: 10px" @click="saveBudget">保存</button>
        <p class="muted small" style="margin: 10px 0 0; line-height: 1.7">
          费用按你填写的单价估算，仅作参考。服务商余额只有官方接口支持时才显示——本软件不会伪造。
        </p>
      </div>
    </SettingGroup>

    <SettingGroup title="检索服务">
      <div class="card-pad-inner">
        <div v-for="sp in app.settings.searchProviders" :key="sp.id" class="search-row">
          <div class="grow">
            <div>{{ sp.label }}</div>
            <div class="muted small mono">{{ sp.baseUrl || '未配置地址' }}</div>
          </div>
          <label class="switch" @click.stop>
            <input
              type="checkbox"
              :checked="sp.enabled"
              @change="sp.enabled = ($event.target as HTMLInputElement).checked; app.saveSettings({ searchProviders: [...app.settings.searchProviders] })"
            />
            <span />
          </label>
        </div>
        <p class="muted small" style="margin: 10px 0 0; line-height: 1.7">
          OpenAlex 与 Crossref 为公开元数据接口，无需 Key，请遵守速率限制。检索结果默认「待核实」。
        </p>
      </div>
    </SettingGroup>
  </SubPage>
</template>

<style scoped>
.usage {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
  padding: 14px; margin-bottom: 18px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-3);
}
.usage div { display: flex; flex-direction: column; gap: 3px; }
.usage b { font-size: calc(17px * var(--font-scale)); font-variant-numeric: tabular-nums; }
.usage span { font-size: calc(11px * var(--font-scale)); color: var(--text-3); }

.providers { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.preset-row { display: flex; gap: 6px; flex-wrap: wrap; }
.preset {
  padding: 6px 11px; border-radius: var(--r-full); border: 1px dashed var(--line-strong);
  background: transparent; color: var(--text-2); font-size: calc(11.5px * var(--font-scale)); cursor: pointer;
  transition: border-color var(--dur-2), color var(--dur-2), background var(--dur-2);
}
.preset:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-soft, rgba(31,79,216,0.06)); }
.prov { padding: 13px 14px; border-radius: var(--r-2); background: var(--surface-2); border: 1px solid var(--line); }
.chip { font-size: calc(10px * var(--font-scale)); padding: 2px 6px; margin-left: 8px; border-radius: var(--r-full); background: var(--surface-3); color: var(--text-3); }
.models { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 10px; }
.model-chip {
  padding: 4px 9px; border-radius: var(--r-full); border: 1px solid var(--line);
  background: var(--surface); font-size: calc(11px * var(--font-scale)); color: var(--text-2); cursor: pointer;
}
.model-chip.on { border-color: var(--primary); color: var(--primary); background: var(--primary-soft, rgba(31,79,216,0.08)); }
.model-chip.add { border-style: dashed; color: var(--text-3); }
.model-chip i { font-style: normal; opacity: 0.55; margin-left: 2px; }

.form { margin-bottom: 18px; background: var(--surface); }
.form-title { font-size: calc(13.5px * var(--font-scale)); font-weight: 640; margin-bottom: 12px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.field-label { font-size: calc(12px * var(--font-scale)); color: var(--text-3); }
.check-row { display: flex; align-items: center; gap: 9px; font-size: calc(12.5px * var(--font-scale)); color: var(--text-2); cursor: pointer; }
.cb { width: 17px; height: 17px; accent-color: var(--primary); }
.card-pad-inner { padding: 14px 16px; }
.search-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.search-row:last-of-type { border-bottom: none; }

.switch { position: relative; display: inline-block; width: 44px; height: 26px; flex: 0 0 44px; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch span {
  position: absolute; inset: 0; background: var(--surface-3); border-radius: var(--r-full);
  transition: background var(--dur-2) var(--ease-out); cursor: pointer;
}
.switch span::after {
  content: ''; position: absolute; width: 20px; height: 20px; border-radius: 50%;
  background: #fff; top: 3px; left: 3px; transition: transform var(--dur-3) var(--ease-out);
}
.switch input:checked + span { background: var(--primary); }
.switch input:checked + span::after { transform: translateX(18px); }

@media (max-width: 700px) {
  .usage { grid-template-columns: repeat(2, 1fr); }
  .grid2 { grid-template-columns: 1fr; }
}
</style>
