import { describe, expect, it } from 'vitest';
import {
  projectProgress,
  progressSummary,
  progressText,
  recordFilled,
  reportGate,
} from '../src/reports/progress';
import { prefetchReferences, searchQueryOf } from '../src/reports/prefetch';
import { DEFAULT_RECORD_PLAN, type Project, type StudyRecord } from '../src/core/types';

const plan = { total: 14, firstTerm: 6, secondTerm: 8 };

const project = {
  id: 'p1',
  topic: '闽江水质调查',
  school: '福州鼓山中学',
  members: [{ id: 'm1', name: '张三', role: 'leader', duty: '统筹' }],
  recordPlan: plan,
} as unknown as Project;

function rec(
  index: number,
  opts: { work?: string; confirmed?: boolean; term?: 1 | 2 } = {},
): StudyRecord {
  return {
    id: `rec-${index}`,
    projectId: 'p1',
    index,
    term: opts.term ?? (index <= plan.firstTerm ? 1 : 2),
    activityName: `第 ${index} 次活动`,
    work: opts.work ?? '按分工完成取样与记录',
    goal: '',
    outputs: '',
    summary: '',
    nextPlan: '',
    participants: [],
    attachments: [],
    confirmed: opts.confirmed ?? true,
    sourceType: 'real',
  } as unknown as StudyRecord;
}

const filledFirst = () => [1, 2, 3, 4, 5, 6].map((i) => rec(i, { confirmed: true }));

describe('一篇记录算不算写完', () => {
  it('只有活动名和时间不算', () => {
    expect(recordFilled(rec(1, { work: '' }))).toBe(false);
  });

  it('写了占位词不算', () => {
    expect(recordFilled(rec(1, { work: '尚未开展' }))).toBe(false);
    expect(recordFilled(rec(1, { work: '本次待补充' }))).toBe(false);
  });

  it('写了实际做了什么才算', () => {
    expect(recordFilled(rec(1, { work: '带着试剂盒到三个断面取样，记录水温与浊度' }))).toBe(true);
  });
});

describe('项目进度', () => {
  it('一篇没写时停在开题阶段', () => {
    const p = projectProgress(project, []);
    expect(p.filled).toBe(0);
    expect(p.stage).toBe('proposal');
  });

  it('上学期写满后进入中期阶段', () => {
    const p = projectProgress(project, filledFirst());
    expect(p.first.filled).toBe(6);
    expect(p.stage).toBe('midterm');
  });

  it('全部写完才算结题阶段', () => {
    const all = Array.from({ length: 14 }, (_, i) => rec(i + 1));
    expect(projectProgress(project, all).stage).toBe('final');
  });

  it('进度文案带上篇数，模型据此判断能写到哪一步', () => {
    const p = projectProgress(project, filledFirst());
    expect(progressText(p)).toContain('已写完 6 篇');
    expect(progressText(p)).toContain('上学期 6/6');
    expect(progressSummary(p)).toContain('可以做中期报告');
  });
});

describe('报告放行校验', () => {
  it('记录全空时，中期与结题都被拦住', () => {
    const p = projectProgress(project, []);
    expect(reportGate('midterm', p).level).toBe('block');
    expect(reportGate('final', p).level).toBe('block');
    expect(reportGate('midterm', p).text).toContain('还差 6 篇');
    expect(reportGate('final', p).text).toContain('0/14');
  });

  it('开题报告与阶段性记录表不受进度限制', () => {
    const p = projectProgress(project, []);
    expect(reportGate('proposal', p).level).toBe('ok');
    expect(reportGate('progress', p).level).toBe('ok');
  });

  it('上学期写满、但没确认真实性时只提醒不拦', () => {
    const p = projectProgress(project, [1, 2, 3, 4, 5, 6].map((i) => rec(i, { confirmed: false })));
    const gate = reportGate('midterm', p);
    expect(gate.level).toBe('warn');
    expect(gate.text).toContain('没确认真实性');
  });

  it('上学期只写了一半，中期报告仍然拦住', () => {
    const p = projectProgress(project, [1, 2, 3].map((i) => rec(i)));
    const gate = reportGate('midterm', p);
    expect(gate.level).toBe('block');
    expect(gate.missing).toBe(3);
  });

  it('结题报告要等两个学期都写完', () => {
    const p = projectProgress(project, filledFirst());
    const gate = reportGate('final', p);
    expect(gate.level).toBe('block');
    expect(gate.text).toContain('下学期还差 8 篇');
  });

  it('改成 10 篇的计划也能正确分学期', () => {
    const small = { ...project, recordPlan: { total: 10, firstTerm: 4, secondTerm: 6 } };
    const p = projectProgress(small as Project, [1, 2, 3, 4].map((i) => rec(i, { term: 1 })));
    expect(p.first.total).toBe(4);
    expect(p.second.total).toBe(6);
    expect(reportGate('midterm', p).level).toBe('ok');
    expect(reportGate('final', p).level).toBe('block');
  });
});

describe('起草前检索', () => {
  it('课题名去掉套话再检索', () => {
    expect(searchQueryOf('《闽江水质调查研究性学习报告》')).toBe('闽江水质调查');
    expect(searchQueryOf('  关于校园噪声的  ')).toBe('校园噪声的');
    expect(searchQueryOf('')).toBe('');
  });

  it('课题名为空时直接跳过，不发请求', async () => {
    const out = await prefetchReferences('', []);
    expect(out.ok).toBe(false);
    expect(out.count).toBe(0);
  });

  it('没有启用检索服务时说明原因，不报错', async () => {
    const out = await prefetchReferences('闽江水质调查', []);
    expect(out.ok).toBe(false);
    expect(out.message).toContain('没有启用检索服务');
  });
});
