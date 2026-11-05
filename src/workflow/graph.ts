/**
 * 标准研究工作流
 *
 * 顺序按「分析课题 → 确认 → 找资料 → 确认 → 设计 → 确认 → 分工 → 确认 →
 * 写开题 → 审核 → 确认 → 真实记录 → 中期 → 审核 → 结题 → 总审 → 导出」，
 * 和学校要求的四份报告节奏一致。
 *
 * 三个原则写死在定义里，不靠提示词提醒：
 * 1. 每个「确认」都是 gate，不点就不往下走；
 * 2. 「真实过程记录」是 guard：没有已确认的真实活动，这一步永远不会生成内容；
 * 3. 导出是 manual：只有人点了才产出文件，工作流不偷偷下载。
 */
import type {
  Project,
  Report,
  ReportKind,
  StudyRecord,
  WorkflowDef,
  WorkflowScope,
  WorkflowStepDef,
} from '../core/types';

export const PHASE_LABEL: Record<WorkflowStepDef['phase'], string> = {
  plan: '分析与计划',
  search: '资料',
  design: '设计与分工',
  write: '报告撰写',
  audit: '审核',
  deliver: '交付',
};

export const PHASE_ORDER: WorkflowStepDef['phase'][] = ['plan', 'search', 'design', 'write', 'audit', 'deliver'];

export const SCOPE_LABEL: Record<WorkflowScope, string> = {
  report: '当前报告生成',
  stage: '当前阶段自动完成',
  project: '全项目推进',
};

export const SCOPE_NOTE: Record<WorkflowScope, string> = {
  report: '只做当前这份报告的写作与审核，中间的确认门照常停',
  stage: '把当前阶段一次做完，阶段内的确认门自动通过并记日志',
  project: '从第一步走到导出，每个确认门都停下来等你点',
};

export const WORKFLOW_ID = 'default';

const step = (s: WorkflowStepDef): WorkflowStepDef => s;

export const DEFAULT_STEPS: WorkflowStepDef[] = [
  step({
    id: 'analyze',
    name: '分析课题',
    kind: 'agent',
    phase: 'plan',
    agentId: 'project-planner',
    desc: '看教师要求和课题现状，判断该用什么方法、分几个阶段',
    enabled: true,
  }),
  step({
    id: 'confirm-plan',
    name: '确认计划',
    kind: 'gate',
    phase: 'plan',
    desc: '计划是你自己的，AI 只是给建议。确认后才继续',
    requires: '阅读上一步的计划，认同后再继续',
    enabled: true,
  }),
  step({
    id: 'search',
    name: '搜索资料',
    kind: 'agent',
    phase: 'search',
    agentId: 'source-researcher',
    desc: '用已启用的检索服务找文献与网页，结果先作为候选，不自动入库',
    enabled: true,
  }),
  step({
    id: 'confirm-sources',
    name: '确认来源',
    kind: 'gate',
    phase: 'search',
    desc: '逐条看候选来源，只把确实要引用的加入来源表',
    requires: '至少确认一条来源，或明确跳过',
    enabled: true,
  }),
  step({
    id: 'design',
    name: '研究设计',
    kind: 'agent',
    phase: 'design',
    agentId: 'research-designer',
    desc: '定方法：问卷、访谈、实验或观察，给出可直接用的工具',
    enabled: true,
  }),
  step({
    id: 'confirm-method',
    name: '确认方法',
    kind: 'gate',
    phase: 'design',
    desc: '方法一旦定了，后面的记录与结论都要按它来',
    requires: '确认方法可执行（样本量、时间、安全）',
    enabled: true,
  }),
  step({
    id: 'assign',
    name: '分工',
    kind: 'agent',
    phase: 'design',
    agentId: 'project-planner',
    desc: '把阶段任务分到成员头上，写清谁做什么、什么时候交',
    enabled: true,
  }),
  step({
    id: 'confirm-assign',
    name: '确认分工',
    kind: 'gate',
    phase: 'design',
    desc: '分工要成员本人认可，软件不替你安排人',
    requires: '成员都清楚自己的任务',
    enabled: true,
  }),
  step({
    id: 'proposal-write',
    name: '立项报告',
    kind: 'agent',
    phase: 'write',
    report: 'proposal',
    agentId: 'report-writer',
    desc: '按学校表格逐节写开题报告，缺材料的地方写「待补充」',
    enabled: true,
  }),
  step({
    id: 'proposal-review',
    name: '开题审核',
    kind: 'agent',
    phase: 'audit',
    report: 'proposal',
    agentId: 'content-reviewer',
    desc: '查有没有把没做的事写成已完成，结论有没有依据',
    enabled: true,
  }),
  step({
    id: 'proposal-confirm',
    name: '确认开题',
    kind: 'gate',
    phase: 'audit',
    report: 'proposal',
    desc: '教师看过、你自己也核过，再标为已确认',
    requires: '逐节核对事实后再确认',
    enabled: true,
  }),
  step({
    id: 'records-draft-t1',
    name: '上学期过程记录',
    kind: 'records',
    phase: 'write',
    term: 1,
    agentId: 'project-planner',
    desc: '按计划分批起草上学期的活动记录：一次只写几篇，写完一批存一批，跑不完下次接着补',
    enabled: true,
  }),
  step({
    id: 'records-confirm-t1',
    name: '确认上学期记录',
    kind: 'gate',
    phase: 'write',
    term: 1,
    desc: '草稿是「该做的事」，不是已经发生的事。逐篇改成真实时间、真实参与人、真实做法，再点确认',
    requires: '每篇核对时间、参与人、做了什么、拿到什么；没做的改成没做，别硬凑',
    enabled: true,
  }),
  step({
    id: 'records-guard-t1',
    name: '核对上学期记录',
    kind: 'guard',
    phase: 'write',
    term: 1,
    desc: '检查上学期的记录是否真实、是否已确认。没有就不进中期',
    requires: '上学期至少一篇「真实开展」且已确认的研究记录',
    enabled: true,
  }),
  step({
    id: 'midterm-write',
    name: '中期报告',
    kind: 'agent',
    phase: 'write',
    report: 'midterm',
    agentId: 'report-writer',
    desc: '对照计划写进度、问题与下一阶段安排，只写已发生的',
    enabled: true,
  }),
  step({
    id: 'midterm-review',
    name: '中期审核',
    kind: 'agent',
    phase: 'audit',
    report: 'midterm',
    agentId: 'format-checker',
    desc: '查章节、字数、图表编号与模拟内容标识',
    enabled: true,
  }),
  step({
    id: 'records-draft-t2',
    name: '下学期过程记录',
    kind: 'records',
    phase: 'write',
    term: 2,
    agentId: 'project-planner',
    desc: '按计划分批起草下学期的活动记录，同样一次只写几篇',
    enabled: true,
  }),
  step({
    id: 'records-confirm-t2',
    name: '确认下学期记录',
    kind: 'gate',
    phase: 'write',
    term: 2,
    desc: '逐篇改成真实发生的事，确认后才进结题',
    requires: '每篇核对时间、参与人、做了什么、拿到什么',
    enabled: true,
  }),
  step({
    id: 'records-guard-t2',
    name: '核对下学期记录',
    kind: 'guard',
    phase: 'write',
    term: 2,
    desc: '检查下学期的记录是否真实、是否已确认。没有就不进结题',
    requires: '下学期至少一篇「真实开展」且已确认的研究记录',
    enabled: true,
  }),
  step({
    id: 'final-write',
    name: '结题报告',
    kind: 'agent',
    phase: 'write',
    report: 'final',
    agentId: 'report-writer',
    desc: '汇总过程、结果、结论与反思，与开题、中期保持一致',
    enabled: true,
  }),
  step({
    id: 'final-review',
    name: '最终审核',
    kind: 'agent',
    phase: 'audit',
    report: 'final',
    agentId: 'final-auditor',
    desc: '四份报告横向对照：主题、成员、时间线、数据有没有互相矛盾',
    enabled: true,
  }),
  step({
    id: 'export',
    name: '导出 DOCX',
    kind: 'manual',
    phase: 'deliver',
    report: 'final',
    desc: '按学校表格导出，交之前自己再读一遍',
    requires: '在工作流面板点「导出」才会生成文件',
    enabled: true,
  }),
];

export function defaultWorkflow(): WorkflowDef {
  return {
    id: WORKFLOW_ID,
    name: '标准研究流程',
    desc: '从分析课题到导出 DOCX，共 22 步，含 7 个确认门与 2 个记录守卫',
    steps: DEFAULT_STEPS.map((s) => ({ ...s })),
    builtin: true,
    updatedAt: Date.now(),
  };
}

/** 每一步依赖的数据是否已经完成，用于「当前阶段自动完成」从哪开始 */
export interface StepProgressContext {
  project: Project;
  reports: Report[];
  records: StudyRecord[];
}

export function stepCompleted(id: string, ctx: StepProgressContext): boolean {
  const reportOf = (kind: ReportKind) => ctx.reports.find((r) => r.kind === kind);
  const hasBody = (kind: ReportKind) => !!reportOf(kind)?.sections.some((s) => s.body.trim());
  const confirmed = (kind: ReportKind) => reportOf(kind)?.status === 'confirmed';
  const realRecords = ctx.records.filter((r) => r.confirmed && r.sourceType === 'real');

  switch (id) {
    case 'analyze':
    case 'confirm-plan':
      return hasBody('proposal');
    case 'search':
    case 'confirm-sources':
      return false; // 来源可以随时补，不视为已完成
    case 'design':
    case 'confirm-method':
      return hasBody('proposal');
    case 'assign':
    case 'confirm-assign':
      return ctx.project.members.some((m) => !!m.duty?.trim());
    case 'proposal-write':
    case 'proposal-review':
    case 'proposal-confirm':
      return confirmed('proposal');
    case 'records-draft-t1':
      return ctx.records.some((r) => r.term === 1);
    case 'records-draft-t2':
      return ctx.records.some((r) => r.term === 2);
    case 'records-confirm-t1':
    case 'records-guard-t1':
      return realRecords.some((r) => r.term === 1);
    case 'records-confirm-t2':
    case 'records-guard-t2':
      return realRecords.some((r) => r.term === 2);
    case 'records-guard':
      return realRecords.length > 0;
    case 'midterm-write':
    case 'midterm-review':
      return confirmed('midterm');
    case 'final-write':
    case 'final-review':
      return confirmed('final');
    case 'export':
      return false;
    default:
      return false;
  }
}

/** 当前该写哪份报告：开题未确认 → 中期未确认 → 结题 */
export function currentReportKind(reports: Report[]): ReportKind {
  const status = (k: ReportKind) => reports.find((r) => r.kind === k)?.status ?? 'not-started';
  if (status('proposal') !== 'confirmed') return 'proposal';
  if (status('midterm') !== 'confirmed') return 'midterm';
  return 'final';
}

/**
 * 三种范围实际要跑哪些步骤。
 * - report：当前报告的写作 / 审核 / 确认 / 导出
 * - stage：从第一个未完成步骤起，跑完它所在的整个阶段
 * - project：全部启用步骤
 */
export function selectSteps(
  def: WorkflowDef,
  scope: WorkflowScope,
  ctx?: StepProgressContext,
): WorkflowStepDef[] {
  const enabled = def.steps.filter((s) => s.enabled !== false);
  if (scope === 'project') return enabled;

  if (scope === 'report') {
    if (!ctx) return enabled.filter((s) => !!s.report);
    const kind = currentReportKind(ctx.reports);
    return enabled.filter((s) => s.report === kind);
  }

  // stage
  if (!ctx) {
    const firstPhase = enabled[0]?.phase;
    return enabled.filter((s) => s.phase === firstPhase);
  }
  const startIdx = enabled.findIndex((s) => !stepCompleted(s.id, ctx));
  if (startIdx < 0) return enabled.filter((s) => s.phase === 'deliver');
  const phase = enabled[startIdx].phase;
  return enabled.filter((s) => s.phase === phase);
}

/** 需不需要停下来等人（stage 范围里中间的门自动通过，最终那道仍然停） */
export function gateNeedsConfirm(scope: WorkflowScope, total: number, index: number): boolean {
  if (scope !== 'stage') return true;
  return index === total - 1;
}
