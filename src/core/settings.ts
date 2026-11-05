import { DEFAULT_SEARCH_PROVIDERS } from '../search/presets';
import type { AppSettings } from './types';

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  theme: 'system',
  motion: 'on',
  font: 'harmony',
  devMode: false,
  disclaimerAccepted: false,
  agreements: { privacy: false, terms: false, statement: false },
  simulatedNoticeAccepted: false,
  aiMode: 'assist',
  thinking: false,
  typingSpeed: 'normal',
  visionModel: undefined,
  enabledSkills: [],
  enabledAgents: [],
  safeTopPad: 0,
  gapMode: 'strict',
  budget: {
    dailyCalls: 200,
    dailyCost: 5,
    maxLoops: 4,
    maxCallsPerTask: 8,
    warnRatio: 0.8,
    pauseOnExceed: true,
  },
  autoAssign: true,
  routing: {
    ruleFirst: true,
    cheapFirst: true,
    strongOnlyForComplex: true,
    cache: true,
    cacheTtlMin: 5,
    dedupe: true,
    compress: true,
    confirmOnBudget: true,
  },
  currentModel: null,
  agentModels: {},
  searchProviders: DEFAULT_SEARCH_PROVIDERS.map((p) => ({ ...p })),
  catalog: {
    url: '',
    lastSyncAt: 0,
    source: 'builtin',
  },
  update: {
    // 官方仓库：检查更新与提交 Issue 都指向这里
    githubRepo: 'https://github.com/baoliaojiang/StudyMate',
    // 镜像站：检查更新前依次探测可达性，不可达自动跳过；留空则直接看 githubRepo
    mirrors: [],
    quarkUrl: '',
    afdianUrl: 'https://afdian.com/a/dcr33550336',
  },
  profile: {
    name: '同学',
    avatar: null,
    signature: '',
  },
  minor: {
    enabled: false,
    guardianDigest: null,
    limitAi: true,
    hideExternal: true,
    dailyMinutes: 60,
  },
  notifications: {
    deadline: true,
    weekly: false,
    aiDone: true,
    system: true,
  },
  features: {
    aiAssist: true,
    docExport: true,
    search: true,
    devTools: false,
    memory: true,
  },
  voice: {
    enabled: false,
    voice: '默认女声',
    rate: 1,
    autoRead: false,
  },
  phrases: [
    '本阶段尚未开展，待补充。',
    '数据来源：小组成员真实记录，已附原始材料。',
    '此处需要指导教师确认。',
  ],
};

/** 项目交付模板的统一说明 —— 内置模板是通用结构，不冒充学校官方格式 */
export const TEMPLATE_NOTE =
  '内置模板按学校下发的四份表格逐行还原（开题报告 / 阶段性记录表 / 中期检查报告 / 结题报告范例）：' +
  '行列、列宽、标签文字、字号字体、页边距都不改动。模板文件由用户提供，本软件为第三方工具，不代表学校授权。';

export const DISCLAIMER_TEXT =
  '研学帮 StudyMate 为个人开发的第三方 AI 辅助工具，与福州鼓山中学及其管理部门不存在官方隶属、授权、合作或背书关系。本软件不代表学校、教师或教育主管部门立场。';

export const AI_NOTICE_TEXT =
  'AI 生成内容可能存在错误、遗漏、过时信息或不准确引用。用户应核实资料来源，并对最终使用内容负责。AI 生成报告不代表相关研究活动已经真实开展。';

export const SIMULATED_TEXT =
  '模拟数据、模拟访谈、模拟实验及模拟过程均为虚拟示例，不属于真实研究数据。不得将模拟内容伪装成真实调查、实验或访谈结果。导出时必须保留模拟标识。';

export const LIABILITY_TEXT =
  '本软件不保证生成内容符合学校、指导教师或教育机构的具体要求，不能替代学生独立思考、真实实践、调查研究及教师指导。用户应遵守学校规定、学术诚信和个人信息保护要求，并对最终提交内容负责。';

export const KEY_SECURITY_TEXT =
  'API Key 默认仅保存在本设备，使用 WebCrypto AES-GCM 加密后写入浏览器数据库。桌面版与安卓版在此基础上可接入系统密钥库。' +
  '必须说明：任何能在此页面同源执行的代码（包括恶意浏览器扩展、被注入的脚本或调试器）都可以解密 Key，' +
  '因此前端加密只能降低明文外泄风险，无法抵御本机恶意软件或浏览器调试。请勿在公用电脑上保存 Key。';
