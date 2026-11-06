import { describe, expect, it } from 'vitest';
import {
  AI_CLEAN_WARNING,
  cleanAiMarks,
  cleanProjectTexts,
  cleanRecord,
  cleanReport,
  hasAiMarks,
} from '../src/core/ai-clean';
import type { Report, StudyRecord } from '../src/core/types';

function report(body: string, simulated = false): Report {
  return {
    id: 'r1',
    projectId: 'p1',
    kind: 'midterm',
    title: '中期报告',
    sections: [{ id: 's1', heading: '课题进展情况', level: 1, body, updatedAt: 0, containsSimulated: simulated }],
    version: 1,
    updatedAt: 0,
    status: 'draft',
  };
}

function record(work: string): StudyRecord {
  return {
    id: 'rec1',
    projectId: 'p1',
    index: 1,
    term: 1,
    stageName: '',
    activityName: '第一次活动',
    startDate: '',
    endDate: '',
    place: '',
    participants: [],
    recorder: '组长',
    recordedAt: '',
    goal: '',
    work,
    materials: '',
    outputs: '',
    summary: '',
    nextPlan: '',
    attachments: [],
    activityIds: [],
    sourceType: 'real',
    confirmed: false,
    updatedAt: 0,
  };
}

describe('清理正文里的 AI 标注', () => {
  it('删掉推断标注、免责声明与模拟标识', () => {
    const src = [
      '日常写作业、查资料的时候，同学用这类产品的频率在上升（推断，需核实）。',
      '预计在______（需补充实测数据）回收问卷。',
      '（AI 模拟示例）本段为示例内容。',
      '免责声明：本节含 AI 补写内容。标注「需核实」的表述为推断，横线处为缺失的真实数据，须由课题组核对后替换。',
    ].join('\n');
    const out = cleanAiMarks(src);
    expect(out.removed).toBeGreaterThanOrEqual(4);
    expect(out.text).not.toContain('推断，需核实');
    expect(out.text).not.toContain('免责声明');
    expect(out.text).not.toContain('AI 模拟示例');
    expect(out.text).not.toContain('需补充实测数据');
    expect(out.text).toContain('______'); // 数据位保留，仍需自己填
    expect(out.text).toContain('同学用这类产品的频率在上升');
  });

  it('不动「待补充」留白和正常正文', () => {
    const src = '待补充：问卷份数。\n小组按分工整理了资料，形成记录。';
    const out = cleanAiMarks(src);
    expect(out.text).toContain('待补充：问卷份数');
    expect(out.text).toContain('小组按分工整理了资料');
    expect(out.removed).toBe(0);
  });

  it('方头括号与英文括号也认', () => {
    expect(cleanAiMarks('数据【待核实】(需核实)（待核实）').text.trim()).toBe('数据');
  });

  it('行内接在句子后面的免责声明也要清掉', () => {
    // 真机冒烟抓到的缺陷：这段是同一行里的两句话，行规则匹配不到
    const src = '发放问卷并回收（推断，需核实）。免责声明：本节含 AI 补写内容，须由课题组核对后使用。';
    const out = cleanAiMarks(src);
    expect(out.text).toBe('发放问卷并回收。');
    expect(out.text).not.toContain('免责声明');
    expect(out.text).not.toContain('AI 补写内容');
  });

  it('句中出现「本文含 AI 补写内容」也整句清掉', () => {
    const out = cleanAiMarks('结论如下。本文含 AI 补写内容，数据待核对。');
    expect(out.text).toBe('结论如下。');
  });

  it('不误伤自己写的免责声明', () => {
    const src = '免责声明：本文数据均来自 2026 年 5 月发放的问卷。';
    expect(cleanAiMarks(src).text).toBe(src);
  });

  it('清掉模型自我说明式的括号（模拟操作 / 示例内容）', () => {
    const src = '查阅食品安全相关标题（模拟操作，实际未深入检索，此处记录为查找方向），列出关键词。';
    expect(cleanAiMarks(src).text).toBe('查阅食品安全相关标题，列出关键词。');
  });

  it('「（含模拟记录）」这类产出说明也要清掉', () => {
    expect(cleanAiMarks('访谈提纲初稿（含模拟记录）。').text).toBe('访谈提纲初稿。');
  });

  it('不误伤「虚拟仿真实验」这类真实活动名', () => {
    const src = '在机房完成虚拟仿真实验（虚拟仿真实验平台），记录三组数据。';
    expect(cleanAiMarks(src).text).toBe(src);
  });

  it('hasAiMarks 能判断有没有可清理的内容', () => {
    expect(hasAiMarks('本节含 AI 补写内容（推断，需核实）')).toBe(true);
    expect(hasAiMarks('小组按分工整理了资料。')).toBe(false);
  });
});

describe('清理报告与记录', () => {
  it('清理后同步把 containsSimulated 置回 false，避免交付检查误报', () => {
    const out = cleanReport(report('（AI 模拟示例）本节是虚拟示例。', true));
    expect(out.removed).toBeGreaterThan(0);
    expect(out.report.sections[0].containsSimulated).toBe(false);
    expect(out.report.sections[0].body).not.toContain('AI 模拟示例');
  });

  it('项目级清理返回新数组，不改原对象', () => {
    const r = report('正文（推断，需核实）');
    const rec = record('做了取样（AI 模拟示例）');
    const out = cleanProjectTexts([r], [rec]);
    expect(out.removed).toBeGreaterThan(0);
    expect(out.touched).toBe(2);
    expect(r.sections[0].body).toContain('推断，需核实');
    expect(rec.work).toContain('AI 模拟示例');
    expect(out.reports[0].sections[0].body).not.toContain('推断，需核实');
    expect(out.records[0].work).not.toContain('AI 模拟示例');
  });

  it('清理记录时其它正文栏不受影响', () => {
    const rec = record('整理资料（推断，需核实）');
    rec.summary = '本阶段按分工完成记录。';
    const out = cleanRecord(rec);
    expect(out.record.work).toBe('整理资料');
    expect(out.record.summary).toBe('本阶段按分工完成记录。');
  });

  it('警告文案写明不可撤销与不再提示', () => {
    expect(AI_CLEAN_WARNING).toContain('无法撤销');
    expect(AI_CLEAN_WARNING).toContain('逐条核实');
  });
});
