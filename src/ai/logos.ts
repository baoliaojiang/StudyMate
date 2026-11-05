/**
 * 模型服务商图标解析
 *
 * 真实品牌 SVG 来自 `brandLogos.generated.ts`（一次性脚本 scripts/gen-brand-logos.mjs
 * 从 simple-icons / Iconify 提取）。该文件不复制任何商标之外的东西——用的就是各厂商
 * 自己的官方/品牌 SVG。
 *
 * 少数纯国内品牌（智谱/阶跃/豆包/火山引擎等）在公开图标集里查不到标准图标，
 * 用「品牌色 + 真实简称」占位，不是自绘 logo；详见 BRAND_PLACEHOLDER。
 *
 * 已保存的服务商（ProviderRow）没有预设 key，所以按「标签关键字 → 预设」兜底，
 * 再按接口类型（kind）兜底，最后落到一个中性通用块。
 */
import { BRANDS, BRAND_PLACEHOLDER, type BrandInfo } from './brandLogos.generated';

export type ProviderLogoDef = BrandInfo;

/** 预设 key 别名 → 同一品牌 */
const ALIAS: Record<string, string> = {
  'openai-responses': 'openai',
  'azure-openai': 'openai',
  'anthropic-compatible': 'anthropic',
  'gemini-openai': 'gemini',
  'deepseek-responses': 'deepseek',
  'minimax-token': 'minimax',
  'xiaomi-token': 'xiaomi',
};

/** kind → 预设 key（仅当标签也匹配不到时兜底） */
const KIND_LOGO: Record<string, string> = {
  'openai-compatible': 'openai',
  'openai-responses': 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
  local: 'local',
};

/** 已保存服务商的标签 → 预设 key（顺序敏感，具体在前、通用在后） */
const LABEL_HINTS: Array<[RegExp, string]> = [
  [/Agnes/i, 'agnes'],
  [/OpenAI/i, 'openai'],
  [/DeepSeek|深度/i, 'deepseek'],
  [/Kimi|Moonshot|月之暗面/i, 'moonshot'],
  [/Gemini|Google/i, 'gemini'],
  [/Anthropic|Claude/i, 'anthropic'],
  [/MiniMax/i, 'minimax'],
  [/智谱|Zhipu|GLM|ChatGLM/i, 'zhipu'],
  [/Qwen|通义|阿里/i, 'qwen'],
  [/小米|Xiaomi/i, 'xiaomi'],
  [/xAI|Grok/i, 'xai'],
  [/LongCat|美团/i, 'longcat'],
  [/OpenRouter/i, 'openrouter'],
  [/NVIDIA/i, 'nvidia'],
  [/Azure/i, 'azure-openai'],
  [/Ollama/i, 'ollama'],
  [/LM ?Studio|LMStudio/i, 'lmstudio'],
  [/Groq/i, 'groq'],
  [/Together/i, 'together'],
  [/Cohere/i, 'cohere'],
  [/302/i, '302ai'],
  [/硅基|SiliconFlow|硅流/i, 'siliconflow'],
  [/PPIO|派欧/i, 'ppio'],
  [/TokenPony/i, 'tokenpony'],
  [/优云|Compshare/i, 'compshare'],
  [/魔搭|ModelScope|模型库/i, 'modelscope'],
  [/FastGPT/i, 'fastgpt'],
  [/豆包|Doubao/i, 'bytedance'], // 豆包属字节系，尽量用真实 logo
  [/字节|ByteDance|火山|Volcengine/i, 'bytedance'],
  [/阶跃|StepFun/i, 'stepfun'],
  [/本地|Local/i, 'local'],
  [/自定义|Custom/i, 'custom'],
  [/vLLM/i, 'vllm'],
  [/Perplexity/i, 'perplexity'],
  [/Hugging ?Face/i, 'huggingface'],
  [/Baidu|百度/i, 'baidu'],
];

const GENERIC: ProviderLogoDef = { svg: '', mono: 'AI', hex: '#5b6470' };

function resolveKey(input: { key?: string; kind?: string; label?: string }): ProviderLogoDef {
  const raw = input.key;
  const key = raw ? ALIAS[raw] ?? raw : undefined;
  if (key && BRANDS[key]) return BRANDS[key];
  if (input.label) {
    for (const [re, k] of LABEL_HINTS) {
      if (re.test(input.label)) return BRANDS[k] ?? GENERIC;
    }
  }
  if (input.kind && KIND_LOGO[input.kind] && BRANDS[KIND_LOGO[input.kind]]) {
    return BRANDS[KIND_LOGO[input.kind]];
  }
  return GENERIC;
}

export function resolveLogo(input: { key?: string; kind?: string; label?: string }): ProviderLogoDef {
  return resolveKey(input);
}

/** 仍是「品牌色 + 简称」占位的服务商（无公开标准图标） */
export const placeholderBrands = BRAND_PLACEHOLDER;
