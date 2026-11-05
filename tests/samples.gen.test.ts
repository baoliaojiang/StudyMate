/**
 * 生成可人工核查的样例文件到 samples/。
 * 默认跳过（不参与 npm test），需要时执行：
 *   GEN_SAMPLES=1 npx vitest run tests/samples.gen.test.ts
 *
 * 用途：把 DOCX 落到磁盘后用 Word / WPS 真正打开看版式，
 * 自动化测试只能验证 ZIP 结构与 XML 内容，验不了「印出来长什么样」。
 */
import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { buildRecordsDocx, buildReportDocx, reportToMarkdown } from '../src/docx/builder';
import type { Project, Report, Source, StudyRecord } from '../src/core/types';
import { blankSections } from '../src/reports/templates';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const project: Project = {
  id: 'p1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  topic: '中学生校园食品安全认知调查',
  teacher: '林志强',
  school: '鼓山中学',
  grade: '高二',
  className: '3 班',
  groupName: '第三研究小组',
  startDate: '2026-09-01',
  endDate: '2027-06-30',
  requirementText: '按学校研究性学习手册撰写，正文不少于 3000 字，参考文献不少于 5 条。',
  mainCourse: '化学',
  relatedCourse: '生物、数学',
  members: [
    { id: 'm1', name: '邱奕宸', role: 'leader', duty: '统筹与问卷设计' },
    { id: 'm2', name: '林小满', role: 'member', duty: '数据整理' },
  ],
  modes: ['practice'],
  aiMode: 'assist',
  recordPlan: { total: 15, firstTerm: 8, secondTerm: 7 },
  stageIndex: 2,
  confirmations: [],
  status: 'active',
};

const sources: Source[] = [
  {
    id: 's1',
    projectId: 'p1',
    title: '校园周边食品安全现状分析',
    authors: '张三',
    date: '2025-03-01',
    url: 'https://example.org/a',
    doi: '10.1000/xyz123',
    retrievedAt: Date.now(),
    abstract: '抽样调查了 12 所中学周边的小卖部与摊贩。',
    sourceType: 'literature',
    verifyStatus: 'verified',
  },
  {
    id: 's2',
    projectId: 'p1',
    title: '某市中学生食品安全知识知晓率调查（未核到原文）',
    authors: '李四',
    date: '2024-06-01',
    url: '',
    doi: '',
    retrievedAt: Date.now(),
    abstract: '',
    sourceType: 'web',
    verifyStatus: 'unverified',
  },
];

function makeReport(kind: 'proposal' | 'midterm' | 'final'): Report {
  const sections = blankSections(kind);
  // 只填前两节，其余保留「待补充」占位，用来核验占位文案的排版
  sections[0].body =
    '本次调查源于我们在校门口观察到的情况：午餐时间有大量同学在校外摊点购买食物，包装上多数没有生产日期。\n\n' +
    '- 我们想弄清同学对食品安全的实际了解程度\n' +
    '- 也想弄清他们为什么仍然选择这些摊点\n\n' +
    '已有研究多集中在城市学校，对县城中学的覆盖较少。';
  if (sections[1]) {
    sections[1].body =
      '目的：用可核实的数据描述本校同学对食品安全的认知水平与购买行为。\n\n意义：为学校开展食品安全教育提供依据，也为同学提供自查清单。';
  }
  return {
    id: `r-${kind}`,
    projectId: 'p1',
    kind,
    title:
      kind === 'proposal'
        ? '课题开题报告'
        : kind === 'midterm'
          ? '课题中期检查报告'
          : '研究性学习结题报告',
    sections,
    version: 1,
    updatedAt: Date.now(),
    status: 'review',
  };
}

function makeRecords(): StudyRecord[] {
  return Array.from({ length: 3 }, (_, i) => ({
    id: `rec${i}`,
    projectId: 'p1',
    index: i + 1,
    term: (i < 2 ? 1 : 2) as 1 | 2,
    stageName: `第 ${i + 1} 阶段`,
    activityName: `第 ${i + 1} 次问卷预调查`,
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    place: '高二（3）班教室',
    participants: ['邱奕宸', '林小满'],
    recorder: '邱奕宸',
    recordedAt: '2026-09-30',
    goal: '验证问卷表述是否会被同学误解',
    work: '在课间发放 30 份问卷，逐题记录同学提出的疑问。',
    materials: '问卷打印件 30 份、签字笔 2 支',
    outputs: '回收 20 份，其中 3 份作答不完整；发现 2 道题的选项互斥性有问题。',
    summary: '题目偏多，同学在第 9 题后开始跳答。',
    nextPlan: '删除 4 道重复题，把矩阵题拆开重写。',
    attachments:
      i === 0 ? [{ id: 'a1', name: '现场.png', size: 70, kind: 'image' as const, dataUrl: PNG_1PX }] : [],
    activityIds: [],
    // 第 2 篇标成 AI 模拟示例，用来核验导出里的区分标识
    sourceType: (i === 1 ? 'simulated' : 'real') as 'real' | 'simulated',
    confirmed: true,
    updatedAt: Date.now(),
  }));
}

const run = Boolean(process.env.GEN_SAMPLES);

describe.skipIf(!run)('生成样例文件', () => {
  it('四份报告 + 研究记录 + Markdown 落盘', async () => {
    await mkdir('samples', { recursive: true });

    for (const kind of ['proposal', 'midterm', 'final'] as const) {
      const report = makeReport(kind);
      const blob = await buildReportDocx(kind, project, report, sources, makeRecords());
      const buf = Buffer.from(await blob.arrayBuffer());
      await writeFile(`samples/${report.title}.docx`, buf);
      await writeFile(`samples/${report.title}.md`, reportToMarkdown(project, report, sources), 'utf8');
      // 逐份自检：必须是合法 ZIP
      await JSZip.loadAsync(buf);
    }

    const recordsBlob = await buildRecordsDocx(project, makeRecords(), sources);
    await writeFile('samples/研究记录（3篇）.docx', Buffer.from(await recordsBlob.arrayBuffer()));

    const zip = await JSZip.loadAsync(Buffer.from(await recordsBlob.arrayBuffer()));
    const names = Object.keys(zip.files);
    expect(names).toContain('word/document.xml');
    // 记录表每篇一页：3 篇 → 3 张表
    const doc = await zip.files['word/document.xml'].async('string');
    expect((doc.match(/<w:tbl>/g) ?? []).length).toBe(3);
  });
});
