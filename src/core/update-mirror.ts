/**
 * 更新源镜像探测
 *
 * 检查更新前依次探测 mirrors 列表，返回第一个网络可达的镜像地址。
 * 全部不可达时回退探测 githubRepo 本身；仍不可达返回 null。
 *
 * 说明：镜像站（如 ghproxy 系列）只是把 GitHub 内容做了反代，没有独立的
 * 版本查询接口，因此「检查更新」实质是可用性探测 + 把用户带到可访问的源。
 * 不会编造版本号，也不会真的下载任何东西。
 */

/** 单个源探测超时（毫秒） */
const PROBE_TIMEOUT_MS = 4500;

/**
 * 探测单个地址是否网络可达。
 * 用 no-cors 模式发 GET：能解析（哪怕是不透明响应）即视为可达，
 * 网络错误 / 超时 / 被拦截则视为不可达。
 */
function probeUrl(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  return fetch(url, {
    method: 'GET',
    mode: 'no-cors',
    cache: 'no-store',
    signal: controller.signal,
  })
    .then(() => true)
    .catch(() => false)
    .finally(() => window.clearTimeout(timer));
}

/**
 * 依次探测镜像列表，返回第一个可达的地址；全部不可达返回 null。
 * 探测顺序即传入顺序（默认/用户已按优先级排好）。
 */
export async function probeMirrors(mirrors: string[]): Promise<string | null> {
  for (const url of mirrors) {
    if (!url) continue;
    if (await probeUrl(url)) return url;
  }
  return null;
}

export type UpdateSourceVia = 'mirror' | 'repo' | null;

export interface UpdateSource {
  /** 可达的地址；全部不可达为 null */
  url: string | null;
  /** 来自镜像站还是官方仓库；null 表示都连不上 */
  via: UpdateSourceVia;
}

/**
 * 选出可用更新源：优先 mirrors，回退 githubRepo。
 */
export async function resolveUpdateSource(
  mirrors: string[],
  githubRepo?: string,
): Promise<UpdateSource> {
  const mirror = await probeMirrors(mirrors);
  if (mirror) return { url: mirror, via: 'mirror' };
  if (githubRepo && (await probeUrl(githubRepo))) {
    return { url: githubRepo, via: 'repo' };
  }
  return { url: null, via: null };
}

/** 取地址的 host 用于界面展示（去掉协议头） */
export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
