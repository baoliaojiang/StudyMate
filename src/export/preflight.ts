/**
 * 交付前核对
 *
 * 导出前把「明显不能交」和「建议再看一眼」分开列清楚：
 * - block：必须先处理（代写教师意见、模拟内容缺标识、PPT 高优先级问题）；
 * - warn：允许导出，但交之前应该补（空章节、待补充、未确认、来源待核实）。
 *
 * 只用项目里已有的数据做本地检查，不新增事实来源，也不替用户改正文。
 * 清单会写进 ZIP（交付前核对.md），Agent 的「交付终检」与这里共用同一套口径。
 */
import type { Deck, Project, Report, ReportKind, Source, StudyRecord } from '../core/types';
import { NON_AI_SECTIONS, templateFor } from '../reports/templates';
import { looksLikePlanning } from '../reports/guard';

export interface DeliveryCheck {
  id: string;
  level: 'block' | 'warn';
  /** 出现在哪份材料 / 哪个环节 */
  where: string;
  text: string;
}

export interface PreflightInput {
  project: Project;
  reports: Report[];
  records: StudyRecord[];
  sources: Source[];
  deck?: Deck | null;
}

const SIM_NOTICE = '（AI 模拟示例）';
const GAP_WORDS = ['待补充', '待核实', '需核实', '（本节尚未填写）'];

function safeTemplate(kind: ReportKind) {
  if (kind === 'progress') return null;
  try {
    return templateFor(kind);
  } catch {
    return null;
  }
}

export function preflight(input: PreflightInput): DeliveryCheck[] {
  const checks: DeliveryCheck[] = [];
  const push = (id: string, level: DeliveryCheck['level'], where: string, text: string) =>
    checks.push({ id, level, where, text });

  const { project, reports, records, sources, deck } = input;

  if (!project.topic?.trim()) push('project-topic', 'block', '项目信息', '课题名称还是空的');
  if (!project.teacher?.trim()) push('project-teacher', 'warn', '项目信息', '指导教师没填，交之前要请老师补上');
  if (!project.members?.length) push('project-members', 'warn', '项目信息', '还没有填小组成员');

  for (const r of reports) {
    if (r.kind === 'progress') continue;
    const tpl = safeTemplate(r.kind);

    const emptyRequired =
      tpl?.sections
        .filter((s) => s.required)
        .filter((s) => {
          const sec = r.sections.find((x) => x.heading === s.heading);
          return !sec?.body?.trim();
        }) ?? [];
    if (emptyRequired.length) {
      push(
        `empty-${r.id}`,
        'warn',
        r.title,
        `还有 ${emptyRequired.length} 个必填栏目没写：${emptyRequired
          .slice(0, 3)
          .map((s) => s.heading)
          .join('、')}${emptyRequired.length > 3 ? ' 等' : ''}`,
      );
    }

    if (r.status !== 'confirmed') {
      push(`status-${r.id}`, 'warn', r.title, '报告还没有标记为「已确认」');
    }

    // 学校栏目只能老师本人写，这条是硬边界
    const teacherSection = r.sections.find((s) => NON_AI_SECTIONS.includes(s.heading));
    if (teacherSection?.body?.trim()) {
      push(`teacher-${r.id}`, 'block', r.title, '「指导教师意见」被写入了内容，请清空后由教师本人填写');
    }

    for (const s of r.sections) {
      const body = s.body ?? '';
      if (s.containsSimulated && body.trim() && !body.includes(SIM_NOTICE)) {
        push(`sim-${r.id}-${s.id}`, 'block', r.title, `「${s.heading}」含模拟内容，但缺少「${SIM_NOTICE}」标识`);
      }
      const planning = looksLikePlanning(body);
      if (planning.bad) {
        push(
          `plan-${r.id}-${s.id}`,
          'warn',
          r.title,
          `「${s.heading}」读起来像写作计划而不是正文${planning.hits[0] ? `（命中「${planning.hits[0]}」）` : ''}`,
        );
      }
      const gap = GAP_WORDS.find((w) => body.includes(w));
      if (gap) push(`gap-${r.id}-${s.id}`, 'warn', r.title, `「${s.heading}」还留着「${gap}」，交之前要补完`);
    }
  }

  const filled = records.filter((r) => (r.work ?? '').trim() || (r.activityName ?? '').trim());
  if (records.length && filled.length < records.length) {
    push('records-empty', 'warn', '研究记录', `${records.length - filled.length} 篇还是空的`);
  }
  const unconfirmed = filled.filter((r) => !r.confirmed);
  if (unconfirmed.length) {
    push('records-unconfirmed', 'warn', '研究记录', `${unconfirmed.length} 篇已填写，但还没确认真实开展`);
  }

  if (!sources.length) {
    push('sources-none', 'warn', '来源', '还没有任何来源，正文里的引用需要自己补齐');
  } else {
    const unverified = sources.filter((s) => s.verifyStatus !== 'verified');
    if (unverified.length) {
      push('sources-unverified', 'warn', '来源', `${unverified.length} 条来源仍是待核实，导出时会标「待核实」`);
    }
  }

  const highIssues = (deck?.issues ?? []).filter((i) => i.level === 'high');
  if (highIssues.length) {
    push(
      'deck-high',
      'block',
      '答辩 PPT',
      `${highIssues.length} 个高优先级问题没处理：${highIssues[0].text}`,
    );
  }

  return checks;
}

export function countChecks(checks: DeliveryCheck[]): { block: number; warn: number } {
  return {
    block: checks.filter((c) => c.level === 'block').length,
    warn: checks.filter((c) => c.level === 'warn').length,
  };
}

/** 写进 ZIP 的「交付前核对.md」 */
export function renderChecklist(checks: DeliveryCheck[], title = '交付前核对'): string {
  const block = checks.filter((c) => c.level === 'block');
  const warn = checks.filter((c) => c.level === 'warn');
  const lines = [`# ${title}`, '', `生成时间：${new Date().toLocaleString('zh-CN')}`, ''];

  lines.push('## 必须先处理', '');
  if (block.length) block.forEach((c, i) => lines.push(`${i + 1}. [${c.where}] ${c.text}`));
  else lines.push('没有阻塞项。');

  lines.push('', '## 建议核对', '');
  if (warn.length) warn.forEach((c, i) => lines.push(`${i + 1}. [${c.where}] ${c.text}`));
  else lines.push('没有需要提醒的项。');

  lines.push(
    '',
    '---',
    '本清单由研学帮 StudyMate（第三方开源工具）按本机数据生成，不代表学校或教师的审核结论。',
    '表格与格式以学校当期下发的要求为准，提交前请交指导教师审阅。',
  );
  return lines.join('\n');
}

/** 写进「项目资料.json」的机器可读摘要 */
export function summarizeChecks(checks: DeliveryCheck[]) {
  const { block, warn } = countChecks(checks);
  return {
    阻塞项: block,
    提醒项: warn,
    明细: checks.map((c) => ({ 级别: c.level === 'block' ? '必须先处理' : '建议核对', 位置: c.where, 说明: c.text })),
  };
}
