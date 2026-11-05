import type { ProviderRow } from '../core/db';
import { maskKey, open_, scrubSecrets, seal, sealWithPassphrase, openWithPassphrase, type PassphraseSealed } from '../core/crypto';
import { uid } from '../core/id';
import type { ModelEntry, ProviderKind } from '../core/types';
import { adapterFor } from './providers';
import { supportOf } from './catalog';
import { ModelListUnsupportedError, ProviderError, type ChatMessage } from './types';
import { joinUrl, trimSlash } from './http';

/* ------------------------------------------------------------------ */
/* 脱敏                                                                 */
/* ------------------------------------------------------------------ */

/** 任何要进界面、进日志、进 toast 的文本都先过这里 */
export function redact(text: string, key?: string): string {
  return scrubSecrets(text ?? '', key ? [key] : []);
}

/** 把任意异常转成一句人话，且保证不含 Key */
export function describeError(e: unknown, key?: string): string {
  if (e instanceof ProviderError) {
    const detail = e.detail ? `（${e.detail}）` : '';
    return redact(`${e.message}${detail}`, key);
  }
  if (e instanceof ModelListUnsupportedError) return redact(e.message, key);
  const msg = e instanceof Error ? e.message : String(e);
  return redact(msg || '未知错误', key);
}

/* ------------------------------------------------------------------ */
/* 连接测试                                                             */
/* ------------------------------------------------------------------ */

export type StageStatus = 'ok' | 'fail' | 'skipped';

export interface StageResult {
  stage: 'address' | 'auth' | 'generate';
  label: string;
  status: StageStatus;
  ms: number;
  message: string;
}

export interface TestReport {
  ok: boolean;
  stages: StageResult[];
  /** 鉴权阶段顺带拉到的模型名 */
  models?: string[];
  /** 生成阶段实际用的模型 */
  model?: string;
  /** 生成阶段返回的前若干字 */
  text?: string;
  latencyMs: number;
}

export interface TestOptions {
  /** 指定用于生成阶段的模型；不填则用默认/第一个 */
  model?: string;
  /** 明文 Key；不传则从加密信封里解 */
  apiKey?: string;
  signal?: AbortSignal;
  onStage?: (s: StageResult) => void;
}

function modelsUrl(row: Pick<ProviderRow, 'kind' | 'baseUrl'>): string | null {
  const support = supportOf(row.kind);
  if (!support.modelList) return null;
  const base = trimSlash(row.baseUrl || '');
  if (!base) return null;
  switch (row.kind) {
    case 'anthropic':
      return joinUrl(base, '/v1/models');
    case 'gemini':
      return joinUrl(base, '/v1beta/models');
    default:
      // OpenAI 兼容与本地：{base}/models（本地后端普遍也支持）
      return joinUrl(base, '/models');
  }
}

function authHeaders(kind: ProviderKind, key: string): Record<string, string> {
  switch (kind) {
    case 'anthropic':
      return {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
    case 'gemini':
      return key ? { 'x-goog-api-key': key } : {};
    default:
      return key ? { Authorization: `Bearer ${key}` } : {};
  }
}

async function timedFetch(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; body: string; ms: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => controller.abort(new Error('aborted'));
  signal?.addEventListener('abort', onAbort);
  const started = performance.now();
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    const body = await res.text();
    return { status: res.status, body: body.slice(0, 400), ms: performance.now() - started };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * 三段式测试：地址 → 鉴权 → 指定模型生成。
 * 每一段单独报结果，失败时能看出是地址填错、Key 不对，还是这个模型不可用。
 * 注意：Key 只进请求头；任何错误文本都经过 redact。
 */
export async function testProvider(row: ProviderRow, opts: TestOptions = {}): Promise<TestReport> {
  const stages: StageResult[] = [];
  const key = opts.apiKey ?? (await open_(row.apiKeySealed));
  const push = (s: StageResult) => {
    stages.push(s);
    opts.onStage?.(s);
  };
  const overall = performance.now();

  /* 1. 地址 --------------------------------------------------------- */
  const url = modelsUrl(row);
  let addressOk = false;
  if (!row.baseUrl || !/^https?:\/\//i.test(row.baseUrl)) {
    push({
      stage: 'address',
      label: '地址',
      status: 'fail',
      ms: 0,
      message: 'Base URL 需以 http:// 或 https:// 开头',
    });
  } else if (!url) {
    push({ stage: 'address', label: '地址', status: 'skipped', ms: 0, message: '该接口没有模型列表路径，跳过' });
    addressOk = true;
  } else {
    const t0 = performance.now();
    try {
      const res = await timedFetch(url, {}, Math.min(row.timeoutMs || 15000, 12000), opts.signal);
      addressOk = true;
      if (res.status === 404) {
        push({
          stage: 'address',
          label: '地址',
          status: 'ok',
          ms: res.ms,
          message: `服务可达，但 ${url} 返回 404。请检查 Base URL 是否缺少 /v1 等版本路径；模型列表也可手动录入。`,
        });
      } else if (res.status === 401 || res.status === 403) {
        push({
          stage: 'address',
          label: '地址',
          status: 'ok',
          ms: res.ms,
          message: `服务可达（未携带密钥时返回 ${res.status}），地址有效，接口需要鉴权。`,
        });
      } else if (res.status >= 500) {
        push({
          stage: 'address',
          label: '地址',
          status: 'fail',
          ms: res.ms,
          message: `服务端返回 ${res.status}，请稍后重试`,
        });
        addressOk = false;
      } else {
        push({ stage: 'address', label: '地址', status: 'ok', ms: res.ms, message: `服务可达（HTTP ${res.status}）` });
      }
    } catch (e) {
      push({
        stage: 'address',
        label: '地址',
        status: 'fail',
        ms: performance.now() - t0,
        message: redact(
          /abort|timeout/i.test(String((e as Error)?.message))
            ? '连接超时：地址不可达或本机网络受限'
            : `无法连接：${describeError(e, key)}。也可能是该服务商未开放浏览器跨域（CORS）访问。`,
        ),
      });
    }
  }

  /* 2. 鉴权 --------------------------------------------------------- */
  let models: string[] | undefined;
  let authOk = false;
  if (!addressOk) {
    push({ stage: 'auth', label: '鉴权', status: 'skipped', ms: 0, message: '地址校验未通过，已跳过鉴权' });
  } else if (!key) {
    push({ stage: 'auth', label: '鉴权', status: 'fail', ms: 0, message: '尚未配置 API 密钥' });
  } else if (!url) {
    push({
      stage: 'auth',
      label: '鉴权',
      status: 'skipped',
      ms: 0,
      message: '当前接口未提供模型列表，鉴权将在生成阶段一并验证',
    });
  } else {
    const t0 = performance.now();
    try {
      const res = await timedFetch(url, authHeaders(row.kind, key), Math.min(row.timeoutMs || 15000, 15000), opts.signal);
      if (res.status >= 200 && res.status < 300) {
        try {
          const data = JSON.parse(res.body || '{}');
          const list = parseModelList(row.kind, data);
          models = list;
          authOk = true;
          push({
            stage: 'auth',
            label: '鉴权',
            status: 'ok',
            ms: res.ms,
            message: `密钥有效，返回 ${list.length} 个模型（列表仅供选择，可用性以校验结果为准）`,
          });
        } catch {
          authOk = true;
          push({ stage: 'auth', label: '鉴权', status: 'ok', ms: res.ms, message: '密钥有效（响应非标准 JSON，请手动录入模型名称）', });
        }
      } else if (res.status === 401 || res.status === 403) {
        push({
          stage: 'auth',
          label: '鉴权',
          status: 'fail',
          ms: res.ms,
          message: `密钥无效、已过期或权限不足（${res.status}）`,
        });
      } else if (res.status === 404) {
        push({
          stage: 'auth',
          label: '鉴权',
          status: 'skipped',
          ms: res.ms,
          message: '该地址未提供模型列表接口，鉴权改由生成阶段验证',
        });
      } else if (res.status === 429) {
        push({ stage: 'auth', label: '鉴权', status: 'fail', ms: res.ms, message: '请求受限或额度不足（429）' });
      } else {
        push({
          stage: 'auth',
          label: '鉴权',
          status: 'fail',
          ms: res.ms,
          message: `鉴权接口返回 ${res.status}：${redact(res.body, key).slice(0, 160)}`,
        });
      }
    } catch (e) {
      push({
        stage: 'auth',
        label: '鉴权',
        status: 'fail',
        ms: performance.now() - t0,
        message: `请求失败：${describeError(e, key)}`,
      });
    }
  }

  /* 3. 生成 --------------------------------------------------------- */
  const model = opts.model || row.defaultModel || row.models.find((m) => m.favorite)?.name || row.models[0]?.name || '';
  let text: string | undefined;
  if (!model) {
    push({
      stage: 'generate',
      label: '生成',
      status: 'skipped',
      ms: 0,
      message: '暂无可用模型。请先同步或手动录入模型，再进行生成测试。',
    });
  } else if (!key) {
    push({ stage: 'generate', label: '生成', status: 'skipped', ms: 0, message: '未配置密钥，已跳过' });
  } else {
    const t0 = performance.now();
    try {
      const res = await adapterFor(row.kind).chat(
        row as never,
        key,
        model,
        [{ role: 'user', content: '只回复两个字：可用' }] as ChatMessage[],
        { maxTokens: 256, timeoutMs: Math.min(row.timeoutMs || 30000, 30000), signal: opts.signal },
      );
      text = res.text.slice(0, 60);
      const reasoning = (res as { reasoning?: string }).reasoning;
      if (!res.text && reasoning) {
        // 推理模型在极短输出额度下只返回了思考过程：接口连通、鉴权有效，不是配置错误
        push({
          stage: 'generate',
          label: '生成',
          status: 'ok',
          ms: Math.round((performance.now() - t0) / 10) / 100,
          message: `接口连通、鉴权有效，但返回的是推理过程（reasoning）而非正文。这是推理模型的正常表现——测试用的短输出额度被思考占满。实际使用时把 max_tokens 调大即可正常出文。`,
        });
      } else {
        push({
          stage: 'generate',
          label: '生成',
          status: 'ok',
          ms: Math.round((performance.now() - t0) / 10) / 100,
          message: `模型 ${res.model || model} 返回：${text || '（空）'}`,
        });
      }
    } catch (e) {
      push({
        stage: 'generate',
        label: '生成',
        status: 'fail',
        ms: Math.round((performance.now() - t0) / 10) / 100,
        message: describeError(e, key),
      });
    }
  }

  const failed = stages.some((s) => s.status === 'fail');
  return {
    ok: !failed && stages.some((s) => s.stage === 'generate' && s.status === 'ok'),
    stages,
    models,
    model: model || undefined,
    text,
    latencyMs: Math.round(performance.now() - overall),
  };
}

/** 各家模型列表的字段不太一样，集中在这里解析 */
export function parseModelList(kind: ProviderKind, data: unknown): string[] {
  const d = data as Record<string, any>;
  if (!d || typeof d !== 'object') return [];
  let raw: unknown[] = [];
  if (kind === 'gemini') raw = d.models ?? [];
  else if (Array.isArray(d.data)) raw = d.data;
  else if (Array.isArray(d.models)) raw = d.models;
  else if (Array.isArray(d)) raw = d;
  return raw
    .map((m) =>
      typeof m === 'string'
        ? m
        : String((m as any)?.id ?? (m as any)?.name ?? (m as any)?.model ?? ''),
    )
    .map((s) => (kind === 'gemini' ? s.replace(/^models\//, '') : s))
    .filter((s) => s.length > 0 && s.length < 200)
    .sort();
}

/* ------------------------------------------------------------------ */
/* 模型列表                                                             */
/* ------------------------------------------------------------------ */

export interface RefreshResult {
  ok: boolean;
  total: number;
  added: number;
  kept: number;
  models: ModelEntry[];
  message: string;
}

/**
 * 拉取模型列表。
 * 合并而不是覆盖：手动添加的、填过价格与能力的、收藏的，都不能因为一次刷新丢掉。
 */
export async function refreshModels(
  row: ProviderRow,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<RefreshResult> {
  const key = opts.apiKey ?? (await open_(row.apiKeySealed));
  try {
    const names = await adapterFor(row.kind).listModels(row as never, key);
    const byName = new Map(row.models.map((m) => [m.name, m]));
    let added = 0;
    for (const n of names) {
      if (!byName.has(n)) {
        byName.set(n, { id: uid('m'), name: n });
        added++;
      }
    }
    const models = [...byName.values()];
    return {
      ok: true,
      total: models.length,
      added,
      kept: row.models.length,
      models,
      message: added ? `新增 ${added} 个，共 ${models.length} 个` : `没有新模型，共 ${models.length} 个`,
    };
  } catch (e) {
    if (e instanceof ModelListUnsupportedError) {
      return {
        ok: false,
        total: row.models.length,
        added: 0,
        kept: row.models.length,
        models: row.models,
        message: '当前接口不提供模型列表，请手动录入模型名称',
      };
    }
    return {
      ok: false,
      total: row.models.length,
      added: 0,
      kept: row.models.length,
      models: row.models,
      message: describeError(e, key),
    };
  }
}

/** 用真实生成验证某个模型到底能不能用——列表里看得见不等于能用 */
export async function verifyModel(
  row: ProviderRow,
  modelName: string,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; message: string; text?: string; latencyMs: number }> {
  const key = opts.apiKey ?? (await open_(row.apiKeySealed));
  if (!key) return { ok: false, message: '未配置 API 密钥', latencyMs: 0 };
  const started = performance.now();
  try {
    const res = await adapterFor(row.kind).chat(
      row as never,
      key,
      modelName,
      [{ role: 'user', content: '回复一个字：可' }],
      { maxTokens: 128, timeoutMs: Math.min(row.timeoutMs || 30000, 30000), signal: opts.signal },
    );
    const reasoning = (res as { reasoning?: string }).reasoning;
    if (!res.text && reasoning) {
      return {
        ok: true,
        message: '接口可用（推理模型：本次只返回了思考过程，调大 max_tokens 即可出文）',
        text: undefined,
        latencyMs: Math.round(performance.now() - started),
      };
    }
    return {
      ok: true,
      message: `生成成功：${res.text.slice(0, 40) || '（空内容）'}`,
      text: res.text.slice(0, 60),
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (e) {
    return { ok: false, message: describeError(e, key), latencyMs: Math.round(performance.now() - started) };
  }
}

/* ------------------------------------------------------------------ */
/* Key 的加密导入 / 导出 / 删除                                          */
/* ------------------------------------------------------------------ */

export interface KeyBundleEntry {
  providerId: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
}

export interface SealedKeyBundle {
  v: 1;
  kind: 'studymate-key-bundle';
  createdAt: number;
  /** 明文结构：{ entries: KeyBundleEntry[] }，用口令加密后放这里 */
  payload: PassphraseSealed;
}

/** 导出的备份文件只含密文；口令由用户自己记，丢了无法恢复 */
export async function exportKeyBundle(rows: ProviderRow[], passphrase: string): Promise<SealedKeyBundle> {
  const entries: KeyBundleEntry[] = [];
  for (const r of rows) {
    const k = await open_(r.apiKeySealed);
    if (!k) continue;
    entries.push({ providerId: r.id, label: r.label, kind: r.kind, baseUrl: r.baseUrl, apiKey: k });
  }
  const payload = await sealWithPassphrase(JSON.stringify({ entries }), passphrase);
  return { v: 1, kind: 'studymate-key-bundle', createdAt: Date.now(), payload };
}

export async function importKeyBundle(
  bundle: SealedKeyBundle,
  passphrase: string,
): Promise<KeyBundleEntry[]> {
  if (bundle?.kind !== 'studymate-key-bundle' || !bundle.payload) {
    throw new Error('该文件不是本软件导出的密钥备份');
  }
  const plain = await openWithPassphrase(bundle.payload, passphrase);
  const parsed = JSON.parse(plain) as { entries?: KeyBundleEntry[] };
  if (!Array.isArray(parsed.entries)) throw new Error('备份内容格式无效');
  return parsed.entries;
}

/** 清掉某个服务商的 Key（保留配置与模型列表） */
export async function clearKey(row: ProviderRow): Promise<ProviderRow> {
  return { ...row, apiKeySealed: await seal(''), apiKeyPreview: '', apiKeyLen: 0 };
}

export function keyMaskFor(key: string): string {
  return maskKey(key);
}
