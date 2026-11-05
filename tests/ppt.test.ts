import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseJsonLoose } from '../src/ppt/generate';
import {
  auditDeck,
  cleanSlideText,
  deckToNotes,
  normalizeSlides,
  templateDeck,
  type DeckFacts,
} from '../src/ppt/model';
import { buildPptx } from '../src/export/pptx';
import type { Dataset, Deck, Project, Report, Source, StudyRecord } from '../src/core/types';

function facts(overrides: Partial<DeckFacts> = {}): DeckFacts {
  const project = {
    id: 'proj-1',
    topic: '校园垃圾分类现状调查',
    teacher: '李老师',
    school: '鼓山中学',
    grade: '高二',
    className: '3 班',
    groupName: '第三小组',
    startDate: '2026-09-01',
    endDate: '2027-06-10',
    requirementText: '研究校园垃圾分类的实施情况',
    members: [{ id: 'm1', name: '小林', role: 'leader' }],
    modes: ['practice'],
    aiMode: 'assist',
    recordPlan: { total: 15, firstTerm: 8, secondTerm: 7 },
    stageIndex: 0,
    confirmations: [],
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  } as unknown as Project;

  const report = {
    id: 'r1', projectId: 'proj-1', kind: 'proposal', title: '开题报告',
    status: 'draft', version: 1, updatedAt: 1,
    sections: [{ id: 's1', heading: '一、课题研究的背景', level: 1, body: '学校垃圾桶旁经常混投。我们想弄清楚原因。', updatedAt: 1 }],
  } as unknown as Report;

  const dataset: Dataset = {
    id: 'ds-real', projectId: 'proj-1', title: '一周混投次数', unit: '次',
    points: [{ label: '周一', value: 12 }, { label: '周二', value: 8 }],
    sourceType: 'real', sourceNote: '2026 年 3 月实地观察', createdAt: 1,
  };

  return {
    project,
    reports: [report],
    records: [] as StudyRecord[],
    datasets: [dataset],
    sources: [] as Source[],
    ...overrides,
  };
}

describe('答辩演示稿 · JSON 与文案清洗', () => {
  it('能从思考标签、代码围栏与前后解释里捞出 JSON', () => {
    const raw = '<think>先想一下</think>这是大纲：\n```json\n{"title":"答辩","slides":[{"layout":"cover","title":"开题"}],}\n```\n希望对你有帮助';
    const obj = parseJsonLoose(raw);
    expect(obj?.title).toBe('答辩');
    expect(Array.isArray(obj?.slides)).toBe(true);
  });

  it('非 JSON 一律返回 null，不让脏输出混进正文', () => {
    expect(parseJsonLoose('我觉得可以分成三页来写，第一页讲背景。')).toBeNull();
  });

  it('去掉 Markdown 符号但保留模拟标识，空内容写待补充', () => {
    expect(cleanSlideText('# **结论**：回收 21 份')).toBe('结论：回收 21 份');
    expect(cleanSlideText('（AI 模拟示例）模拟回收率 84%')).toContain('AI 模拟示例');
    expect(cleanSlideText('   ')).toBe('待补充');
  });
});

describe('答辩演示稿 · 离线模板与本地校验', () => {
  it('模板首尾是封面和结尾，数据页只引用真实存在的数据集', () => {
    const f = facts();
    const deck = templateDeck(f);
    expect(deck.slides.length).toBeGreaterThanOrEqual(8);
    expect(deck.slides[0].layout).toBe('cover');
    expect(deck.slides[deck.slides.length - 1].layout).toBe('end');
    expect(deck.slides.find((s) => s.layout === 'data')?.datasetId).toBe('ds-real');
    expect(deckToNotes(deck, f)).toContain('指导教师意见');
  });

  it('没有真实记录时，模板不会写成「已完成」', () => {
    const deck = templateDeck(facts());
    const all = deck.slides.map((s) => [s.title, s.lead ?? '', ...s.bullets].join(' ')).join('\n');
    expect(all).not.toMatch(/顺利开展|圆满结束|实地走访了/);
    expect(all).toContain('待补充');
  });

  it('模型给的伪造数据集 id 会被丢掉，要点也只留 4 条', () => {
    const slides = normalizeSlides(
      {
        slides: [
          { layout: 'cover', title: '校园垃圾分类现状调查', bullets: ['第三小组'] },
          ...Array.from({ length: 7 }, (_, i) => ({
            layout: i === 3 ? 'data' : 'points',
            title: `第 ${i + 1} 页结论`,
            lead: '一句话结论',
            bullets: ['一', '二', '三', '四', '五', '六'],
            datasetId: 'ds-不存在',
            source: '开题报告',
          })),
          { layout: 'end', title: '谢谢，请老师指正', bullets: [] },
        ],
      },
      facts(),
    );
    expect(slides.every((s) => s.datasetId === undefined)).toBe(true);
    expect(slides.every((s) => s.bullets.length <= 4)).toBe(true);
    expect(slides[0].layout).toBe('cover');
    expect(slides[slides.length - 1].layout).toBe('end');
  });

  it('本地终检能抓到无来源数字与遗漏的模拟标识', () => {
    const f = facts();
    const deck = templateDeck(f);
    deck.slides[2] = {
      ...deck.slides[2],
      title: '回收率达到 84%',
      source: '待补充',
      simulated: true,
      lead: '这次问卷很顺利',
    };
    const issues = auditDeck(deck, f);
    expect(issues.some((x) => x.text.includes('来源与分母'))).toBe(true);
    expect(issues.some((x) => x.text.includes('AI 模拟示例'))).toBe(true);
  });
});

describe('答辩演示稿 · PPTX 文件', () => {
  it('导出的是合法 Office Open XML，含每页幻灯片、演讲备注与中文正文', async () => {
    const f = facts();
    const deck: Deck = templateDeck(f);
    const blob = await buildPptx(deck, f.project, f.datasets);
    expect(blob.size).toBeGreaterThan(10_000);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files);
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('ppt/presentation.xml');
    expect(names).toContain('ppt/slides/slide1.xml');
    expect(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length).toBe(deck.slides.length);
    expect(names.some((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))).toBe(true);
    const slide1 = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slide1).toContain('校园垃圾分类现状调查');
    expect(slide1).toContain('AI 生成内容需核实');
    const dataPage = names.find((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n) && n.includes('slide7'));
    expect(dataPage).toBeTruthy();
  });
});
