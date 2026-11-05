/**
 * 过程记录起草
 *
 * 为什么不一次生成全部：一篇记录要写清阶段、时间、参与人、做法、材料、产出、小结，
 * 一次要 7～8 篇，既拖时间又容易把模型挤到胡说。这里改成「一次一批」——
 * 每批 3 篇，写一批、落一次库、界面点亮一次，跑不完下次接着补。
 *
 * 只写「计划里该做的事」，不编数据、不编结果：真实细节由学生自己改成实际发生的事，
 * 确认之前一律是未确认草稿。
 */
import type { Term } from '../core/types';

/** 起草需要的项目信息，显式列出，避免和 Project 的字段漂移 */
export interface DraftContext {
  topic: string;
  grade: string;
  modes: string[];
  members: string[];
  startDate?: string;
  endDate?: string;
}

/** 一次生成几篇。3 篇约 700～900 token，手机上 8～20 秒能回来 */
export const DRAFT_BATCH = 3;

/** 一批要几篇：不超过批大小，也不超过还差几篇 */
export function batchCount(need: number, left = DRAFT_BATCH): number {
  const n = Math.min(DRAFT_BATCH, left);
  return Math.max(0, Math.min(Math.floor(need), Math.floor(n)));
}

/** 一篇记录的草稿字段，允许缺（缺的落空串，让用户自己补） */
export interface DraftRecord {
  stageName: string;
  activityName: string;
  startDate: string;
  endDate: string;
  place: string;
  participants: string[];
  goal: string;
  work: string;
  materials: string;
  outputs: string;
  summary: string;
  nextPlan: string;
}

const FIELDS: (keyof Omit<DraftRecord, 'participants'>)[] = [
  'stageName',
  'activityName',
  'startDate',
  'endDate',
  'place',
  'goal',
  'work',
  'materials',
  'outputs',
  'summary',
  'nextPlan',
];

export function emptyDraft(): DraftRecord {
  return {
    stageName: '',
    activityName: '',
    startDate: '',
    endDate: '',
    place: '',
    participants: [],
    goal: '',
    work: '',
    materials: '',
    outputs: '',
    summary: '',
    nextPlan: '',
  };
}

export function termName(term: Term): string {
  return term === 1 ? '上学期' : '下学期';
}

/** 起草提示词：只要事实栏位，不许编数据、不许写结论 */
export function draftMessages(
  ctx: DraftContext,
  term: Term,
  count: number,
  fromIndex: number,
): { role: 'system' | 'user'; content: string }[] {
  const members = ctx.members.filter(Boolean);
  const start = fromIndex + 1;
  const end = fromIndex + count;
  return [
    {
      role: 'system',
      content:
        '你在帮中学生把研究性学习的「过程记录」排成一条能照着做的流水。' +
        '写的是计划里该发生的事，不是已经拿到的结果：' +
        '不得编造问卷份数、访谈人数、实验数据、百分比、结论；结果与产出拿不准就写「待补充」。' +
        '只输出 JSON 数组，不要代码块标记、不要解释。数组里每一项形如 ' +
        '{"stageName":"阶段名","activityName":"这次做了什么","startDate":"2026-09-12","endDate":"2026-09-12",' +
        '"place":"地点或留空","participants":["姓名"],"goal":"本次目标","work":"具体做法，2-4 句",' +
        '"materials":"用到的材料或工具","outputs":"产出，拿不准写待补充","summary":"本次小结","nextPlan":"下一步"}。' +
        '日期必须落在研究周期内、按时间先后排列，相邻两次不要同一天。',
    },
    {
      role: 'user',
      content: [
        `研究主题：${ctx.topic}`,
        `年级：${ctx.grade || '未填'}`,
        `研究方式：${(ctx.modes ?? []).join('、') || '未填'}`,
        `成员：${members.join('、') || '未填'}`,
        `研究周期：${ctx.startDate || '未填'} 至 ${ctx.endDate || '未填'}`,
        `现在要写${termName(term)}的第 ${start}～${end} 篇，共 ${count} 篇。`,
        '请给这几篇写的是一条连贯的推进线：每篇接上一篇的下一步，不要重复同一件事。',
      ].join('\n'),
    },
  ];
}

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
}

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean);
  const s = str(v);
  return s ? s.split(/[、,，;；\s]+/).filter(Boolean) : [];
}

/** 从模型输出里抠出草稿；脏输出返回空数组，由调用方决定重试还是收工 */
export function parseDrafts(raw: string, max: number): DraftRecord[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  const a = s.indexOf('[');
  const b = s.lastIndexOf(']');
  if (a < 0 || b <= a) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(s.slice(a, b + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: DraftRecord[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const d = emptyDraft();
    for (const k of FIELDS) d[k] = str(o[k]);
    d.participants = strList(o.participants);
    // 没有活动名又没有任何做法，这篇是空壳，丢掉
    if (!d.activityName && !d.work) continue;
    if (!d.activityName) d.activityName = d.work.slice(0, 18);
    out.push(d);
    if (out.length >= Math.max(1, Math.floor(max))) break;
  }
  return out;
}
