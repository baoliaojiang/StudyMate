/**
 * 更新源镜像探测
 *
 * 检查更新前依次探测 mirrors 列表，返回第一个网络可达的镜像地址。
 * 全部不可达时回退探测 githubRepo 本身；仍不可达返回 null。
 *
 * 说明：镜像站（如 ghproxy 系列）只是把 GitHub 内容做了反代，没有独立的
 * 版本查询接口，因此镜像只用于「可达性 + 备用打开」。
 * 真正的版本号一律从 GitHub 官方 Releases 接口读取，读不到就如实说明；
 * 不会编造版本号，也不会真的下载或安装任何东西。
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
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  return fetch(url, {
    method: 'GET',
    mode: 'no-cors',
    cache: 'no-store',
    signal: controller.signal,
  })
    .then(() => true)
    .catch(() => false)
    .finally(() => clearTimeout(timer));
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

export interface UpdateProbe {
  /** 被探测的地址（镜像是根地址） */
  url: string;
  host: string;
  via: 'repo' | 'mirror';
  ok: boolean;
}

/**
 * 把所有通道都试一遍：官方仓库 + 全部镜像并行探测，不用一个个等。
 * 返回顺序固定为「官方在前、镜像按配置顺序」，界面可以逐条显示可达状态。
 */
export async function probeUpdateSources(
  mirrors: string[],
  githubRepo?: string,
): Promise<UpdateProbe[]> {
  const targets: { url: string; via: 'repo' | 'mirror' }[] = [];
  if (githubRepo) targets.push({ url: githubRepo, via: 'repo' });
  for (const m of mirrors) if (m) targets.push({ url: m, via: 'mirror' });
  if (!targets.length) return [];
  return Promise.all(
    targets.map(async (t) => ({ ...t, host: hostOf(t.url), ok: await probeUrl(t.url) })),
  );
}

/** 镜像根地址 + 目标页面：ghproxy 系列都支持「前缀/https://github.com/...」 */
export function mirrorTarget(mirror: string, target: string): string {
  const base = mirror.endsWith('/') ? mirror : `${mirror}/`;
  return `${base}${target}`;
}

/**
 * 选出可用更新源：优先 mirrors，回退 githubRepo。
 * 只需要一个地址时用它；要在界面上列出全部通道时用 probeUpdateSources。
 */
export async function resolveUpdateSource(
  mirrors: string[],
  githubRepo?: string,
): Promise<UpdateSource> {
  const probes = await probeUpdateSources(mirrors, githubRepo);
  const hit = probes.find((p) => p.via === 'mirror' && p.ok) ?? probes.find((p) => p.ok);
  return hit ? { url: hit.url, via: hit.via } : { url: null, via: null };
}

/** 取地址的 host 用于界面展示（去掉协议头） */
export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/* ---------------------- GitHub Releases 版本查询 ---------------------- */

export interface ReleaseInfo {
  /** 原始 tag，如 v1.0.12 */
  tag: string;
  /** 去掉 v 前缀的版本号 */
  version: string;
  /** Releases 页面地址，供用户自己去看与下载 */
  htmlUrl: string;
  publishedAt: string;
  name?: string;
}

const RELEASE_TIMEOUT_MS = 6500;

/** 从仓库地址解析出 GitHub Releases API 地址；不是 GitHub 仓库时返回 null */
export function releaseApiUrl(githubRepo: string): string | null {
  const m = /github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i.exec(githubRepo ?? '');
  if (!m) return null;
  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, '').replace(/\/$/, '');
  if (!owner || !repo) return null;
  return `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
}

/** 版本号只按数字段比：v1.0.12 > 1.0.11，预发布后缀不参与排序 */
export function compareVersions(a: string, b: string): number {
  const left = (a.match(/\d+/g) ?? []).map(Number);
  const right = (b.match(/\d+/g) ?? []).map(Number);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * 只读取官方 Releases 的最新版本信息，不下载任何文件。
 * 失败（网络、限流、仓库没有 Release、被拦）一律返回 null，由界面如实说明「读不到」。
 * 参数 doFetch 只为测试注入，生产走全局 fetch。
 */
export async function fetchLatestRelease(
  githubRepo: string,
  doFetch: typeof fetch = fetch,
): Promise<ReleaseInfo | null> {
  const url = releaseApiUrl(githubRepo);
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELEASE_TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name?: unknown;
      html_url?: unknown;
      published_at?: unknown;
      name?: unknown;
    };
    const tag = typeof data.tag_name === 'string' ? data.tag_name.trim() : '';
    if (!tag) return null;
    return {
      tag,
      version: tag.replace(/^v/i, ''),
      htmlUrl:
        typeof data.html_url === 'string' && data.html_url
          ? data.html_url
          : `${githubRepo.replace(/\/$/, '')}/releases`,
      publishedAt: typeof data.published_at === 'string' ? data.published_at : '',
      name: typeof data.name === 'string' ? data.name : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
