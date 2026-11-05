import type { ProviderKind } from '../core/types';

/**
 * 适配器支持范围
 *
 * 这张表是给人看的「说实话」清单：哪些能力真的实现了、哪些只是尽量尝试。
 * UI 直接渲染它，避免用「支持 OpenAI 兼容」这种一句话把差异抹平。
 */
export interface SupportMatrix {
  kind: ProviderKind;
  label: string;
  /** 对话生成（必需） */
  chat: boolean;
  /** 模型列表：null 表示该接口不提供 */
  modelList: string | null;
  /** 模型列表是否可靠：'stable' 一般都给，'partial' 只有部分服务商给 */
  modelListConfidence: 'stable' | 'partial' | 'none';
  /** 余额/额度查询：null 表示官方没有这个接口 */
  balance: string | null;
  /** 一句话说清支持到哪 */
  scope: string;
}

export const SUPPORT_MATRIX: Record<ProviderKind, SupportMatrix> = {
  'openai-compatible': {
    kind: 'openai-compatible',
    label: 'OpenAI 兼容',
    chat: true,
    modelList: 'GET {base}/models',
    modelListConfidence: 'partial',
    balance: null,
    scope:
      '已实现 POST {base}/chat/completions 与 GET {base}/models。兼容范围仅限上述路径，' +
      '不代表已支持 OpenAI 全部能力：流式输出、函数调用、图像输入与批量接口均未接入。',
  },
  'openai-responses': {
    kind: 'openai-responses',
    label: 'OpenAI Responses',
    chat: true,
    modelList: null,
    modelListConfidence: 'none',
    balance: null,
    scope:
      '已实现 POST {base}/responses（非流式），把 input 数组转成对话消息、从 output_text 取回复。' +
      'Responses 的原生工具、文件、会话状态都未接入；是否可用取决于服务商是否真的实现了该路径。',
  },
  anthropic: {
    kind: 'anthropic',
    label: 'Anthropic',
    chat: true,
    modelList: 'GET {base}/v1/models',
    modelListConfidence: 'stable',
    balance: null,
    scope:
      '只实现 POST {base}/v1/messages（非流式）与 GET {base}/v1/models。' +
      '工具调用、图像输入与 prompt caching 未接入；Anthropic 未提供公开的余额查询接口，因此不展示余额。',
  },
  gemini: {
    kind: 'gemini',
    label: 'Google Gemini',
    chat: true,
    modelList: 'GET {base}/v1beta/models',
    modelListConfidence: 'stable',
    balance: null,
    scope:
      '已实现 generateContent（非流式）与 models 列表。密钥仅通过 x-goog-api-key 请求头传递，不附加于 URL。' +
      'Gemini 未提供跨项目通用的余额接口，请在官方控制台查看。',
  },
  local: {
    kind: 'local',
    label: '本地模型（Beta）',
    chat: true,
    modelList: 'GET {base}/models（Ollama 亦可用 /api/tags）',
    modelListConfidence: 'partial',
    balance: null,
    scope:
      'Beta：通过 OpenAI 兼容接口接入，尚未针对每个本地后端逐一验证。' +
      '移动端可用性取决于设备内存与算力，本软件不作保证；使用局域网地址时，同网段设备可能访问该服务。',
  },
};

export function supportOf(kind: ProviderKind): SupportMatrix {
  return SUPPORT_MATRIX[kind] ?? SUPPORT_MATRIX['openai-compatible'];
}

/** 预设分组，用于新建面板的分类筛选 */
export type PresetGroup = 'protocol' | 'cn' | 'gateway' | 'local' | 'custom';

export const PRESET_GROUP_LABEL: Record<PresetGroup, string> = {
  protocol: '接口协议',
  cn: '国内服务',
  gateway: '聚合与云',
  local: '本地部署',
  custom: '自定义',
};

/** 新建服务商时的预设。baseUrl 只是起点，用户可改 */
export interface ProviderPreset {
  key: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  hint: string;
  group: PresetGroup;
  /** 该预设是否 Beta */
  beta?: boolean;
  /** 新建时默认勾选「支持模型列表」 */
  modelList: boolean;
  docs?: string;
  /** 地址需要用户替换（如 Azure 的资源名），界面会提示 */
  needsEdit?: boolean;
  /** 我不确定这个地址是否仍然有效时置 true，界面显示「以官方文档为准」 */
  needsConfirm?: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'openai',
    label: 'OpenAI Compatible',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    hint: '任何实现 /chat/completions 与 /models 的服务都可以填这里',
    group: 'protocol',
    modelList: true,
    docs: 'https://platform.openai.com/docs/api-reference',
  },
  {
    key: 'openai-responses',
    label: 'OpenAI Responses',
    kind: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    hint: '走 /responses，与 Chat Completions 是两条不同的路径',
    group: 'protocol',
    modelList: false,
    docs: 'https://platform.openai.com/docs/api-reference/responses',
  },
  {
    key: 'gemini',
    label: 'Gemini Compatible',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    hint: '原生 generateContent 接口，密钥走请求头',
    group: 'protocol',
    modelList: true,
    docs: 'https://ai.google.dev/api',
  },
  {
    key: 'anthropic-compatible',
    label: 'Anthropic Compatible',
    kind: 'openai-compatible',
    baseUrl: 'https://api.anthropic.com/v1',
    hint: 'Anthropic 的 OpenAI SDK 兼容层；原生接口请选「Anthropic 原生」',
    group: 'protocol',
    modelList: true,
    needsConfirm: true,
    docs: 'https://docs.anthropic.com/en/api/openai-sdk',
  },
  {
    key: 'anthropic',
    label: 'Anthropic 原生',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    hint: 'Claude 系列，需在服务商后台允许浏览器直连',
    group: 'protocol',
    modelList: true,
    docs: 'https://docs.anthropic.com',
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    hint: '国内直连，成本较低，适合作为默认服务商',
    group: 'cn',
    modelList: true,
    docs: 'https://api-docs.deepseek.com',
  },
  {
    key: 'agnes',
    label: 'Agnes',
    kind: 'openai-compatible',
    baseUrl: 'https://apihub.agnes-ai.cn/v1',
    hint: '新加坡 Sapiens AI 旗下，推广期免费：agnes-3.0-flash / agnes-2.5-flash，OpenAI 兼容、支持思考',
    group: 'cn',
    modelList: true,
    docs: 'https://platform.agnes-ai.cn',
  },
  {
    key: 'deepseek-responses',
    label: 'DeepSeek Responses',
    kind: 'openai-responses',
    baseUrl: 'https://api.deepseek.com/v1',
    hint: '仅当服务商明确支持 /responses 时可用；不支持会直接报 404',
    group: 'cn',
    modelList: false,
    needsConfirm: true,
    docs: 'https://api-docs.deepseek.com',
  },
  {
    key: 'moonshot',
    label: 'Kimi',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    hint: '月之暗面，长上下文',
    group: 'cn',
    modelList: true,
    docs: 'https://platform.moonshot.cn/docs',
  },
  {
    key: 'kimi-coding',
    label: 'Kimi Coding Plan',
    kind: 'anthropic',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    hint: '编码套餐走 Anthropic 兼容路径，不是 /v1',
    group: 'cn',
    modelList: false,
    needsConfirm: true,
    docs: 'https://platform.moonshot.cn/docs',
  },
  {
    key: 'minimax',
    label: 'MiniMax',
    kind: 'openai-compatible',
    baseUrl: 'https://api.minimax.chat/v1',
    hint: '国内站地址；国际站为 api.minimaxi.com',
    group: 'cn',
    modelList: true,
    needsConfirm: true,
    docs: 'https://platform.minimaxi.com/document',
  },
  {
    key: 'minimax-token',
    label: 'MiniMax Token Plan',
    kind: 'openai-compatible',
    baseUrl: 'https://api.minimaxi.com/v1',
    hint: '国际站 token 套餐地址，Key 与国内站不通用',
    group: 'cn',
    modelList: true,
    needsConfirm: true,
    docs: 'https://platform.minimaxi.com/document',
  },
  {
    key: 'zhipu',
    label: 'Zhipu',
    kind: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    hint: '智谱 GLM，v4 接口遵循 OpenAI 兼容协议',
    group: 'cn',
    modelList: false,
    docs: 'https://open.bigmodel.cn/dev/api',
  },
  {
    key: 'xiaomi',
    label: 'Xiaomi',
    kind: 'openai-compatible',
    baseUrl: '',
    hint: '小米开放平台的模型地址与模型名请以官方文档为准，这里不预填',
    group: 'cn',
    modelList: false,
    needsEdit: true,
    needsConfirm: true,
  },
  {
    key: 'xiaomi-token',
    label: 'Xiaomi Token Plan',
    kind: 'openai-compatible',
    baseUrl: '',
    hint: 'Token 套餐的地址与 Key 类型需按官方说明填写',
    group: 'cn',
    modelList: false,
    needsEdit: true,
    needsConfirm: true,
  },
  {
    key: 'xai',
    label: 'xAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.x.ai/v1',
    hint: 'Grok 系列',
    group: 'gateway',
    modelList: true,
    docs: 'https://docs.x.ai',
  },
  {
    key: 'longcat',
    label: 'LongCat',
    kind: 'openai-compatible',
    baseUrl: 'https://api.longcat.chat/openai/v1',
    hint: '美团 LongCat 开放平台',
    group: 'cn',
    modelList: true,
    needsConfirm: true,
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    hint: '一个 Key 调用多家模型，模型名带服务商前缀',
    group: 'gateway',
    modelList: true,
    docs: 'https://openrouter.ai/docs',
  },
  {
    key: 'nvidia',
    label: 'NVIDIA',
    kind: 'openai-compatible',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    hint: 'NVIDIA NIM / build.nvidia.com',
    group: 'gateway',
    modelList: true,
    docs: 'https://docs.api.nvidia.com',
  },
  {
    key: 'azure-openai',
    label: 'Azure OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://{resource}.openai.azure.com/openai/v1',
    hint: '把 {resource} 换成你的资源名；模型名填部署名，不是模型名',
    group: 'gateway',
    modelList: false,
    needsEdit: true,
    docs: 'https://learn.microsoft.com/azure/ai-services/openai/',
  },
  {
    key: 'ollama',
    label: 'Ollama',
    kind: 'local',
    baseUrl: 'http://localhost:11434/v1',
    hint: 'Beta · 需本机已运行 ollama serve',
    group: 'local',
    beta: true,
    modelList: true,
    docs: 'https://ollama.com',
  },
  {
    key: 'lmstudio',
    label: 'LM Studio',
    kind: 'local',
    baseUrl: 'http://localhost:1234/v1',
    hint: 'Beta · 需在 LM Studio 中启动 Local Server',
    group: 'local',
    beta: true,
    modelList: true,
    docs: 'https://lmstudio.ai/docs',
  },
  {
    key: 'gemini-openai',
    label: 'Gemini OpenAI API',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    hint: 'Google 提供的 OpenAI 兼容层，Key 仍然是 Gemini 的',
    group: 'protocol',
    modelList: true,
    docs: 'https://ai.google.dev/gemini-api/docs/openai',
  },
  {
    key: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    hint: '推理速度快，免费档有限流',
    group: 'gateway',
    modelList: true,
    docs: 'https://console.groq.com/docs',
  },
  {
    key: '302ai',
    label: '302.AI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.302.ai/v1',
    hint: '按量付费的聚合平台',
    group: 'gateway',
    modelList: true,
    docs: 'https://302.ai',
  },
  {
    key: 'siliconflow',
    label: 'SiliconFlow',
    kind: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    hint: '硅基流动，国内直连，有免费模型额度',
    group: 'cn',
    modelList: true,
    docs: 'https://docs.siliconflow.cn',
  },
  {
    key: 'ppio',
    label: 'PPIO',
    kind: 'openai-compatible',
    baseUrl: 'https://api.ppinfra.com/v3/openai',
    hint: '派欧云，地址以控制台显示为准',
    group: 'cn',
    modelList: true,
    needsConfirm: true,
    docs: 'https://ppio.com/docs',
  },
  {
    key: 'tokenpony',
    label: 'TokenPony',
    kind: 'openai-compatible',
    baseUrl: '',
    hint: '地址与模型名请按官方文档填写，这里不预填',
    group: 'gateway',
    modelList: false,
    needsEdit: true,
    needsConfirm: true,
  },
  {
    key: 'compshare',
    label: 'Compshare',
    kind: 'openai-compatible',
    baseUrl: 'https://api.compshare.cn/v1',
    hint: '优云智算，地址以控制台显示为准',
    group: 'cn',
    modelList: true,
    needsConfirm: true,
  },
  {
    key: 'modelscope',
    label: 'ModelScope',
    kind: 'openai-compatible',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    hint: '魔搭社区推理接口',
    group: 'cn',
    modelList: true,
    docs: 'https://modelscope.cn/docs',
  },
  {
    key: 'fastgpt',
    label: 'FastGPT',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:3000/api/v1',
    hint: '自建 FastGPT 的 OpenAI 兼容入口，地址换成你的部署域名',
    group: 'local',
    modelList: true,
    needsEdit: true,
    docs: 'https://doc.tryfastgpt.ai',
  },
  {
    key: 'custom',
    label: '自定义',
    kind: 'openai-compatible',
    baseUrl: '',
    hint: '从零填地址与模型名，不做任何预设',
    group: 'custom',
    modelList: false,
    needsEdit: true,
  },
];

/** 本地模型接入说明：直接写在界面上，不让用户去猜 */
export interface LocalGuide {
  key: string;
  name: string;
  steps: string[];
  baseUrl: string;
  modelHint: string;
  note: string;
}

export const LOCAL_GUIDES: LocalGuide[] = [
  {
    key: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    modelHint: '例如 qwen2.5:7b、llama3.2:3b（用 ollama list 看本机已有的）',
    steps: [
      '从 ollama.com 安装对应系统版本，安装完成后在终端执行 ollama -v 确认可用。',
      '执行 ollama pull qwen2.5:7b 下载模型（通常 2–5 GB，请预留磁盘空间）。',
      '执行 ollama serve 启动服务，默认监听 11434 端口。',
      '在下方填写地址 http://localhost:11434/v1，模型名称填写 ollama list 中的名称，点击「连接测试」。',
    ],
    note: 'Ollama 默认仅监听本机。若改为 0.0.0.0 以开放局域网访问，同网段的其他设备也可调用该模型服务，请自行评估风险。',
  },
  {
    key: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    modelHint: '模型名以 LM Studio 的 Local Server 页面显示为准',
    steps: [
      '安装 LM Studio，在模型页下载并加载一个 GGUF 模型。',
      '打开左侧 Local Server 面板，点击 Start Server（默认端口 1234）。',
      '地址填写 http://localhost:1234/v1，模型名称使用面板中显示的完整名称。',
      '点击「连接测试」；通过后可在「模型」页设为默认或收藏。',
    ],
    note: 'LM Studio 的模型名称区分大小写。若无法获取模型列表，请在「模型」页手动录入名称。',
  },
  {
    key: 'vllm',
    name: 'vLLM / 自建推理',
    baseUrl: 'http://localhost:8000/v1',
    modelHint: '模型名用启动参数里的 --served-model-name',
    steps: [
      '在服务器上安装 vLLM，启动时加 --served-model-name 指定对外暴露的模型名。',
      '确认服务监听 8000 端口，且允许本机或局域网访问。',
      '地址填 http://<服务器地址>:8000/v1；跨设备访问需放通防火墙。',
      '点击「连接测试」，通过后在「模型」页设为默认。',
    ],
    note: '自建服务的稳定性与显存占用由你负责；跨公网暴露时请加鉴权，不要直接开在公网。',
  },
];
