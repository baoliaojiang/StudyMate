import { describe, expect, it } from 'vitest';
import { analyzeRequirement, mergeAnalysis, parseAiExtraction } from '../src/reports/requirement';
import { computeCost, compress, pickByTier } from '../src/ai/gateway';
import { FINAL_TEMPLATE, MIDTERM_TEMPLATE, PROPOSAL_TEMPLATE, RECORD_FIELDS, RECORD_TEMPLATE, blankSections } from '../src/reports/templates';
import { sanityCheck } from '../src/agents/runtime';
import { DEFAULT_RECORD_PLAN, type Project } from '../src/core/types';
import { maskKey, scrubSecrets } from '../src/core/crypto';
import { joinUrl } from '../src/ai/http';

const SAMPLE = `鼓山中学 高二年级 研究性学习通知
本学期每班需提交 研究记录 15 篇，上学期 8 篇，下学期完成剩余部分。
课题名称统一格式，指导教师：林志强
时间：2026年9月 至 2027年6月
正文 3000 字以上，宋体小四，行距 1.5 倍。
`;

describe('要求文本解析', () => {
  it('能抠出学校、年级、教师、篇数与时间', () => {
    const r = analyzeRequirement(SAMPLE);
    const get = (k: string) => r.fields.find((f) => f.key === k)?.value;
    expect(get('school')).toContain('中学');
    expect(get('grade')).toBe('高二');
    expect(get('teacher')).toBe('林志强');
    expect(get('recordTotal')).toBe('15');
    expect(get('startDate')).toBe('2026-09-01');
    expect(get('endDate')).toBe('2027-06-01');
  });

  it('原文没写教师时不会瞎猜，并给出警告', () => {
    const r = analyzeRequirement('请各班提交研究性学习报告，字数为 2000 字以上。');
    expect(r.fields.some((f) => f.key === 'teacher')).toBe(false);
    expect(r.warnings.join()).toContain('指导教师');
  });

  it('空文本返回缺失项清单而不是报错', () => {
    const r = analyzeRequirement('');
    expect(r.fields.length).toBe(0);
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it('AI 只补空缺，与规则冲突时提示用户确认', () => {
    const rule = analyzeRequirement(SAMPLE);
    const merged = mergeAnalysis(rule, { teacher: '王老师', topic: '校园食品安全' });
    const teacher = merged.fields.filter((f) => f.key === 'teacher');
    expect(teacher.length).toBe(1);
    expect(teacher[0].value).toBe('林志强');
    expect(merged.warnings.join()).toContain('不一致');
    expect(merged.fields.find((f) => f.key === 'topic')?.value).toBe('校园食品安全');
  });

  it('能解析带 ``` 包裹的模型输出', () => {
    expect(parseAiExtraction('```json\n{"topic":"A"}\n```')).toEqual({ topic: 'A' });
    expect(parseAiExtraction('完全不是 JSON')).toBeNull();
  });
});

describe('成本与上下文', () => {
  it('按单价估算费用', () => {
    const cost = computeCost(
      { text: '', model: 'x', promptTokens: 1_000_000, completionTokens: 1_000_000, duration: 1 },
      { priceIn: 2, priceOut: 8 },
    );
    expect(cost).toBeCloseTo(10, 6);
  });

  it('未填单价时返回 0，不编造费用', () => {
    expect(computeCost({ text: '', model: 'x', duration: 1 }, {})).toBe(0);
  });

  it('上下文压缩保留首条与最近若干条', () => {
    const msgs = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'first' },
      ...Array.from({ length: 20 }, (_, i) => ({ role: 'user' as const, content: `m${i}` })),
    ];
    const out = compress(msgs, 4);
    expect(out.length).toBeLessThan(msgs.length);
    expect(out[0].content).toBe('sys');
    expect(out[out.length - 1].content).toBe('m19');
  });

  it('按档位选模型', () => {
    const provider = {
      id: 'p',
      kind: 'openai-compatible' as const,
      label: 'x',
      baseUrl: '',
      models: [{ id: '1', name: 'gpt-4o-mini' }, { id: '2', name: 'gpt-4o' }],
      supportsModelList: true,
      timeoutMs: 1000,
      maxRetries: 0,
      createdAt: 0,
      apiKeySealed: { v: 1 as const, iv: '', data: '' },
      apiKeyPreview: '',
      apiKeyLen: 0,
    };
    expect(pickByTier(provider, 'cheap')).toBe('gpt-4o-mini');
    expect(pickByTier(provider, 'strong')).toBe('gpt-4o');
  });
});

describe('报告模板', () => {
  it('开题报告按学校表格：4 个可填格 / 8 行 / 7 列', () => {
    expect(PROPOSAL_TEMPLATE.sections.map((s) => s.heading)).toEqual([
      '简要背景说明',
      '课题的目的和意义',
      '课题活动计划',
      '指导教师意见',
    ]);
    expect(PROPOSAL_TEMPLATE.form!.rows.length).toBe(8);
    expect(PROPOSAL_TEMPLATE.form!.grid).toEqual([1575, 60, 1470, 1230, 1950, 855, 1845]);
  });

  it('中期报告按学校表格：7 行 / 6 列', () => {
    expect(MIDTERM_TEMPLATE.sections.length).toBe(5);
    expect(MIDTERM_TEMPLATE.form!.rows.length).toBe(7);
    expect(MIDTERM_TEMPLATE.form!.grid).toEqual([1546, 1260, 868, 1652, 1173, 2023]);
    expect(MIDTERM_TEMPLATE.sections.map((s) => s.heading)).toEqual([
      '课题进展情况',
      '研究中遇到的问题及对策',
      '自我评定',
      '前一阶段课题组成员的表现',
      '下一阶段研究活动的要点及讨论',
    ]);
  });

  it('结题报告是十章，用「一、二、三」编号', () => {
    expect(FINAL_TEMPLATE.sections.length).toBe(10);
    expect(FINAL_TEMPLATE.sections[0].heading).toBe('一、课题研究的背景（或问题的提出）');
    expect(FINAL_TEMPLATE.sections.at(-1)!.heading).toBe('十、研究中的反思及今后的设想');
  });

  it('记录表：6 行 / 2 列，五个正文字段', () => {
    expect(RECORD_TEMPLATE.form!.rows.length).toBe(6);
    expect(RECORD_TEMPLATE.form!.grid).toEqual([1114, 8460]);
    expect(RECORD_FIELDS.map((f) => f.label)).toEqual([
      '本阶段主要研究目标',
      '本阶段主要研究工作',
      '阶段性成果',
      '工作小结',
      '下阶段研究工作安排',
    ]);
  });

  it('模板出处写明「按学校下发」而不是自称官方', () => {
    for (const t of [PROPOSAL_TEMPLATE, MIDTERM_TEMPLATE, FINAL_TEMPLATE, RECORD_TEMPLATE]) {
      expect(t.note).toContain('学校下发');
      expect(t.note).toContain('还原');
    }
  });

  it('空白章节按模板铺满且带 id', () => {
    const secs = blankSections('final');
    expect(secs.length).toBe(FINAL_TEMPLATE.sections.length);
    expect(new Set(secs.map((s) => s.id)).size).toBe(secs.length);
  });

  it('研究记录字段与记录表六行对应', () => {
    expect(RECORD_FIELDS.map((f) => f.key)).toEqual(['goal', 'work', 'outputs', 'summary', 'nextPlan']);
  });

  it('默认 15 篇按上下学期拆分', () => {
    expect(DEFAULT_RECORD_PLAN.total).toBe(15);
    expect(DEFAULT_RECORD_PLAN.firstTerm + DEFAULT_RECORD_PLAN.secondTerm).toBe(15);
  });
});

describe('真实性护栏', () => {
  const project = { id: 'p', topic: 't' } as unknown as Project;

  it('无真实记录却说已完成 -> 告警', () => {
    const w = sanityCheck('我们已完成 120 份问卷的发放，回收率 96%。', {
      project,
      activities: [],
      datasets: [],
      sources: [],
    });
    expect(w.length).toBeGreaterThan(0);
  });

  it('有真实记录时不误报', () => {
    const w = sanityCheck('本阶段完成了问卷发放，回收 40 份。', {
      project,
      activities: [
        {
          id: 'a',
          projectId: 'p',
          title: '发问卷',
          occurredAt: '2026-10-01',
          participants: ['甲'],
          content: '',
          findings: '',
          sourceType: 'real',
          actuallyHappened: true,
          createdAt: 0,
        },
      ],
      datasets: [{ id: 'd', projectId: 'p', title: 'd', points: [], sourceType: 'real', sourceNote: 'x', createdAt: 0 }],
      sources: [],
    });
    expect(w.filter((x) => x.includes('已完成'))).toEqual([]);
  });
});

describe('密钥与地址工具', () => {
  it('脱敏不泄露完整 Key', () => {
    const k = 'sk-abcdefghijklmnop';
    const masked = maskKey(k);
    expect(masked).not.toContain('efghijklmn');
    expect(masked).toContain('…');
  });

  it('错误信息里会抹掉 Key', () => {
    expect(scrubSecrets('failed with sk-1234567890', ['sk-1234567890'])).not.toContain('1234567890');
  });

  it('baseUrl 带不带 /v1 都能拼对', () => {
    expect(joinUrl('https://api.x.com/v1', '/chat/completions')).toBe('https://api.x.com/v1/chat/completions');
    expect(joinUrl('https://api.x.com', '/chat/completions')).toBe('https://api.x.com/chat/completions');
  });
});
