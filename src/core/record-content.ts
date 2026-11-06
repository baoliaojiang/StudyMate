/**
 * 过程记录的「承上启下」规则
 *
 * 用户口径（优先于报告那套「缺材料就留白」）：过程性记录默认每一栏都要写上，
 * 不许出现「尚未开展」「待补充」「暂无」这类占位内容，尤其是第一篇。
 *
 * 三条硬约束：
 * 1. 写第 N 篇只参考 1..N-1 篇；本篇的「本阶段主要研究工作」必须落实
 *    上一篇「下阶段研究工作安排」里定下的那件事。
 * 2. 上学期最后一篇的下一步收尾到「撰写中期报告」；
 *    全项目最后一篇收尾到「撰写结题报告」。这两句由代码兜底，不靠模型自觉。
 * 3. 生成结果统一过 repairRecordDraft()：空栏、占位栏都会被补成实质内容。
 *
 * 本文件全是纯函数，便于单测，不碰数据库、不碰网络。
 */
import type { Project, RecordPlan, StudyRecord, Term } from './types';
import { DEFAULT_RECORD_PLAN } from './types';

/** 只用到三个数字的场景（批量提示词等）不必持有完整 Project */
export type RecordPlanLike = Pick<RecordPlan, 'total' | 'firstTerm' | 'secondTerm'>;

export interface RecordDraftFields {
  activityName?: string;
  stageName?: string;
  goal?: string;
  work?: string;
  materials?: string;
  outputs?: string;
  summary?: string;
  nextPlan?: string;
  recorder?: string;
}

export const RECORD_BODY_KEYS = [
  'goal',
  'work',
  'materials',
  'outputs',
  'summary',
  'nextPlan',
] as const;

/** 过程记录里出现这些词就当作「没写」，直接重写这一栏 */
export const PLACEHOLDER_WORDS = [
  '尚未开展',
  '未开展',
  '没有开展',
  '尚未进行',
  '待补充',
  '待填',
  '暂缺',
  '暂无',
  '本节尚未填写',
  '尚未填写',
  '待核实',
  '需核实',
  '暂无阶段性成果',
  '尚无',
];

const PLACEHOLDER_RE = new RegExp(PLACEHOLDER_WORDS.join('|'), 'g');

export function hasPlaceholderText(text: string): boolean {
  PLACEHOLDER_RE.lastIndex = 0;
  return PLACEHOLDER_RE.test(String(text ?? ''));
}

/** 学校表格的六个格子；materials 只存档，不进表格 */
export const RECORD_CONTENT_RULE = [
  '过程记录写作规则（不可违背）：',
  '- 每一个格子都要写具体内容，不能留空，也不能只写一句话带过。',
  '- 严禁出现「尚未开展」「待补充」「暂无」「未开展」「待填」「暂缺」「尚无」「本节尚未填写」，以及任何表示本阶段什么都没做的句子。',
  '- 这是一份「已经做完」的工作小结：写清这次实际做了什么、怎么做的、用了什么材料、得到什么产出、小结与下一步。',
  '- 可以围绕课题主题与前面几篇记录合理组织活动过程；但不得编造具体数字（份数、人数、百分比）、访谈原话、文献、作者、DOI 或网址。',
  '- 确实需要具体数据的地方写「______」留出位置，句子本身要完整，不能整栏只写占位。',
  '- 不要写「模拟」「示例」「虚拟」「假设」「此处为演示」这类自我说明，也不要在括号里解释自己是怎么编的；读者看到的应当是一份真实的工作记录。',
  '- 语言朴素，中学生口吻，不写成公文；不要出现「用户」「学生」「我先」「接下来」这类自述视角。',
].join('\n');

export function planOf(project: Project): RecordPlan {
  const p = project.recordPlan ?? DEFAULT_RECORD_PLAN;
  const total = Math.max(1, Math.floor(p.total || DEFAULT_RECORD_PLAN.total));
  const firstTerm = Math.min(total, Math.max(1, Math.floor(p.firstTerm || DEFAULT_RECORD_PLAN.firstTerm)));
  return { total, firstTerm, secondTerm: total - firstTerm };
}

/** 记录人默认取组长，其次第一位成员；旧项目没成员时给一个中性署名 */
export function recorderOf(project: Project): string {
  const members = project.members ?? [];
  const leader = members.find((m) => m.role === 'leader' && m.name?.trim());
  if (leader) return leader.name.trim();
  const first = members.find((m) => m.name?.trim());
  return first ? first.name.trim() : '课题组成员';
}

export function termOf(index: number, plan: RecordPlan): Term {
  return index <= plan.firstTerm ? 1 : 2;
}

/** 学期末的固定收尾；不是学期末返回 null */
export function closingNextPlan(index: number, plan: RecordPlan): string | null {
  if (index === plan.firstTerm && index < plan.total) {
    return '整理上学期的研究记录与阶段性成果，汇总问卷、访谈和资料清单，撰写中期报告，并按指导教师意见调整下学期的研究安排。';
  }
  if (index === plan.total) {
    return '汇总两个学期的全部研究记录、数据与结论，整理成果与附件，撰写结题报告并准备答辩材料。';
  }
  return null;
}

/** 把一篇记录压成给模型看的一行，旧数据缺字段也不会崩 */
export function briefRecord(r: Partial<StudyRecord> & { index: number }): string {
  const parts = [`第 ${r.index} 篇`];
  if (r.activityName?.trim()) parts.push(`活动：${r.activityName.trim()}`);
  if (r.goal?.trim()) parts.push(`目标：${r.goal.trim()}`);
  if (r.work?.trim()) parts.push(`做了：${r.work.trim()}`);
  if (r.outputs?.trim()) parts.push(`产出：${r.outputs.trim()}`);
  if (r.summary?.trim()) parts.push(`小结：${r.summary.trim()}`);
  if (r.nextPlan?.trim()) parts.push(`下一步：${r.nextPlan.trim()}`);
  return `- ${parts.join('；')}`;
}

function isFilled(r: Partial<StudyRecord> & { index: number }): boolean {
  return Boolean(r.work?.trim() || r.summary?.trim() || r.goal?.trim() || r.outputs?.trim());
}

export interface RecordFlow {
  index: number;
  term: Term;
  plan: RecordPlan;
  prevLines: string;
  lastNextPlan: string;
  lastIndex: number;
  isFirst: boolean;
  isFirstTermEnd: boolean;
  isFinalEnd: boolean;
  expectedNextPlan: string | null;
  closingText: string;
  recorder: string;
  scopeText: string;
  topic: string;
}

/**
 * 生成第 index 篇时能看见的上下文：只看前面已经写过的记录。
 * 后面的记录属于「还没发生」，绝不能喂给模型。
 */
export function buildRecordFlow(project: Project, records: StudyRecord[], index: number): RecordFlow {
  const plan = planOf(project);
  const term = termOf(index, plan);
  const prev = (records ?? [])
    .filter((r) => r.index < index && isFilled(r))
    .sort((a, b) => a.index - b.index);
  const prevLines = prev.map((r) => briefRecord(r)).join('\n');
  const last = prev[prev.length - 1];
  const lastNextPlan = (last?.nextPlan ?? '').trim();
  const expectedNextPlan = closingNextPlan(index, plan);
  const isFirstTermEnd = index === plan.firstTerm && index < plan.total;
  const isFinalEnd = index === plan.total;

  let closingText = '';
  if (expectedNextPlan) {
    closingText =
      `这是${isFirstTermEnd ? '上学期' : '整个项目'}最后一篇，「下阶段研究工作安排」必须收尾到` +
      `「${isFirstTermEnd ? '撰写中期报告' : '撰写结题报告'}」：` +
      `写清楚要汇总哪些材料、要写哪份报告，原句大意写成「${expectedNextPlan}」。`;
  }

  const scopeText =
    `本阶段属于${term === 1 ? '上学期' : '下学期'}，全项目共 ${plan.total} 篇` +
    `（上学期 ${plan.firstTerm} 篇 / 下学期 ${plan.secondTerm} 篇），当前是第 ${index} 篇。`;

  return {
    index,
    term,
    plan,
    prevLines,
    lastNextPlan,
    lastIndex: last?.index ?? 0,
    isFirst: prev.length === 0,
    isFirstTermEnd,
    isFinalEnd,
    expectedNextPlan,
    closingText,
    recorder: recorderOf(project),
    scopeText,
    topic: project.topic?.trim() || '本课题',
  };
}

/** 单篇生成的统一提示词：列表页、独立编辑页、批量链路都用它 */
export function recordPrompt(
  flow: RecordFlow,
  current: RecordDraftFields,
  project: Pick<Project, 'grade' | 'modes' | 'members' | 'startDate' | 'endDate'>,
  keys: string[] = ['goal', 'work', 'outputs', 'summary', 'nextPlan'],
): string {
  const members = (project.members ?? []).map((m) => m.name).filter(Boolean).join('、');
  const fact = (v: string | undefined) => (v?.trim() ? v.trim() : '（未填）');
  const schema: Record<string, string> = {};
  for (const k of keys) schema[k] = '';
  const schemaText = JSON.stringify(schema);

  const handoff = flow.lastNextPlan
    ? [
        `上一篇（第 ${flow.lastIndex} 篇）写下的「下阶段研究工作安排」是：${flow.lastNextPlan}`,
        '本篇的「本阶段主要研究工作」必须就是落实这件事：写清楚具体怎么做的、谁做了哪部分、用了什么办法，不要另起炉灶，也不要重复上一篇已经做完的事。',
        '本篇结尾的「下阶段研究工作安排」再给出新的、具体可执行的一步。',
      ].join('\n')
    : '这是第一篇：写课题启动阶段实际做的事，例如明确研究问题、分工、查资料、设计问卷或访谈提纲、确定后续步骤。不要写「还没开始」。';

  return [
    `请为「研究记录 第 ${flow.index} 篇」写一份完整的工作小结。`,
    '',
    `课题：${flow.topic}；年级：${project.grade || '未填'}；研究方式：${(project.modes ?? []).join('、') || '未填'}；成员：${members || '未填'}。`,
    `研究周期：${project.startDate || '未填'} 至 ${project.endDate || '未填'}；记录人：${flow.recorder}。`,
    flow.scopeText,
    '',
    '【前面已经写完的记录（只用于承接，不要重复它们的活动）】',
    flow.prevLines || '- 无（这是第一篇）',
    '',
    '【承上启下（硬要求）】',
    handoff,
    flow.closingText ? `\n【学期收尾（硬要求）】\n${flow.closingText}` : '',
    '',
    '【用户已填的事实（只能用这些，不要改）】',
    `- 活动名称：${fact(current.activityName)}`,
    `- 阶段名称：${fact(current.stageName)}`,
    `- 目标：${fact(current.goal)}`,
    `- 工作：${fact(current.work)}`,
    `- 成果：${fact(current.outputs)}`,
    `- 小结：${fact(current.summary)}`,
    '',
    '这是学校《课题阶段性工作小结记录表》，六个格子是「起迄时间 / 本阶段主要研究目标 / 本阶段主要研究工作 / 阶段性成果 / 工作小结 / 下阶段研究工作安排」。',
    `只输出 JSON（不要代码块、不要解释），键必须是：${schemaText}`,
    '',
    RECORD_CONTENT_RULE,
    '',
    '只输出 JSON，第一字符就是 {。',
  ].join('\n');
}

/** 兜底内容所需的最小上下文：批量链路没有完整 Project 也能用 */
export interface FallbackCtx {
  topic: string;
  index: number;
  isFirst: boolean;
  lastNextPlan: string;
  expectedNextPlan: string | null;
}

export function fallbackFor(key: string, flow: RecordFlow): string {
  return fallbackText(key, {
    topic: flow.topic,
    index: flow.index,
    isFirst: flow.isFirst,
    lastNextPlan: flow.lastNextPlan,
    expectedNextPlan: flow.expectedNextPlan,
  });
}

/** 兜底内容：不编数字，但每栏都有能交上去的实质描述 */
export function fallbackText(key: string, c: FallbackCtx): string {
  const topic = c.topic;
  const handoff = c.lastNextPlan
    ? `按上一篇定下的安排，${c.lastNextPlan.replace(/[。；;]$/, '')}`
    : `小组围绕「${topic}」明确研究问题、分工与资料来源，确定本学期的推进步骤`;
  switch (key) {
    case 'activityName':
      return c.isFirst ? '课题启动与资料准备' : `第 ${c.index} 阶段研究与资料整理`;
    case 'stageName':
      return `第 ${c.index} 阶段`;
    case 'goal':
      return `围绕「${topic}」完成本阶段的资料整理与分工落实，把上一篇定下的任务落到具体做法上，并明确本阶段要留下的记录与产出。`;
    case 'work':
      return `${handoff}。小组成员按各自分工查阅并摘记与课题相关的资料，讨论记录口径，整理出需要继续追查的问题清单，并把本次讨论的过程与结果写进记录表。`;
    case 'materials':
      return '课题资料摘记、小组分工表、讨论记录本、问卷或访谈提纲（按学校模板整理）。';
    case 'outputs':
      return '形成本阶段的工作记录、资料摘记与问题清单，明确下一阶段要补的材料和负责人。';
    case 'summary':
      return '本阶段把计划落到了具体做法上，资料来源与分工都已明确，记录内容完整，后续按记录里写下的安排继续推进。';
    case 'nextPlan':
      return c.expectedNextPlan ??
        `继续围绕「${topic}」收集与核对资料，按分工完成下一阶段的任务，并把过程与发现写进下一篇记录。`;
    default:
      return `围绕「${topic}」完成本阶段的研究工作并做好记录。`;
  }
}

export interface RepairResult {
  fields: RecordDraftFields;
  repaired: string[];
  hits: string[];
}

/**
 * 生成结果的最后一道闸：空栏、占位栏一律补成实质内容；
 * 学期末的 nextPlan 强制覆盖成收尾句，保证「顺利收尾」不靠模型自觉。
 */
export function repairRecordDraft(input: RecordDraftFields, flow: RecordFlow): RepairResult {
  const fields: RecordDraftFields = { ...input };
  const repaired: string[] = [];
  const hits: string[] = [];

  for (const k of RECORD_BODY_KEYS) {
    const v = typeof fields[k] === 'string' ? (fields[k] as string).trim() : '';
    const target = fields as unknown as Record<string, string>;
    if (!v || hasPlaceholderText(v)) {
      if (v && hasPlaceholderText(v)) hits.push(k);
      target[k] = fallbackFor(k, flow);
      repaired.push(k);
    } else {
      target[k] = v;
    }
  }

  if (flow.expectedNextPlan) {
    if ((fields.nextPlan ?? '').trim() !== flow.expectedNextPlan) repaired.push('nextPlan');
    fields.nextPlan = flow.expectedNextPlan;
  }

  if (!fields.activityName?.trim()) {
    fields.activityName = fallbackFor('activityName', flow);
    repaired.push('activityName');
  }
  if (!fields.stageName?.trim()) {
    fields.stageName = fallbackFor('stageName', flow);
    repaired.push('stageName');
  }
  if (!fields.recorder?.trim()) fields.recorder = flow.recorder;

  return { fields, repaired, hits };
}

/** 给批量链路用：把前序记录压成提示词里的一段 */
export function batchHistory(
  records: Array<Partial<StudyRecord> & { index: number }>,
  beforeIndex: number,
  limit = 6,
): string {
  const prev = (records ?? [])
    .filter((r) => r.index < beforeIndex && isFilled(r))
    .sort((a, b) => a.index - b.index)
    .slice(-limit);
  if (!prev.length) return '- 前面还没有写好的记录，本次从课题启动写起。';
  return prev.map((r) => briefRecord(r)).join('\n');
}

/** 给报告上下文用：中期只看上学期，结题看全项目 */
export function recordsForReport(kind: string, records: StudyRecord[], plan?: RecordPlan): StudyRecord[] {
  const p = plan ?? DEFAULT_RECORD_PLAN;
  const all = (records ?? []).slice().sort((a, b) => a.index - b.index);
  if (kind === 'midterm') return all.filter((r) => r.term === 1 || r.index <= p.firstTerm);
  return all;
}

export function reportScopeText(kind: string, plan: RecordPlan, count: number): string {
  if (kind === 'midterm') {
    return `【本报告范围】中期报告只总结上学期（第 1～${plan.firstTerm} 篇，共 ${count} 篇）的研究工作与阶段性成果；下学期的内容属于后续计划，不要写进本报告的「已完成」部分。`;
  }
  if (kind === 'final') {
    return `【本报告范围】结题报告覆盖整个研究周期：上学期与下学期共 ${count} 篇记录都要纳入，按时间顺序写清研究过程、结果、结论与反思。`;
  }
  if (kind === 'proposal') {
    return '【本报告范围】开题报告写研究计划：背景、目标、方法、分工与预期成果；不要把尚未开展的事写成已经完成。';
  }
  return '';
}
