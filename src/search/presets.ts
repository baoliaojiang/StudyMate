import type { SearchCapability, SearchProviderConfig, SearchProviderKind } from '../core/types';

/**
 * 检索服务清单与默认配置
 *
 * 默认只开「不需要 Key、条款明确允许公开调用」的三个学术接口 + 本地文件检索。
 * 需要自备 Key 的商业搜索默认关闭：用户填了 Key 再启用，避免装完就报错。
 */
export interface SearchPreset {
  kind: SearchProviderKind;
  label: string;
  baseUrl: string;
  capabilities: SearchCapability[];
  /** 是否需要自备 Key */
  needsKey: boolean;
  rateLimitPerMin: number;
  docs?: string;
  /** 免费额度 / 条款要点，一句话，界面直接显示 */
  note: string;
}

export const SEARCH_PRESETS: SearchPreset[] = [
  {
    kind: 'openalex',
    label: 'OpenAlex',
    baseUrl: 'https://api.openalex.org',
    capabilities: ['academic'],
    needsKey: false,
    rateLimitPerMin: 60,
    docs: 'https://docs.openalex.org',
    note: '公开学术元数据，无需 Key。官方建议低频调用并标识来源，适合按主题找论文。',
  },
  {
    kind: 'crossref',
    label: 'Crossref',
    baseUrl: 'https://api.crossref.org',
    capabilities: ['academic'],
    needsKey: false,
    rateLimitPerMin: 30,
    docs: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/',
    note: 'DOI 注册库，无需 Key。返回的是出版元数据，不含全文；摘要字段常为空。',
  },
  {
    kind: 'arxiv',
    label: 'arXiv',
    baseUrl: 'https://export.arxiv.org',
    capabilities: ['academic'],
    needsKey: false,
    rateLimitPerMin: 20,
    docs: 'https://info.arxiv.org/help/api/index.html',
    note: '预印本，无需 Key。官方要求每次请求间隔 3 秒，本软件按 20 次/分钟限流。',
  },
  {
    kind: 'semantic-scholar',
    label: 'Semantic Scholar',
    baseUrl: 'https://api.semanticscholar.org',
    capabilities: ['academic'],
    needsKey: false,
    rateLimitPerMin: 20,
    docs: 'https://api.semanticscholar.org/api-docs/',
    note: '不填 Key 也能用，但共用额度很容易被限流；有 Key 时额度更高。',
  },
  {
    kind: 'tavily',
    label: 'Tavily',
    baseUrl: 'https://api.tavily.com',
    capabilities: ['web', 'news', 'site', 'fulltext'],
    needsKey: true,
    rateLimitPerMin: 20,
    docs: 'https://docs.tavily.com',
    note: '为 AI 设计的搜索接口，可直接返回网页正文；需要 Key，免费额度以官网为准。',
  },
  {
    kind: 'brave',
    label: 'Brave Search',
    baseUrl: 'https://api.search.brave.com',
    capabilities: ['web', 'news', 'site'],
    needsKey: true,
    rateLimitPerMin: 20,
    docs: 'https://api.search.brave.com/app/documentation',
    note: '独立索引，需要订阅令牌；免费档有每月次数限制，以官网为准。',
  },
  {
    kind: 'serper',
    label: 'Serper',
    baseUrl: 'https://google.serper.dev',
    capabilities: ['web', 'news'],
    needsKey: true,
    rateLimitPerMin: 20,
    docs: 'https://serper.dev',
    note: 'Google 结果的中转接口，需要 Key；免费额度较小，以官网为准。',
  },
  {
    kind: 'bocha',
    label: '博查 Bocha',
    baseUrl: 'https://api.bochaai.com',
    capabilities: ['web', 'news'],
    needsKey: true,
    rateLimitPerMin: 20,
    docs: 'https://open.bochaai.com',
    note: '国内可直连的网页搜索接口，需要 Key；中文结果覆盖较好。',
  },
  {
    kind: 'searxng',
    label: 'SearXNG（自建）',
    baseUrl: '',
    capabilities: ['web', 'news', 'site'],
    needsKey: false,
    rateLimitPerMin: 20,
    docs: 'https://docs.searxng.org/dev/search_api.html',
    note: '自建元搜索，无 Key，但必须由你部署并开启 format=json；公共实例大多已禁用 JSON。',
  },
  {
    kind: 'generic-web',
    label: '自定义搜索接口',
    baseUrl: '',
    capabilities: ['web'],
    needsKey: false,
    rateLimitPerMin: 20,
    note: '接口需接受 POST {query, limit} 并返回 {results:[{title,url,snippet}]}；用于接入自建服务。',
  },
  {
    kind: 'local-files',
    label: '本地文件检索',
    baseUrl: '',
    capabilities: ['local'],
    needsKey: false,
    rateLimitPerMin: 0,
    note: '只检索你导入到本机的 txt / md 文本，不联网、不上传。',
  },
];

export function presetOf(kind: SearchProviderKind): SearchPreset | undefined {
  return SEARCH_PRESETS.find((p) => p.kind === kind);
}

/** 首次启动的默认检索配置：只开免费公开接口与本地检索 */
export const DEFAULT_SEARCH_PROVIDERS: SearchProviderConfig[] = SEARCH_PRESETS.map((p, i) => ({
  id: p.kind,
  label: p.label,
  kind: p.kind,
  baseUrl: p.baseUrl || undefined,
  enabled: ['openalex', 'crossref', 'arxiv', 'local-files'].includes(p.kind),
  priority: (i + 1) * 10,
  capabilities: [...p.capabilities],
  rateLimitPerMin: p.rateLimitPerMin,
  needsKey: p.needsKey,
  docs: p.docs,
}));

export const CAPABILITY_LABEL: Record<SearchCapability, string> = {
  web: '通用网页',
  academic: '学术元数据',
  news: '近期新闻',
  site: '指定域名',
  fulltext: '网页正文',
  local: '本地文件',
};

export const MODE_TO_CAPABILITY = {
  web: 'web',
  academic: 'academic',
  news: 'news',
  local: 'local',
} as const;

export type SearchMode = keyof typeof MODE_TO_CAPABILITY;

export const SEARCH_MODE_LABEL: Record<SearchMode, string> = {
  web: '网页',
  academic: '学术',
  news: '新闻',
  local: '本地文件',
};
