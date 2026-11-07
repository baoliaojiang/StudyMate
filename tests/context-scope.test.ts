import { describe, expect, it } from 'vitest';
import { contextText, gapsFor, type ReportContext } from '../src/reports/context';
import { DEFAULT_RECORD_PLAN, type Project, type StudyRecord } from '../src/core/types';

const project = {
  id: 'p1',
  topic: '闽江水质调查',
  school: '福州鼓山中学',
  grade: '高二',
  className: '3 班',
  groupName: '第一小组',
  teacher: '陈老师',
  members: [{ id: 'm1', name: '张三', role: 'leader', duty: '统筹' }],
  modes: ['practice'],
  startDate: '2026-09-01',
  endDate: '2027-01-10',
  requirementText: '',
  recordPlan: DEFAULT_RECORD_PLAN,
} as unknown as Project;

function rec(index: number, term: 1 | 2, confirmed: boolean): StudyRecord {
  return {
    id: `rec-${index}`,
    projectId: 'p1',
    index,
    term,
    stageName: '',
    activityName: term === 1 ? `上学期取样第 ${index} 次` : `下学期回访第 ${index} 次`,
    startDate: '',
    endDate: '',
    place: '',
    participants: [],
    recorder: '张三',
    recordedAt: '',
    goal: '',
    work: '按分工完成取样与记录',
    materials: '',
    outputs: '',
    summary: '',
    nextPlan: '',
    attachments: [],
    activityIds: [],
    sourceType: 'real',
    confirmed,
    updatedAt: 0,
  };
}

const ctx: ReportContext = {
  project,
  records: [rec(2, 1, false), rec(9, 2, true), rec(14, 2, true)],
  sources: [],
  datasets: [],
};

describe('报告事实底座按报告类型取记录', () => {
  it('中期报告只喂上学期记录，并写明范围', () => {
    const text = contextText(ctx, 'midterm');
    expect(text).toContain('只总结上学期');
    expect(text).toContain('上学期取样第 2 次');
    expect(text).not.toContain('下学期回访第 9 次');
    expect(text).toContain('本报告可用 1 篇');
  });

  it('结题报告覆盖整个研究周期', () => {
    const text = contextText(ctx, 'final');
    expect(text).toContain('整个研究周期');
    expect(text).toContain('上学期取样第 2 次');
    expect(text).toContain('下学期回访第 9 次');
    expect(text).toContain('本报告可用 3 篇');
  });

  it('开题报告写明是计划书，既不把计划写成已完成，也不通篇写尚未开展', () => {
    const text = contextText(ctx, 'proposal');
    expect(text).toContain('开题报告写的是研究计划');
    expect(text).toContain('不要把计划写成已完成');
    expect(text).toContain('也不要通篇写「尚未开展」');
  });

  it('不传 kind 时保持全量，兼容旧调用方', () => {
    const text = contextText(ctx);
    expect(text).toContain('下学期回访第 9 次');
    expect(text).toContain('共 3 篇');
  });
});

describe('缺口检查也按报告范围', () => {
  it('中期只看上学期：上学期未确认就必须先处理', () => {
    const gaps = gapsFor('midterm', ctx, 'strict');
    expect(gaps.some((g) => g.level === 'block' && g.text.includes('没确认真实性'))).toBe(true);
  });

  it('结题看全项目：有已确认记录就不再拦这一条', () => {
    const gaps = gapsFor('final', ctx, 'strict');
    expect(gaps.some((g) => g.level === 'block' && g.text.includes('没确认真实性'))).toBe(false);
  });
});
