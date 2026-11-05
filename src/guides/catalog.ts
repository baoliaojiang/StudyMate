/**
 * 免费 / 低价 API 指引数据
 *
 * 写作原则：
 * - 只写官方文档能查到的东西；额度、价格这类会变的信息一律加「以官网为准」
 * - 不确定的一律写「未知」，不猜
 * - 绝不承诺「永久免费」
 *
 * 这份数据可以被远端 JSON 覆盖（设置 → 免费 API 指引 → 从远端更新），
 * 远端失败时依次退回本地缓存、再退回这里的内置版本。
 */

export type ServiceCategory = 'ai-models' | 'search' | 'academic' | 'local' | 'doc-tools';

export const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  'ai-models': 'AI 模型',
  search: '网页搜索',
  academic: '学术检索',
  local: '本地模型',
  'doc-tools': '文档工具',
};

export interface ServiceEntry {
  id: string;
  name: string;
  category: ServiceCategory;
  /** 官网 */
  site: string;
  /** 注册 / 控制台入口 */
  signup?: string;
  /** 官方文档 */
  docs?: string;
  /** 免费额度说明（不含具体数字时写「以官网为准」） */
  freeQuota: string;
  /** 是否需要信用卡：unknown 表示未确认 */
  creditCard: 'no' | 'yes' | 'unknown';
  /** 怎么拿 Key */
  keyGuide: string;
  /** OpenAI 兼容地址；没有则留空 */
  baseUrl?: string;
  /** 模型名示例 */
  models?: string[];
  /** 在本软件里的配置步骤 */
  steps: string[];
  /** 限制与注意事项 */
  limits: string[];
  /** 最后一次人工核对日期（ISO） */
  verifiedAt: string;
  /** 一键复制的配置示例 */
  configSnippet?: string;
  /** 是否 Beta */
  beta?: boolean;
  /** 推荐：列表排在最前并打「推荐」标记 */
  recommended?: boolean;
}

const V = '2026-11-03';

export const BUILTIN_SERVICES: ServiceEntry[] = [
  /* ----------------------------- AI 模型 ----------------------------- */
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'ai-models',
    site: 'https://www.deepseek.com',
    signup: 'https://platform.deepseek.com',
    docs: 'https://api-docs.deepseek.com',
    freeQuota: '按量计费为主；新用户是否有赠送额度以官网活动页为准，本软件不承诺存在免费额度。',
    creditCard: 'unknown',
    keyGuide: '登录开放平台 → API keys → 创建，复制 sk- 开头的字符串；只显示一次。',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    steps: [
      '在 API 管理中心点「+ 添加」，选 DeepSeek 预设。',
      '粘贴 Key，保存。',
      '点「同步模型」，或手动填入 deepseek-chat。',
      '点「连接测试」，地址、鉴权、指定模型生成三段都会跑一次。',
    ],
    limits: [
      '同一账号有并发与速率限制，具体数值以平台文档为准。',
      '推理模型返回较慢，单次超时可调到 120 秒。',
    ],
    verifiedAt: V,
    configSnippet: JSON.stringify(
      { kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      null,
      2,
    ),
  },
  {
    id: 'agnes',
    name: 'Agnes AI',
    category: 'ai-models',
    // 国内可直接注册、送免费额度、OpenAI 兼容好接，放在第一位推荐
    recommended: true,
    site: 'https://agnes-ai.cn',
    signup: 'https://platform.agnes-ai.cn',
    docs: 'https://platform.agnes-ai.cn',
    freeQuota: '推广期文本模型免费（agnes-3.0-flash / agnes-2.5-flash），无需绑卡；免费额度与政策会变动，以官网公告为准，本软件不承诺永久免费。',
    creditCard: 'no',
    keyGuide: '国内站 platform.agnes-ai.cn 登录 → API Key 页面 → 新建密钥，复制 sk- 开头字符串（只显示一次）。',
    baseUrl: 'https://apihub.agnes-ai.cn/v1',
    models: ['agnes-3.0-flash', 'agnes-2.5-flash'],
    steps: [
      '在 API 管理中心点「+ 添加」，选 Agnes 预设。',
      '粘贴 Key，保存；点「同步模型」或手动填入 agnes-3.0-flash。',
      '点「连接测试」：推理模型在短输出额度下可能只返回思考过程，属正常，调大 max_tokens 即可出文。',
    ],
    limits: [
      '免费用户限速约每分钟 20 次，高峰期更慢，批量生成需做好限速与重试。',
      '国际站（.com）与国内站（.cn）账号 / Key 不互通，国内用户用国内站最稳。',
      '模型支持 Thinking，长任务建议调大 max_tokens。',
    ],
    verifiedAt: V,
    configSnippet: JSON.stringify(
      { kind: 'openai-compatible', baseUrl: 'https://apihub.agnes-ai.cn/v1', model: 'agnes-3.0-flash' },
      null,
      2,
    ),
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    category: 'ai-models',
    site: 'https://www.moonshot.cn',
    signup: 'https://platform.moonshot.cn',
    docs: 'https://platform.moonshot.cn/docs',
    freeQuota: '以官网控制台显示的赠送额度为准；用完后需充值。',
    creditCard: 'unknown',
    keyGuide: '开放平台 → 用户中心 → API Key 管理 → 新建。',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-latest'],
    steps: ['选 Kimi 预设 → 粘贴 Key → 同步模型 → 连接测试。'],
    limits: ['长上下文模型按 token 计费更高，报告生成建议用 8k 档。', '编码套餐走 Anthropic 兼容地址，不是 /v1。'],
    verifiedAt: V,
    configSnippet: JSON.stringify(
      { kind: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
      null,
      2,
    ),
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    category: 'ai-models',
    site: 'https://open.bigmodel.cn',
    signup: 'https://open.bigmodel.cn/usercenter/apikeys',
    docs: 'https://open.bigmodel.cn/dev/api',
    freeQuota: '有面向新用户的体验额度，具体以控制台为准；不承诺长期免费。',
    creditCard: 'no',
    keyGuide: '控制台 → API Keys → 新建，得到「id.secret」形式的 Key。',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-flash', 'glm-4-plus'],
    steps: ['选 Zhipu 预设 → 粘贴 Key → 手动填模型名（该地址不提供 /models）→ 连接测试。'],
    limits: ['v4 接口不返回模型列表，必须手动录入模型名。', '免费模型有并发限制。'],
    verifiedAt: V,
    configSnippet: JSON.stringify(
      { kind: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
      null,
      2,
    ),
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    category: 'ai-models',
    site: 'https://siliconflow.cn',
    signup: 'https://cloud.siliconflow.cn',
    docs: 'https://docs.siliconflow.cn',
    freeQuota: '提供部分免费模型与赠送额度，具体模型与额度以控制台为准。',
    creditCard: 'no',
    keyGuide: '控制台 → API 密钥 → 新建 API 密钥。',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3'],
    steps: ['选 SiliconFlow 预设 → 粘贴 Key → 同步模型 → 连接测试。'],
    limits: ['模型名带组织前缀，必须与服务商列表完全一致。', '免费模型可能排队。'],
    verifiedAt: V,
    configSnippet: JSON.stringify(
      {
        kind: 'openai-compatible',
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'Qwen/Qwen2.5-7B-Instruct',
      },
      null,
      2,
    ),
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'ai-models',
    site: 'https://openrouter.ai',
    signup: 'https://openrouter.ai/keys',
    docs: 'https://openrouter.ai/docs',
    freeQuota: '有标注 :free 的模型可免费调用，额度与可用性随平台调整，以官网为准。',
    creditCard: 'unknown',
    keyGuide: '登录 → Keys → Create Key。',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct:free'],
    steps: ['选 OpenRouter 预设 → 粘贴 Key → 同步模型（会返回很长的列表）→ 收藏常用模型。'],
    limits: ['模型名必须带服务商前缀。', '免费模型有每日次数限制，且可能被限流。'],
    verifiedAt: V,
  },
  {
    id: 'groq',
    name: 'Groq',
    category: 'ai-models',
    site: 'https://groq.com',
    signup: 'https://console.groq.com/keys',
    docs: 'https://console.groq.com/docs',
    freeQuota: '有免费档，按分钟/按天限流，具体额度以控制台为准。',
    creditCard: 'no',
    keyGuide: 'Console → API Keys → Create API Key。',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    steps: ['选 Groq 预设 → 粘贴 Key → 同步模型 → 连接测试。'],
    limits: ['免费档限流较紧，批量生成容易触发 429。', '不支持中文长文写作优化，适合快速草稿。'],
    verifiedAt: V,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    category: 'ai-models',
    site: 'https://ai.google.dev',
    signup: 'https://aistudio.google.com/apikey',
    docs: 'https://ai.google.dev/gemini-api/docs',
    freeQuota: 'AI Studio 提供免费档，按模型与地区限流；是否需要结算账号以官网为准。',
    creditCard: 'unknown',
    keyGuide: 'Google AI Studio → Get API key → 创建。',
    baseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-2.0-flash', 'gemini-1.5-flash'],
    steps: [
      '选 Gemini 预设（原生接口）或 Gemini OpenAI API（兼容层）。',
      '粘贴 Key。原生接口的 Key 走请求头，不拼进 URL。',
      '同步模型 → 连接测试。',
    ],
    limits: ['部分地区无法直连，需要网络条件允许。', '原生接口与 OpenAI 兼容层是两条路径，模型名相同但请求格式不同。'],
    verifiedAt: V,
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    category: 'ai-models',
    site: 'https://www.anthropic.com',
    signup: 'https://console.anthropic.com',
    docs: 'https://docs.anthropic.com',
    freeQuota: '以按量计费为主，新账号是否有赠送额度以控制台为准。',
    creditCard: 'yes',
    keyGuide: 'Console → API Keys → Create Key。',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'],
    steps: ['选 Anthropic 原生 → 粘贴 Key → 连接测试。'],
    limits: [
      '浏览器直连需要服务商允许，本软件已带 anthropic-dangerous-direct-browser-access 请求头。',
      '官方未提供公开的余额查询接口，界面不显示余额。',
    ],
    verifiedAt: V,
  },

  /* ----------------------------- 网页搜索 ----------------------------- */
  {
    id: 'tavily',
    name: 'Tavily',
    category: 'search',
    site: 'https://tavily.com',
    signup: 'https://app.tavily.com',
    docs: 'https://docs.tavily.com',
    freeQuota: '有免费月度额度，具体次数以官网价格页为准。',
    creditCard: 'unknown',
    keyGuide: '注册后进入 Dashboard，API Keys 里复制 tvly- 开头的 Key。',
    baseUrl: 'https://api.tavily.com',
    steps: ['设置 → 检索服务 → 添加 Tavily → 填 Key → 测试 → 启用。', '在组合检索里选「网页」或「新闻」模式。'],
    limits: ['按调用次数计费，免费额度用完后会拒绝请求。', '返回的正文长度受套餐限制。'],
    verifiedAt: V,
  },
  {
    id: 'brave',
    name: 'Brave Search API',
    category: 'search',
    site: 'https://brave.com/search/api/',
    signup: 'https://api.search.brave.com/app/keys',
    docs: 'https://api.search.brave.com/app/documentation',
    freeQuota: '有免费档（每月固定次数），具体以官网价格页为准。',
    creditCard: 'yes',
    keyGuide: '注册开发者账号 → API Keys → 订阅 Free 计划后生成 Key。',
    baseUrl: 'https://api.search.brave.com',
    steps: ['检索服务 → 添加 Brave → 填 X-Subscription-Token（即 Key）→ 测试。'],
    limits: ['需要先订阅计划（含免费计划）才能拿到 Key。', '新闻检索只覆盖近几天。'],
    verifiedAt: V,
  },
  {
    id: 'serper',
    name: 'Serper',
    category: 'search',
    site: 'https://serper.dev',
    signup: 'https://serper.dev/signup',
    docs: 'https://serper.dev/playground',
    freeQuota: '注册赠送少量免费查询，之后按次计费，以官网为准。',
    creditCard: 'unknown',
    keyGuide: '登录后在 Dashboard 顶部复制 API Key。',
    baseUrl: 'https://google.serper.dev',
    steps: ['检索服务 → 添加 Serper → 填 Key → 测试。'],
    limits: ['免费额度很小，适合验证流程，不适合日常批量检索。', '结果来自 Google，中文站点覆盖一般。'],
    verifiedAt: V,
  },
  {
    id: 'bocha',
    name: '博查 Bocha',
    category: 'search',
    site: 'https://bochaai.com',
    signup: 'https://open.bochaai.com',
    docs: 'https://open.bochaai.com/docs',
    freeQuota: '以官网控制台显示的额度为准，未确认长期免费。',
    creditCard: 'unknown',
    keyGuide: '开放平台 → API KEY 管理 → 创建。',
    baseUrl: 'https://api.bochaai.com',
    steps: ['检索服务 → 添加博查 → 填 Key → 测试 → 在「网页」或「新闻」模式下使用。'],
    limits: ['国内可直连，但仍有速率限制。', '返回摘要而非全文，需要全文请开「抓取网页正文」。'],
    verifiedAt: V,
  },
  {
    id: 'searxng',
    name: 'SearXNG（自建）',
    category: 'search',
    site: 'https://docs.searxng.org',
    signup: '',
    docs: 'https://docs.searxng.org/dev/search_api.html',
    freeQuota: '软件本身免费开源；成本取决于你部署在哪台机器上。',
    creditCard: 'no',
    keyGuide: '不需要 Key，但必须在 settings.yml 里开启 formats: [html, json]。',
    baseUrl: 'http://localhost:8080',
    steps: ['用 Docker 部署 SearXNG，开启 JSON 输出。', '检索服务 → 添加 SearXNG → 填地址 → 测试。'],
    limits: ['公共实例大多关闭了 JSON 接口，必须自建。', '上游搜索引擎可能封禁你的实例 IP。'],
    verifiedAt: V,
  },

  /* ----------------------------- 学术检索 ----------------------------- */
  {
    id: 'openalex',
    name: 'OpenAlex',
    category: 'academic',
    site: 'https://openalex.org',
    signup: '',
    docs: 'https://docs.openalex.org',
    freeQuota: '完全免费，无需注册或 Key。',
    creditCard: 'no',
    keyGuide: '不需要 Key。',
    baseUrl: 'https://api.openalex.org',
    steps: ['默认已启用。设置 → 检索服务里可以看优先级与限流。', '检索模式选「学术」即可。'],
    limits: ['官方建议控制频率；本软件默认 60 次/分钟。', '摘要为倒排索引还原，个别条目缺失。'],
    verifiedAt: V,
  },
  {
    id: 'crossref',
    name: 'Crossref',
    category: 'academic',
    site: 'https://www.crossref.org',
    signup: '',
    docs: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/',
    freeQuota: '完全免费，无需注册。',
    creditCard: 'no',
    keyGuide: '不需要 Key。',
    baseUrl: 'https://api.crossref.org',
    steps: ['默认已启用。检索模式选「学术」。'],
    limits: ['只提供出版元数据，通常没有摘要与全文。', '官方建议标识来源并控制频率，本软件默认 30 次/分钟。'],
    verifiedAt: V,
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    category: 'academic',
    site: 'https://arxiv.org',
    signup: '',
    docs: 'https://info.arxiv.org/help/api/index.html',
    freeQuota: '完全免费，无需注册。',
    creditCard: 'no',
    keyGuide: '不需要 Key。',
    baseUrl: 'https://export.arxiv.org',
    steps: ['默认已启用。检索模式选「学术」。'],
    limits: ['官方要求每次请求间隔 3 秒，本软件默认 20 次/分钟。', '以预印本为主，未经过同行评审；引用前需核对是否正式发表。'],
    verifiedAt: V,
  },
  {
    id: 'semantic-scholar',
    name: 'Semantic Scholar',
    category: 'academic',
    site: 'https://www.semanticscholar.org',
    signup: 'https://www.semanticscholar.org/product/api',
    docs: 'https://api.semanticscholar.org/api-docs/',
    freeQuota: '不填 Key 也可用，但为共享额度；有 Key 时额度更高，以官网为准。',
    creditCard: 'no',
    keyGuide: '在 API 页面申请 Key；不申请也能调用。',
    baseUrl: 'https://api.semanticscholar.org',
    steps: ['检索服务 → 添加 Semantic Scholar → 可直接启用；有 Key 时填入。'],
    limits: ['共享额度很容易 429，建议排在其他学术接口之后。', '部分摘要缺失。'],
    verifiedAt: V,
  },

  /* ----------------------------- 本地模型 ----------------------------- */
  {
    id: 'ollama',
    name: 'Ollama',
    category: 'local',
    site: 'https://ollama.com',
    signup: '',
    docs: 'https://github.com/ollama/ollama/tree/main/docs',
    freeQuota: '完全免费，模型下载与推理都在本机。',
    creditCard: 'no',
    keyGuide: '不需要 Key。',
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen2.5:7b', 'llama3.2:3b'],
    steps: [
      '安装 Ollama，终端执行 ollama -v 确认可用。',
      'ollama pull qwen2.5:7b 下载模型。',
      'ollama serve 启动服务（默认 11434）。',
      'API 管理中心选 Ollama 预设 → 连接测试。',
    ],
    limits: ['7B 模型通常需要 8 GB 以上可用内存。', '手机端能否运行取决于设备，本软件不保证。'],
    verifiedAt: V,
    configSnippet: JSON.stringify(
      { kind: 'local', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
      null,
      2,
    ),
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    category: 'local',
    site: 'https://lmstudio.ai',
    signup: '',
    docs: 'https://lmstudio.ai/docs',
    freeQuota: '软件免费；模型是否可商用取决于模型自身的许可证。',
    creditCard: 'no',
    keyGuide: '不需要 Key。',
    baseUrl: 'http://localhost:1234/v1',
    steps: ['安装并下载 GGUF 模型 → 打开 Local Server → Start Server。', 'API 管理中心选 LM Studio 预设 → 连接测试。'],
    limits: ['模型名区分大小写。', '显存/内存不足时会退到 CPU，速度显著下降。'],
    verifiedAt: V,
  },

  /* ----------------------------- 文档工具 ----------------------------- */
  {
    id: 'pandoc',
    name: 'Pandoc',
    category: 'doc-tools',
    site: 'https://pandoc.org',
    signup: '',
    docs: 'https://pandoc.org/MANUAL.html',
    freeQuota: '开源免费（GPL）。',
    creditCard: 'no',
    keyGuide: '命令行工具，不需要 Key。',
    steps: ['安装后执行 pandoc -v 确认。', '可用 pandoc input.md -o output.docx --reference-doc=模板.docx 套用学校模板。'],
    limits: ['不擅长复杂表格与图片定位。', '需要本机安装，不是在线服务。'],
    verifiedAt: V,
  },
  {
    id: 'libreoffice',
    name: 'LibreOffice',
    category: 'doc-tools',
    site: 'https://www.libreoffice.org',
    signup: '',
    docs: 'https://help.libreoffice.org',
    freeQuota: '开源免费（MPL）。',
    creditCard: 'no',
    keyGuide: '不需要 Key。',
    steps: ['安装后可用 soffice --headless --convert-to pdf 批量转 PDF。'],
    limits: ['对 DOCX 的复杂版式还原与 Word 存在差异，交付前需人工比对。'],
    verifiedAt: V,
  },
  {
    id: 'docx-lib',
    name: 'docx（npm 库）',
    category: 'doc-tools',
    site: 'https://docx.js.org',
    signup: '',
    docs: 'https://docx.js.org/#/usage/',
    freeQuota: '开源免费（MIT）。',
    creditCard: 'no',
    keyGuide: '不需要 Key。',
    steps: ['npm i docx，在代码里构造 Document 后 Packer.toBlob。', '本项目正是用它生成 DOCX。'],
    limits: ['目录是 Word 域，首次打开需右键「更新域」。', '复杂浮动版式支持有限。'],
    verifiedAt: V,
  },
];

/** 远端目录的响应形态 */
export interface CatalogPayload {
  version: number;
  updatedAt: string;
  items: ServiceEntry[];
}
