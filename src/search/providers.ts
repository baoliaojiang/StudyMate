/**
 * 检索服务适配层
 *
 * 只调用各服务公开文档中说明的接口，遵守速率限制；不抓取需要登录的页面、不绕过反爬。
 * 检索结果 ≠ 事实证明：所有结果落到来源表时默认「待核实」。
 */
import type { SearchCapability, SearchProviderConfig, Source, SourceType } from '../core/types';
import type { SearchMode } from './presets';
import { fetchJson, joinUrl } from '../ai/http';
import { scrubSecrets } from '../core/crypto';
import { uid } from '../core/id';
import { searchLocalFiles } from './local';

export interface SearchHit {
  title: string;
  authors: string;
  /** 机构 / 出版方 / 站点名 */
  institution: string;
  date: string;
  url: string;
  doi: string;
  abstract: string;
  /** 抓到的网页正文（仅在启用正文抓取且成功时） */
  fullText?: string;
  provider: string;
  providerKind: string;
  /** 落库时区分文献 / 网页 / 用户提供 */
  sourceType: SourceType;
  /** 检索关键词，便于回溯 */
  query: string;
  /** 命中的能力，界面用来标「学术 / 新闻」 */
  via: SearchCapability[];
}

export interface SearchOutcome {
  hits: SearchHit[];
  provider: string;
  /** 面向用户的说明（含"未检索到"/限流等情况） */
  message: string;
  error?: string;
}

export interface SearchRequest {
  query: string;
  mode: SearchMode;
  /** 限定域名，如 gov.cn */
  site?: string;
  /** 是否抓取网页正文 */
  fulltext?: boolean;
  limit?: number;
  signal?: AbortSignal;
}

const lastCallAt = new Map<string, number>();

async function throttle(id: string, perMin = 30): Promise<void> {
  if (perMin <= 0) return;
  const gap = 60_000 / Math.max(1, perMin);
  const last = lastCallAt.get(id) ?? 0;
  const wait = last + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 2500)));
  lastCallAt.set(id, Date.now());
}

function redact(text: string, key?: string): string {
  return scrubSecrets(String(text ?? ''), key ? [key] : []);
}

function stripTags(s: string): string {
  return String(s ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

type HitSeed = Partial<SearchHit> & { title: string; provider: string; providerKind: string };

function makeHit(p: HitSeed, req: SearchRequest): SearchHit {
  return {
    title: p.title || '（无标题）',
    authors: p.authors ?? '',
    institution: p.institution ?? '',
    date: p.date ?? '',
    url: p.url ?? '',
    doi: String(p.doi ?? '').replace(/^https?:\/\/doi\.org\//i, ''),
    abstract: p.abstract ?? '',
    fullText: p.fullText,
    provider: p.provider,
    providerKind: p.providerKind,
    sourceType: p.sourceType ?? (req.mode === 'academic' ? 'literature' : 'web'),
    query: req.query,
    via: [req.mode],
  };
}

/* ------------------------------------------------------------------ */
/* 学术元数据                                                           */
/* ------------------------------------------------------------------ */

function invertAbstract(idx: Record<string, number[]>): string {
  const arr: string[] = [];
  for (const [word, positions] of Object.entries(idx ?? {})) {
    for (const p of positions) arr[p] = word;
  }
  return arr.filter(Boolean).join(' ');
}

export async function searchOpenAlex(query: string, limit = 10): Promise<SearchHit[]> {
  const url =
    joinUrl('https://api.openalex.org', '/works') +
    `?search=${encodeURIComponent(query)}&per-page=${limit}&sort=relevance_score:desc`;
  const res = await fetchJson<any>(url, { timeoutMs: 20000, maxRetries: 1 });
  const items: any[] = res.data?.results ?? [];
  return items.map((w) =>
    makeHit(
      {
        title: w?.title ?? w?.display_name ?? '（无标题）',
        authors: (w?.authorships ?? [])
          .slice(0, 6)
          .map((a: any) => a?.author?.display_name)
          .filter(Boolean)
          .join('、'),
        institution: (w?.authorships ?? [])
          .map((a: any) => a?.institutions?.[0]?.display_name)
          .filter(Boolean)
          .slice(0, 3)
          .join('、'),
        date: w?.publication_date ?? String(w?.publication_year ?? ''),
        url: w?.doi ?? w?.id ?? '',
        doi: String(w?.doi ?? ''),
        abstract: w?.abstract_inverted_index ? invertAbstract(w.abstract_inverted_index).slice(0, 600) : '',
        provider: 'OpenAlex',
        providerKind: 'openalex',
        sourceType: 'literature',
      },
      { query, mode: 'academic' },
    ),
  );
}

export async function searchCrossref(query: string, limit = 10): Promise<SearchHit[]> {
  const url =
    joinUrl('https://api.crossref.org', '/works') +
    `?query=${encodeURIComponent(query)}&rows=${limit}` +
    '&select=title,author,issued,DOI,URL,abstract,publisher,container-title';
  const res = await fetchJson<any>(url, { timeoutMs: 20000, maxRetries: 1 });
  const items: any[] = res.data?.message?.items ?? [];
  return items.map((w) =>
    makeHit(
      {
        title: Array.isArray(w?.title) ? w.title[0] : (w?.title ?? '（无标题）'),
        authors: (w?.author ?? [])
          .slice(0, 6)
          .map((a: any) => [a?.given, a?.family].filter(Boolean).join(' '))
          .filter(Boolean)
          .join('、'),
        institution:
          (w?.author ?? [])
            .map((a: any) => a?.affiliation?.[0]?.name)
            .filter(Boolean)
            .slice(0, 3)
            .join('、') || (w?.publisher ?? ''),
        date: w?.issued?.['date-parts']?.[0]?.join('-') ?? '',
        url: w?.URL ?? '',
        doi: w?.DOI ?? '',
        abstract: stripTags(String(w?.abstract ?? '')).slice(0, 600),
        provider: 'Crossref',
        providerKind: 'crossref',
        sourceType: 'literature',
      },
      { query, mode: 'academic' },
    ),
  );
}

/** arXiv 只提供 Atom XML，这里用正则取字段（浏览器与 Node 都能跑，不依赖 DOMParser） */
export async function searchArxiv(query: string, limit = 10, signal?: AbortSignal): Promise<SearchHit[]> {
  const url =
    joinUrl('https://export.arxiv.org', '/api/query') +
    `?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/atom+xml' } });
  if (!res.ok) throw new Error(`arXiv 返回 ${res.status}`);
  const xml = await res.text();
  const entries = xml.split(/<entry[\s>]/).slice(1);
  return entries.map((raw) => {
    const pick = (tag: string) => {
      const m = raw.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      return m ? stripTags(m[1]) : '';
    };
    const authors = [...raw.matchAll(/<name>([\s\S]*?)<\/name>/gi)]
      .map((m) => stripTags(m[1]))
      .filter(Boolean)
      .join('、');
    return makeHit(
      {
        title: pick('title'),
        authors,
        date: pick('published').slice(0, 10),
        url: pick('id'),
        doi: pick('arxiv:doi'),
        abstract: pick('summary').slice(0, 600),
        provider: 'arXiv',
        providerKind: 'arxiv',
        sourceType: 'literature',
      },
      { query, mode: 'academic' },
    );
  });
}

export async function searchSemanticScholar(
  query: string,
  limit = 10,
  apiKey?: string,
): Promise<SearchHit[]> {
  const url =
    joinUrl('https://api.semanticscholar.org', '/graph/v1/paper/search') +
    `?query=${encodeURIComponent(query)}&limit=${limit}` +
    '&fields=title,authors,year,abstract,url,externalIds,venue';
  const res = await fetchJson<any>(url, {
    timeoutMs: 20000,
    maxRetries: 1,
    secrets: apiKey ? [apiKey] : [],
    headers: apiKey ? { 'x-api-key': apiKey } : {},
  });
  const items: any[] = res.data?.data ?? [];
  return items.map((w) =>
    makeHit(
      {
        title: w?.title ?? '（无标题）',
        authors: (w?.authors ?? []).map((a: any) => a?.name).filter(Boolean).slice(0, 6).join('、'),
        institution: w?.venue ?? '',
        date: String(w?.year ?? ''),
        url: w?.url ?? (w?.externalIds?.DOI ? `https://doi.org/${w.externalIds.DOI}` : ''),
        doi: w?.externalIds?.DOI ?? '',
        abstract: String(w?.abstract ?? '').slice(0, 600),
        provider: 'Semantic Scholar',
        providerKind: 'semantic-scholar',
        sourceType: 'literature',
      },
      { query, mode: 'academic' },
    ),
  );
}

/* ------------------------------------------------------------------ */
/* 商业搜索（需用户自己的 Key）                                          */
/* ------------------------------------------------------------------ */

function siteSuffix(req: SearchRequest): string {
  return req.site ? ` site:${req.site}` : '';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

async function searchTavily(cfg: SearchProviderConfig, key: string, req: SearchRequest, limit: number) {
  const res = await fetchJson<any>(joinUrl(cfg.baseUrl || 'https://api.tavily.com', '/search'), {
    timeoutMs: 25000,
    maxRetries: 0,
    secrets: [key],
    signal: req.signal,
    headers: { Authorization: `Bearer ${key}` },
    body: {
      api_key: key,
      query: req.query + siteSuffix(req),
      max_results: limit,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: Boolean(req.fulltext),
      topic: req.mode === 'news' ? 'news' : 'general',
    },
  });
  const items: any[] = res.data?.results ?? [];
  return items.map((r) =>
    makeHit(
      {
        title: r?.title ?? '（无标题）',
        institution: hostOf(r?.url ?? ''),
        date: r?.published_date ?? '',
        url: r?.url ?? '',
        abstract: String(r?.content ?? r?.snippet ?? '').slice(0, 600),
        fullText: req.fulltext ? String(r?.raw_content ?? '').slice(0, 8000) : undefined,
        provider: cfg.label,
        providerKind: cfg.kind,
        sourceType: 'web',
      },
      req,
    ),
  );
}

async function searchBrave(cfg: SearchProviderConfig, key: string, req: SearchRequest, limit: number) {
  const path = req.mode === 'news' ? '/res/v1/news/search' : '/res/v1/web/search';
  const params = new URLSearchParams({ q: req.query + siteSuffix(req), count: String(limit) });
  if (req.mode === 'news') params.set('freshness', 'pd');
  const res = await fetchJson<any>(
    joinUrl(cfg.baseUrl || 'https://api.search.brave.com', path) + `?${params}`,
    {
      timeoutMs: 20000,
      maxRetries: 0,
      secrets: [key],
      signal: req.signal,
      headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    },
  );
  const items: any[] = res.data?.web?.results ?? res.data?.results ?? [];
  return items.map((r) =>
    makeHit(
      {
        title: r?.title ?? '（无标题）',
        institution: r?.profile?.name ?? hostOf(r?.url ?? ''),
        date: r?.age ?? r?.page_age ?? '',
        url: r?.url ?? '',
        abstract: stripTags(String(r?.description ?? '')).slice(0, 600),
        provider: cfg.label,
        providerKind: cfg.kind,
        sourceType: 'web',
      },
      req,
    ),
  );
}

async function searchSerper(cfg: SearchProviderConfig, key: string, req: SearchRequest, limit: number) {
  const path = req.mode === 'news' ? '/news' : '/search';
  const res = await fetchJson<any>(joinUrl(cfg.baseUrl || 'https://google.serper.dev', path), {
    timeoutMs: 20000,
    maxRetries: 0,
    secrets: [key],
    signal: req.signal,
    headers: { 'X-API-KEY': key },
    body: { q: req.query + siteSuffix(req), num: limit },
  });
  const items: any[] = res.data?.organic ?? res.data?.news ?? [];
  return items.map((r) =>
    makeHit(
      {
        title: r?.title ?? '（无标题）',
        institution: r?.source ?? hostOf(r?.link ?? ''),
        date: r?.date ?? '',
        url: r?.link ?? '',
        abstract: stripTags(String(r?.snippet ?? '')).slice(0, 600),
        provider: cfg.label,
        providerKind: cfg.kind,
        sourceType: 'web',
      },
      req,
    ),
  );
}

async function searchBocha(cfg: SearchProviderConfig, key: string, req: SearchRequest, limit: number) {
  const res = await fetchJson<any>(joinUrl(cfg.baseUrl || 'https://api.bochaai.com', '/v1/web-search'), {
    timeoutMs: 20000,
    maxRetries: 0,
    secrets: [key],
    signal: req.signal,
    headers: { Authorization: `Bearer ${key}` },
    body: {
      query: req.query + siteSuffix(req),
      count: limit,
      summary: true,
      ...(req.mode === 'news' ? { freshness: 'oneDay' } : {}),
    },
  });
  const items: any[] = res.data?.data?.webPages?.value ?? res.data?.webPages?.value ?? [];
  return items.map((r) =>
    makeHit(
      {
        title: r?.name ?? '（无标题）',
        institution: r?.siteName ?? hostOf(r?.url ?? ''),
        date: r?.datePublished ?? r?.dateLastCrawled ?? '',
        url: r?.url ?? '',
        abstract: stripTags(String(r?.summary ?? r?.snippet ?? '')).slice(0, 600),
        provider: cfg.label,
        providerKind: cfg.kind,
        sourceType: 'web',
      },
      req,
    ),
  );
}

async function searchSearxng(cfg: SearchProviderConfig, req: SearchRequest, limit: number) {
  if (!cfg.baseUrl) throw new Error('尚未填写 SearXNG 地址');
  const params = new URLSearchParams({
    q: req.query + siteSuffix(req),
    format: 'json',
    categories: req.mode === 'news' ? 'news' : 'general',
  });
  const res = await fetchJson<any>(joinUrl(cfg.baseUrl, '/search') + `?${params}`, {
    timeoutMs: 20000,
    maxRetries: 0,
    signal: req.signal,
    headers: { Accept: 'application/json' },
  });
  const items: any[] = res.data?.results ?? [];
  return items.slice(0, limit).map((r) =>
    makeHit(
      {
        title: r?.title ?? '（无标题）',
        institution: hostOf(r?.url ?? ''),
        date: r?.publishedDate ?? '',
        url: r?.url ?? '',
        abstract: stripTags(String(r?.content ?? '')).slice(0, 600),
        provider: cfg.label,
        providerKind: cfg.kind,
        sourceType: 'web',
      },
      req,
    ),
  );
}

async function searchGeneric(cfg: SearchProviderConfig, key: string, req: SearchRequest, limit: number) {
  if (!cfg.baseUrl) throw new Error('尚未填写搜索接口地址');
  const res = await fetchJson<any>(cfg.baseUrl, {
    timeoutMs: 20000,
    maxRetries: 0,
    secrets: key ? [key] : [],
    signal: req.signal,
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    body: { query: req.query, limit, mode: req.mode, site: req.site },
  });
  const items: any[] = res.data?.results ?? res.data?.data ?? [];
  return items.slice(0, limit).map((r) =>
    makeHit(
      {
        title: r?.title ?? '（无标题）',
        authors: r?.author ?? '',
        institution: r?.source ?? hostOf(r?.url ?? r?.link ?? ''),
        date: r?.published_date ?? r?.date ?? '',
        url: r?.url ?? r?.link ?? '',
        doi: r?.doi ?? '',
        abstract: stripTags(String(r?.content ?? r?.snippet ?? r?.description ?? '')).slice(0, 600),
        provider: cfg.label,
        providerKind: cfg.kind,
        sourceType: 'web',
      },
      req,
    ),
  );
}

/* ------------------------------------------------------------------ */
/* 正文抓取                                                             */
/* ------------------------------------------------------------------ */

/**
 * 抓网页正文
 *
 * 浏览器里受 CORS 限制，多数站点会直接失败。失败就如实说失败，
 * 不用摘要冒充正文，也不绕过跨域。
 */
export async function fetchPageText(url: string, signal?: AbortSignal): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('地址需以 http:// 或 https:// 开头');
  const res = await fetch(url, { signal, headers: { Accept: 'text/html,application/xhtml+xml' } });
  if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
    throw new Error(`该地址不是网页（${type || '未知类型'}）`);
  }
  const html = await res.text();
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const text = stripTags(body);
  if (text.length < 40) throw new Error('正文太短，可能是脚本渲染的页面');
  return text.slice(0, 12000);
}

/* ------------------------------------------------------------------ */
/* 组合检索                                                             */
/* ------------------------------------------------------------------ */

const MODE_CAP: Record<SearchMode, SearchCapability> = {
  web: 'web',
  academic: 'academic',
  news: 'news',
  local: 'local',
};

function supports(cfg: SearchProviderConfig, mode: SearchMode): boolean {
  return (cfg.capabilities ?? []).includes(MODE_CAP[mode]);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

/** 去重：DOI 优先，其次 URL，再退到标题相似 */
export function dedupe(hits: SearchHit[]): SearchHit[] {
  const seenDoi = new Set<string>();
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    const doi = h.doi.trim().toLowerCase();
    const url = h.url.trim().replace(/\/+$/, '').toLowerCase();
    const title = norm(h.title).slice(0, 80);
    if (doi && seenDoi.has(doi)) continue;
    if (url && seenUrl.has(url)) continue;
    if (title && seenTitle.has(title)) continue;
    if (doi) seenDoi.add(doi);
    if (url) seenUrl.add(url);
    if (title) seenTitle.add(title);
    out.push(h);
  }
  return out;
}

/** 按优先级轮转合并，避免排在前面的服务把名额占满 */
export function interleave(lists: SearchHit[][], limit: number): SearchHit[] {
  const out: SearchHit[] = [];
  let i = 0;
  while (out.length < limit) {
    let added = false;
    for (const list of lists) {
      if (i < list.length) {
        out.push(list[i]);
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
    i += 1;
  }
  return out;
}

export interface CombinedSearch {
  hits: SearchHit[];
  outcomes: SearchOutcome[];
  /** 参与本次检索的服务名，按优先级 */
  used: string[];
}

/**
 * 组合检索
 *
 * 选服务 → 按优先级排序 → 并发执行（每个服务内部限流）→ 轮转合并 → 去重。
 * 某个服务失败不影响其它服务，失败原因逐条返回。
 */
export async function runCombinedSearch(
  providers: SearchProviderConfig[],
  req: SearchRequest,
): Promise<CombinedSearch> {
  const limit = Math.min(30, Math.max(1, req.limit ?? 8));
  const usable = providers
    .filter((p) => p.enabled && supports(p, req.mode))
    .sort((a, b) => a.priority - b.priority);

  if (!usable.length) {
    return {
      hits: [],
      used: [],
      outcomes: [
        {
          hits: [],
          provider: 'none',
          message: `没有启用支持「${req.mode}」的检索服务，请到「设置 → 检索服务」开启。`,
        },
      ],
    };
  }

  const results = await Promise.all(
    usable.map(async (cfg): Promise<SearchOutcome> => {
      const key = cfg.apiKey ?? '';
      try {
        if (cfg.needsKey && !key) {
          return { hits: [], provider: cfg.label, message: '未配置密钥，已跳过。填写后即可启用。' };
        }
        await throttle(cfg.id, cfg.rateLimitPerMin ?? 20);

        let hits: SearchHit[] = [];
        switch (cfg.kind) {
          case 'openalex':
            hits = await searchOpenAlex(req.query, limit);
            break;
          case 'crossref':
            hits = await searchCrossref(req.query, limit);
            break;
          case 'arxiv':
            hits = await searchArxiv(req.query, limit, req.signal);
            break;
          case 'semantic-scholar':
            hits = await searchSemanticScholar(req.query, limit, key || undefined);
            break;
          case 'tavily':
            hits = await searchTavily(cfg, key, req, limit);
            break;
          case 'brave':
            hits = await searchBrave(cfg, key, req, limit);
            break;
          case 'serper':
            hits = await searchSerper(cfg, key, req, limit);
            break;
          case 'bocha':
            hits = await searchBocha(cfg, key, req, limit);
            break;
          case 'searxng':
            hits = await searchSearxng(cfg, req, limit);
            break;
          case 'generic-web':
            hits = await searchGeneric(cfg, key, req, limit);
            break;
          case 'local-files': {
            const matches = await searchLocalFiles(req.query, limit);
            hits = matches.map((m) =>
              makeHit(
                {
                  title: m.name,
                  abstract: m.snippet,
                  fullText: m.snippet,
                  provider: cfg.label,
                  providerKind: cfg.kind,
                  sourceType: 'provided',
                },
                req,
              ),
            );
            break;
          }
          default:
            throw new Error('未知的检索服务类型');
        }

        // 限定域名：服务本身不支持时，在客户端按 URL 主机名过滤
        if (req.site) {
          const site = req.site.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
          hits = hits.filter((h) => {
            if (!h.url) return true; // 学术记录常只有 DOI，不强过滤
            return hostOf(h.url).toLowerCase().endsWith(site) || h.url.toLowerCase().includes(site);
          });
        }

        // 正文抓取：服务没有返回全文时自己抓，失败只保留摘要
        if (req.fulltext && req.mode !== 'local') {
          const targets = hits.filter((h) => !h.fullText && h.url).slice(0, 3);
          await Promise.all(
            targets.map(async (h) => {
              try {
                h.fullText = await fetchPageText(h.url, req.signal);
              } catch {
                /* 单条失败不打扰用户：摘要仍然可用 */
              }
            }),
          );
        }

        return {
          hits,
          provider: cfg.label,
          message: hits.length
            ? `返回 ${hits.length} 条。检索结果不等于事实，引用前请打开原文核对。`
            : '未检索到相关结果。可更换关键词，或改用其他检索服务。',
        };
      } catch (e) {
        return {
          hits: [],
          provider: cfg.label,
          message: '检索失败：可能是网络限制、CORS、服务限流或密钥无效。',
          error: redact(e instanceof Error ? e.message : String(e), key),
        };
      }
    }),
  );

  const hits = dedupe(interleave(results.map((r) => r.hits), limit));
  return { hits, outcomes: results, used: usable.map((p) => p.label) };
}

/** 兼容旧调用 */
/** 按「用户实际启用的能力」挑一个模式：只开了网页搜索的人不该被学术模式筛掉 */
function pickMode(providers: SearchProviderConfig[]): SearchMode {
  const on = providers.filter((p) => p.enabled);
  const order: SearchMode[] = ['academic', 'web', 'news', 'local'];
  for (const m of order) {
    if (on.some((p) => supports(p, m))) return m;
  }
  return 'academic';
}

export async function runSearch(
  providers: SearchProviderConfig[],
  query: string,
  limit = 8,
): Promise<SearchOutcome[]> {
  const res = await runCombinedSearch(providers, { query, mode: pickMode(providers), limit });
  return res.outcomes;
}

/** 单个服务的连通性测试：跑一次最小查询 */
export async function testSearchProvider(
  cfg: SearchProviderConfig,
  key: string,
): Promise<{ ok: boolean; message: string; count: number; latencyMs: number }> {
  const started = performance.now();
  const mode: SearchMode = supports(cfg, 'academic')
    ? 'academic'
    : supports(cfg, 'web')
      ? 'web'
      : supports(cfg, 'local')
        ? 'local'
        : 'news';
  try {
    const res = await runCombinedSearch([{ ...cfg, apiKey: key, enabled: true }], {
      query: mode === 'local' ? '研究' : 'research',
      mode,
      limit: 3,
    });
    const outcome = res.outcomes[0];
    const latency = Math.round(performance.now() - started);
    if (outcome?.error) {
      return { ok: false, message: redact(outcome.error, key), count: 0, latencyMs: latency };
    }
    const count = res.hits.length;
    return {
      ok: true,
      message: count
        ? `连通，返回 ${count} 条示例结果。`
        : '接口可访问，但示例查询没有结果（可能该服务对空结果也返回 200）。',
      count,
      latencyMs: latency,
    };
  } catch (e) {
    return {
      ok: false,
      message: redact(e instanceof Error ? e.message : String(e), key),
      count: 0,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

/** 检索结果 -> 来源（默认待核实，绝不自动标为已核验） */
export function hitToSource(projectId: string, h: SearchHit): Source {
  return {
    id: uid('src'),
    projectId,
    title: h.title,
    authors: h.authors,
    institution: h.institution,
    date: h.date,
    url: h.url,
    doi: h.doi,
    retrievedAt: Date.now(),
    abstract: h.abstract,
    fullText: h.fullText,
    sourceType: h.sourceType,
    verifyStatus: 'unverified',
    provider: h.provider,
    query: h.query,
    linkedSections: [],
  };
}
