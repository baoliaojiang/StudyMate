import { describe, expect, it } from 'vitest';
import { preflight, renderChecklist, countChecks } from '../src/export/preflight';
import { selectRecords, selectReports } from '../src/export/bundle';
import type { Project, Report, ReportSection, Source, StudyRecord } from '../src/core/types';

const project = {
  id: 'p1',
  topic: '闽江水质调查',
  teacher: '陈老师',
  members: [{ id: 'm1', name: '张三' }],
  modes: ['theory'],
} as unknown as Project;

function section(heading: string, body: string, extra: Partial<ReportSection> = {}): ReportSection {
  return { id: `s-${heading}`, heading, level: 1, body, updatedAt: 0, ...extra };
}

function report(kind: Report['kind'], sections: ReportSection[], status: Report['status'] = 'draft'): Report {
  return {
    id: `r-${kind}`,
    projectId: 'p1',
    kind,
    title: `${kind} 报告`,
    sections,
    version: 1,
    updatedAt: 0,
    status,
  };
}

function record(index: number, term: 1 | 2, filled = true, confirmed = false): StudyRecord {
  return {
    id: `rec-${index}`,
    projectId: 'p1',
    index,
    term,
    stageName: '',
    activityName: filled ? `第 ${index} 次活动` : '',
    startDate: '',
    endDate: '',
    place: '',
    participants: [],
    recorder: '',
    recordedAt: '',
    goal: '',
    work: filled ? '做了取样与记录' : '',
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

const verifiedSource = {
  id: 'src1',
  projectId: 'p1',
  title: '水质标准',
  authors: '',
  date: '',
  url: '',
  doi: '',
  retrievedAt: 0,
  abstract: '',
  sourceType: 'official',
  verifyStatus: 'verified',
} as unknown as Source;

describe('交付前核对', () => {
  it('必填栏目为空时给提醒，不阻塞导出', () => {
    const checks = preflight({
      project,
      reports: [report('proposal', [])],
      records: [record(1, 1)],
      sources: [verifiedSource],
    });
    expect(checks.some((c) => c.level === 'warn' && c.text.includes('必填栏目'))).toBe(true);
    expect(checks.some((c) => c.level === 'block')).toBe(false);
  });

  it('「指导教师意见」被写入时必须先处理：这一栏只能老师本人写', () => {
    const checks = preflight({
      project,
      reports: [report('final', [section('指导教师意见', '该课题完成较好，同意结题。', { origin: 'ai' })])],
      records: [record(1, 1)],
      sources: [verifiedSource],
    });
    const hit = checks.find((c) => c.id.startsWith('teacher-'));
    expect(hit?.level).toBe('block');
  });

  it('模拟内容缺少标识时必须先处理，带了标识就不报', () => {
    const missing = preflight({
      project,
      reports: [report('midterm', [section('研究过程', '我们做了三次取样。', { containsSimulated: true })])],
      records: [record(1, 1)],
      sources: [verifiedSource],
    });
    expect(missing.some((c) => c.id.startsWith('sim-') && c.level === 'block')).toBe(true);

    const ok = preflight({
      project,
      reports: [
        report('midterm', [section('研究过程', '（AI 模拟示例）我们做了三次取样。', { containsSimulated: true })]),
      ],
      records: [record(1, 1)],
      sources: [verifiedSource],
    });
    expect(ok.some((c) => c.id.startsWith('sim-'))).toBe(false);
  });

  it('来源未核验、记录未确认都只提醒，不拦导出', () => {
    const checks = preflight({
      project,
      reports: [report('proposal', [section('一、课题研究的背景', '正文内容')], 'confirmed')],
      records: [record(1, 1, true, false)],
      sources: [{ ...verifiedSource, verifyStatus: 'unverified' } as Source],
    });
    expect(checks.some((c) => c.id === 'sources-unverified' && c.level === 'warn')).toBe(true);
    expect(checks.some((c) => c.id === 'records-unconfirmed' && c.level === 'warn')).toBe(true);
    expect(countChecks(checks).block).toBe(0);
  });

  it('清单写清楚两栏与第三方声明', () => {
    const md = renderChecklist([
      { id: 'a', level: 'block', where: '结题报告', text: '教师意见不能代写' },
      { id: 'b', level: 'warn', where: '来源', text: '2 条待核实' },
    ]);
    expect(md).toContain('## 必须先处理');
    expect(md).toContain('## 建议核对');
    expect(md).toContain('第三方开源工具');
    expect(md).toContain('教师意见不能代写');
  });
});

describe('批量导出的范围选择', () => {
  const reports = [report('proposal', []), report('midterm', []), report('final', []), report('progress', [])];
  const records = [record(1, 1), record(2, 1), record(3, 2), record(4, 2)];

  it('只导出勾选的报告，记录表不重复进报告列表', () => {
    const picked = selectReports(reports, { reports: ['proposal', 'final'] });
    expect(picked.map((r) => r.kind)).toEqual(['proposal', 'final']);
    expect(selectReports(reports).map((r) => r.kind)).toEqual(['proposal', 'midterm', 'final']);
  });

  it('按学期与篇号筛记录，并保持第几篇的顺序', () => {
    expect(selectRecords(records, { records: { term: 1 } }).map((r) => r.index)).toEqual([1, 2]);
    expect(selectRecords(records, { records: { from: 2, to: 3 } }).map((r) => r.index)).toEqual([2, 3]);
    expect(selectRecords(records, { records: { term: 2, from: 4 } }).map((r) => r.index)).toEqual([4]);
  });
});
