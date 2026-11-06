import { describe, expect, it } from 'vitest';
import { DEFAULT_RECORD_PLAN, type Project, type StudyRecord } from '../src/core/types';
import {
  RECORD_CONTENT_RULE,
  buildRecordFlow,
  closingNextPlan,
  hasPlaceholderText,
  planOf,
  recordPrompt,
  recorderOf,
  recordsForReport,
  repairRecordDraft,
  reportScopeText,
} from '../src/core/record-content';
import { draftMessages, parseDrafts, sanitizeDrafts } from '../src/workflow/record-draft';

const project = {
  id: 'p1',
  topic: '中学生使用 AI 产品的调研',
  grade: '高二',
  teacher: '陈老师',
  school: '福州鼓山中学',
  members: [
    { id: 'm1', name: '组长', role: 'leader', duty: '统筹' },
    { id: 'm2', name: '组员1', role: 'member', duty: '记录' },
  ],
  modes: ['practice'],
  startDate: '2026-09-01',
  endDate: '2027-01-10',
  recordPlan: DEFAULT_RECORD_PLAN,
} as unknown as Project;

function rec(index: number, patch: Partial<StudyRecord> = {}): StudyRecord {
  return {
    id: `rec-${index}`,
    projectId: 'p1',
    index,
    term: index <= 8 ? 1 : 2,
    stageName: '',
    activityName: `第 ${index} 次活动`,
    startDate: '',
    endDate: '',
    place: '',
    participants: [],
    recorder: '',
    recordedAt: '',
    goal: `第 ${index} 篇目标`,
    work: `第 ${index} 篇做了取样与记录`,
    materials: '',
    outputs: `第 ${index} 篇成果`,
    summary: `第 ${index} 篇小结`,
    nextPlan: `第 ${index} 篇的下一步：整理资料`,
    attachments: [],
    activityIds: [],
    sourceType: 'real',
    confirmed: true,
    updatedAt: 0,
    ...patch,
  };
}

describe('篇目与记录人', () => {
  it('默认 15 篇，上 8 下 7', () => {
    expect(planOf(project)).toEqual({ total: 15, firstTerm: 8, secondTerm: 7 });
  });

  it('记录人默认取组长', () => {
    expect(recorderOf(project)).toBe('组长');
  });

  it('上学期最后一篇收尾到中期，最后一篇收尾到结题', () => {
    expect(closingNextPlan(8, DEFAULT_RECORD_PLAN)).toContain('中期报告');
    expect(closingNextPlan(15, DEFAULT_RECORD_PLAN)).toContain('结题报告');
    expect(closingNextPlan(7, DEFAULT_RECORD_PLAN)).toBeNull();
  });
});

describe('承上启下：只看前序记录', () => {
  const records = [rec(1), rec(2), rec(3, { nextPlan: '第 3 篇的下一步：设计问卷题目' }), rec(9)];

  it('写第 4 篇时只带 1～3 篇，绝不带第 9 篇', () => {
    const flow = buildRecordFlow(project, records, 4);
    expect(flow.prevLines).toContain('第 1 篇');
    expect(flow.prevLines).toContain('第 3 篇');
    expect(flow.prevLines).not.toContain('第 9 篇');
    expect(flow.lastIndex).toBe(3);
    expect(flow.lastNextPlan).toContain('设计问卷题目');
  });

  it('第一篇没有前序，提示词要求写课题启动而不是「还没开始」', () => {
    const flow = buildRecordFlow(project, records, 1);
    expect(flow.isFirst).toBe(true);
    const prompt = recordPrompt(flow, {}, project);
    expect(prompt).toContain('课题启动阶段实际做的事');
    expect(prompt).toContain('不要写「还没开始」');
  });

  it('提示词把上一篇的下一步写成本篇硬约束，并带上禁占位规则', () => {
    const flow = buildRecordFlow(project, records, 4);
    const prompt = recordPrompt(flow, {}, project);
    expect(prompt).toContain('设计问卷题目');
    expect(prompt).toContain('必须就是落实这件事');
    expect(prompt).toContain('严禁出现「尚未开展」');
    expect(RECORD_CONTENT_RULE).toContain('待补充');
  });

  it('学期末的提示词明确写出收尾要求', () => {
    const prompt = recordPrompt(buildRecordFlow(project, records, 8), {}, project);
    expect(prompt).toContain('撰写中期报告');
    expect(prompt).toContain('中期报告');
  });
});

describe('生成结果兜底：不许留空、不许占位', () => {
  it('占位词识别覆盖截图里的三种说法', () => {
    expect(hasPlaceholderText('尚未开展。')).toBe(true);
    expect(hasPlaceholderText('待补充')).toBe(true);
    expect(hasPlaceholderText('本阶段为立项初期，尚未开展具体研究活动，暂无阶段性成果。')).toBe(true);
    expect(hasPlaceholderText('小组按分工查阅资料并整理成清单。')).toBe(false);
  });

  it('第一篇被写成占位时，六栏都会被补成实质内容', () => {
    const flow = buildRecordFlow(project, [], 1);
    const out = repairRecordDraft(
      { goal: '尚未开展。', work: '待补充', outputs: '', summary: '暂无阶段性成果', nextPlan: '' },
      flow,
    );
    expect(out.hits).toContain('goal');
    for (const k of ['goal', 'work', 'materials', 'outputs', 'summary', 'nextPlan'] as const) {
      expect((out.fields[k] ?? '').trim().length).toBeGreaterThan(8);
      expect(hasPlaceholderText(out.fields[k] ?? '')).toBe(false);
    }
    expect(out.fields.recorder).toBe('组长');
  });

  it('上学期最后一篇的下一步被强制改成撰写中期报告', () => {
    const flow = buildRecordFlow(project, [rec(7)], 8);
    const out = repairRecordDraft({ nextPlan: '继续做问卷调查' }, flow);
    expect(out.fields.nextPlan).toContain('中期报告');
  });

  it('全项目最后一篇的下一步被强制改成撰写结题报告', () => {
    const flow = buildRecordFlow(project, [rec(14)], 15);
    const out = repairRecordDraft({ nextPlan: '继续做问卷调查' }, flow);
    expect(out.fields.nextPlan).toContain('结题报告');
  });
});

describe('批量链路同样不许占位', () => {
  it('提示词带前序承接、收尾与禁占位规则', () => {
    const ctx = {
      topic: project.topic,
      grade: project.grade,
      modes: ['practice'],
      members: ['组长', '组员1'],
      startDate: project.startDate,
      endDate: project.endDate,
      history: [{ index: 7, work: '整理了问卷', nextPlan: '打印并试发问卷' }],
      plan: DEFAULT_RECORD_PLAN,
      recorder: '组长',
    };
    const [sys, user] = draftMessages(ctx, 1, 2, 7);
    expect(sys.content).toContain('已经做完的工作小结');
    expect(sys.content).toContain('严禁出现「尚未开展」');
    expect(user.content).toContain('打印并试发问卷');
    expect(user.content).toContain('承上启下');
    expect(user.content).toContain('中期报告'); // 第 8 篇收尾
  });

  it('解析后被 sanitizeDrafts 修好：占位栏变成实质内容，收尾与记录人都在', () => {
    const raw = JSON.stringify([
      {
        activityName: '第 8 次活动',
        goal: '待补充',
        work: '尚未开展',
        outputs: '暂无',
        summary: '',
        nextPlan: '下周再说',
      },
    ]);
    const out = sanitizeDrafts(parseDrafts(raw, 1), {
      startIndex: 8,
      plan: DEFAULT_RECORD_PLAN,
      topic: project.topic,
      recorder: '组长',
      prevNextPlan: '打印并试发问卷',
    });
    expect(out).toHaveLength(1);
    expect(out[0].work).not.toMatch(/尚未开展|待补充/);
    expect(out[0].outputs).not.toContain('暂无');
    expect(out[0].nextPlan).toContain('中期报告');
    expect(out[0].recorder).toBe('组长');
  });
});

describe('报告上下文按范围取记录', () => {
  const records = [rec(2), rec(9), rec(14)];

  it('中期只拿上学期，结题拿全项目', () => {
    expect(recordsForReport('midterm', records, DEFAULT_RECORD_PLAN).map((r) => r.index)).toEqual([2]);
    expect(recordsForReport('final', records, DEFAULT_RECORD_PLAN).map((r) => r.index)).toEqual([2, 9, 14]);
  });

  it('范围说明写明中期只总结上学期、结题覆盖整个研究周期', () => {
    expect(reportScopeText('midterm', DEFAULT_RECORD_PLAN, 8)).toContain('只总结上学期');
    expect(reportScopeText('final', DEFAULT_RECORD_PLAN, 15)).toContain('整个研究周期');
    expect(reportScopeText('proposal', DEFAULT_RECORD_PLAN, 0)).toContain('不要把尚未开展的事写成已经完成');
  });
});
