<script setup lang="ts">
/**
 * API 管理中心
 *
 * 普通用户看到的：加服务商、填 Key、拉模型、选默认、看今日花费。
 * 开发者模式多出：请求参数、能力配置、按 Agent 分配、用量明细、Key 加密导入导出。
 * 所有「支持 / 不支持」都按适配器实际情况写，不拿「OpenAI 兼容」一句话糊过去。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { backOr } from '../../core/nav';
import { db, type ProviderRow } from '../../core/db';
import { useAppStore } from '../../stores/app';
import { maskKey, seal } from '../../core/crypto';
import { uid } from '../../core/id';
import { downloadBlob } from '../../export/bundle';
import {
  clearKey,
  describeError,
  exportKeyBundle,
  importKeyBundle,
  refreshModels,
  testProvider,
  verifyModel,
  type SealedKeyBundle,
  type TestReport,
} from '../../ai/manager';
import { adapterFor } from '../../ai/providers';
import { LOCAL_GUIDES, SUPPORT_MATRIX } from '../../ai/catalog';
import { previewRoutes, type Tier } from '../../ai/routing';
import type { BudgetSnapshot, UsageStats } from '../../ai/gateway';
import SubPage from '../../components/settings/SubPage.vue';
import ProviderCard from '../../components/api/ProviderCard.vue';
import ProviderEditor from '../../components/api/ProviderEditor.vue';
import PresetPicker from '../../components/api/PresetPicker.vue';

const app = useAppStore();
const router = useRouter();

/** 返回上一级：有历史原路返回，没有则回设置首页 */
function back() {
  backOr(router, '/settings');
}

type Tab = 'providers' | 'models' | 'routing' | 'usage' | 'local' | 'security';
const TABS: { key: Tab; label: string }[] = [
  { key: 'providers', label: '服务商' },
  { key: 'models', label: '模型' },
  { key: 'routing', label: '分配与成本' },
  { key: 'usage', label: '用量' },
  { key: 'local', label: '本地模型' },
  { key: 'security', label: '密钥安全' },
];
const tab = ref<Tab>('providers');
const devMode = computed(() => app.settings.devMode);

const providers = ref<ProviderRow[]>([]);
const reports = reactive<Record<string, TestReport>>({});
const busyId = ref<string | null>(null);
const stats = ref<UsageStats | null>(null);
const snapshot = ref<BudgetSnapshot | null>(null);

const editorOpen = ref(false);
const editingRow = ref<ProviderRow | null>(null);
const presetKey = ref<string | undefined>(undefined);
/* 新建时先开预设面板，选完再进编辑 */
const pickerOpen = ref(false);
/** 每次打开换 key，强制表单重建，避免上一次的残留 */
const editorSeq = ref(0);

const matrixRows = Object.values(SUPPORT_MATRIX);

const budget = reactive({ ...app.settings.budget });
const routing = reactive({ ...app.settings.routing });

/* 模型页筛选 */
const query = ref('');
const onlyFavorite = ref(false);
const providerFilter = ref('');
const manual = reactive({ providerId: '', name: '' });

/* 密钥页 */
const passphrase = ref('');
const passphrase2 = ref('');
const importPassphrase = ref('');
const keyError = ref('');
const keyNotice = ref('');

onMounted(async () => {
  await reload();
});

async function reload() {
  providers.value = await db.providers.toArray();
  providers.value.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt - b.createdAt);
  stats.value = await app.gateway.usageSummary();
  snapshot.value = await app.gateway.budgetSnapshot();
  if (!manual.providerId && providers.value.length) manual.providerId = providers.value[0].id;
}

async function put(row: ProviderRow) {
  await db.providers.put(JSON.parse(JSON.stringify(row)));
  await reload();
  // 顶栏胶囊与首页据此重读，配置完立刻生效
  app.touchModels();
}

/* ------------------------------ 服务商 ------------------------------ */

function openAdd(preset?: string) {
  editingRow.value = null;
  presetKey.value = preset;
  editorSeq.value++;
  editorOpen.value = true;
}

/** 预设面板选中某一项后，关闭面板并打开编辑抽屉 */
function onPickPreset(key: string) {
  pickerOpen.value = false;
  openAdd(key);
}

function openEdit(row: ProviderRow) {
  editingRow.value = row;
  presetKey.value = undefined;
  editorSeq.value++;
  editorOpen.value = true;
}

async function onSaved(row: ProviderRow) {
  editorOpen.value = false;
  if (row.isDefault) {
    for (const p of providers.value) {
      if (p.id !== row.id && p.isDefault) await db.providers.put({ ...p, isDefault: false });
    }
  }
  const isNew = !editingRow.value;
  await put(row);
  app.toast(
    isNew && row.enabled === false ? '已添加。打开右侧开关启用后才会参与对话' : isNew ? '已添加服务商' : '已保存',
    'ok',
    isNew && row.enabled === false ? 4200 : 3200,
  );
  editingRow.value = null;
}

async function removeProvider(row: ProviderRow) {
  if (!confirm(`删除「${row.label}」？已保存的密钥将一并删除，且不可恢复。`)) return;
  await db.providers.delete(row.id);
  delete reports[row.id];
  await reload();
  app.touchModels();
  app.toast('已删除', 'ok');
}

async function toggleEnabled(row: ProviderRow) {
  await put({ ...row, enabled: row.enabled === false });
}

/** 可供转述的模型：已启用 + OpenAI 兼容 + 标了看图 */
const visionOptions = computed(() =>
  providers.value
    .filter((p) => p.enabled !== false && p.kind === 'openai-compatible')
    .flatMap((p) =>
      p.models
        .filter((m) => m.cap?.vision)
        .map((m) => ({ key: `${p.id}::${m.name}`, label: `${p.label} · ${m.name}` })),
    ),
);
const visionKey = computed(() =>
  app.settings.visionModel
    ? `${app.settings.visionModel.providerId}::${app.settings.visionModel.model}`
    : '',
);

async function setVisionModel(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  if (!v) {
    await app.saveSettings({ visionModel: undefined });
    app.toast('已改为自动选择转述模型', 'ok', 2200);
    return;
  }
  const [providerId, model] = v.split('::');
  await app.saveSettings({ visionModel: { providerId, model } });
  app.toast('已设置图片转述模型', 'ok', 2200);
}

async function toggleThinking(v: boolean) {
  await app.saveSettings({ thinking: v });
  app.toast(v ? '已开启深度思考' : '已关闭深度思考', 'ok', 2200);
}

async function setDefaultProvider(row: ProviderRow) {
  for (const p of providers.value) {
    const want = p.id === row.id;
    if (Boolean(p.isDefault) !== want) await db.providers.put({ ...p, isDefault: want });
  }
  await reload();
}

async function runTest(row: ProviderRow) {
  busyId.value = row.id;
  try {
    const report = await testProvider(row);
    reports[row.id] = report;
    const failed = report.stages.find((s) => s.status === 'fail');
    await put({
      ...row,
      lastTest: {
        at: Date.now(),
        ok: report.ok,
        latencyMs: report.latencyMs,
        stage: failed?.stage ?? 'generate',
        message: failed?.message ?? '通过',
      },
    });
  } finally {
    busyId.value = null;
  }
}

async function runRefresh(row: ProviderRow) {
  busyId.value = row.id;
  try {
    const res = await refreshModels(row);
    if (res.ok) {
      await put({ ...row, models: res.models });
      app.toast(res.message, 'ok');
    } else {
      app.toast(res.message, 'warn', 6000);
    }
  } finally {
    busyId.value = null;
  }
}

/* ------------------------------- 模型 ------------------------------- */

interface ModelRow {
  provider: ProviderRow;
  name: string;
  id: string;
  favorite: boolean;
  manual: boolean;
  priceIn?: number;
  priceOut?: number;
  cap: NonNullable<ProviderRow['models'][number]['cap']>;
}

const modelRows = computed<ModelRow[]>(() => {
  const q = query.value.trim().toLowerCase();
  const out: ModelRow[] = [];
  for (const p of providers.value) {
    if (providerFilter.value && p.id !== providerFilter.value) continue;
    for (const m of p.models) {
      if (onlyFavorite.value && !m.favorite) continue;
      if (q && !`${m.name} ${m.alias ?? ''} ${p.label}`.toLowerCase().includes(q)) continue;
      out.push({
        provider: p,
        name: m.name,
        id: m.id,
        favorite: Boolean(m.favorite),
        manual: Boolean(m.manual),
        priceIn: m.priceIn,
        priceOut: m.priceOut,
        cap: m.cap ?? {},
      });
    }
  }
  return out.sort(
    (a, b) =>
      Number(b.favorite) - Number(a.favorite) ||
      Number(Boolean(b.cap.verified)) - Number(Boolean(a.cap.verified)) ||
      a.name.localeCompare(b.name),
  );
});

const usableCount = computed(() => providers.value.reduce((n, p) => n + p.models.filter((m) => m.cap?.verified).length, 0));
const totalModels = computed(() => providers.value.reduce((n, p) => n + p.models.length, 0));

async function patchModel(provider: ProviderRow, name: string, patch: Partial<ModelRow>) {
  const models = provider.models.map((m) =>
    m.name === name
      ? {
          ...m,
          favorite: patch.favorite ?? m.favorite,
          priceIn: patch.priceIn ?? m.priceIn,
          priceOut: patch.priceOut ?? m.priceOut,
          cap: patch.cap ?? m.cap,
        }
      : m,
  );
  await put({ ...provider, models });
}

async function toggleFavorite(row: ModelRow) {
  await patchModel(row.provider, row.name, { favorite: !row.favorite });
}

async function setDefaultModel(provider: ProviderRow, name: string) {
  await put({ ...provider, defaultModel: name, models: provider.models.map((m) => (m.name === name ? { ...m, favorite: true } : m)) });
  app.toast(`「${name}」已设为 ${provider.label} 的默认模型`, 'ok');
}

async function toggleCap(row: ModelRow, key: 'vision' | 'tools' | 'json' | 'reasoning') {
  await patchModel(row.provider, row.name, { cap: { ...row.cap, [key]: !row.cap[key] } });
}

async function runVerify(row: ModelRow) {
  busyId.value = row.provider.id;
  try {
    const res = await verifyModel(row.provider, row.name);
    await patchModel(row.provider, row.name, {
      cap: {
        ...row.cap,
        verified: res.ok,
        verifiedAt: res.ok ? Date.now() : row.cap.verifiedAt,
        lastError: res.ok ? undefined : res.message,
      },
    });
    app.toast(res.ok ? `「${row.name}」校验通过：${res.text ?? ''}` : `「${row.name}」校验未通过：${res.message}`, res.ok ? 'ok' : 'error', 6000);
  } finally {
    busyId.value = null;
  }
}

async function addManualModel() {
  const name = manual.name.trim();
  const provider = providers.value.find((p) => p.id === manual.providerId);
  if (!provider) {
    app.toast('请先添加服务商', 'warn');
    return;
  }
  if (!name) {
    app.toast('请填写模型名称，需与服务商文档完全一致', 'warn');
    return;
  }
  if (provider.models.some((m) => m.name === name)) {
    app.toast('该模型已存在', 'warn');
    return;
  }
  const models = [
    ...provider.models,
    {
      id: uid('m'),
      name,
      manual: true,
    },
  ];
  await put({ ...provider, models, defaultModel: provider.defaultModel || name });
  manual.name = '';
  app.toast('模型已添加。建议执行一次校验，以确认实际可用性。', 'ok', 6000);
}

async function removeModel(row: ModelRow) {
  if (!confirm(`从列表中移除「${row.name}」？该操作不会影响服务商侧配置。`)) return;
  const models = row.provider.models.filter((m) => m.name !== row.name);
  await put({
    ...row.provider,
    models,
    defaultModel: row.provider.defaultModel === row.name ? models[0]?.name : row.provider.defaultModel,
  });
}

/* ------------------------------ 分配 ------------------------------ */

const routes = computed(() => previewRoutes(providers.value, app.settings));

const TIER_LABEL: Record<Tier, string> = { cheap: '低成本', balanced: '均衡', strong: '高性能' };

function agentModel(agentId: string): string {
  const m = app.settings.agentModels[agentId];
  return m ? `${m.providerId}::${m.model}` : '';
}

async function setAgentModel(agentId: string, value: string) {
  const next = { ...app.settings.agentModels };
  if (!value) delete next[agentId];
  else {
    const [providerId, model] = value.split('::');
    next[agentId] = { providerId, model };
  }
  await app.saveSettings({ agentModels: next });
}

async function toggleAutoAssign(e: Event) {
  await app.saveSettings({ autoAssign: (e.target as HTMLInputElement).checked });
}

async function saveRouting() {
  await app.saveSettings({ routing: { ...routing } });
  app.gateway.clearCache();
  app.toast('分配与成本规则已保存', 'ok');
}

async function saveBudget() {
  await app.saveSettings({ budget: { ...budget } });
  await reload();
  app.toast('预算已保存', 'ok');
}

const modelOptions = computed(() =>
  providers.value.flatMap((p) => p.models.map((m) => ({ value: `${p.id}::${m.name}`, label: `${p.label} / ${m.name}` }))),
);

/* ------------------------------ 用量 ------------------------------ */

const balanceCapable = computed(() => providers.value.filter((p) => adapterFor(p.kind).supportsBalance));
const ratioPct = computed(() => Math.round((snapshot.value?.ratio ?? 0) * 100));

/* ------------------------------ 密钥 ------------------------------ */

const keyRows = computed(() =>
  providers.value.map((p) => ({
    id: p.id,
    label: p.label,
    mask: p.apiKeyPreview || (p.kind === 'local' ? '本地服务' : '未配置'),
    has: p.apiKeyLen > 0,
  })),
);

async function removeKey(id: string) {
  const row = providers.value.find((p) => p.id === id);
  if (!row) return;
  if (!confirm(`删除「${row.label}」的密钥？模型列表与接口地址将保留。`)) return;
  await put(await clearKey(row));
  app.toast('Key 已删除', 'ok');
}

async function doExportKeys() {
  keyError.value = '';
  keyNotice.value = '';
  if (passphrase.value.length < 6) {
    keyError.value = '口令至少 6 位。口令遗失后，备份文件将无法解密。';
    return;
  }
  if (passphrase.value !== passphrase2.value) {
    keyError.value = '两次口令不一致';
    return;
  }
  try {
    const bundle = await exportKeyBundle(providers.value, passphrase.value);
    downloadBlob(
      new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
      `studymate-keys-${new Date().toISOString().slice(0, 10)}.json`,
    );
    passphrase.value = '';
    passphrase2.value = '';
    keyNotice.value = '导出完成。文件内容为密文，本软件不保存口令，遗失后无法找回。';
  } catch (e) {
    keyError.value = describeError(e);
  }
}

async function onImportFile(e: Event) {
  keyError.value = '';
  keyNotice.value = '';
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!importPassphrase.value) {
    keyError.value = '请输入导出时设置的口令';
    return;
  }
  try {
    const text = await file.text();
    const bundle = JSON.parse(text) as SealedKeyBundle;
    const entries = await importKeyBundle(bundle, importPassphrase.value);
    let applied = 0;
    for (const entry of entries) {
      const target =
        providers.value.find((p) => p.id === entry.providerId) ??
        providers.value.find((p) => p.baseUrl === entry.baseUrl && p.kind === entry.kind);
      if (target) {
        // 换设备后旧信封解不开，用本机设备密钥重新封
        await db.providers.put({
          ...target,
          apiKeySealed: await seal(entry.apiKey),
          apiKeyPreview: maskKey(entry.apiKey),
          apiKeyLen: entry.apiKey.length,
        });
        applied++;
      }
    }
    await reload();
    keyNotice.value = applied
      ? `已导入 ${applied} 个密钥。未匹配的服务商需先创建相同地址的配置。`
      : '备份中的服务商在本机不存在，请先添加相同 Base URL 的配置后再导入。';
  } catch (e) {
    keyError.value = `导入失败：${describeError(e)}`;
  } finally {
    (e.target as HTMLInputElement).value = '';
  }
}

function copyText(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => app.toast('已复制到剪贴板', 'ok', 1600),
    () => app.toast('复制失败，请手动选择文本复制', 'warn'),
  );
}
</script>

<template>
  <SubPage
    title="API 管理中心"
    subtitle="集中管理模型服务商、密钥与调用策略。密钥经加密后存储于本机，不写入日志、链接或导出文件。"
    @back="back"
  >
    <!-- 概览 -->
    <div class="overview">
      <div class="ov-item">
        <b class="tnum">{{ stats?.calls ?? 0 }}</b>
        <span>今日请求</span>
      </div>
      <div class="ov-item">
        <b class="tnum">{{ ((stats?.tokens ?? 0) / 1000).toFixed(1) }}k</b>
        <span>Token</span>
      </div>
      <div class="ov-item">
        <b class="tnum">¥{{ (stats?.cost ?? 0).toFixed(3) }}</b>
        <span>估算花费</span>
      </div>
      <div class="ov-item">
        <b class="tnum">{{ usableCount }}/{{ totalModels }}</b>
        <span>已校验 / 全部模型</span>
      </div>
    </div>

    <div v-if="snapshot" class="budget-bar" :class="{ warn: snapshot.nearLimit, over: snapshot.blocked }">
      <div class="bar-track"><div class="bar-fill" :style="{ width: `${Math.min(ratioPct, 100)}%` }" /></div>
      <div class="bar-text">
        <span v-if="snapshot.blocked">已达今日上限，生成前需要你确认</span>
        <span v-else-if="snapshot.nearLimit">已用 {{ ratioPct }}%，接近上限</span>
        <span v-else>今日预算已用 {{ ratioPct }}%</span>
        <span class="muted">
          ¥{{ snapshot.costToday.toFixed(3) }} / {{ snapshot.costLimit || '不限' }} · {{ snapshot.callsToday }} /
          {{ snapshot.callsLimit || '不限' }} 次
        </span>
      </div>
    </div>

    <!-- Tab -->
    <nav class="tabs">
      <button v-for="t in TABS" :key="t.key" class="tab" :class="{ on: tab === t.key }" type="button" @click="tab = t.key">
        {{ t.label }}
      </button>
    </nav>

    <p v-if="!devMode" class="dev-hint">
      当前为普通模式，仅展示常用配置。更多参数需在开发者模式下调整。
      <button class="link" type="button" @click="router.push('/settings/developer')">前往设置</button>
    </p>

    <!-- 服务商 -->
    <section v-if="tab === 'providers'" class="pane">
      <div class="pane-head">
        <div>
          <h3>服务商</h3>
          <p class="muted small">同一服务商可创建多条配置，适用于不同密钥、区域节点或本地部署，彼此独立。</p>
        </div>
        <button class="btn btn-sm btn-primary" type="button" @click="pickerOpen = true">+ 添加</button>
      </div>

      <div v-if="!providers.length" class="empty">
        <b>尚未添加服务商</b>
        <p>添加服务商后即可同步或手动录入模型。未配置时，AI 功能将显示为不可用。</p>
      </div>

      <div class="prov-list">
        <ProviderCard
          v-for="p in providers"
          :key="p.id"
          :row="p"
          :report="reports[p.id]"
          :busy="busyId === p.id"
          :dev-mode="devMode"
          @test="runTest(p)"
          @refresh="runRefresh(p)"
          @edit="openEdit(p)"
          @remove="removeProvider(p)"
          @toggle-enabled="toggleEnabled(p)"
          @set-default="setDefaultProvider(p)"
        />
      </div>

      <div v-if="devMode" class="matrix">
        <h4>适配器实际支持范围</h4>
        <table>
          <thead>
            <tr><th>接口</th><th>对话生成</th><th>模型列表</th><th>余额/额度</th></tr>
          </thead>
          <tbody>
            <tr v-for="m in matrixRows" :key="m.kind">
              <td>{{ m.label }}</td>
              <td>{{ m.chat ? '已实现（非流式）' : '未实现' }}</td>
              <td>{{ m.modelList || '无' }}</td>
              <td>{{ m.balance || '官方无此接口，不显示' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="muted small">「兼容」只指上面这两条路径，不代表 OpenAI 的全部能力都已接入。</p>
      </div>
    </section>

    <!-- 模型 -->
    <section v-else-if="tab === 'models'" class="pane">
      <div class="pane-head">
        <div>
          <h3>模型</h3>
          <p class="muted small">
            模型列表仅代表服务商提供的可选范围。实际可用性以<b>校验结果</b>为准，未校验的模型不会进入自动分配。
          </p>
        </div>
      </div>

      <div class="filters">
        <input v-model="query" class="input grow" placeholder="搜索模型或服务商" />
        <select v-model="providerFilter" class="select">
          <option value="">全部服务商</option>
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
        <button class="btn btn-sm" :class="{ on: onlyFavorite }" type="button" @click="onlyFavorite = !onlyFavorite">
          只看收藏
        </button>
      </div>

      <div class="manual-row">
        <select v-model="manual.providerId" class="select">
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
        <input v-model="manual.name" class="input grow mono" placeholder="输入模型名称，如 deepseek-chat" />
        <button class="btn btn-sm" type="button" @click="addManualModel">添加</button>
      </div>

      <div v-if="!modelRows.length" class="empty">
        <b>没有匹配的模型</b>
        <p>未找到匹配的模型。可前往「服务商」页同步列表，或通过上方手动录入。</p>
      </div>

      <ul class="model-list">
        <li v-for="m in modelRows" :key="m.provider.id + m.name" class="model-item">
          <button class="star" :class="{ on: m.favorite }" type="button" :title="m.favorite ? '取消收藏' : '收藏'" @click="toggleFavorite(m)">
            ★
          </button>
          <div class="m-main">
            <div class="m-name">
              <span class="mono">{{ m.name }}</span>
              <span v-if="m.manual" class="tag">手动</span>
              <span v-if="m.cap.verified" class="tag ok">已校验</span>
              <span v-else class="tag unknown">未校验</span>
              <span v-if="m.provider.defaultModel === m.name" class="tag default">默认</span>
            </div>
            <div class="m-meta">
              {{ m.provider.label }}
              · 计费按服务商官网账单
            </div>
            <div v-if="m.cap.lastError && !m.cap.verified" class="m-err">{{ m.cap.lastError }}</div>
            <div v-if="devMode" class="caps">
              <button class="cap" :class="{ on: m.cap.vision }" type="button" @click="toggleCap(m, 'vision')">看图</button>
              <button class="cap" :class="{ on: m.cap.tools }" type="button" @click="toggleCap(m, 'tools')">工具调用</button>
              <button class="cap" :class="{ on: m.cap.json }" type="button" @click="toggleCap(m, 'json')">JSON</button>
              <button class="cap" :class="{ on: m.cap.reasoning }" type="button" @click="toggleCap(m, 'reasoning')">推理</button>
              <span class="muted">能力只影响路由偏好，不会凭空多出接口</span>
            </div>
          </div>
          <div class="m-actions">
            <button class="btn btn-xs" type="button" :disabled="busyId === m.provider.id" @click="runVerify(m)">
              {{ busyId === m.provider.id ? '校验中' : '校验' }}
            </button>
            <button class="btn btn-xs" type="button" @click="setDefaultModel(m.provider, m.name)">设为默认</button>
            <button class="btn btn-xs btn-danger" type="button" @click="removeModel(m)">移除</button>
          </div>
        </li>
      </ul>
    </section>

    <!-- 分配 -->
    <section v-else-if="tab === 'routing'" class="pane">
      <div class="pane-head">
        <div>
          <h3>分配与成本</h3>
          <p class="muted small">优先级：手动指定 → Agent 指定 → 顶栏选择 → 规则 → 默认服务商。手动选择始终优先于自动规则。</p>
        </div>
      </div>

      <div class="card">
        <h4>图片转述模型</h4>
        <p class="muted small" style="margin: 0 0 10px; line-height: 1.7">
          主模型不吃图片时，先用它把图讲成文字再继续聊。只列 OpenAI 兼容、且勾了「看图」能力的模型
          （模型页 → 开发者模式里可勾）。
        </p>
        <select class="select" :value="visionKey" @change="setVisionModel">
          <option value="">自动：用第一个支持看图的模型</option>
          <option v-for="o in visionOptions" :key="o.key" :value="o.key">{{ o.label }}</option>
        </select>
      </div>

      <div class="card">
        <label class="chk big">
          <input
            type="checkbox"
            :checked="app.settings.thinking === true"
            @change="toggleThinking(($event.target as HTMLInputElement).checked)"
          />
          <span>
            <b>深度思考</b><br />
            <small class="muted">
              先推理再回答，能明显提升复杂题目的质量，也更慢、更费 token。
              只对勾选了「推理」能力的模型生效（模型页 → 开发者模式可勾）。
            </small>
          </span>
        </label>
      </div>

      <div class="card">
        <label class="chk big">
          <input :checked="app.settings.autoAssign" type="checkbox" @change="toggleAutoAssign" />
          <span><b>自动分配模型</b><br /><small class="muted">不加指定时，按任务类型挑模型。关掉后所有调用都用顶栏选的那个。</small></span>
        </label>
        <div class="rule-grid">
          <label class="chk"><input v-model="routing.ruleFirst" type="checkbox" /><span>规则优先（按任务定档位）</span></label>
          <label class="chk"><input v-model="routing.cheapFirst" type="checkbox" /><span>简单任务先用低成本模型</span></label>
          <label class="chk"><input v-model="routing.strongOnlyForComplex" type="checkbox" /><span>高性能模型只用于复杂任务</span></label>
          <label class="chk"><input v-model="routing.cache" type="checkbox" /><span>相同请求复用结果</span></label>
          <label class="chk"><input v-model="routing.dedupe" type="checkbox" /><span>并发重复请求合并为一次</span></label>
          <label class="chk"><input v-model="routing.compress" type="checkbox" /><span>上下文压缩（保留最近 8 条）</span></label>
          <label class="chk"><input v-model="routing.confirmOnBudget" type="checkbox" /><span>超预算时暂停并要求确认</span></label>
          <label class="field inline">
            <span class="field-label">缓存有效期（分钟）</span>
            <input v-model.number="routing.cacheTtlMin" type="number" min="1" class="input num" />
          </label>
        </div>
        <button class="btn btn-sm btn-primary" type="button" @click="saveRouting">保存规则</button>
      </div>

      <div class="card">
        <h4>按 Agent / 任务指定模型</h4>
        <p class="muted small" style="margin-top: 0">未指定时按规则分配；指定后固定使用该模型，不再自动切换。</p>
        <div class="agent-rows">
          <div v-for="r in routes" :key="r.agentId" class="agent-row">
            <div class="a-main">
              <div class="a-name">
                {{ r.name }}
                <span class="tag">{{ TIER_LABEL[r.tier] }}</span>
                <span v-if="r.manual" class="tag ok">已指定</span>
              </div>
              <div class="a-reason muted small">
                现在会走：{{ r.decision ? `${r.decision.model}（${r.decision.reason}）` : '没有可用模型' }}
              </div>
            </div>
            <select class="select a-select" :value="agentModel(r.agentId)" @change="setAgentModel(r.agentId, ($event.target as HTMLSelectElement).value)">
              <option value="">跟随规则</option>
              <option v-for="o in modelOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
        </div>
      </div>
    </section>

    <!-- 用量 -->
    <section v-else-if="tab === 'usage'" class="pane">
      <div class="pane-head">
        <div>
          <h3>用量与预算</h3>
          <p class="muted small">统计数据来自本机调用记录，仅保存在当前设备。</p>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat"><b class="tnum">{{ stats?.calls ?? 0 }}</b><span>调用</span></div>
        <div class="stat"><b class="tnum">{{ stats?.failed ?? 0 }}</b><span>失败</span></div>
        <div class="stat"><b class="tnum">{{ stats?.tokens ?? 0 }}</b><span>Token</span></div>
        <div class="stat"><b class="tnum">¥{{ (stats?.cost ?? 0).toFixed(4) }}</b><span>估算花费</span></div>
        <div class="stat"><b class="tnum">{{ (stats?.avgDuration ?? 0).toFixed(1) }}s</b><span>平均耗时</span></div>
        <div class="stat"><b class="tnum">{{ stats?.cacheHits ?? 0 }}</b><span>缓存命中</span></div>
      </div>

      <div class="card">
        <h4>预算</h4>
        <div class="grid2">
          <label class="field"><span class="field-label">每日调用上限（0 = 不限）</span><input v-model.number="budget.dailyCalls" type="number" class="input num" /></label>
          <label class="field"><span class="field-label">每日预算（元，0 = 不限）</span><input v-model.number="budget.dailyCost" type="number" step="0.5" class="input num" /></label>
          <label class="field"><span class="field-label">单任务最大调用</span><input v-model.number="budget.maxCallsPerTask" type="number" class="input num" /></label>
          <label class="field"><span class="field-label">单任务最大循环</span><input v-model.number="budget.maxLoops" type="number" class="input num" /></label>
          <label class="field"><span class="field-label">提醒比例（0–1）</span><input v-model.number="budget.warnRatio" type="number" step="0.1" min="0" max="1" class="input num" /></label>
        </div>
        <label class="chk"><input v-model="budget.pauseOnExceed" type="checkbox" /><span>达到上限时暂停，问我是否继续（不勾则直接拒绝）</span></label>
        <button class="btn btn-sm btn-primary" type="button" @click="saveBudget">保存预算</button>
      </div>

      <div v-if="stats?.byModel.length" class="card">
        <h4>按模型</h4>
        <table class="tbl">
          <thead><tr><th>模型</th><th>调用</th><th>Token</th><th>估算</th><th>平均耗时</th></tr></thead>
          <tbody>
            <tr v-for="m in stats.byModel" :key="m.key">
              <td class="mono">{{ m.model }}</td>
              <td class="tnum">{{ m.calls }}</td>
              <td class="tnum">{{ m.tokens }}</td>
              <td class="tnum">¥{{ m.cost.toFixed(4) }}</td>
              <td class="tnum">{{ m.avgDuration.toFixed(1) }}s</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h4>余额</h4>
        <p class="muted small" style="margin: 0; line-height: 1.7">
          <template v-if="balanceCapable.length">
            以下服务商提供官方余额接口：{{ balanceCapable.map((p) => p.label).join('、') }}。
          </template>
          <template v-else>
            已配置的服务商都没有可用的官方余额查询接口，所以这里不显示余额。
            请到服务商控制台查看。本软件不会用「估算值」冒充余额。
          </template>
        </p>
      </div>
    </section>

    <!-- 本地 -->
    <section v-else-if="tab === 'local'" class="pane">
      <div class="pane-head">
        <div>
          <h3>本地模型 <span class="tag beta">Beta</span></h3>
          <p class="muted small">
            通过 OpenAI 兼容接口接入，尚未针对每个后端逐一验证。推理性能取决于设备硬件，不保证所有机型可用。
          </p>
        </div>
      </div>

      <div v-for="g in LOCAL_GUIDES" :key="g.key" class="card">
        <div class="guide-head">
          <h4>{{ g.name }}</h4>
          <button class="btn btn-xs" type="button" @click="copyText(g.baseUrl)">复制地址</button>
          <button class="btn btn-xs" type="button" @click="openAdd(g.key)">用这个预设添加</button>
        </div>
        <ol class="steps">
          <li v-for="(s, i) in g.steps" :key="i">{{ s }}</li>
        </ol>
        <div class="kv"><span>地址</span><code class="mono">{{ g.baseUrl }}</code></div>
        <div class="kv"><span>模型名</span><span>{{ g.modelHint }}</span></div>
        <p class="warn-box">{{ g.note }}</p>
      </div>

      <div class="card note-card">
        <h4>使用限制</h4>
        <ul class="notes">
          <li><b>安卓端推理受设备性能限制。</b>大参数模型需数 GB 可用内存，中低端设备可能无法运行。本软件不内置模型，也不保证任何机型可用。</li>
          <li><b>局域网服务存在访问风险。</b>若将监听地址改为 0.0.0.0 或局域网 IP，同网段设备可能直接访问该模型服务，请自行评估。</li>
          <li><b>不依赖开发者服务器。</b>所有请求由本机直接发往你配置的地址，无中转服务，对话内容不会上传至第三方。</li>
        </ul>
      </div>
    </section>

    <!-- 安全 -->
    <section v-else class="pane">
      <div class="pane-head">
        <div>
          <h3>密钥安全</h3>
          <p class="muted small">密钥默认加密存储于本机。以下限制请务必了解，加密并不等于绝对安全。</p>
        </div>
      </div>

      <div class="card">
        <h4>存储方式</h4>
        <ul class="notes">
          <li>密钥经 AES-GCM 加密后写入本机 IndexedDB；设备主密钥为不可导出的 CryptoKey，脚本无法读取原始字节。</li>
          <li>密钥仅通过请求头传递，不附加于 URL，不写入日志、代码仓库、源码或导出文件。</li>
          <li>错误提示统一脱敏：即使服务商在报错中回显密钥，也会被替换为 ***。</li>
          <li>
            <b>Web 环境限制：</b>任何可在同源页面执行的代码（浏览器扩展、注入脚本、调试工具）均可调用解密接口。
            因此浏览器端加密仅能降低明文泄露与被备份带出的风险，无法抵御本机恶意程序。
          </li>
        </ul>
      </div>

      <div class="card">
        <h4>已保存的密钥</h4>
        <div v-for="k in keyRows" :key="k.id" class="key-row">
          <div class="grow">
            <b>{{ k.label }}</b>
            <span class="mono muted">{{ k.mask }}</span>
          </div>
          <button class="btn btn-xs btn-danger" type="button" :disabled="!k.has" @click="removeKey(k.id)">删除</button>
        </div>
      </div>

      <div class="card">
        <h4>加密导出</h4>
        <p class="muted small" style="margin-top: 0">
          导出文件仅包含密文。口令至少 6 位，本软件不保存口令，遗失后无法恢复。
        </p>
        <div class="grid2">
          <label class="field"><span class="field-label">设置口令</span><input v-model="passphrase" type="password" class="input" autocomplete="new-password" /></label>
          <label class="field"><span class="field-label">再输一次</span><input v-model="passphrase2" type="password" class="input" autocomplete="new-password" /></label>
        </div>
        <button class="btn btn-sm btn-primary" type="button" @click="doExportKeys">导出加密备份</button>

        <div class="import">
          <h4>加密导入</h4>
          <div class="grid2">
            <label class="field"><span class="field-label">备份口令</span><input v-model="importPassphrase" type="password" class="input" autocomplete="new-password" /></label>
            <label class="field">
              <span class="field-label">选择备份文件</span>
              <input type="file" accept="application/json,.json" class="input" @change="onImportFile" />
            </label>
          </div>
          <p class="muted small" style="margin: 0">导入仅写入地址匹配的现有服务商，不会新建配置。</p>
        </div>

        <p v-if="keyError" class="err">{{ keyError }}</p>
        <p v-if="keyNotice" class="notice">{{ keyNotice }}</p>
      </div>
    </section>
  </SubPage>

  <!-- 预设选择 -->
  <PresetPicker v-if="pickerOpen" @pick="onPickPreset" @close="pickerOpen = false" />

  <!-- 编辑抽屉 -->
  <div v-if="editorOpen" class="scrim" @click.self="editorOpen = false">
    <ProviderEditor :key="editorSeq" :row="editingRow" :preset-key="presetKey" @saved="onSaved" @cancel="editorOpen = false" />
  </div>
</template>

<style scoped>
.overview {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
  padding: 14px; border-radius: var(--r-3); background: var(--surface);
}
.ov-item { display: flex; flex-direction: column; gap: 3px; }
.ov-item b { font-size: 17px; font-weight: var(--fw-strong); }
.ov-item span { font-size: 11px; color: var(--text-3); }

.budget-bar { margin-top: 10px; padding: 12px 14px; border-radius: var(--r-3); background: var(--surface); }
.bar-track { height: 5px; border-radius: var(--r-full); background: var(--surface-3); overflow: hidden; }
.bar-fill { height: 100%; background: var(--primary); transition: width var(--dur-3) var(--ease-out); }
.budget-bar.warn .bar-fill { background: #c98a00; }
.budget-bar.over .bar-fill { background: var(--danger, #c0392b); }
.bar-text { display: flex; justify-content: space-between; gap: 10px; margin-top: 7px; font-size: 11.5px; color: var(--text-2); flex-wrap: wrap; }

.tabs { display: flex; gap: 4px; overflow-x: auto; margin: 14px 0 0; padding-bottom: 2px; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.tab {
  flex: 0 0 auto; height: 32px; padding: 0 12px; border: none; border-radius: var(--r-full);
  background: transparent; color: var(--text-3); font-size: 12.5px; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.tab:hover { color: var(--text); }
.tab.on { background: var(--text); color: var(--bg); }

.dev-hint {
  margin: 12px 0 0; padding: 10px 12px; border-radius: var(--r-2);
  background: var(--surface-2); font-size: 11.5px; color: var(--text-3); line-height: 1.7;
}
.dev-hint .link {
  border: none; background: transparent; padding: 0;
  color: var(--primary); font-size: 11.5px; cursor: pointer; text-decoration: underline;
}
.pane { margin-top: 16px; }
.pane-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.pane-head h3 { margin: 0 0 4px; font-size: var(--fs-4); font-weight: var(--fw-strong); }
.pane-head p { margin: 0; line-height: 1.65; }

.preset {
  padding: 6px 11px; border-radius: var(--r-full); border: 1px dashed var(--line-strong);
  background: transparent; color: var(--text-2); font-size: 11.5px; cursor: pointer;
  transition: border-color var(--dur-2), color var(--dur-2), background var(--dur-2);
}
.preset:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }

.prov-list { display: flex; flex-direction: column; gap: 10px; }
.empty { padding: 22px 18px; border-radius: var(--r-3); background: var(--surface-2); text-align: center; }
.empty b { display: block; margin-bottom: 6px; }
.empty p { margin: 0; font-size: 12px; color: var(--text-3); line-height: 1.7; }

.matrix { margin-top: 18px; }
.matrix h4 { margin: 0 0 8px; font-size: 12.5px; }
.matrix table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.matrix th, .matrix td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); }
.matrix th { color: var(--text-3); font-weight: var(--fw-medium); }

.filters { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.filters .select { width: 150px; flex: 0 0 150px; }
.btn.on { background: var(--text); color: var(--bg); border-color: var(--text); }

.manual-row { display: flex; gap: 6px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.manual-row .select { width: 140px; flex: 0 0 140px; }
.manual-row .price { width: 96px; flex: 0 0 96px; }

.model-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.model-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 11px 12px; border-radius: var(--r-2); background: var(--surface-2);
}
.star { border: none; background: transparent; color: var(--text-3); font-size: 15px; cursor: pointer; line-height: 1.4; padding: 0; }
.star.on { color: #d4a017; }
.m-main { flex: 1 1 auto; min-width: 0; }
.m-name { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12.5px; }
.m-meta { margin-top: 3px; font-size: 11px; color: var(--text-3); }
.m-err { margin-top: 4px; font-size: 11px; color: var(--danger, #c0392b); line-height: 1.55; }
.tag { font-size: 10px; padding: 1px 6px; border-radius: var(--r-full); background: var(--surface-3); color: var(--text-3); }
.tag.ok { background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--primary); }
.tag.unknown { background: var(--surface-3); }
.tag.default { background: color-mix(in srgb, var(--primary) 10%, transparent); color: var(--primary); }
.tag.beta { background: color-mix(in srgb, #c98a00 16%, transparent); color: #a06f00; }
.caps { display: flex; align-items: center; gap: 5px; margin-top: 7px; flex-wrap: wrap; }
.caps .muted { font-size: 10.5px; }
.cap { padding: 2px 8px; border: none; border-radius: var(--r-full); background: var(--surface-3); color: var(--text-3); font-size: 10.5px; cursor: pointer; }
.cap.on { background: var(--primary-soft); color: var(--primary); }
.m-actions { display: flex; flex-direction: column; gap: 4px; flex: 0 0 auto; }

.card { padding: 15px 16px; border-radius: var(--r-3); background: var(--surface); margin-bottom: 12px; }
.card h4 { margin: 0 0 10px; font-size: 12.5px; font-weight: var(--fw-strong); }
.chk { display: flex; align-items: flex-start; gap: 9px; font-size: 12.5px; color: var(--text-2); line-height: 1.55; margin-bottom: 8px; cursor: pointer; }
.chk.big { margin-bottom: 14px; }
.chk input { width: 17px; height: 17px; flex: 0 0 17px; margin-top: 1px; accent-color: var(--primary); }
.rule-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-bottom: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.field.inline { margin-bottom: 0; }
.field-label { font-size: 12px; color: var(--text-3); }
.field-hint { font-size: 11.5px; color: var(--text-3); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }

.agent-rows { display: flex; flex-direction: column; gap: 8px; }
.agent-row { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: var(--r-2); background: var(--surface-2); }
.a-main { flex: 1 1 auto; min-width: 0; }
.a-name { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
.a-reason { margin-top: 2px; }
.a-select { width: 240px; flex: 0 0 240px; }

.stat-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 12px; }
.stat { padding: 11px 10px; border-radius: var(--r-2); background: var(--surface); display: flex; flex-direction: column; gap: 3px; }
.stat b { font-size: 15px; }
.stat span { font-size: 10.5px; color: var(--text-3); }

.tbl { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.tbl th, .tbl td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); }
.tbl th { color: var(--text-3); font-weight: var(--fw-medium); }

.guide-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.guide-head h4 { margin: 0; flex: 1 1 auto; }
.steps { margin: 0 0 10px; padding-left: 18px; font-size: 12px; color: var(--text-2); line-height: 1.8; }
.kv { display: flex; gap: 8px; font-size: 11.5px; color: var(--text-2); margin-bottom: 4px; }
.kv > span:first-child { color: var(--text-3); flex: 0 0 52px; }
.warn-box { margin: 10px 0 0; padding: 9px 11px; border-radius: var(--r-2); background: color-mix(in srgb, #c98a00 10%, transparent); font-size: 11.5px; line-height: 1.7; color: var(--text-2); }
.notes { margin: 0; padding-left: 18px; font-size: 12px; color: var(--text-2); line-height: 1.85; }
.note-card { background: var(--surface-2); }

.key-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 12px; }
.key-row b { margin-right: 8px; }
.key-row:last-of-type { border-bottom: none; }
.import { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); }
.err { margin: 8px 0 0; font-size: 11.5px; color: var(--danger, #c0392b); line-height: 1.6; }
.notice { margin: 8px 0 0; font-size: 11.5px; color: var(--primary); line-height: 1.6; }

.scrim {
  position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgba(12, 13, 16, 0.5); animation: fade var(--dur-2) var(--ease-out);
}
.scrim > * { width: min(560px, 100%); }
@keyframes fade { from { opacity: 0 } to { opacity: 1 } }

@media (max-width: 760px) {
  .overview { grid-template-columns: repeat(2, 1fr); }
  .stat-grid { grid-template-columns: repeat(3, 1fr); }
  .rule-grid { grid-template-columns: 1fr; }
  .grid2 { grid-template-columns: 1fr; }
  .agent-row { flex-direction: column; align-items: stretch; }
  .a-select { width: 100%; flex: 1 1 auto; }
  .manual-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .manual-row .select { width: auto; flex: 1 1 auto; grid-column: 1 / -1; }
  .manual-row .input.grow { grid-column: 1 / -1; }
  .manual-row .btn { grid-column: 1 / -1; }

  /* 模型条目在窄屏会顶出屏幕：名字换行、按钮改横排 */
  .model-item { flex-wrap: wrap; }
  .m-name { font-size: 12px; }
  .m-name .mono { word-break: break-all; }
  .m-actions { flex-direction: row; flex-wrap: wrap; width: 100%; margin-top: 8px; }
  .m-actions .btn { flex: 1 1 auto; }
  .filters .select { width: auto; flex: 1 1 140px; }
  .pane-head { flex-direction: column; align-items: stretch; }
}
</style>
