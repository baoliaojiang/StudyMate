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

function record(sourceType: StudyRecord['sourceType'], confirmed = true, term: 1 | 2 = 1): StudyRecord {
  return {
    id: Math.random().toString(36).slice(2),
    content: 'x',
    term,
    sourceType,
    confirmed,
  } as unknown as StudyRecord;
}

/* ------------------------------ 流程定义 ------------------------------ */

describe('标准研究流程', () => {
  const def: WorkflowDef = defaultWorkflow();

  it('共 22 步，其中 7 个确认门、2 个记录守卫（上/下学期各一个）', () => {
    expect(def.steps.length).toBe(22);
    expect(def.steps.filter((s) => s.kind === 'gate').length).toBe(7);
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

  it('上学期：开题确认 → 起草记录 → 确认记录 → 核对；下学期同理跟在中期审核之后', () => {
    const ids = def.steps.map((s) => s.id);
    const t1 = ids.indexOf('records-draft-t1');
    expect(ids.indexOf('proposal-confirm')).toBe(t1 - 1);
    expect(ids.slice(t1, t1 + 3)).toEqual(['records-draft-t1', 'records-confirm-t1', 'records-guard-t1']);

    const t2 = ids.indexOf('records-draft-t2');
    expect(ids.indexOf('midterm-review')).toBe(t2 - 1);
    expect(ids.slice(t2, t2 + 3)).toEqual(['records-draft-t2', 'records-confirm-t2', 'records-guard-t2']);
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

/**
 * 回归：每个「记录守卫」前面必须真的有一支写入步骤。
 * 之前只有守卫没有写入，新项目跑到第 12 步必然失败，工作流等于跑不起来。
 */
describe('过程记录必须能自己写出来', () => {
  const ids = DEFAULT_STEPS.map((s) => s.id);

  it('两个学期都先起草、再确认、最后核对', () => {
    for (const term of [1, 2] as const) {
      const draft = ids.indexOf(`records-draft-t${term}`);
      const confirm = ids.indexOf(`records-confirm-t${term}`);
      const guard = ids.indexOf(`records-guard-t${term}`);
      expect(draft).toBeGreaterThanOrEqual(0);
      expect(confirm).toBeGreaterThan(draft);
      expect(guard).toBeGreaterThan(confirm);
    }
  });

  it('起草步骤绑定了 Agent，且标注了学期', () => {
    for (const term of [1, 2] as const) {
      const s = DEFAULT_STEPS.find((x) => x.id === `records-draft-t${term}`)!;
      expect(s.kind).toBe('records');
      expect(s.term).toBe(term);
      expect(!!s.agentId).toBe(true);
    }
  });

  it('起草步骤排在中期报告之前，不会等写完中期才补记录', () => {
    expect(ids.indexOf('records-draft-t1')).toBeLessThan(ids.indexOf('midterm-write'));
    expect(ids.indexOf('records-draft-t2')).toBeLessThan(ids.indexOf('final-write'));
  });

  it('门与守卫都要求「已确认的真实记录」，草稿通过不了', () => {
    for (const term of [1, 2] as const) {
      const draftOnly = { project: project(), reports: [], records: [record('real', false, term)] };
      const confirmed = { project: project(), reports: [], records: [record('real', true, term)] };
      expect(stepCompleted(`records-confirm-t${term}`, draftOnly)).toBe(false);
      expect(stepCompleted(`records-guard-t${term}`, draftOnly)).toBe(false);
      expect(stepCompleted(`records-guard-t${term}`, confirmed)).toBe(true);
    }
  });

  it('已经写了记录就算起草完成，不会重跑覆盖', () => {
    const withRec = { project: project(), reports: [], records: [record('real', false, 1)] };
    expect(stepCompleted('records-draft-t1', withRec)).toBe(true);
    const otherTerm = { project: project(), reports: [], records: [record('real', false, 2)] };
    expect(stepCompleted('records-draft-t1', otherTerm)).toBe(false);
  });

  it('步骤总数与说明一致（22 步 / 7 门 / 2 守卫）', () => {
    const wf = defaultWorkflow();
    expect(wf.steps).toHaveLength(22);
    expect(wf.steps.filter((s) => s.kind === 'gate')).toHaveLength(7);
    expect(wf.steps.filter((s) => s.kind === 'guard')).toHaveLength(2);
    expect(wf.desc).toContain('22 步');
  });
});
