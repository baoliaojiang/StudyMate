import { describe, expect, it } from 'vitest';
import {
  FILL_DISCLAIMER,
  NO_FABRICATION_RULE,
  gapsFor,
  sectionPrompt,
  type ReportContext,
} from '../src/reports/context';
import type { Project } from '../src/core/types';

/** 只有最基本的字段，其余按需缺省——缺口计算只读 members / topic 等少数几个 */
function ctx(over: Partial<Project> = {}, records: ReportContext['records'] = []): ReportContext {
  const project = {
    members: [],
    topic: '测试课题',
    requirementText: '',
    recordPlan: { total: 3 },
    ...over,
  } as unknown as Project;
  return { project, records, sources: [], datasets: [] };
}

function prompt(mode?: 'strict' | 'fill') {
  return sectionPrompt({
    kind: 'final',
    heading: '八、课题研究的主要过程',
    hint: '按阶段陈述实际做法。',
    words: 900,
    ctxText: '【研究记录】共 0 篇',
    gaps: [],
    mode,
  });
}

describe('写作模式：留白 / 写满', () => {
  it('默认按留白处理：写「待补充」，不出现补全模式规则', () => {
    const text = prompt();
    expect(text).toContain('待补充');
    expect(text).toContain(NO_FABRICATION_RULE);
    expect(text).not.toContain('写作模式：补全');
    expect(text).not.toContain(FILL_DISCLAIMER);
  });

  it('写满模式仍然禁止编造具体数据与文献，并要求带免责声明', () => {
    const text = prompt('fill');
    expect(text).toContain('写作模式：补全');
    expect(text).toContain('（推断，需核实）');
    expect(text).toContain('不得虚构参考文献');
    expect(text).toContain('______（需补充实测数据）');
    expect(text).toContain(FILL_DISCLAIMER);
    // 补全模式不再要求整段留白
    expect(text).not.toContain(NO_FABRICATION_RULE);
  });

  it('没有任何研究记录：留白模式算阻断，写满模式降级为提醒', () => {
    const strict = gapsFor('final', ctx(), 'strict');
    const fill = gapsFor('final', ctx(), 'fill');
    expect(strict.some((g) => g.level === 'block' && g.text.includes('没有任何研究记录'))).toBe(true);
    expect(fill.some((g) => g.text.includes('没有任何研究记录'))).toBe(true);
    expect(fill.some((g) => g.level === 'block' && g.text.includes('没有任何研究记录'))).toBe(false);
  });

  it('没有成员名单在任何模式下都阻断（结构缺失无法推断）', () => {
    for (const mode of ['strict', 'fill'] as const) {
      expect(gapsFor('midterm', ctx(), mode).some((g) => g.level === 'block')).toBe(true);
    }
  });

  it('写满模式会在缺口里写明「需逐条核对」', () => {
    const fill = gapsFor('midterm', ctx(), 'fill');
    expect(fill.some((g) => g.text.includes('逐条核对'))).toBe(true);
  });
});
