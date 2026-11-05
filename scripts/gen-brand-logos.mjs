// 一次性脚本：把各模型服务商的「真实品牌 SVG」提取成静态 TS 文件。
// 来源 A：本地 simple-icons 包（离线，single-path 品牌色图标）
// 来源 B：Iconify 公共 API（补齐 simple-icons 未收录的：openai 被移除、xAI/Groq/Together/Cohere 等）
// 生成后运行时直接 import，不打包上千个图标，也不依赖网络。
//
// 运行：node scripts/gen-brand-logos.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const SI_ICONS = path.join(ROOT, 'node_modules/simple-icons/icons');
const SI_DATA = path.join(ROOT, 'node_modules/simple-icons/data/simple-icons.json');
const OUT = path.join(ROOT, 'src/ai/brandLogos.generated.ts');

// ---- simple-icons 品牌色 ----
const siData = JSON.parse(fs.readFileSync(SI_DATA, 'utf8'));
const SI_HEX = Object.fromEntries(siData.map((x) => [x.slug, x.hex]));

function readSi(slug) {
  const f = path.join(SI_ICONS, `${slug}.svg`);
  if (!fs.existsSync(f)) return null;
  let s = fs.readFileSync(f, 'utf8').trim();
  // 去掉 <title>，并统一 viewBox
  s = s.replace(/<title>.*?<\/title>/g, '');
  s = s.replace(/<svg([^>]*?)>/, '<svg$1>');
  return s;
}

// ---- Iconify 抓取（仅用于 simple-icons 缺失的几个）----
function fetchIconify(col, icon) {
  const url = `https://api.iconify.design/${col}/${icon}.svg`;
  try {
    const out = execSync(`curl -fsSL --max-time 20 "${url}"`, { encoding: 'utf8' }).trim();
    return out.replace(/<title>.*?<\/title>/g, '');
  } catch {
    return null;
  }
}

// 预设 key -> 来源。si 表示本地 simple-icons slug；ify 表示 Iconify col/icon。
const SI = {
  gemini: 'googlegemini',
  anthropic: 'anthropic',
  deepseek: 'deepseek',
  moonshot: 'moonshotai',
  'kimi-coding': 'kimi',
  minimax: 'minimax',
  xiaomi: 'xiaomi',
  openrouter: 'openrouter',
  nvidia: 'nvidia',
  ollama: 'ollama',
};
// 通过标签也能识别的常见品牌（非预设，但用户可能自建）
const SI_EXTRA = {
  qwen: 'qwen',
  perplexity: 'perplexity',
  baidu: 'baidu',
  alibabacloud: 'alibabacloud',
  bytedance: 'bytedance',
  huggingface: 'huggingface',
  claude: 'claude',
  github: 'github',
  bilibili: 'bilibili',
  metaai: 'metaai',
  mistralai: 'mistralai',
  google: 'google',
};
const IFY = {
  openai: ['simple-icons', 'openai'], // simple-icons 本地已移除，走 Iconify
  xai: ['bxl', 'xai'],
  groq: ['logos', 'groq'],
  together: ['logos', 'togetherai'],
  cohere: ['logos', 'cohere'],
};

// 单色图标（simple-icons / bxl）需要给定品牌色；彩色图标（logos）用其自带色，hex 仅作兜底
const HEX = {
  openai: '#412991',
  xai: '#111111',
  groq: '#F55036',
  together: '#111111',
  cohere: '#39594D',
};

// 兜底单色：没有标准图标的服务商，用「品牌色 + 真实简称」占位（非自绘 logo）
const MONO = {
  'openai-responses': ['O', '#412991', 'openai'],
  'anthropic-compatible': ['A', '#d97757', 'anthropic'],
  'gemini-openai': ['G', '#1a73e8', 'gemini'],
  'deepseek-responses': ['DS', '#4d6bfe', 'deepseek'],
  'minimax-token': ['M', '#ff7a00', 'minimax'],
  'xiaomi-token': ['Mi', '#ff6900', 'xiaomi'],
  'azure-openai': ['O', '#412991', 'openai'],
  zhipu: ['智', '#4e6ef2', null],
  longcat: ['L', '#ffb300', null],
  lmstudio: ['LM', '#ff8c00', null],
  '302ai': ['302', '#7c4dff', null],
  siliconflow: ['硅', '#1664ff', null],
  ppio: ['P', '#2b6cff', null],
  tokenpony: ['TP', '#6b4fbb', null],
  compshare: ['云', '#2f8fff', null],
  modelscope: ['魔', '#ff6a00', null],
  fastgpt: ['F', '#2b5cff', null],
  agnes: ['Ag', '#7c5cfc', null],
  stepfun: ['阶', '#4e6ef2', null],
  doubao: ['豆', '#000000', null],
  volcengine: ['火', '#1F6FEB', null],
  vllm: ['V', '#6b4fbb', null],
  custom: ['＋', '#5b6470', null],
  local: ['⌂', '#4b5563', null],
};

const out = {};
const note = [];

function addLogo(key, svg, hex) {
  out[key] = { svg, mono: '', hex };
}
function addMono(key, mono, hex) {
  out[key] = { svg: '', mono, hex };
}

// 1) 本地 simple-icons
for (const [key, slug] of Object.entries(SI)) {
  const svg = readSi(slug);
  if (svg) addLogo(key, svg, SI_HEX[slug] || '#444');
  else note.push(`simple-icons 缺失: ${key} (${slug})`);
}
for (const [key, slug] of Object.entries(SI_EXTRA)) {
  const svg = readSi(slug);
  if (svg) addLogo(key, svg, SI_HEX[slug] || '#444');
  else note.push(`simple-icons 缺失: ${key} (${slug})`);
}
// 2) Iconify 补齐
for (const [key, [col, icon]] of Object.entries(IFY)) {
  const svg = fetchIconify(col, icon);
  if (svg) addLogo(key, svg, HEX[key] || '#444');
  else note.push(`Iconify 缺失: ${key} (${col}/${icon})`);
}
// 3) 同 logo 别名
out['openai-responses'] = out['openai'];
out['azure-openai'] = out['openai'];
out['anthropic-compatible'] = out['anthropic'];
out['gemini-openai'] = out['gemini'];
out['deepseek-responses'] = out['deepseek'];
out['minimax-token'] = out['minimax'];
out['xiaomi-token'] = out['xiaomi'];
// 4) 兜底单色
for (const [key, [mono, hex, alias]] of Object.entries(MONO)) {
  if (alias && out[alias]) out[key] = out[alias];
  else addMono(key, mono, hex);
}

// ---- 写出静态 TS ----
const normHex = (h) => (h || '#444').startsWith('#') ? h : '#' + h;
const body = Object.entries(out)
  .map(([k, v]) => {
    const svg = v.svg ? JSON.stringify(v.svg) : "''";
    return `  ${JSON.stringify(k)}: { svg: ${svg}, mono: ${JSON.stringify(v.mono)}, hex: ${JSON.stringify(normHex(v.hex))} },`;
  })
  .join('\n');

const file = `// 自动生成，请勿手改。来源：scripts/gen-brand-logos.mjs
// 品牌真实 SVG（simple-icons / Iconify）。无标准图标的服务商用「品牌色 + 简称」占位。
export interface BrandInfo {
  /** 真实品牌 SVG（outer <svg>），空串表示无标准图标 */
  svg: string;
  /** 无标准图标时的简称 */
  mono: string;
  /** 品牌色（单色图标上色 / 简称文字色） */
  hex: string;
}

export const BRANDS: Record<string, BrandInfo> = {
${body}
};

/** 仍缺标准图标的服务商（供 UI 标注「占位」用） */
export const BRAND_PLACEHOLDER: string[] = ${JSON.stringify(
  Object.entries(MONO)
    .filter(([k]) => !out[k]?.svg)
    .map(([k]) => k),
)};
`;
fs.writeFileSync(OUT, file, 'utf8');
console.log(`已生成 ${OUT}`);
console.log(`覆盖 ${Object.keys(out).length} 个 key；其中真实 SVG ${Object.values(out).filter((v) => v.svg).length} 个。`);
if (note.length) console.log('注意:\n' + note.join('\n'));
