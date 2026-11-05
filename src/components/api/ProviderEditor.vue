<script setup lang="ts">
/**
 * 服务商编辑
 *
 * 普通用户只看到：名称、接口类型、地址、Key、是否支持模型列表。
 * 开发者模式多出：超时、重试、采样参数、额外请求头/请求体、启用与默认。
 * 这些额外项默认折叠，避免「一堆看不懂的框」把新手劝退。
 */
import { computed, reactive, ref, watch } from 'vue';
import type { ProviderRow } from '../../core/db';
import type { ModelParams, ProviderKind } from '../../core/types';
import { useAppStore } from '../../stores/app';
import { maskKey, seal } from '../../core/crypto';
import { uid } from '../../core/id';
import { PROVIDER_PRESETS, supportOf } from '../../ai/catalog';

const props = defineProps<{
  /** 编辑现有服务商；null 表示新建 */
  row?: ProviderRow | null;
  presetKey?: string;
}>();
const emit = defineEmits<{ saved: [ProviderRow]; cancel: [] }>();

const app = useAppStore();
const devMode = computed(() => app.settings.devMode);

const showAdvanced = ref(false);
const keyInput = ref('');
const keyVisible = ref(false);
const error = ref('');
const extraBodyText = ref('');
const headersText = ref('');
/** 预设带来的提示（地址怎么填、是否需要替换资源名） */
const presetHint = ref('');

const form = reactive({
  label: '',
  kind: 'openai-compatible' as ProviderKind,
  baseUrl: '',
  supportsModelList: true,
  // 新加的服务商默认不启用：用户自己点开关后才参与对话
  enabled: false,
  isDefault: false,
  timeoutMs: 60000,
  maxRetries: 1,
  temperature: 0.4 as number | undefined,
  maxTokens: 2048 as number | undefined,
  topP: undefined as number | undefined,
  beta: false,
});

const isEdit = computed(() => Boolean(props.row?.id));
const support = computed(() => supportOf(form.kind));

function loadPreset() {
  const p = PROVIDER_PRESETS.find((x) => x.key === props.presetKey);
  if (!p) return;
  form.label = p.label;
  form.kind = p.kind;
  form.baseUrl = p.baseUrl;
  form.supportsModelList = p.modelList;
  form.beta = Boolean(p.beta);
  presetHint.value = [p.hint, p.needsConfirm ? '该地址请以服务商官方文档为准，本软件不保证长期有效。' : '']
    .filter(Boolean)
    .join(' ');
}

function loadRow(r: ProviderRow) {
  presetHint.value = '';
  form.label = r.label;
  form.kind = r.kind;
  form.baseUrl = r.baseUrl;
  form.supportsModelList = r.supportsModelList;
  form.enabled = r.enabled !== false;
  form.isDefault = Boolean(r.isDefault);
  form.timeoutMs = r.timeoutMs || 60000;
  form.maxRetries = r.maxRetries ?? 1;
  form.temperature = r.params?.temperature;
  form.maxTokens = r.params?.maxTokens;
  form.topP = r.params?.topP;
  form.beta = Boolean(r.beta);
  extraBodyText.value = r.params?.extraBody ? JSON.stringify(r.params.extraBody, null, 2) : '';
  headersText.value = r.params?.headers ? JSON.stringify(r.params.headers, null, 2) : '';
}

watch(
  () => props.row,
  (r) => {
    error.value = '';
    keyInput.value = '';
    if (r) loadRow(r);
    else {
      Object.assign(form, {
        label: '',
        kind: 'openai-compatible',
        baseUrl: '',
        supportsModelList: true,
        enabled: false,
        isDefault: false,
        timeoutMs: 60000,
        maxRetries: 1,
        temperature: 0.4,
        maxTokens: 2048,
        topP: undefined,
        beta: false,
      });
      extraBodyText.value = '';
      headersText.value = '';
      loadPreset();
    }
  },
  { immediate: true },
);

watch(
  () => form.kind,
  (k) => {
    // 切接口类型时，把「支持模型列表」跟着支持表走，但仍可手动改
    form.supportsModelList = supportOf(k).modelList !== null;
    form.beta = k === 'local';
  },
);

function parseJsonObject(text: string, label: string): Record<string, unknown> | undefined {
  const t = text.trim();
  if (!t) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch {
    throw new Error(`${label} 格式无效，请检查 JSON`);
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${label} 需为 JSON 对象`);
  return v as Record<string, unknown>;
}

async function save() {
  error.value = '';
  if (!form.label.trim()) {
    error.value = '请填写服务商名称，用于在列表中区分';
    return;
  }
  if (!/^https?:\/\//i.test(form.baseUrl.trim())) {
    error.value = 'Base URL 需以 http:// 或 https:// 开头';
    return;
  }
  if (/[?&](key|api_key|apikey|access_token)=/i.test(form.baseUrl)) {
    error.value = '地址中不得包含密钥。请将密钥填写在下方输入框，通过请求头传递。';
    return;
  }

  let extraBody: Record<string, unknown> | undefined;
  let headers: Record<string, string> | undefined;
  try {
    extraBody = parseJsonObject(extraBodyText.value, '额外请求体');
    const h = parseJsonObject(headersText.value, '额外请求头');
    headers = h ? (h as Record<string, string>) : undefined;
  } catch (e) {
    error.value = (e as Error).message;
    return;
  }

  const params: ModelParams = {
    temperature: form.temperature,
    maxTokens: form.maxTokens,
    topP: form.topP,
    headers,
    extraBody,
  };

  const base: ProviderRow = props.row
    ? { ...props.row }
    : {
        id: uid('prov'),
        kind: form.kind,
        label: form.label.trim(),
        baseUrl: form.baseUrl.trim(),
        models: [],
        supportsModelList: form.supportsModelList,
        timeoutMs: form.timeoutMs,
        maxRetries: form.maxRetries,
        createdAt: Date.now(),
        apiKeySealed: { v: 1, iv: '', data: '' },
        apiKeyPreview: '',
        apiKeyLen: 0,
      };

  const next: ProviderRow = {
    ...base,
    label: form.label.trim(),
    kind: form.kind,
    baseUrl: form.baseUrl.trim(),
    supportsModelList: form.supportsModelList,
    enabled: form.enabled,
    isDefault: form.isDefault,
    timeoutMs: Math.max(3000, Number(form.timeoutMs) || 60000),
    maxRetries: Math.max(0, Number(form.maxRetries) || 0),
    params,
    beta: form.beta || form.kind === 'local',
  };

  if (keyInput.value.trim()) {
    next.apiKeySealed = await seal(keyInput.value.trim());
    next.apiKeyPreview = maskKey(keyInput.value.trim());
    next.apiKeyLen = keyInput.value.trim().length;
  }

  emit('saved', next);
}
</script>

<template>
  <div class="editor">
    <div class="editor-head">
      <div class="grow">
        <div class="muted small">{{ isEdit ? '编辑服务商' : '添加服务商' }}</div>
        <b>{{ form.label || '未命名' }}</b>
      </div>
      <button class="x" type="button" aria-label="关闭" @click="emit('cancel')">×</button>
    </div>

    <div class="editor-body">
      <label class="field">
        <span class="field-label">名称</span>
        <input v-model="form.label" class="input" placeholder="例如 DeepSeek 主力" />
        <span class="field-hint">仅用于界面显示，不影响接口调用。</span>
      </label>

      <label class="field">
        <span class="field-label">接口类型</span>
        <select v-model="form.kind" class="select">
          <option value="openai-compatible">OpenAI 兼容</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Google Gemini</option>
          <option value="local">本地模型（Beta）</option>
        </select>
        <span class="field-hint">{{ support.scope }}</span>
      </label>

      <label class="field">
        <span class="field-label">Base URL</span>
        <input v-model="form.baseUrl" class="input mono" placeholder="https://api.example.com/v1" spellcheck="false" />
        <span class="field-hint">填写至 API 版本路径，例如 /v1。密钥仅通过请求头传递，不会附加在地址中。</span>
        <span v-if="presetHint" class="field-hint preset-hint">{{ presetHint }}</span>
      </label>

      <label class="field">
        <span class="field-label">API Key</span>
        <div class="key-row">
          <input
            v-model="keyInput"
            :type="keyVisible ? 'text' : 'password'"
            class="input mono grow"
            :placeholder="isEdit && row?.apiKeyLen ? `已保存 ${row.apiKeyPreview}，留空则不修改` : '输入密钥，仅保存于本机'"
            spellcheck="false"
            autocomplete="off"
          />
          <button class="btn btn-sm" type="button" @click="keyVisible = !keyVisible">
            {{ keyVisible ? '隐藏' : '显示' }}
          </button>
        </div>
        <span class="field-hint">密钥经 AES-GCM 加密后写入本机数据库，不会出现在日志、导出文件或链接中。</span>
      </label>

      <label class="chk">
        <input v-model="form.supportsModelList" type="checkbox" />
        <span>该服务商提供模型列表接口（{{ support.modelList || '无' }}）</span>
      </label>

      <button class="adv-toggle" type="button" @click="showAdvanced = !showAdvanced">
        {{ showAdvanced ? '收起高级选项' : '高级选项（超时、重试、采样参数）' }}
        <span class="chev" :class="{ on: showAdvanced }">›</span>
      </button>

      <div class="fold" :class="{ open: showAdvanced }">
        <div class="fold-inner">
          <div class="grid2">
            <label class="field">
              <span class="field-label">超时（毫秒）</span>
              <input v-model.number="form.timeoutMs" type="number" min="3000" class="input num" />
            </label>
            <label class="field">
              <span class="field-label">失败重试次数</span>
              <input v-model.number="form.maxRetries" type="number" min="0" max="3" class="input num" />
            </label>
            <label class="field">
              <span class="field-label">temperature</span>
              <input v-model.number="form.temperature" type="number" step="0.1" min="0" max="2" class="input num" />
            </label>
            <label class="field">
              <span class="field-label">max_tokens</span>
              <input v-model.number="form.maxTokens" type="number" min="1" class="input num" />
            </label>
          </div>

          <label class="field">
            <span class="field-label">附加请求头（JSON，可选）</span>
            <textarea v-model="headersText" class="textarea mono" rows="2" placeholder='{"X-Title":"StudyMate"}' spellcheck="false" />
          </label>

          <label class="field">
            <span class="field-label">附加请求体（JSON，可选）</span>
            <textarea v-model="extraBodyText" class="textarea mono" rows="3" placeholder='{"top_k":40}' spellcheck="false" />
            <span class="field-hint">合并至请求体末尾，可覆盖上方参数，用于服务商私有字段。</span>
          </label>

          <label class="chk">
            <input v-model="form.enabled" type="checkbox" />
            <span>启用（停用后不参与自动分配，手动指定仍可用）</span>
          </label>
          <label class="chk">
            <input v-model="form.isDefault" type="checkbox" />
            <span>设为默认服务商</span>
          </label>
        </div>
      </div>

      <p v-if="error" class="err">{{ error }}</p>
    </div>

    <div class="editor-foot">
      <button class="btn btn-sm" type="button" @click="emit('cancel')">取消</button>
      <button class="btn btn-sm btn-primary" type="button" @click="save">
        {{ isEdit ? '保存修改' : '添加' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: flex; flex-direction: column;
  background: var(--bg); border-radius: var(--r-4);
  box-shadow: var(--shadow-3); overflow: hidden;
  max-height: min(88vh, 760px);
}
.editor-head {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px 18px 12px; border-bottom: 1px solid var(--line);
}
.editor-head b { font-weight: var(--fw-strong); font-size: var(--fs-3); }
.x {
  width: 30px; height: 30px; flex: 0 0 30px; border: none; border-radius: 50%;
  background: var(--surface-2); color: var(--text-2); font-size: 18px; cursor: pointer;
}
.editor-body { padding: 16px 18px; overflow-y: auto; }
.editor-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px; border-top: 1px solid var(--line);
  background: var(--surface);
}
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.field-label { font-size: 12px; color: var(--text-3); }
.field-hint { font-size: 11.5px; color: var(--text-3); line-height: 1.6; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.key-row { display: flex; gap: 8px; align-items: center; }
.chk { display: flex; align-items: flex-start; gap: 9px; font-size: 12.5px; color: var(--text-2); line-height: 1.55; margin-bottom: 10px; cursor: pointer; }
.chk input { width: 17px; height: 17px; flex: 0 0 17px; margin-top: 1px; accent-color: var(--primary); }
.adv-toggle {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 10px 0; margin-bottom: 4px;
  border: none; border-top: 1px solid var(--line); background: transparent;
  color: var(--text-2); font-size: 12.5px; cursor: pointer; text-align: left;
}
.chev { margin-left: auto; transition: transform var(--dur-2) var(--ease-out); }
.chev.on { transform: rotate(90deg); }
.fold { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--dur-3) var(--ease-out); }
.fold.open { grid-template-rows: 1fr; }
.fold-inner { overflow: hidden; }
.err { margin: 4px 0 0; color: var(--danger, #c0392b); font-size: 12px; line-height: 1.6; }
@media (max-width: 700px) { .grid2 { grid-template-columns: 1fr; } }
</style>
<style scoped>
.preset-hint { color: var(--text-3); }
</style>
