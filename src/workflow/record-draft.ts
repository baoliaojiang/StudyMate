/**
 * 过程记录起草
 *
 * 为什么不一次生成全部：一篇记录要写清阶段、时间、参与人、做法、材料、产出、小结，
 * 一次要 7～8 篇，既拖时间又容易把模型挤到胡说。这里改成「一次一批」——
 * 每批 3 篇，写一批、落一次库、界面点亮一次，跑不完下次接着补。
 *
 * 用户口径：过程记录每一栏默认都要写上，不许出现「尚未开展 / 待补充 / 暂无」。
 * 每篇承接上一篇的「下阶段研究工作安排」，上学期最后一篇收尾到中期报告，
 * 全项目最后一篇收尾到结题报告（这句由代码兜底，不靠模型自觉）。
 */
import type { Term } from '../core/types';
import { DEFAULT_RECORD_PLAN } from '../core/types';
import {
  RECORD_CONTENT_RULE,
  batchHistory,
  closingNextPlan,
  fallbackText,
  hasPlaceholderText,
  type RecordPlanLike,
} from '../core/record-content';

/** 起草需要的项目信息，显式列出，避免和 Project 的字段漂移 */
export interface DraftContext {
  topic: string;
  grade: string;
  modes: string[];
  members: string[];
  startDate?: string;
  endDate?: string;
  /** 前序已经写好、有内容的记录（只到本批之前） */
  history?: Array<{
    index: number;
    activityName?: string;
    goal?: string;
    work?: string;
    outputs?: string;
    summary?: string;
    nextPlan?: string;
  }>;
  plan?: RecordPlanLike;
  recorder?: string;
}

/** 一次生成几篇。3 篇约 700～900 token，手机上 8～20 秒能回来 */
export const DRAFT_BATCH = 3;

/** 一批要几篇：不超过批大小，也不超过还差几篇 */
export function batchCount(need: number, left = DRAFT_BATCH): number {
  const n = Math.min(DRAFT_BATCH, left);
  return Math.max(0, Math.min(Math.floor(need), Math.floor(n)));
}

/** 一篇记录的草稿字段，允许缺（缺的由 sanitizeDrafts 补成实质内容） */
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
  recorder: string;
  recordedAt: string;
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
  'recorder',
  'recordedAt',
];

const BODY_KEYS = ['goal', 'work', 'materials', 'outputs', 'summary', 'nextPlan'] as const;

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
    recorder: '',
    recordedAt: '',
  };
}

export function termName(term: Term): string {
  return term === 1 ? '上学期' : '下学期';
}

/** 本批里如果遇到学期末，把收尾要求写死给模型 */
function closingRules(start: number, end: number, plan: RecordPlanLike): string {
  const lines: string[] = [];
  for (let i = start; i <= end; i += 1) {
    const text = closingNextPlan(i, plan);
    if (!text) continue;
    lines.push(
      `第 ${i} 篇是${i === plan.firstTerm ? '上学期' : '整个项目'}最后一篇，「nextPlan」必须写成：${text}`,
    );
  }
  return lines.join('\n');
}

/** 起草提示词：承接前序、每栏写满、不编数据 */
export function draftMessages(
  ctx: DraftContext,
  term: Term,
  count: number,
  fromIndex: number,
): { role: 'system' | 'user'; content: string }[] {
  const members = ctx.members.filter(Boolean);
  const start = fromIndex + 1;
  const end = fromIndex + count;
  const plan = ctx.plan ?? DEFAULT_RECORD_PLAN;
  const history = ctx.history ?? [];
  const last = history[history.length - 1];
  const lastNextPlan = (last?.nextPlan ?? '').trim();
  const closing = closingRules(start, end, plan);
  const schema =
    '{"stageName":"阶段名","activityName":"这次做了什么","startDate":"2026-09-12","endDate":"2026-09-12",' +
    '"place":"地点","participants":["姓名"],"recorder":"记录人","goal":"本次目标","work":"具体做法，2-4 句",' +
    '"materials":"用到的材料或工具","outputs":"产出","summary":"本次小结","nextPlan":"下一步"}';

  return [
    {
      role: 'system',
      content: [
        '你在帮中学生写研究性学习的「过程记录」，每一篇都是一份已经做完的工作小结。',
        RECORD_CONTENT_RULE,
        '额外规则：不得编造问卷份数、访谈人数、实验数据、百分比、结论或文献；' +
          '确实需要具体数据的地方写「______」，但句子要完整。',
        `只输出 JSON 数组，不要代码块标记、不要解释。数组里每一项形如 ${schema}。`,
        '日期必须落在研究周期内、按时间先后排列，相邻两次不要同一天。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `研究主题：${ctx.topic}`,
        `年级：${ctx.grade || '未填'}`,
        `研究方式：${(ctx.modes ?? []).join('、') || '未填'}`,
        `成员：${members.join('、') || '未填'}`,
        `记录人（默认）：${ctx.recorder || members[0] || '课题组成员'}`,
        `研究周期：${ctx.startDate || '未填'} 至 ${ctx.endDate || '未填'}`,
        `全项目共 ${plan.total} 篇（上学期 ${plan.firstTerm} / 下学期 ${plan.secondTerm}）。`,
        `现在要写${termName(term)}的第 ${start}～${end} 篇，共 ${count} 篇。`,
        '',
        '【前面已经写好的记录（只用于承接，不要重复它们的活动）】',
        history.length ? batchHistory(history, start, 6) : '- 前面还没有写好的记录，本批从课题启动写起。',
        '',
        '【承上启下（硬要求）】',
        lastNextPlan
          ? `上一篇（第 ${last?.index ?? start - 1} 篇）的「下阶段研究工作安排」是：${lastNextPlan}\n` +
            `本批第 ${start} 篇的「work」必须就是落实这件事，写清怎么做的、谁做了哪部分，不要另起炉灶。`
          : `第 ${start} 篇写课题启动阶段实际做的事：明确研究问题、分工、查资料、设计问卷或访谈提纲。不要写「还没开始」。`,
        '本批内部也要连成一条线：每篇的「nextPlan」是下一篇「work」要做的事，不要重复同一件活动。',
        closing ? `\n【学期收尾（硬要求）】\n${closing}` : '',
        '',
        '只输出 JSON 数组，第一个字符就是 [。',
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

export interface SanitizeOpts {
  /** 本批第一篇的全局篇号 */
  startIndex: number;
  plan: RecordPlanLike;
  topic: string;
  recorder: string;
  /** 本批之前最后一篇的 nextPlan */
  prevNextPlan?: string;
}

/**
 * 落库前最后一道闸：空栏 / 占位栏一律补成实质内容，学期末收尾句强制覆盖。
 * 返回修复过的副本，不改传入数组。
 */
export function sanitizeDrafts(drafts: DraftRecord[], opts: SanitizeOpts): DraftRecord[] {
  let lastNextPlan = (opts.prevNextPlan ?? '').trim();
  return drafts.map((d, i) => {
    const index = opts.startIndex + i;
    const expected = closingNextPlan(index, opts.plan);
    const c = {
      topic: opts.topic || '本课题',
      index,
      isFirst: index === 1,
      lastNextPlan,
      expectedNextPlan: expected,
    };
    const out: DraftRecord = { ...d, participants: [...(d.participants ?? [])] };
    for (const k of BODY_KEYS) {
      const v = (out[k] ?? '').trim();
      out[k] = !v || hasPlaceholderText(v) ? fallbackText(k, c) : v;
    }
    if (!out.activityName.trim()) out.activityName = fallbackText('activityName', c);
    if (!out.stageName.trim()) out.stageName = fallbackText('stageName', c);
    if (expected) out.nextPlan = expected;
    if (!out.recorder.trim()) out.recorder = opts.recorder;
    lastNextPlan = out.nextPlan;
    return out;
  });
}
