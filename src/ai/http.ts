import { scrubSecrets } from '../core/crypto';
import { ProviderError } from './types';
import { emitSseLine, emitSseText } from './sse-lines';
import { NativeSseColdError, nativeSseAvailable, postNativeSse } from './native-sse';

export function trimSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

/**
 * 拼接 baseUrl 与路径。
 * 用户常常把 baseUrl 填成 `https://api.deepseek.com` 或 `https://api.openai.com/v1`，
 * 两种都要能用：如果 baseUrl 已以 /v1 结尾则不再重复添加。
 */
export function joinUrl(baseUrl: string, path: string): string {
  const base = trimSlash(baseUrl || '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export interface FetchJsonOptions {
  timeoutMs: number;
  maxRetries: number;
  /** 用于脱敏的敏感串（api key 等），永不进日志 */
  secrets?: string[];
  signal?: AbortSignal;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface FetchJsonResult<T> {
  status: number;
  data: T;
  duration: number;
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** 限流后统一等 1 分钟再自动重试：不打断、不暂停正在推进的流程 */
export const RATE_LIMIT_WAIT_MS = 60_000;

/** 通知界面「被限流了，正在等」，界面只提示不中断 */
function notifyRateLimit(waitMs: number) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('studymate:ratelimit', { detail: { waitMs } }));
}

/**
 * 统一网络层：超时 + 指数退避重试 + 错误脱敏。
 * 注意：绝不把 apiKey 拼进 URL；所有 key 均走 header。
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<FetchJsonResult<T>> {
  const started = performance.now();
  let attempt = 0;
  let lastErr: unknown;

  while (attempt <= opts.maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), opts.timeoutMs);
    const onAbort = () => controller.abort(new Error('aborted'));
    opts.signal?.addEventListener('abort', onAbort);

    try {
      const res = await fetch(url, {
        method: opts.method ?? (opts.body ? 'POST' : 'GET'),
        headers: {
          'Content-Type': 'application/json',
          ...opts.headers,
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text.slice(0, 800) };
        }
      }

      if (!res.ok) {
        const detail = scrubSecrets(
          typeof data === 'object' && data ? JSON.stringify(data).slice(0, 500) : String(text).slice(0, 500),
          opts.secrets ?? [],
        );
        const retryable = RETRYABLE_STATUS.has(res.status);
        // 429：先告诉用户，然后等满一分钟再试；这一等不算失败，外层流程不暂停
        if (res.status === 429) {
          notifyRateLimit(RATE_LIMIT_WAIT_MS);
          if (attempt < Math.max(1, opts.maxRetries)) {
            attempt++;
            lastErr = new ProviderError(
              '触发限流（429），已自动排队，约 1 分钟后重试',
              429,
              detail,
              true,
            );
            await rateLimitSleep(RATE_LIMIT_WAIT_MS, opts.signal);
            continue;
          }
        }
        if (retryable && attempt < opts.maxRetries) {
          lastErr = new ProviderError(
            `服务商返回 ${res.status}，正在重试（${attempt + 1}/${opts.maxRetries}）`,
            res.status,
            detail,
            true,
          );
          attempt++;
          await sleep(300 * 2 ** (attempt - 1));
          continue;
        }
        throw new ProviderError(describeStatus(res.status), res.status, detail, retryable);
      }

      return { status: res.status, data: data as T, duration: (performance.now() - started) / 1000 };
    } catch (e) {
      lastErr = e;
      const isAbort = e instanceof Error && /abort/i.test(e.message);
      if (isAbort) {
        throw new ProviderError('请求已取消或超时', undefined, undefined, true);
      }
      if (e instanceof ProviderError) {
        if (!e.retryable || attempt >= opts.maxRetries) throw e;
      } else {
        // 网络错误（CORS / DNS / 断网）通常可重试
        if (attempt >= opts.maxRetries) {
          const msg = e instanceof Error ? e.message : String(e);
          const hint = /Failed to fetch|NetworkError|Load failed/i.test(msg)
            ? '网络请求失败。按顺序排查：① 手机浏览器能否打开该服务商官网；② 接口地址若是 http:// 开头，安卓会拦明文请求，请改成 https://；③ 地址要带对路径（多数是 …/v1）；④ 该服务商可能不允许浏览器直连（CORS），换一家或自建中转。'
            : msg;
          throw new ProviderError(scrubSecrets(hint, opts.secrets ?? []), undefined, undefined, true);
        }
      }
      attempt++;
      await sleep(300 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr instanceof Error ? lastErr : new ProviderError('请求失败', undefined, undefined, false);
}

export interface FetchSseOptions extends FetchJsonOptions {
  /** 每解析出一条 data 的 JSON 就回调一次 */
  onData: (data: any) => void;
  /** 还没收到任何数据前允许重连几次；收到数据后不再重试，避免文字重复 */
  retriesBeforeFirstChunk?: number;
}

export { emitSseLine, emitSseText };

/**
 * 流式请求（SSE）。
 *
 * 与 fetchJson 的区别：
 * - 不做「失败后整段重放」的重试：已经吐字了再重放会让界面出现重复文字，
 *   所以只在「一个字都没收到」时重连一次；
 * - 超时按「多久没新数据」算（idle timeout），长回答不会被总时长掐断。
 */
export async function fetchSse(
  url: string,
  opts: FetchSseOptions,
): Promise<{ status: number; duration: number }> {
  const started = performance.now();

  /**
   * 安卓优先走原生通道：CapacitorHttp 读不到流，只有原生侧边读边推才看得见逐字输出。
   * 若一条数据都没收到就失败（地址错、证书问题等），退回下面的 fetch，行为与旧版一致。
   */
  if (nativeSseAvailable()) {
    try {
      const r = await postNativeSse(url, {
        headers: opts.headers,
        body: opts.body,
        signal: opts.signal,
        onData: opts.onData,
      });
      return { status: r.status, duration: (performance.now() - started) / 1000 };
    } catch (e) {
      if (!(e instanceof NativeSseColdError)) throw e;
      // 冷失败：继续走 fetch 分支，那里有完整的错误提示与重试
    }
  }
  const maxRetries = Math.max(0, opts.retriesBeforeFirstChunk ?? 1);
  let attempt = 0;
  let lastErr: unknown;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    let gotAny = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('timeout'));
      }, opts.timeoutMs);
    };
    const onAbort = () => controller.abort(new Error('aborted'));
    opts.signal?.addEventListener('abort', onAbort);
    bump();

    try {
      const res = await fetch(url, {
        method: opts.method ?? (opts.body ? 'POST' : 'GET'),
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...opts.headers },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        const detail = scrubSecrets(String(text).slice(0, 500), opts.secrets ?? []);
        const retryable = RETRYABLE_STATUS.has(res.status);
        if (res.status === 429) {
          notifyRateLimit(RATE_LIMIT_WAIT_MS);
          if (attempt < Math.max(1, opts.retriesBeforeFirstChunk ?? 1)) {
            attempt++;
            await rateLimitSleep(RATE_LIMIT_WAIT_MS, opts.signal);
            continue;
          }
        }
        if (retryable && attempt < maxRetries) {
          lastErr = new ProviderError(describeStatus(res.status), res.status, detail, true);
          attempt++;
          await sleep(300 * 2 ** (attempt - 1));
          continue;
        }
        throw new ProviderError(describeStatus(res.status), res.status, detail, retryable);
      }

      // 原生网络桥接（CapacitorHttp）不提供 body 流：整体拿回来后按行解析，
      // 会退化成「一次性出现」，但内容仍然正确
      const body = res.body as ReadableStream<Uint8Array> | null;
      if (!body || typeof body.getReader !== 'function') {
        const whole = await res.text();
        emitSseText(whole, opts.onData);
        return { status: res.status, duration: (performance.now() - started) / 1000 };
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bump();
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (emitSseLine(line, opts.onData)) gotAny = true;
        }
      }
      buf += decoder.decode();
      if (buf && emitSseLine(buf, opts.onData)) gotAny = true;
      return { status: res.status, duration: (performance.now() - started) / 1000 };
    } catch (e) {
      lastErr = e;
      if (opts.signal?.aborted) throw new ProviderError('请求已取消', undefined, undefined, true);
      if (timedOut) throw new ProviderError('等待响应超时：服务商长时间没有返回新内容', undefined, undefined, true);
      if (e instanceof ProviderError) {
        if (!e.retryable || attempt >= maxRetries) throw e;
      } else if (gotAny) {
        // 已经收到部分内容：不再重试，直接把错误抛上去，界面保留已收到的部分
        throw new ProviderError(e instanceof Error ? e.message : String(e), undefined, undefined, true);
      }
      attempt++;
      if (attempt > maxRetries) {
        const msg = e instanceof Error ? e.message : String(e);
        const hint = /Failed to fetch|NetworkError|Load failed/i.test(msg)
          ? '网络请求失败。按顺序排查：① 手机浏览器能否打开该服务商官网；② 接口地址若是 http:// 开头，安卓会拦明文请求，请改成 https://；③ 地址要带对路径（多数是 …/v1）；④ 该服务商可能不允许浏览器直连（CORS），换一家或自建中转。'
          : msg;
        throw new ProviderError(scrubSecrets(hint, opts.secrets ?? []), undefined, undefined, true);
      }
      await sleep(300 * 2 ** (attempt - 1));
    } finally {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr instanceof Error ? lastErr : new ProviderError('请求失败', undefined, undefined, false);
}

function describeStatus(status: number): string {  switch (status) {
    case 400:
      return '请求格式有误（400）';
    case 401:
      return 'API Key 无效或已过期（401）';
    case 403:
      return '访问被拒绝（403），可能是 Key 权限不足或地区限制';
    case 404:
      return '接口地址不存在（404），请检查 Base URL 是否包含正确路径';
    case 413:
      return '请求内容过长（413），请缩短上下文';
    case 429:
      return '触发限流或额度不足（429）';
    case 500:
    case 502:
    case 503:
    case 504:
      return `服务商暂时不可用（${status}）`;
    default:
      return `请求失败（${status}）`;
  }
}

let skipRateWait = false;

/** 用户在限流提示里点「立即重试」：让当前这一次等待提前结束 */
export function skipRateLimitWait() {
  skipRateWait = true;
}

/**
 * 限流等待：默认等满 60 秒后自动重试，用户也可以点「立即重试」提前放行。
 * 每 400ms 醒一次，既省电，又能及时响应手动重试与取消。
 */
async function rateLimitSleep(ms: number, signal?: AbortSignal): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (signal?.aborted) {
      throw new ProviderError('请求已取消或超时', undefined, undefined, true);
    }
    if (skipRateWait) {
      skipRateWait = false;
      return;
    }
    await sleep(Math.min(400, Math.max(0, end - Date.now())), signal);
  }
  skipRateWait = false;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new ProviderError('请求已取消或超时', undefined, undefined, true));
    };
    const onAbort = () => cancel();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      cancel();
      return;
    }
    signal?.addEventListener('abort', onAbort);
  });
}

/** 无网络时的确定性回退（本地模型 / 单元测试） */
export function estimateTokens(text: string): number {
  // 粗略估算：中文约 1 字 1 token，英文约 4 字符 1 token
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u3400-\u9fff\uff00-\uffef]/.test(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk + other / 4);
}
