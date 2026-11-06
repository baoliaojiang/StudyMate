/**
 * 一键清理 AI 生成痕迹
 *
 * 只清理软件/提示词主动写进正文的标注，不动用户自己写的内容，也不动
 * 「待补充：<缺什么>」这类留白（那是事实边界，不是 AI 痕迹）。
 *
 * 会被清掉的：
 *  - （推断，需核实）/（需核实）/（待核实）/【待核实】
 *  - （AI 模拟示例）/（AI 补写内容）
 *  - 整行「免责声明：本节含 AI 补写内容…」
 *  - 数据占位后面的（需补充实测数据）——横线本身保留，仍需自己填真实数据
 *
 * 清理是不可逆的，调用方必须先弹确认并说明后果（见各页面的 cleanAiMarks 按钮）。
 */
import type { Report, StudyRecord } from './types';

/** 行内标注：每个分支都是完整的括号串，替换成空串不会把两个词粘在一起 */
const INLINE_MARKS =
  /[（(]\s*(?:推断\s*[，,、]?\s*)?需核实\s*[）)]|【\s*待核实\s*】|[（(]\s*待核实\s*[）)]|[（(]\s*(?:本节|本文|本部分)?\s*含?\s*AI\s*补写(?:内容)?[^）)\n]{0,20}[）)]|[（(]\s*AI\s*模拟示例\s*[）)]|[（(]\s*含?\s*模拟[^）)\n]{0,12}[）)]|[（(]\s*(?:模拟操作|模拟内容|模拟数据|示例内容|示例数据|演示内容|虚拟数据|虚拟内容|假设情景|仅为示例|此处为演示)[^）)\n]{0,40}[）)]|[（(]\s*需补充实测数据\s*[）)]/g;

/**
 * 整行免责声明：只认从行首开始的声明句，用户自己写的免责声明不动。
 * 从行首起算才不会把同一行前半句的正常结论一起删掉。
 */
const DISCLAIMER_LINES =
  /^[ \t]*(?:(?:免责声明|声明)\s*[：:]\s*)?(?:本节|本文|本部分)?\s*含\s*AI\s*补写内容[^\n]*$|^[ \t]*(?:免责声明|声明)\s*[：:][^\n]*含\s*AI\s*补写内容[^\n]*$/gm;

/**
 * 行内免责声明：模型经常把它接在正文句子后面（「……已回收。免责声明：本节含 AI 补写内容，须核对后使用。」），
 * 这种不在行首，行规则匹配不到，必须按句子清掉，否则正文里会留下半句 AI 声明。
 */
const DISCLAIMER_SENTENCES =
  /(?:免责声明|声明)\s*[：:]\s*[^\n。！？]{0,40}?AI\s*补写内容[^\n。！？]*[。！？]?|(?:本节|本文|本部分)\s*含\s*AI\s*补写内容[^\n。！？]*[。！？]?/g;

export interface CleanResult {
  text: string;
  removed: number;
}

/** 纯函数：清一段正文，返回清理后的文本与删掉的处数 */
export function cleanAiMarks(input: string): CleanResult {
  const src = String(input ?? '');
  if (!src) return { text: '', removed: 0 };
  let removed = 0;

  DISCLAIMER_LINES.lastIndex = 0;
  DISCLAIMER_SENTENCES.lastIndex = 0;
  INLINE_MARKS.lastIndex = 0;
  // 先按整行清（能连同该行后面的解释一起删干净），再清行内接在句子后面的那半句
  let text = src.replace(DISCLAIMER_LINES, () => {
    removed += 1;
    return '';
  });
  text = text.replace(DISCLAIMER_SENTENCES, () => {
    removed += 1;
    return '';
  });
  text = text.replace(INLINE_MARKS, () => {
    removed += 1;
    return '';
  });

  // 标注删掉后可能留下行尾空格与多余空行，整理一下但不改正文语义
  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/[，、；]\s*([。！？])/g, '$1')
    .replace(/。{2,}/g, '。')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, removed };
}

export function hasAiMarks(input: string): boolean {
  const src = String(input ?? '');
  INLINE_MARKS.lastIndex = 0;
  DISCLAIMER_LINES.lastIndex = 0;
  DISCLAIMER_SENTENCES.lastIndex = 0;
  return (
    INLINE_MARKS.test(src) || DISCLAIMER_LINES.test(src) || DISCLAIMER_SENTENCES.test(src)
  );
}

const RECORD_TEXT_KEYS = [
  'stageName',
  'activityName',
  'goal',
  'work',
  'materials',
  'outputs',
  'summary',
  'nextPlan',
] as const;

export function cleanReport(report: Report): { report: Report; removed: number } {
  const next = JSON.parse(JSON.stringify(report)) as Report;
  let removed = 0;
  for (const s of next.sections) {
    const r = cleanAiMarks(s.body);
    s.body = r.text;
    removed += r.removed;
    // 标识被删掉后同步状态位，否则交付检查会误报「模拟内容缺标识」
    if (!/AI\s*模拟示例/.test(s.body)) s.containsSimulated = false;
  }
  return { report: next, removed };
}

export function cleanRecord(record: StudyRecord): { record: StudyRecord; removed: number } {
  const next = JSON.parse(JSON.stringify(record)) as StudyRecord & Record<string, unknown>;
  let removed = 0;
  for (const k of RECORD_TEXT_KEYS) {
    const v = next[k];
    if (typeof v !== 'string') continue;
    const r = cleanAiMarks(v);
    (next as unknown as Record<string, unknown>)[k] = r.text;
    removed += r.removed;
  }
  return { record: next as StudyRecord, removed };
}

/** 项目级一键清理：给概览页用，返回全新的数组，不改动传入对象 */
export function cleanProjectTexts(
  reports: Report[],
  records: StudyRecord[],
): { reports: Report[]; records: StudyRecord[]; removed: number; touched: number } {
  let removed = 0;
  let touched = 0;
  const nextReports = reports.map((r) => {
    const out = cleanReport(r);
    if (out.removed) touched += 1;
    removed += out.removed;
    return out.report;
  });
  const nextRecords = records.map((r) => {
    const out = cleanRecord(r);
    if (out.removed) touched += 1;
    removed += out.removed;
    return out.record;
  });
  return { reports: nextReports, records: nextRecords, removed, touched };
}

export const AI_CLEAN_WARNING =
  '这会删掉正文里的「（推断，需核实）」、AI 补写免责声明和「（AI 模拟示例）」标识，并同步去掉模拟内容标记。\n\n删除后无法撤销，导出时也不会再提示哪些是推断或虚拟内容。请只在自己已经逐条核实、确认可以提交之后使用。';
