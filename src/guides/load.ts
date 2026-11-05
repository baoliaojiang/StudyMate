import { BUILTIN_SERVICES, CATEGORY_LABEL, type ServiceCategory, type ServiceEntry } from './catalog';

/**
 * 服务目录加载
 *
 * 顺序：远端 JSON → 本机缓存 → 内置数据。
 * 远端地址可以指向 GitHub raw；文件里只需要写「要覆盖或新增」的条目，
 * 其余条目继续用内置版本，维护时不必整份复制。
 */

const CACHE_KEY = 'sm.service-catalog.v1';
const VALID_CATEGORIES = Object.keys(CATEGORY_LABEL) as ServiceCategory[];

export interface CatalogLoad {
  items: ServiceEntry[];
  source: 'remote' | 'cache' | 'builtin';
  /** 远端文件里的更新日期，或缓存写入时间 */
  updatedAt: string;
  /** 远端失败原因，成功时为空 */
  error?: string;
}

function isEntry(x: unknown): x is ServiceEntry {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.name === 'string' &&
    VALID_CATEGORIES.includes(e.category as ServiceCategory) &&
    typeof e.site === 'string' &&
    typeof e.freeQuota === 'string' &&
    typeof e.keyGuide === 'string' &&
    Array.isArray(e.steps) &&
    Array.isArray(e.limits) &&
    typeof e.verifiedAt === 'string'
  );
}

/** 远端条目覆盖同 id 的内置条目，新 id 追加在后面 */
export function mergeCatalog(remote: ServiceEntry[]): ServiceEntry[] {
  const byId = new Map<string, ServiceEntry>();
  for (const e of BUILTIN_SERVICES) byId.set(e.id, e);
  for (const e of remote) byId.set(e.id, { ...byId.get(e.id), ...e });
  return Array.from(byId.values());
}

/** 从 Markdown 里取出第一个 ```json 代码块，方便用 Markdown 维护 */
export function extractJson(text: string): string {
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

export function parseCatalog(raw: string): { items: ServiceEntry[]; updatedAt: string } {
  const data = JSON.parse(extractJson(raw));
  const list: unknown[] = Array.isArray(data) ? data : (data?.items ?? []);
  const items = list.filter(isEntry);
  // 允许空 items：表示「本次不改任何条目」，继续使用内置数据
  if (list.length && !items.length) throw new Error('目录条目缺少必填字段（id / name / category / site / steps / limits 等）');
  return {
    items,
    updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : new Date().toISOString().slice(0, 10),
  };
}

function readCache(): CatalogLoad | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { items: ServiceEntry[]; savedAt: string };
    const items = (parsed.items ?? []).filter(isEntry);
    if (!items.length) return null;
    return { items: mergeCatalog(items), source: 'cache', updatedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

function writeCache(items: ServiceEntry[], updatedAt: string) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ items, savedAt: updatedAt, at: Date.now() }));
  } catch {
    /* 存储满或被禁用时忽略：下次仍然可以走远端或内置 */
  }
}

export function builtinCatalog(): CatalogLoad {
  return {
    items: BUILTIN_SERVICES,
    source: 'builtin',
    updatedAt: BUILTIN_SERVICES.reduce((m, e) => (e.verifiedAt > m ? e.verifiedAt : m), ''),
  };
}

/**
 * 加载目录
 *
 * @param url 远端地址；为空时直接用缓存或内置，不发请求
 */
export async function loadCatalog(url: string): Promise<CatalogLoad> {
  const cached = readCache();
  if (!url.trim()) {
    return cached ?? builtinCatalog();
  }

  try {
    const res = await fetch(url.trim(), { headers: { Accept: 'application/json, text/markdown, text/plain' } });
    if (!res.ok) throw new Error(`远端返回 HTTP ${res.status}`);
    const text = await res.text();
    const { items, updatedAt } = parseCatalog(text);
    writeCache(items, updatedAt);
    return { items: mergeCatalog(items), source: 'remote', updatedAt };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      ...(cached ?? builtinCatalog()),
      error: `远端目录加载失败：${reason}。已改用${cached ? '本机缓存' : '内置数据'}。`,
    };
  }
}

export function clearCatalogCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}
