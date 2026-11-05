/**
 * 研学帮 StudyMate 核心数据模型
 *
 * 设计原则：
 * 1. 一个 Project = 一整套研究性学习项目（含四份相互关联的报告）
 * 2. 任何内容单元都带 sourceType / verification / 真实性标记，绝不让模拟内容冒充真实研究
 * 3. 报告是"章节树"，章节可从项目资料派生，也可由用户/AI 编辑
 */

/* ------------------------------------------------------------------ */
/* 基础枚举                                                             */
/* ------------------------------------------------------------------ */

/** 报告类型：初期固定四份，架构预留自定义 */
export type ReportKind = 'proposal' | 'progress' | 'midterm' | 'final' | (string & {});

/** 研究方式，可多选混合 */
export type ResearchMode = 'theory' | 'practice' | 'simulated';

/** AI 工作模式 */
export type AiWorkMode = 'assist' | 'lead';

/**
 * 来源类型 —— 所有记录 / 数据 / 图表都必须标注
 * real      真实获取（学生亲自做的调查、访谈、实验、观察）
 * literature 文献 / 公开资料
 * web        网页检索结果
 * simulated  AI 模拟 / 虚拟示例（导出必须保留标识）
 * provided   用户直接提供的材料
 */
export type SourceType = 'real' | 'literature' | 'web' | 'simulated' | 'provided';

/** 核验状态 */
export type VerifyStatus = 'verified' | 'unverified' | 'failed';

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  real: '真实记录',
  literature: '文献资料',
  web: '网络来源',
  simulated: 'AI 模拟 / 虚拟示例',
  provided: '用户提供',
};

export const REPORT_KIND_LABEL: Record<string, string> = {
  proposal: '开题报告',
  'records-t1': '过程记录（上学期）',
  midterm: '中期报告',
  'records-t2': '过程记录（下学期）',
  final: '结题报告',
  /** 兼容旧数据：合并展示时的统称 */
  progress: '过程记录',
};

/**
 * 报告状态 —— 四态，用户手动推进，AI 不得自行置为「已确认」
 * not-started 未开始 → draft 草稿 → review 待审核 → confirmed 已确认
 */
export type ReportStatus = 'not-started' | 'draft' | 'review' | 'confirmed';

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  'not-started': '未开始',
  draft: '草稿',
  review: '待审核',
  confirmed: '已确认',
};

export const REPORT_STATUS_ORDER: ReportStatus[] = ['not-started', 'draft', 'review', 'confirmed'];

/** 由 N 篇研究记录反推「研究记录」这份报告的状态（记录没有独立 Report 行） */
export function deriveRecordsStatus(
  recs: { goal: string; work: string; confirmed: boolean }[],
): ReportStatus {
  if (!recs.length) return 'not-started';
  const filled = recs.filter((r) => (r.goal ?? '').trim() || (r.work ?? '').trim()).length;
  const confirmed = recs.filter((r) => r.confirmed).length;
  if (filled === 0) return 'not-started';
  if (confirmed === recs.length && filled === recs.length) return 'confirmed';
  if (filled === recs.length) return 'review';
  return 'draft';
}

/** 四份报告在项目内的固定顺序 */
export const REPORT_KINDS = ['proposal', 'progress', 'midterm', 'final'] as const;

/* ------------------------------------------------------------------ */
/* 项目                                                                 */
/* ------------------------------------------------------------------ */

export interface Member {
  id: string;
  name: string;
  role?: 'leader' | 'member';
  /** 分工说明，可后补 */
  duty?: string;
}

export interface ProjectMeta {
  /** 研究主题 */
  topic: string;
  /** 指导教师姓名 —— 必须用户填写，AI 不得猜测 */
  teacher: string;
  /** 学校 */
  school: string;
  grade: string;
  className: string;
  groupName: string;
  /** 项目起止（ISO date） */
  startDate: string;
  endDate: string;
  /** 教师布置的研究性学习要求（原文） */
  requirementText: string;
  /** 主导课程（开题表「主导课程」栏） */
  mainCourse?: string;
  /** 相关课程（开题表「相关课程」栏） */
  relatedCourse?: string;
  /** 要求来源：粘贴 / 导入文件名 */
  requirementSource?: string;
}

/**
 * 研究记录篇数安排
 * 一个项目的完整交付 = 1 开题 + N 篇研究记录 + 1 中期 + 1 结题。
 * 默认 N = 15，且按学期拆分（上学期 / 下学期），立项时由用户决定怎么分。
 */
export interface RecordPlan {
  total: number;
  /** 上学期篇数 */
  firstTerm: number;
  /** 下学期篇数 */
  secondTerm: number;
}

export const DEFAULT_RECORD_PLAN: RecordPlan = { total: 15, firstTerm: 8, secondTerm: 7 };

export interface Project extends ProjectMeta {
  id: string;
  createdAt: number;
  updatedAt: number;
  members: Member[];
  modes: ResearchMode[];
  aiMode: AiWorkMode;
  /**
   * 纯 AI 生成项目：只允许理论研究 / 模拟实践，全部内容按模拟示例标注。
   * 开启前必须过三层免责确认，导出与生成都会带标识。
   */
  pureAi?: boolean;
  /** 研究记录篇数安排 */
  recordPlan: RecordPlan;
  /** 当前阶段索引，对应 plan.stages */
  stageIndex: number;
  /** 已完成的关键节点确认 */
  confirmations: Confirmation[];
  status: 'draft' | 'active' | 'done';
}

/* ------------------------------------------------------------------ */
/* 研究记录（15 篇之其一，对应学校「阶段性工作小结记录表」）             */
/* ------------------------------------------------------------------ */

export type Term = 1 | 2;

/** 记录附件：图片会随 DOCX 一起导出，其他类型只登记文件名 */
export interface Attachment {
  id: string;
  name: string;
  /** 字节数，用于显示与导出前检查 */
  size: number;
  kind: 'image' | 'file';
  /** 图片为 dataURL；非图片不存内容，避免本地库无限膨胀 */
  dataUrl?: string;
}

export interface StudyRecord {
  id: string;
  projectId: string;
  /** 第几篇，从 1 开始，与学期一起决定排序 */
  index: number;
  term: Term;
  /** 阶段名称（如「第一阶段：资料准备」） */
  stageName: string;
  /** 活动名称 —— 研究日志的第一栏 */
  activityName: string;
  /** 起迄时间 */
  startDate: string;
  endDate: string;
  /** 活动地点（选填） */
  place: string;
  /** 参与成员（姓名数组） */
  participants: string[];
  recorder: string;
  recordedAt: string;
  /** 本阶段主要研究目标 */
  goal: string;
  /** 本阶段主要研究工作 / 活动内容 */
  work: string;
  /** 使用材料 */
  materials: string;
  /** 阶段性成果 / 活动结果 */
  outputs: string;
  /** 工作小结 */
  summary: string;
  /** 下阶段研究工作安排 */
  nextPlan: string;
  /** 附件（图片随文档导出，其他仅登记） */
  attachments: Attachment[];
  /** 关联的真实活动记录 id */
  activityIds: string[];
  sourceType: SourceType;
  /** 用户是否已确认真实开展 */
  confirmed: boolean;
  updatedAt: number;
}

export interface Confirmation {
  id: string;
  node: string;
  at: number;
  note?: string;
  by?: string;
}

/* ------------------------------------------------------------------ */
/* 计划 / 分工 / 活动记录                                                */
/* ------------------------------------------------------------------ */

export interface Stage {
  id: string;
  name: string;
  goal: string;
  /** 计划产出 */
  outputs: string[];
  startDate?: string;
  endDate?: string;
  done: boolean;
}

export interface Plan {
  stages: Stage[];
  /** 研究方法（文献法、问卷法…） */
  methods: string[];
}

export interface ActivityRecord {
  id: string;
  projectId: string;
  /** 所属阶段 */
  stageId?: string;
  title: string;
  /** 真实开展时间（用户填写），未开展则为 null */
  occurredAt: string | null;
  participants: string[];
  /** 做了什么 */
  content: string;
  /** 产出 / 发现 */
  findings: string;
  sourceType: SourceType;
  /** 是否已确认真实发生 */
  actuallyHappened: boolean;
  createdAt: number;
  /** 模拟内容标记文案，sourceType === 'simulated' 时必须存在 */
  simulatedNotice?: string;
}

export interface DataPoint {
  label: string;
  value: number;
}

export interface Dataset {
  id: string;
  projectId: string;
  title: string;
  unit?: string;
  points: DataPoint[];
  sourceType: SourceType;
  /** 来源说明，必填 */
  sourceNote: string;
  /** 关联的活动记录 */
  activityId?: string;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* 资料 / 来源                                                          */
/* ------------------------------------------------------------------ */

export interface Source {
  id: string;
  projectId: string;
  title: string;
  /** 作者 / 机构（多人用顿号分隔） */
  authors: string;
  /** 单独记录的机构 / 出版方 */
  institution?: string;
  /** 出版或发布日 */
  date: string;
  url: string;
  doi: string;
  /** 检索时间 */
  retrievedAt: number;
  abstract: string;
  sourceType: SourceType;
  verifyStatus: VerifyStatus;
  /** 检索该来源的服务名，如 crossref / openalex */
  provider?: string;
  /** 检索时用的关键词，便于回溯这条是怎么来的 */
  query?: string;
  /** 网页正文或摘录（用户主动抓取/粘贴时才有） */
  fullText?: string;
  /** 用户的备注 */
  notes?: string;
  /** 关联到报告段落：同一来源可能被多处引用 */
  linkedSections?: { reportId: string; sectionId: string }[];
  /** 用户在正文里引用用的短标记 */
  citationKey?: string;
}

/* ------------------------------------------------------------------ */
/* 报告                                                                 */
/* ------------------------------------------------------------------ */

export interface ReportSection {
  id: string;
  /** 章节标题，如「一、课题研究的背景」 */
  heading: string;
  level: 1 | 2 | 3;
  /** Markdown 正文 */
  body: string;
  /** 该章节引用的来源 id */
  sourceIds?: string[];
  /** 该章节是否含模拟内容 */
  containsSimulated?: boolean;
  /** 由谁生成 */
  origin?: 'user' | 'ai' | 'template';
  updatedAt: number;
}

export interface Report {
  id: string;
  projectId: string;
  kind: ReportKind;
  title: string;
  sections: ReportSection[];
  /** 使用的模板标识（内置 / 学校导入） */
  templateId?: string;
  /** 模板来源说明：内置通用模板不冒充学校官方格式 */
  templateNote?: string;
  version: number;
  updatedAt: number;
  /** 报告状态，四态：未开始 / 草稿 / 待审核 / 已确认 */
  status: ReportStatus;
}

/* ------------------------------------------------------------------ */
/* 设置 / 模型                                                          */
/* ------------------------------------------------------------------ */

export type ProviderKind =
  | 'openai-compatible'
  /** OpenAI Responses API（POST {base}/responses） */
  | 'openai-responses'
  | 'anthropic'
  | 'gemini'
  | 'local';

/**
 * 模型能力。
 * 这些字段**不由「模型出现在列表里」推断**——列表只说明服务商列出过这个名字，
 * 不代表当前 Key 能调用、也不代表支持看图或工具。
 * verified 只有在真实生成成功一次后才置 true。
 */
export interface ModelCapability {
  /** 上下文窗口（token），自己填，不猜 */
  contextWindow?: number;
  vision?: boolean;
  tools?: boolean;
  json?: boolean;
  reasoning?: boolean;
  /** 真实生成成功过一次 */
  verified?: boolean;
  verifiedAt?: number;
  /** 最近一次失败原因（已脱敏） */
  lastError?: string;
}

export interface ModelEntry {
  id: string;
  name: string;
  /** 手动添加时为 true */
  manual?: boolean;
  /** 每百万 token 估算价（输入/输出，单位：元），仅用于估算费用 */
  priceIn?: number;
  priceOut?: number;
  /** 收藏，列表与选择器里排前面 */
  favorite?: boolean;
  /** 显示别名（不改接口传的 model 名） */
  alias?: string;
  cap?: ModelCapability;
}

/** 单服务商的请求参数（开发者模式可改） */
export interface ModelParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  /** 追加请求头；值里不要写 Key，界面会提示 */
  headers?: Record<string, string>;
  /** 额外请求体字段（JSON 对象） */
  extraBody?: Record<string, unknown>;
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  /** 显示名，如「DeepSeek」 */
  label: string;
  baseUrl: string;
  /** 本地加密存储，不进入日志/URL/Git */
  apiKey: string;
  /** 拉取到的模型列表 */
  models: ModelEntry[];
  defaultModel?: string;
  /** 是否支持 GET /v1/models */
  supportsModelList: boolean;
  timeoutMs: number;
  maxRetries: number;
  createdAt: number;
  /** 备用 provider id */
  fallbackOf?: string;
  /** 停用后不参与自动路由（手动指定仍可用） */
  enabled?: boolean;
  /** 全局默认服务商：自动路由时的兜底 */
  isDefault?: boolean;
  /** 请求参数 */
  params?: ModelParams;
  /** 最近一次连接测试（只留结论与耗时，不留响应体） */
  lastTest?: {
    at: number;
    ok: boolean;
    latencyMs: number;
    /** address | auth | generate */
    stage: string;
    message: string;
  };
  /** 本地模型：标记 Beta */
  beta?: boolean;
}

export interface BudgetConfig {
  /** 每日调用次数上限，0 = 不限 */
  dailyCalls: number;
  /** 每日预算（元），0 = 不限 */
  dailyCost: number;
  /** 单次任务最大循环 */
  maxLoops: number;
  /** 单次任务最大调用 */
  maxCallsPerTask: number;
  /** 用到多少比例时提醒，0 = 不提醒（0–1） */
  warnRatio: number;
  /** 超过上限时暂停并要求二次确认，而不是直接拒绝 */
  pauseOnExceed: boolean;
}

/**
 * 省钱与路由策略。
 * 规则优先：先按任务类型定档位，再在档位里挑最便宜的可用模型；
 * 只有被判为复杂任务时才允许用高性能模型。
 */
export interface RoutingConfig {
  ruleFirst: boolean;
  /** 简单任务优先低成本模型 */
  cheapFirst: boolean;
  /** 高性能模型只用于复杂任务 */
  strongOnlyForComplex: boolean;
  /** 相同请求在 TTL 内复用结果 */
  cache: boolean;
  /** 缓存有效期（分钟） */
  cacheTtlMin: number;
  /** 同一请求并发时合并为一次调用 */
  dedupe: boolean;
  /** 上下文压缩 */
  compress: boolean;
  /** 超预算时要求确认后继续 */
  confirmOnBudget: boolean;
}

export interface UsageRecord {
  id?: number;
  at: number;
  providerId: string;
  model: string;
  agentId?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** 秒 */
  duration: number;
  cost: number;
  ok: boolean;
  /** 错误摘要（不含 key） */
  error?: string;
}

/**
 * 本机账号资料。
 * 没有账号体系：这里只是本机身份，用于首页称呼、导出署名与头像显示。
 */
export interface UserProfile {
  /** 昵称，默认「同学」 */
  name: string;
  /** 头像 dataURL；null 表示使用内置默认头像 */
  avatar: string | null;
  /** 一句话签名，可留空 */
  signature: string;
}

/** 未成年人模式：本机模式，开启与关闭都需要监护人密码 */
export interface MinorModeConfig {
  enabled: boolean;
  /** 监护人密码的 SHA-256 摘要（不存明文）；null 表示尚未设置 */
  guardianDigest: string | null;
  /** 限制 AI 生成与联网检索 */
  limitAi: boolean;
  /** 隐藏外链与捐赠入口 */
  hideExternal: boolean;
  /** 每日使用时长提醒（分钟），0 = 不提醒 */
  dailyMinutes: number;
}

export interface NotificationConfig {
  /** 阶段截止提醒 */
  deadline: boolean;
  /** 每周进度小结 */
  weekly: boolean;
  /** AI 任务完成提示 */
  aiDone: boolean;
  /** 系统与更新提示 */
  system: boolean;
}

export interface FeatureConfig {
  /** 首页 AI 助手入口 */
  aiAssist: boolean;
  /** DOCX / Markdown 导出 */
  docExport: boolean;
  /** 文献检索（OpenAlex / Crossref） */
  search: boolean;
  /** 开发者面板 */
  devTools: boolean;
  /** 是否让 AI 带上项目记忆（主题、成员、已写内容） */
  memory: boolean;
}

export interface VoiceConfig {
  enabled: boolean;
  /** 音色标识，仅做本地选择 */
  voice: string;
  /** 语速 0.5 - 2 */
  rate: number;
  /** 进入详情页自动朗读要点 */
  autoRead: boolean;
  /**
   * 微软语音（Azure Speech）配置：可选。
   * 填了就用它合成（音质明显好于系统 TTS），没填回退到本机语音。
   * Key 与 API Key 一样加密存储，界面只显示脱敏预览。
   */
  azure?: {
    keySealed: string;
    /** 资源区域，如 eastasia / eastus */
    region: string;
    /** 音色短名，如 zh-CN-XiaoxiaoNeural */
    voiceName: string;
  };
}

export interface AppSettings {
  id: 'app';
  theme: 'system' | 'light' | 'dark';
  /** 界面动效，默认开启；关闭后所有过渡与动画瞬时完成 */
  motion: 'on' | 'off';
  /** 界面字体：默认内置 HarmonyOS Sans；可切回系统字体 */
  font: 'harmony' | 'system';
  /** 状态栏额外留白（px）：部分机型 env() 返回 0，顶栏会压到状态栏下面，用户可手动补 */
  safeTopPad?: number;
  devMode: boolean;
  /** 已确认免责声明（三份文档全部勾选后为 true） */
  disclaimerAccepted: boolean;
  /** 三份文档各自的确认记录 */
  agreements: { privacy: boolean; terms: boolean; statement: boolean };
  /** 已确认 AI 模拟实践声明 */
  simulatedNoticeAccepted: boolean;
  aiMode: AiWorkMode;
  /** 深度思考：只对支持 reasoning 的模型生效，开启后界面展示思考过程 */
  thinking?: boolean;
  /**
   * 打字流速度。normal 按人类中文阅读速度（约 14 字/秒），
   * slow 更慢一档，fast 用于快速扫读；超长内容仍有总时长上限，不会让人干等。
   */
  typingSpeed?: 'slow' | 'normal' | 'fast';
  /** 图片转述模型：主模型不吃图片时，先把图讲成文字 */
  visionModel?: { providerId: string; model: string };
  /** 用户启用的 Skill / Agent；空数组或未设置 = 全部启用 */
  enabledSkills?: string[];
  enabledAgents?: string[];
  /**
   * 章节生成遇到缺失事实时的处理方式。
   * strict：写「待补充」，不替用户编（默认）。
   * fill：尽量写满，推断处标注、数据留横线、末尾附免责声明。
   */
  gapMode: 'strict' | 'fill';
  budget: BudgetConfig;
  /** Agent -> 模型映射；关闭自动分配则为空 */
  /** Agent -> 模型映射；关闭自动分配则为空 */
  autoAssign: boolean;
  /** 省钱与路由策略 */
  routing: RoutingConfig;
  /** 顶栏当前选用的模型；tier 决定「快速 / 进阶」 */
  currentModel: { providerId: string; model: string; tier: 'fast' | 'pro' } | null;
  agentModels: Record<string, { providerId: string; model: string }>;
  /** 搜索服务配置 */
  searchProviders: SearchProviderConfig[];
  /** 免费 API 指引目录：可从 GitHub 上的 JSON 更新，失败时用本地缓存 */
  catalog: CatalogConfig;
  /** 更新源 */
  update: UpdateConfig;
  /** 本机身份 */
  profile: UserProfile;
  /** 未成年人模式 */
  minor: MinorModeConfig;
  /** 通知开关 */
  notifications: NotificationConfig;
  /** 功能开关（关闭后入口从界面移除，不假装还能用） */
  features: FeatureConfig;
  /** 语音播报 */
  voice: VoiceConfig;
  /** 常用语：插入报告/记录的快捷短语 */
  phrases: string[];
}

/** 检索服务类型。前四个是无需自建服务的公开学术/元数据接口 */
export type SearchProviderKind =
  | 'openalex'
  | 'crossref'
  | 'semantic-scholar'
  | 'arxiv'
  | 'tavily'
  | 'brave'
  | 'serper'
  | 'searxng'
  | 'bocha'
  | 'generic-web'
  | 'local-files';

/** 检索能力：决定这个服务在哪种模式下会被调用 */
export type SearchCapability = 'web' | 'academic' | 'news' | 'site' | 'fulltext' | 'local';

export interface SearchProviderConfig {
  id: string;
  label: string;
  kind: SearchProviderKind;
  baseUrl?: string;
  /** 运行时明文，只在内存里；落库一律用 apiKeySealed */
  apiKey?: string;
  /** 本机设备密钥加密后的信封，不落明文 */
  apiKeySealed?: { v: 1; iv: string; data: string };
  /** 仅用于界面显示的脱敏预览 */
  apiKeyPreview?: string;
  enabled: boolean;
  /** 数值小的先检索；同值时按列表顺序 */
  priority: number;
  capabilities: SearchCapability[];
  /** 每分钟请求上限（遵守各服务条款） */
  rateLimitPerMin?: number;
  /** 该服务是否必须自备 Key */
  needsKey?: boolean;
  docs?: string;
  /** 最近一次测试：只留结论，不留响应体与密钥 */
  lastTest?: { at: number; ok: boolean; message: string; latencyMs: number };
}

export interface CatalogConfig {
  /** 远端 JSON 地址（GitHub raw 或自己的静态托管），为空则只用内置/缓存 */
  url: string;
  /** 最近一次成功同步的时间 */
  lastSyncAt: number;
  /** 最近一次同步来源：remote / cache / builtin */
  source: 'remote' | 'cache' | 'builtin';
}

export interface UpdateConfig {
  /** GitHub owner/repo 占位，由维护者填写 */
  githubRepo: string;
  /** 更新源镜像站列表：检查更新时依次探测，哪个可达用哪个 */
  mirrors: string[];
  /** 备用下载（夸克网盘）链接占位 */
  quarkUrl: string;
  /** 爱发电链接占位 */
  afdianUrl: string;
}

/* ------------------------------------------------------------------ */
/* Agent / Skill                                                        */
/* ------------------------------------------------------------------ */

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 该 Agent 需要的 Skill */
  skills: string[];
  /** 默认建议模型档位，用于自动分配 */
  tier: 'cheap' | 'balanced' | 'strong';
  permission: {
    /** 允许写入报告 */
    writeReport: boolean;
    /** 允许调用搜索 */
    useSearch: boolean;
    /** 允许读取项目资料 */
    readSources: boolean;
  };
  maxLoops: number;
  timeoutMs: number;
  builtin: boolean;
  /** 执行顺序，越小越靠前；缺省按内置顺序 */
  order?: number;
  /** 单任务预算上限（元），0 或未填 = 沿用全局预算 */
  budgetYuan?: number;
  /** 是否参与工作流；关掉后入口里不再出现 */
  enabled?: boolean;
  /** 本地覆盖或外部导入的来源说明 */
  origin?: string;
  updatedAt?: number;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  /** 声明式能力清单（默认禁止任意代码执行） */
  capability: 'prompt' | 'checklist' | 'format';
  /** 注入到提示词的规则 */
  rules: string;
  builtin: boolean;
  /** 默认不启用：用户明确勾选后才参与生成（如「Markdown 杀手」） */
  defaultOff?: boolean;
  /** 外部导入来源，导入前必须展示 */
  origin?: string;
  /** 导入时间 / 最近修改 */
  updatedAt?: number;
}

/* ------------------------------------------------------------------ */
/* 工作流                                                               */
/* ------------------------------------------------------------------ */

/**
 * 执行范围：
 * - report：只跑当前这份报告（写作 → 审核 → 确认）
 * - stage：把当前阶段一次做完，中间的确认门自动通过（仍记日志）
 * - project：全流程推进，每个确认门都停下来等人
 */
export type WorkflowScope = 'report' | 'stage' | 'project';

/**
 * 步骤类型：
 * - agent：调用模型
 * - gate：等人确认，不确认不往下走
 * - guard：只做条件检查，不满足就停下（例如没有真实记录）
 * - manual：需要人动手（导出 DOCX、去补记录）
 */
export type WorkflowStepKind = 'agent' | 'gate' | 'guard' | 'manual';

export interface WorkflowStepDef {
  id: string;
  name: string;
  kind: WorkflowStepKind;
  /** 步骤说明，展示给普通用户看的是一句人话 */
  desc: string;
  /** 所属阶段：plan / search / design / write / audit / deliver */
  phase: 'plan' | 'search' | 'design' | 'write' | 'audit' | 'deliver';
  /** 这一步服务于哪份报告，用于「当前报告生成」的范围筛选 */
  report?: ReportKind;
  /** 过程记录分包到学期：1 = 上学期，2 = 下学期 */
  term?: Term;
  agentId?: string;
  /** 条件不满足时的提示（guard / gate 用） */
  requires?: string;
  enabled: boolean;
  /** 覆盖 Agent 的限制，留空则用 Agent 自身设置 */
  maxLoops?: number;
  timeoutMs?: number;
  budgetYuan?: number;
  /** 生成报告时是否覆盖已有正文（默认只填空章节） */
  overwrite?: boolean;
}

export interface WorkflowDef {
  id: string;
  name: string;
  desc: string;
  steps: WorkflowStepDef[];
  builtin?: boolean;
  updatedAt: number;
}

export type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'awaiting'
  | 'done'
  | 'skipped'
  | 'failed';

export interface WorkflowRunStep {
  id: string;
  name: string;
  kind: WorkflowStepKind;
  phase: WorkflowStepDef['phase'];
  report?: ReportKind;
  agentId?: string;
  status: WorkflowStepStatus;
  /** 文本产出（分析、设计、审核意见） */
  output?: string;
  /** 用户在确认门改过这份产出：后续步骤按用户版本走 */
  edited?: boolean;
  warnings?: string[];
  error?: string;
  /** 搜索步骤命中的候选数量 */
  hits?: number;
  calls: number;
  cost: number;
  startedAt?: number;
  endedAt?: number;
}

export type WorkflowRunStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'awaiting'
  | 'done'
  | 'failed'
  | 'cancelled';

/** 实时过程：一条动作一行，跑完就打勾，像对话里那样逐条点亮 */
export interface WorkflowActivity {
  id: string;
  stepId: string;
  label: string;
  detail?: string;
  status: 'running' | 'done' | 'failed';
  at: number;
}

export interface WorkflowRun {
  id: string;
  projectId: string;
  scope: WorkflowScope;
  title: string;
  defId: string;
  status: WorkflowRunStatus;
  steps: WorkflowRunStep[];
  /** 当前正在执行的下标 */
  current: number;
  startedAt: number;
  endedAt?: number;
  /** 已用调用次数与估算费用 */
  calls: number;
  cost: number;
  /** 本次运行动辄上限 */
  maxCalls: number;
  maxCost: number;
  /** 暂停 / 失败原因 */
  message?: string;
  /** 用户确认记录 */
  confirmed: string[];
  /** 实时动作流水（最近若干条），给面板显示「正在做什么」 */
  activities?: WorkflowActivity[];
}

/* ------------------------------------------------------------------ */
/* 答辩演示文稿（PPTX）                                                 */
/* ------------------------------------------------------------------ */

/** 一页只讲一件事；版式决定导出时怎么摆，不决定内容 */
export type SlideLayout = 'cover' | 'section' | 'points' | 'two' | 'data' | 'end';

export interface SlideItem {
  id: string;
  layout: SlideLayout;
  /** 页标题：一句结论，≤ 18 字 */
  title: string;
  /** 顶部小标，如「01 · 为什么做」 */
  kicker?: string;
  /** 这一页唯一要观众记住的话 */
  lead?: string;
  /** 2–4 条短要点 */
  bullets: string[];
  /** 口播词 1–2 句，导出为演讲备注 */
  note?: string;
  /** 依据来自哪份材料；没有就写「待补充」 */
  source?: string;
  /** 含 AI 模拟示例，导出时页脚会加标识 */
  simulated?: boolean;
  /** 数据集 id：只引用项目里真实存在的数据集，导出时画成条形图 */
  datasetId?: string;
}

/**
 * 一个项目一份演示稿，id 就是 projectId。
 * 内容由「演示策划 / 逐页撰写 / 演示终检」三个助手产出，用户可逐页改。
 */
export interface Deck {
  id: string;
  projectId: string;
  title: string;
  slides: SlideItem[];
  /** 生成来源：ai / template / mixed，界面上如实标注 */
  origin?: 'ai' | 'template' | 'mixed';
  /** 终检发现的问题，导出前展示给用户 */
  issues?: { page: number; level: 'high' | 'mid' | 'low'; text: string }[];
  createdAt: number;
  updatedAt: number;
  version: number;
}
