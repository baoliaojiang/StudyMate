/**
 * 安卓原生 SSE 通道
 *
 * 背景：安卓 WebView 直连服务商会被 CORS 拦，所以开了 CapacitorHttp；
 * 但 CapacitorHttp 是一次性返回，读不到流。结果就是「等半天，然后一坨字出现」。
 * 原生插件 SseStream 用 HttpURLConnection 边读边推，这里负责把它桥回来。
 *
 * 插件不存在（旧包 / 浏览器 / 桌面）或第一条数据都没收到时，调用方应回退到 fetch。
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { emitSseLine, emitSseText } from './sse-lines';
import { ProviderError } from './types';

interface SseStreamPlugin {
  post(o: { url: string; headers?: Record<string, string>; body?: string }): Promise<{ id: string }>;
  abort(o: { id: string }): Promise<void>;
  addListener(
    event: 'start' | 'chunk' | 'done' | 'error',
    cb: (d: any) => void,
  ): Promise<{ remove: () => Promise<void> | void }>;
}

interface NativeSseOptions {
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  onData: (data: any) => void;
}

let cached: SseStreamPlugin | null = null;

function plugin(): SseStreamPlugin {
  if (!cached) cached = registerPlugin<SseStreamPlugin>('SseStream');
  return cached;
}

/** 原生通道是否可用（插件已注册） */
export function nativeSseAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SseStream');
  } catch {
    return false;
  }
}

/** 第一条数据都没收到就失败：调用方可以安全地回退到 fetch */
export class NativeSseColdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeSseColdError';
  }
}

export async function postNativeSse(url: string, opts: NativeSseOptions): Promise<{ status: number }> {
  const p = plugin();
  const handles: Array<{ remove: () => Promise<void> | void }> = [];
  const registrations: Array<Promise<unknown>> = [];
  let status = 0;
  let gotAny = false;

  const settle = new Promise<number>((resolve, reject) => {
    const add = (event: 'start' | 'chunk' | 'done' | 'error', cb: (d: any) => void) => {
      registrations.push(
        p.addListener(event, cb).then((h) => {
          handles.push(h);
        }),
      );
    };

    add('start', (d) => {
      status = Number(d?.status) || 0;
    });
    add('chunk', (d) => {
      const text = typeof d?.text === 'string' ? d.text : '';
      if (!text) return;
      if (emitSseText(text, opts.onData)) gotAny = true;
    });
    add('done', () => resolve(status));
    add('error', (d) => {
      const msg = String(d?.message ?? '原生请求失败');
      const code = Number(d?.status) || 0;
      if (!gotAny) reject(new NativeSseColdError(msg));
      else reject(new ProviderError(msg.slice(0, 300), code || undefined, undefined, true));
    });
  });

  // 监听器是异步注册的：必须全部就位再发请求，否则最前面的几行会丢
  await Promise.all(registrations);

  const { id } = await p.post({
    url,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : '',
  });

  const onAbort = () => {
    void p.abort({ id }).catch(() => {});
  };
  opts.signal?.addEventListener('abort', onAbort);

  try {
    const finalStatus = await settle;
    if (!gotAny && finalStatus && (finalStatus < 200 || finalStatus >= 300)) {
      throw new NativeSseColdError(`服务商返回 ${finalStatus}`);
    }
    return { status: finalStatus };
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    for (const h of handles) {
      try {
        await h.remove();
      } catch {
        /* 监听器已随页面销毁 */
      }
    }
  }
}

/** 给 http.ts 用的统一出口 */
export { emitSseLine };
