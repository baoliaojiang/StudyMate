/**
 * 工作流图与守卫逻辑（纯函数，不碰 IndexedDB / 网络）
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STEPS,
  defaultWorkflow,
  gateNeedsConfirm,
  selectSteps,
  stepCompleted,
  currentReportKind,
} from '../src/workflow/graph';
import type { Project, Report, StudyRecord, WorkflowDef, WorkflowStepDef } from '../src/core/types';

/* ------------------------------ 测试数据工厂 ------------------------------ */

function project(members: { name: string; duty?: string }[] = []): Project {
  return {
    id: 'p1',
    name: '测试课题',
    topic: '校园植物调查',
    members: members.map((m, i) => ({ id: `m${i}`, name: m.name, duty: m.duty ?? '' })),
  } as unknown as Project;
}

function report(kind: Report['kind'], opts: { body?: string; status?: Report['status'] } = {}): Report {
  return {
    id: `r-${kind}`,
    projectId: 'p1',
    kind,
    title: kind,
    sections: [{ id: 's1', heading: '一、研究背景', body: opts.body ?? '', hint: '', words: 300 }],
    status: opts.status ?? 'draft',
    version: 1,
    updatedAt: 0,
  } as unknown as Report;
}

function record(sourceType: StudyRecord['sourceType'], confirmed = true): StudyRecord {
  return {
    id: Math.random().toString(36).slice(2),
    content: 'x',
    sourceType,
    confirmed,
  } as unknown as StudyRecord;
}

/* ------------------------------ 流程定义 ------------------------------ */

describe('标准研究流程', () => {
  const def: WorkflowDef = defaultWorkflow();

  it('共 18 步，其中 5 个确认门、2 个记录守卫（上/下学期各一个）', () => {
    expect(def.steps.length).toBe(18);
    expect(def.steps.filter((s) => s.kind === 'gate').length).toBe(5);
    expect(def.steps.filter((s) => s.id.startsWith('records-guard')).length).toBe(2);
    expect(def.steps.find((s) => s.id === 'records-guard-t1')?.term).toBe(1);
    expect(def.steps.find((s) => s.id === 'records-guard-t2')?.term).toBe(2);
  });

  it('建议顺序：… → 开题确认 → 上学期记录 → 中期 → 下学期记录 → 结题 → 终审 → 导出', () => {
    expect(def.steps[0].id).toBe('analyze');
    expect(def.steps[1].id).toBe('confirm-plan');
    expect(def.steps[2].id).toBe('search');
    expect(def.steps[3].id).toBe('confirm-sources');
    const ids = def.steps.map((s) => s.id);
    expect(ids.indexOf('confirm-plan')).toBeLessThan(ids.indexOf('search'));
    expect(ids.indexOf('confirm-sources')).toBeLessThan(ids.indexOf('design'));
    expect(ids.indexOf('confirm-method')).toBeLessThan(ids.indexOf('assign'));
    expect(ids.indexOf('confirm-assign')).toBeLessThan(ids.indexOf('proposal-write'));
    expect(ids.indexOf('records-guard-t1')).toBeLessThan(ids.indexOf('midterm-write'));
    expect(ids.indexOf('midterm-review')).toBeLessThan(ids.indexOf('records-guard-t2'));
    expect(ids.indexOf('records-guard-t2')).toBeLessThan(ids.indexOf('final-write'));
    expect(ids.indexOf('final-review')).toBeLessThan(ids.indexOf('export'));
  });

  it('上学期守卫紧跟在开题确认之后、下学期守卫紧跟中期审核之后', () => {
    const ids = def.steps.map((s) => s.id);
    expect(ids.indexOf('proposal-confirm')).toBe(ids.indexOf('records-guard-t1') - 1);
    expect(ids.indexOf('midterm-review')).toBe(ids.indexOf('records-guard-t2') - 1);
  });
});

/* ------------------------------ 范围筛选 ------------------------------ */

describe('selectSteps 三种范围', () => {
  const def = defaultWorkflow();
  const ctx = {
    project: project([{ name: '张三', duty: '组长' }]),
    reports: [report('proposal', { body: '有内容' })],
    records: [],
  };

  it('project：全部启用步骤', () => {
    const all = selectSteps(def, 'project');
    expect(all.length).toBe(DEFAULT_STEPS.length);
    const withDisabled = { ...def, steps: def.steps.map((s, i) => (i === 0 ? { ...s, enabled: false } : s)) } as WorkflowDef;
    expect(selectSteps(withDisabled, 'project').length).toBe(DEFAULT_STEPS.length - 1);
  });

  it('report：只留当前报告相关的步骤', () => {
    const steps = selectSteps(def, 'report', ctx);
    expect(steps.length).toBeGreaterThan(0);
    // 开题未确认 → 当前是 proposal
    for (const s of steps) expect(s.report).toBe('proposal');
  });

  it('stage：只留当前阶段（计划阶段的下一步还没做时）', () => {
    const steps = selectSteps(def, 'stage', ctx);
    const phases = new Set(steps.map((s) => s.phase));
    expect(phases.size).toBe(1);
  });
});

/* ------------------------------ 确认门 ------------------------------ */

describe('gateNeedsConfirm', () => {
  it('project / report 范围每一道门都停', () => {
    expect(gateNeedsConfirm('project', 17, 0)).toBe(true);
    expect(gateNeedsConfirm('project', 17, 16)).toBe(true);
    expect(gateNeedsConfirm('report', 5, 2)).toBe(true);
  });

  it('stage 范围只有最后一道门停，中间的自动通过', () => {
    expect(gateNeedsConfirm('stage', 6, 0)).toBe(false);
    expect(gateNeedsConfirm('stage', 6, 4)).toBe(false);
    expect(gateNeedsConfirm('stage', 6, 5)).toBe(true);
  });
});

/* ------------------------------ 进度与守卫 ------------------------------ */

describe('stepCompleted', () => {
  it('records-guard：没有已确认的真实记录就是没完成（中期推进被拦住）', () => {
    const empty = { project: project(), reports: [], records: [] };
    expect(stepCompleted('records-guard', empty)).toBe(false);

    const simOnly = { project: project(), reports: [], records: [record('simulated'), record('simulated')] };
    expect(stepCompleted('records-guard', simOnly)).toBe(false);

    const unconfirmed = { project: project(), reports: [], records: [record('real', false)] };
    expect(stepCompleted('records-guard', unconfirmed)).toBe(false);

    const ok = { project: project(), reports: [], records: [record('real'), record('simulated')] };
    expect(stepCompleted('records-guard', ok)).toBe(true);
  });

  it('分工完成的判定是「至少有一名成员填了分工」', () => {
    expect(stepCompleted('assign', { project: project([{ name: '张三' }]), reports: [], records: [] })).toBe(false);
    expect(stepCompleted('assign', { project: project([{ name: '张三', duty: '访谈' }]), reports: [], records: [] })).toBe(true);
  });

  it('报告类步骤以「已确认」为准，草稿不算', () => {
    const draft = { project: project(), reports: [report('proposal', { body: '写了' })], records: [] };
    const confirmed = {
      project: project(),
      reports: [report('proposal', { body: '写了', status: 'confirmed' })],
      records: [],
    };
    expect(stepCompleted('proposal-write', draft)).toBe(false);
    expect(stepCompleted('proposal-write', confirmed)).toBe(true);
  });
});

describe('currentReportKind', () => {
  it('开题未确认 → proposal；确认后 → midterm；都确认 → final', () => {
    expect(currentReportKind([])).toBe('proposal');
    expect(currentReportKind([report('proposal', { status: 'confirmed' })])).toBe('midterm');
    expect(
      currentReportKind([report('proposal', { status: 'confirmed' }), report('midterm', { status: 'confirmed' })]),
    ).toBe('final');
  });
});
