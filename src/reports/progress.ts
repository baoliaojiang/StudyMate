/**
 * 项目进度与报告放行校验
 *
 * 背景：以前记录一篇都没写，也能直接点「AI 起草本节」写中期报告和结题报告，
 * 生成出来的东西跟项目实际进度脱节。这里把「什么时候能写哪份报告」定成纯函数，
 * 报告页、工作流、概览页共用同一套判定，避免三处各写一套。
 *
 * 判定口径（与学校材料顺序一致）：
 * - 开题报告：项目一建立就能写，它本身就是计划。
 * - 中期报告：上学期记录全部写完才能写。学期最后一篇的下一步本来就是「撰写中期报告」。
 * - 结题报告：全项目记录全部写完才能写。
 * - 阶段性记录表：跟着记录走，不受这里的限制。
 *
 * 「写完」= 有实质内容，且不是「尚未开展 / 待补充」这类占位。
 */
import type { Project, RecordPlan, StudyRecord, Term } from '../core/types';
import { hasPlaceholderText, planOf, termOf } from '../core/record-content';

/** 报告类型（与 ReportKind 对齐，但不引字符串联合，便于旧数据） */
export type ReportGateKind = 'proposal' | 'progress' | 'midterm' | 'final' | (string & {});

export interface TermProgress {
  term: Term;
  total: number;
  filled: number;
  confirmed: number;
}

export interface ProjectProgress {
  plan: RecordPlan;
  /** 计划总篇数 */
  total: number;
  /** 已写完的篇数 */
  filled: number;
  /** 已确认真实性的篇数 */
  confirmed: number;
  /** 最后一篇写完的序号，一篇没写为 0 */
  reached: number;
  /** 计划内还没写出实质内容的序号，按从小到大 */
  blankIndexes: number[];
  /** 写了内容但还没勾「真实开展」的序号 */
  unconfirmedIndexes: number[];
  first: TermProgress;
  second: TermProgress;
  /** 现在处在哪一步 */
  stage: 'proposal' | 'first-term' | 'midterm' | 'second-term' | 'final';
}

/** 把序号列成「第 3、5、7 篇」，多了就省略，别把提示撑成一段 */
export function indexList(nums: number[], max = 5): string {
  if (!nums.length) return '';
  const head = nums.slice(0, max).map((n) => `第 ${n} 篇`).join('、');
  return nums.length > max ? `${head} 等 ${nums.length} 篇` : head;
}

export type GateLevel = 'ok' | 'warn' | 'block';

export interface ReportGate {
  kind: ReportGateKind;
  level: GateLevel;
  /** 一句话结论，可直接显示 */
  text: string;
  /** 还差几篇 */
  missing: number;
  /** 补齐入口 */
  where: string;
  progress: ProjectProgress;
}

/**
 * 一篇记录算不算写完。
 * 只写了活动名和时间不算：中期/结题要用的是过程与结论。
 * 占位词（尚未开展 / 待补充 / 暂无）不算内容。
 */
export function recordFilled(r: Partial<StudyRecord>): boolean {
  const body = [r.goal, r.work, r.outputs, r.summary].map((x) => String(x ?? '').trim());
  const real = body.filter((x) => x.length > 0 && !hasPlaceholderText(x));
  if (!real.length) return false;
  // 「本阶段主要研究工作」是小结表的主体，缺了它这一篇实质上是空的
  const work = String(r.work ?? '').trim();
  if (!work || hasPlaceholderText(work)) return false;
  return true;
}

export function projectProgress(project: Project, records: StudyRecord[]): ProjectProgress {
  const plan = planOf(project);
  const list = (records ?? []).slice().sort((a, b) => a.index - b.index);

  const bucket = (term: Term) => {
    // 一律按序号推导学期：旧数据里 term 可能缺失，也可能和序号对不上
    const of = list.filter((r) => termOf(r.index, plan) === term);
    const total = term === 1 ? plan.firstTerm : plan.secondTerm;
    return {
      term,
      total,
      filled: of.filter((r) => recordFilled(r)).length,
      confirmed: of.filter((r) => r.confirmed && recordFilled(r)).length,
    } satisfies TermProgress;
  };

  const first = bucket(1);
  const second = bucket(2);
  const filledRecords = list.filter((r) => recordFilled(r));
  const reached = filledRecords.reduce((max, r) => Math.max(max, r.index), 0);
  const filled = filledRecords.length;
  const confirmed = list.filter((r) => r.confirmed && recordFilled(r)).length;

  // 计划里有、但还没写出实质内容的序号：直接告诉用户缺哪几篇，比只说「还差 3 篇」有用
  const blankIndexes: number[] = [];
  for (let i = 1; i <= plan.total; i += 1) {
    const r = list.find((x) => x.index === i);
    if (!r || !recordFilled(r)) blankIndexes.push(i);
  }

  let stage: ProjectProgress['stage'] = 'proposal';
  if (filled > 0) stage = 'first-term';
  if (first.filled >= first.total && plan.secondTerm > 0) stage = 'midterm';
  if (first.filled >= first.total && second.filled > 0) stage = 'second-term';
  if (filled >= plan.total) stage = 'final';

  return {
    plan,
    total: plan.total,
    filled,
    confirmed,
    reached,
    blankIndexes,
    unconfirmedIndexes: filledRecords.filter((r) => !r.confirmed).map((r) => r.index),
    first,
    second,
    stage,
  };
}

export function reportGate(kind: ReportGateKind, progress: ProjectProgress, pureAi = false): ReportGate {
  const { plan, first, second, filled } = progress;
  const base = { kind, progress };

  if (kind === 'proposal') {
    return { ...base, level: 'ok', text: '开题报告写的是研究计划，随时可以改。', missing: 0, where: '' };
  }
  if (kind === 'progress') {
    return { ...base, level: 'ok', text: '阶段性记录表跟着研究记录走，不受进度限制。', missing: 0, where: '' };
  }
  // 纯 AI 项目本来就没有真实记录，按记录进度卡它没有意义：只提醒，不阻断
  if (pureAi) {
    return {
      ...base,
      level: 'warn',
      text: '这是纯 AI 项目：报告只能按模拟情况写，导出时正文会标「AI 模拟示例」，不得当作真实研究数据提交。',
      missing: 0,
      where: '项目 → 设置',
    };
  }

  if (kind === 'midterm') {
    const missing = Math.max(0, plan.firstTerm - first.filled);
    if (missing > 0) {
      const blanks = progress.blankIndexes.filter((i) => i <= plan.firstTerm);
      return {
        ...base,
        level: 'block',
        text: `中期报告只总结上学期，要等上学期 ${plan.firstTerm} 篇记录写完（现在 ${first.filled}/${plan.firstTerm} 篇，还差 ${missing} 篇：${indexList(blanks)}）。`,
        missing,
        where: '项目 → 研究记录 → 上学期',
      };
    }
    if (first.confirmed < plan.firstTerm) {
      const un = progress.unconfirmedIndexes.filter((i) => i <= plan.firstTerm);
      return {
        ...base,
        level: 'warn',
        text: `上学期记录已写满，但还有 ${plan.firstTerm - first.confirmed} 篇没确认真实性（${indexList(un)}），写进去的过程只能当参考。`,
        missing: 0,
        where: '项目 → 研究记录（勾选「真实开展」）',
      };
    }
    return { ...base, level: 'ok', text: '上学期记录已写完并确认，可以写中期报告。', missing: 0, where: '' };
  }

  if (kind === 'final') {
    const missing = Math.max(0, plan.total - filled);
    if (missing > 0) {
      const secondLeft = Math.max(0, plan.secondTerm - second.filled);
      const blanks = progress.blankIndexes;
      return {
        ...base,
        level: 'block',
        text: secondLeft > 0
          ? `结题报告要覆盖整个研究周期，要等全部 ${plan.total} 篇记录写完（现在 ${filled}/${plan.total} 篇，下学期还差 ${secondLeft} 篇：${indexList(blanks.filter((i) => i > plan.firstTerm))}）。`
          : `结题报告要覆盖整个研究周期，要等全部 ${plan.total} 篇记录写完（现在 ${filled}/${plan.total} 篇，还差 ${indexList(blanks)}）。`,
        missing,
        where: '项目 → 研究记录',
      };
    }
    if (progress.confirmed < plan.total) {
      return {
        ...base,
        level: 'warn',
        text: `记录已写满，但还有 ${plan.total - progress.confirmed} 篇没确认真实性（${indexList(progress.unconfirmedIndexes)}），结论部分要自己再核一遍。`,
        missing: 0,
        where: '项目 → 研究记录（勾选「真实开展」）',
      };
    }
    return { ...base, level: 'ok', text: '全部记录已写完并确认，可以写结题报告。', missing: 0, where: '' };
  }

  return { ...base, level: 'ok', text: '', missing: 0, where: '' };
}

/** 给模型的进度描述：让它知道现在处在哪一段，别把没发生的事写成已完成 */
export function progressText(progress: ProjectProgress): string {
  const { plan, first, second, filled, stage } = progress;
  const stageLabel: Record<ProjectProgress['stage'], string> = {
    proposal: '开题阶段：记录尚未开始，一切按计划写',
    'first-term': '上学期进行中：记录还在逐篇补',
    midterm: '上学期已收尾，进入中期阶段',
    'second-term': '下学期进行中',
    final: '两个学期都已收尾，进入结题阶段',
  };
  return [
    '【项目进度】',
    `当前阶段：${stageLabel[stage]}`,
    `研究记录：共 ${plan.total} 篇（上学期 ${plan.firstTerm} / 下学期 ${plan.secondTerm}），已写完 ${filled} 篇；上学期 ${first.filled}/${first.total}，下学期 ${second.filled}/${second.total}。`,
    '写作时按这个进度落笔：还没发生的阶段只能写成计划，不要写进「已完成的工作」。',
  ].join('\n');
}

/** 概览页用的一句话进度，不需要图表 */
export function progressSummary(progress: ProjectProgress): string {
  const { plan, filled, stage } = progress;
  const stageLabel: Record<ProjectProgress['stage'], string> = {
    proposal: '还没开始写记录',
    'first-term': '上学期记录进行中',
    midterm: '可以做中期报告',
    'second-term': '下学期记录进行中',
    final: '记录写完，可以做结题',
  };
  return `记录 ${filled}/${plan.total} 篇 · ${stageLabel[stage]}`;
}
