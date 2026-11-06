/**
 * 报告生成的事实底座
 *
 * 两条硬规则：
 * 1. 只把「已经存在的真实材料」喂给模型：项目字段、研究记录、来源、数据集。
 * 2. 缺什么就列出来，让模型提问或写「待补充」，不允许它用常识补齐数据。
 *
 * 唯一的例外是用户主动关闭留白（GapMode = 'fill'）：允许把篇幅写满，
 * 但推断处必须标注、具体数据必须留横线、正文末尾必须带免责声明。
 */

import type {
  Dataset,
  Project,
  ReportKind,
  Source,
  StudyRecord,
} from '../core/types';
import { SOURCE_TYPE_LABEL } from '../core/types';
import { planOf, recorderOf, recordsForReport, reportScopeText } from '../core/record-content';

export interface ReportContext {
  project: Project;
  records: StudyRecord[];
  sources: Source[];
  datasets: Dataset[];
}

export interface Gap {
  /** block：没有它就不能写；warn：能写但要标注 */
  level: 'block' | 'warn';
  text: string;
  /** 去哪补 */
  where: string;
}

export const NO_FABRICATION_RULE = [
  '硬性规则（不可违背）：',
  '- 只使用用户提供的项目信息、研究记录、来源与数据集里出现的事实。',
  '- 缺少必要信息时，不要猜测、不要编造数字、访谈、实验结果或文献；在该处写「待补充：<缺什么>」，并在正文末尾用一行列出需要用户补充的条目。',
  '- 不得把计划中的活动写成已完成；未开展就写「尚未开展」。',
  '- 不得虚构引用。没有来源就不写参考文献，不能拼凑作者与年份。',
  '- 报告结构沿用学校下发的表格，不得改动章节名称与顺序。',
].join('\n');

/**
 * 写作模式。
 * - strict：默认。缺事实就写「待补充」，一个字都不替用户编。
 * - fill：用户主动关闭留白后生效。允许把篇幅写满，但每一处推断都要标出来，
 *   具体数据、人名、日期、访谈原话仍然只能留横线，结尾必须带免责声明。
 */
export type GapMode = 'strict' | 'fill';

export const FILL_DISCLAIMER =
  '免责声明：本节含 AI 补写内容。标注「需核实」的表述为推断，横线处为缺失的真实数据，须由课题组核对后替换，不得直接提交。';

/** 补全模式下的写作规则：放宽的是「篇幅」，不是「真实性」 */
export const FILL_MODE_RULE = [
  '写作模式：补全（用户已关闭「待补充」留白，允许把本节写满）。放宽的只有篇幅，事实边界不变：',
  '- 可以基于课题常识、研究设计与既有材料展开论述、补充过渡与分析性表述，句末统一加「（推断，需核实）」。',
  '- 具体数字、百分比、样本量、人名、日期、访谈原话、实验现象、文献出处，一律写成「______（需补充实测数据）」，不得给出看起来合理的数值。',
  '- 不得虚构参考文献、作者、DOI、期刊或链接；没有来源就不写参考文献。',
  '- 不得把计划写成已完成，不得虚构活动名称、参与人或地点。',
  `- 正文最后另起一段，原文照抄这句：${FILL_DISCLAIMER}`,
].join('\n');


export function recordLine(r: StudyRecord, withIndex = true): string {
  const parts: string[] = [];
  const head = withIndex ? `第 ${r.index} 篇` : '';
  if (head) parts.push(head);
  if (r.activityName) parts.push(`活动名称：${r.activityName}`);
  if (r.startDate || r.endDate) parts.push(`时间：${r.startDate || '?'} 至 ${r.endDate || '?'}`);
  if (r.place) parts.push(`地点：${r.place}`);
  // 旧备份 / 旧库里的记录可能没有这两个数组，别让一行脏数据把整份上下文搞崩
  const participants = Array.isArray(r.participants) ? r.participants : [];
  const attachments = Array.isArray(r.attachments) ? r.attachments : [];
  if (participants.length) parts.push(`参与：${participants.join('、')}`);
  if (r.recorder) parts.push(`记录人：${r.recorder}`);
  if (r.goal) parts.push(`本阶段主要研究目标：${r.goal}`);
  if (r.work) parts.push(`本阶段主要研究工作：${r.work}`);
  if (r.materials) parts.push(`材料：${r.materials}`);
  if (r.outputs) parts.push(`阶段性成果：${r.outputs}`);
  if (r.summary) parts.push(`工作小结：${r.summary}`);
  if (r.nextPlan) parts.push(`下阶段研究工作安排：${r.nextPlan}`);
  if (attachments.length) parts.push(`附件：${attachments.map((a) => a.name).join('、')}`);
  parts.push(`来源类型：${SOURCE_TYPE_LABEL[r.sourceType]}${r.confirmed ? '（已确认真实开展）' : '（未确认真实性）'}`);
  return `- ${parts.join('；')}`;
}

/**
 * 拼成可直接塞进提示词的事实清单。
 *
 * kind 决定能看到哪些记录：中期报告只总结上学期，结题报告覆盖整个项目，
 * 开题报告看到全量但明确写着「不要把未开展写成已完成」。
 * 不传 kind 时保持旧行为（全量），避免影响其它调用方与既有测试。
 */
export function contextText(ctx: ReportContext, kind?: ReportKind): string {
  const { project, records, sources, datasets } = ctx;
  const plan = planOf(project);
  const scoped = kind ? recordsForReport(kind, records, plan) : records;
  const lines: string[] = [];
  lines.push('【项目基本信息】');
  lines.push(
    `课题：${project.topic || '未填写'}；学校：${project.school || '未填写'}；年级班级：${project.grade || ''} ${project.className || ''}；小组：${project.groupName || '未填写'}；指导教师：${project.teacher || '未填写'}`,
  );
  lines.push(
    `研究周期：${project.startDate || '未填'} 至 ${project.endDate || '未填'}；研究方式：${project.modes.join('、') || '未填'}`,
  );
  lines.push(
    `成员：${project.members.map((m) => `${m.name}${m.role === 'leader' ? '（组长）' : ''}${m.duty ? `，${m.duty}` : '，分工未填'}`).join('；') || '未填写'}`,
  );
  lines.push(`记录人（默认）：${recorderOf(project)}；过程记录共 ${plan.total} 篇（上学期 ${plan.firstTerm} / 下学期 ${plan.secondTerm}）。`);
  if (project.requirementText) {
    lines.push(`【教师要求原文】\n${project.requirementText.slice(0, 1200)}`);
  }

  const scope = kind ? reportScopeText(kind, plan, scoped.length) : '';
  if (scope) lines.push('', scope);
  lines.push('', `【研究记录】本报告可用 ${scoped.length} 篇（项目内共 ${records.length} 篇）`);
  if (!scoped.length) {
    lines.push('- 暂无可用的研究记录。');
  } else {
    for (const r of scoped) lines.push(recordLine(r));
  }

  lines.push('', `【来源】共 ${sources.length} 条`);
  if (!sources.length) {
    lines.push('- 暂无来源。');
  } else {
    for (const s of sources) {
      lines.push(
        `- ${s.authors || '作者未填'}《${s.title}》${s.date || ''}${s.doi ? ` DOI:${s.doi}` : s.url ? ` ${s.url}` : ''}；类型：${SOURCE_TYPE_LABEL[s.sourceType]}；${s.verifyStatus === 'verified' ? '已核实' : '待核实'}`,
      );
    }
  }

  lines.push('', `【数据集】共 ${datasets.length} 个`);
  if (!datasets.length) {
    lines.push('- 暂无数据集。');
  } else {
    for (const d of datasets) {
      const points = d.points.slice(0, 12).map((p) => `${p.label}=${p.value}`).join('，');
      lines.push(`- ${d.title}${d.unit ? `（单位：${d.unit}）` : ''}：${points}；来源说明：${d.sourceNote}；类型：${SOURCE_TYPE_LABEL[d.sourceType]}`);
    }
  }
  return lines.join('\n');
}

/** 缺少哪些必要真实信息 */
export function gapsFor(kind: ReportKind, ctx: ReportContext, mode: GapMode = 'strict'): Gap[] {
  const gaps: Gap[] = [];
  const fill = mode === 'fill';
  const { project, sources, datasets } = ctx;
  const plan = planOf(project);
  // 中期报告的「事实够不够」只看上学期，不能拿下学期的记录来凑
  const records = recordsForReport(kind, ctx.records, plan);
  const real = records.filter((r) => r.sourceType === 'real' || r.sourceType === 'provided');
  const confirmed = records.filter((r) => r.confirmed);
  const withResult = records.filter((r) => (r.outputs ?? '').trim());

  if (fill) {
    gaps.push({
      level: 'warn',
      text: '补全模式已开启：缺失处会由 AI 推断写满，提交前必须逐条核对',
      where: '设置 → 个性化 → 缺材料时（留白待补充）',
    });
  }

  if (!project.members.length) {
    gaps.push({ level: 'block', text: '还没有成员名单，无法写分工与参与人', where: '项目 → 成员' });
  } else if (project.members.some((m) => !m.duty?.trim())) {
    gaps.push({ level: 'warn', text: '有成员没填分工，中期与结题的「成员表现」只能概括', where: '项目 → 成员' });
  }

  if (kind === 'proposal') {
    if (!project.topic.trim()) gaps.push({ level: 'block', text: '课题名称未填', where: '项目 → 设置' });
    if (!project.requirementText.trim()) {
      gaps.push({ level: 'warn', text: '没有粘贴教师要求，格式与字数无法对齐', where: '项目 → 设置' });
    }
    return gaps;
  }

  /* 记录类缺口在补全模式下降级为提醒：用户已经接受「先写满、后核对」 */
  if (!records.length) {
    gaps.push({
      level: fill ? 'warn' : 'block',
      text: fill
        ? '没有任何研究记录，过程与结果只能按研究设计推断，全部需核实'
        : '没有任何研究记录，过程/中期/结题都无法基于事实生成',
      where: '项目 → 研究记录',
    });
  }
  if (records.length && !confirmed.length) {
    gaps.push({
      level: fill ? 'warn' : 'block',
      text: fill
        ? '研究记录都还没确认真实性，报告里的过程描述需逐条核对'
        : '研究记录都还没确认真实性，不能当作已完成的证据',
      where: '项目 → 研究记录（勾选「真实开展」）',
    });
  }
  if (records.length && !real.length) {
    gaps.push({ level: 'warn', text: '记录全部是模拟或文献内容，缺少真实开展的活动', where: '项目 → 研究记录' });
  }
  if (records.length && !withResult.length) {
    gaps.push({ level: 'warn', text: '记录里没有填写阶段性成果/数据，报告只能写「暂无数据」', where: '项目 → 研究记录 → 阶段性成果' });
  }
  if (!sources.length) {
    gaps.push({ level: 'warn', text: '没有来源，参考文献与理论依据会留空', where: '项目 → 来源' });
  }
  if ((kind === 'midterm' || kind === 'final') && !datasets.length) {
    gaps.push({ level: 'warn', text: '没有数据集，结果部分无法附带统计图表', where: '项目 → 研究记录 / 数据集' });
  }
  if (kind === 'final' && records.length < Math.min(3, plan.total)) {
    gaps.push({ level: 'warn', text: '记录篇数偏少，结题报告的过程描述会显得单薄', where: '项目 → 研究记录' });
  }
  return gaps;
}

/** 单节写作提示：把模板提示、缺口与规则拼一起 */
export function sectionPrompt(args: {
  kind: ReportKind;
  heading: string;
  hint: string;
  words: number;
  ctxText: string;
  gaps: Gap[];
  existing?: string;
  mode?: GapMode;
}): string {
  const mode = args.mode ?? 'strict';
  const fill = mode === 'fill';
  const gapLines = args.gaps.length
    ? args.gaps.map((g) => `- ${g.text}（补充位置：${g.where}）`).join('\n')
    : fill
      ? '- 没有记录到缺口，可正常写作。'
      : '- 暂无明显缺口。';
  return [
    `请为「${args.heading}」写正文，目标约 ${args.words} 字。`,
    '',
    '【写作要求】',
    args.hint,
    '',
    '【已知事实】',
    args.ctxText,
    '',
    fill ? '【缺失的信息（可据此推断，但必须标注）】' : '【当前缺少的信息】',
    gapLines,
    '',
    fill ? FILL_MODE_RULE : NO_FABRICATION_RULE,
    '',
    '【输出纪律】',
    '- 第一句就是这一节的正文内容，不要任何开场白。',
    '- 不要评论「原来的草稿」，不要说明你打算怎么写，不要写「需要换成」「这一点要等老师」这类计划句。',
    '- 不要出现「用户」「学生」「我先」「接下来」这类旁观或自述视角；正文是交上去的成品文字。',
    '- 信息不够就直接写「尚未开展」或留「待补充」，不要把「还缺什么」写进正文。',
    '',
    '只输出正文（Markdown），不要重复章节标题。',
    args.existing?.trim() ? `\n【已有草稿】可在其基础上改写，保留其中的真实数据：\n"""\n${args.existing}\n"""` : '',
  ].join('\n');
}

