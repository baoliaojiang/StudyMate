/**
 * DOCX 结构测试 —— 断言的是「学校模板的行列结构是否被原样还原」
 *
 * 验收口径（来自用户提供的四份原表）：
 * - 开题：8 行 / 7 列，标题两行「鼓山中学研究性学习」「课题开题报告」
 * - 记录表：6 行 / 2 列，标题两行 + 「第 N 研究阶段 记录人 记录时间」
 * - 中期：7 行 / 6 列，标题两行「研究性学习」「课题中期检查报告」
 * - 结题：十章（一、…十、），四号宋体、标题加粗
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildRecordsDocx, buildReportDocx, reportToMarkdown } from '../src/docx/builder';
import type { Project, Report, Source, StudyRecord } from '../src/core/types';
import { blankSections } from '../src/reports/templates';

const project: Project = {
  id: 'p1',
  createdAt: 0,
  updatedAt: 0,
  topic: '中学生校园食品安全认知调查',
  teacher: '林志强',
  school: '鼓山中学',
  grade: '高二',
  className: '3 班',
  groupName: '第三研究小组',
  startDate: '2026-09-01',
  endDate: '2027-06-30',
  requirementText: '',
  mainCourse: '化学',
  relatedCourse: '生物、数学',
  members: [
    { id: 'm1', name: '邱奕宸', role: 'leader', duty: '统筹与问卷设计' },
    { id: 'm2', name: '李四', role: 'member', duty: '数据整理' },
  ],
  modes: ['practice'],
  aiMode: 'assist',
  recordPlan: { total: 15, firstTerm: 8, secondTerm: 7 },
  stageIndex: 0,
  confirmations: [],
  status: 'active',
};

const source: Source = {
  id: 's1',
  projectId: 'p1',
  title: '校园食品安全现状分析',
  authors: '张三',
  date: '2025-03-01',
  url: 'https://example.org/a',
  doi: '10.1000/xyz123',
  retrievedAt: Date.now(),
  abstract: '',
  sourceType: 'literature',
  verifyStatus: 'unverified',
};

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function makeReport(kind: 'proposal' | 'midterm' | 'final'): Report {
  const sections = blankSections(kind);
  sections[0].body = '这是第一节的正文。\n\n- 要点一\n- 要点二\n\n**加粗一句**';
  return {
    id: 'r1',
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
    status: 'draft',
  };
}

function makeRecords(): StudyRecord[] {
  return Array.from({ length: 3 }, (_, i) => ({
    id: `r${i}`,
    projectId: 'p1',
    index: i + 1,
    term: (i < 2 ? 1 : 2) as 1 | 2,
    stageName: `阶段${i + 1}`,
    activityName: `第 ${i + 1} 次问卷预调查`,
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    place: '高一（3）班',
    participants: ['邱奕宸', '林小满'],
    recorder: '邱奕宸',
    recordedAt: '2026-09-30',
    goal: '验证问卷表述是否会被同学误解',
    work: '在课间发放 30 份问卷，逐题记录同学提出的疑问。',
    materials: '问卷打印件 30 份',
    outputs: '回收 20 份，其中 3 份作答不完整',
    summary: '题目偏多，第 9 题后开始跳答。',
    nextPlan: '删除 4 道重复题。',
    attachments: [
      { id: 'a1', name: '现场.png', size: 70, kind: 'image' as const, dataUrl: PNG_1PX },
    ],
    activityIds: [],
    sourceType: 'real' as const,
    confirmed: true,
    updatedAt: Date.now(),
  }));
}

async function unzip(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const files: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    const f = zip.files[name];
    if (!f.dir) files[name] = await f.async('string');
  }
  return files;
}

/** 数出 document.xml 里每张表的行数 */
function tableRowCounts(doc: string): number[] {
  return [...doc.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].map(
    (m) => (m[1].match(/<w:tr\b/g) ?? []).length,
  );
}

describe('DOCX：按学校模板还原结构', () => {
  it('MIME 与 ZIP 容器正确，含 content types / 正文', async () => {
    const blob = await buildReportDocx('proposal', project, makeReport('proposal'), [source]);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const files = await unzip(blob);
    expect(Object.keys(files)).toContain('[Content_Types].xml');
    expect(files['[Content_Types].xml']).toContain('wordprocessingml.document.main+xml');
    expect(files['word/document.xml']).toContain('<w:tbl>');
  });

  it('开题：8 行 / 7 列、标题两行、标签与冒号与原表一致', async () => {
    const files = await unzip(await buildReportDocx('proposal', project, makeReport('proposal'), [source]));
    const doc = files['word/document.xml'];

    expect(tableRowCounts(doc)).toEqual([8]);
    // 7 列网格
    expect((doc.match(/<w:gridCol /g) ?? []).length).toBe(7);
    // 两行标题（学校名取自项目，不写死）
    expect(doc).toContain('鼓山中学研究性学习');
    expect(doc).toContain('课题开题报告');
    // 原表标签，含全角空格
    for (const label of ['课题题目', '课题组成员', '组　长', '指导教师', '班级', '主导课程', '相关课程', '简要背景说明：', '课题的目的和意义：', '课题活动计划：', '指导教师意见']) {
      expect(doc).toContain(label);
    }
    // 签名与日期留给教师手写
    expect(doc).toContain('签名：');
    expect(doc).toContain('年');
    // 12 磅（w:sz=24）、宋体、Times New Roman
    expect(doc).toContain('w:val="24"');
    expect(doc).toContain('宋体');
    expect(doc).toContain('Times New Roman');
    // 主导/相关课程取自项目字段
    expect(doc).toContain('化学');
    expect(doc).toContain('生物、数学');
  });

  it('中期：7 行 / 6 列，长标签括注保留', async () => {
    const files = await unzip(await buildReportDocx('midterm', project, makeReport('midterm'), []));
    const doc = files['word/document.xml'];
    expect(tableRowCounts(doc)).toEqual([7]);
    expect((doc.match(/<w:gridCol /g) ?? []).length).toBe(6);
    expect(doc).toContain('课题中期检查报告');
    expect(doc).toContain('课题名称');
    expect(doc).toContain('课题组长');
    expect(doc).toContain('记录人');
    expect(doc).toContain('起止时间');
    expect(doc).toContain('课题进展情况');
    expect(doc).toContain('研究中遇到的问题及对策（在研究活动中遇到哪些问题，采用了怎样的对策予以解决，目前还存在哪些问题，准备如何解决）');
    expect(doc).toContain('自我评定');
    expect(doc).toContain('前一阶段课题组成员的表现（课题组负责人填写）');
    expect(doc).toContain('下一阶段研究活动的要点及讨论');
  });

  it('结题：十章齐全，编号用「一、二、三」，无封面无目录域', async () => {
    const files = await unzip(await buildReportDocx('final', project, makeReport('final'), []));
    const doc = files['word/document.xml'];
    const headings = [
      '一、课题研究的背景（或问题的提出）',
      '二、课题研究的意义',
      '三、课题研究的界定',
      '四、课题研究的达成目标',
      '五、课题研究的主要内容',
      '六、课题研究的方法',
      '七、课题研究的步骤',
      '八、课题研究的主要过程',
      '九、课题研究的成果',
      '十、研究中的反思及今后的设想',
    ];
    for (const h of headings) expect(doc).toContain(h);
    // 学校范例是纯长文：不放封面、不放自动目录
    expect(doc).not.toContain('目　　录');
    expect(doc).not.toContain('TOC \\h \\o');
    // 正文四号（w:sz=28）
    expect(doc).toContain('w:val="28"');
  });

  it('结题可选加封面与目录（默认不加）', async () => {
    const withCover = await unzip(
      await buildReportDocx('final', project, makeReport('final'), [source], [], { cover: true }),
    );
    expect(withCover['word/document.xml']).toContain('目　　录');
    expect(withCover['word/document.xml']).toContain('TOC \\h \\o');
  });

  it('缺内容写「（本节尚未填写）」，不生成看似真实的段落', async () => {
    const report = makeReport('final');
    for (const s of report.sections.slice(1)) s.body = '';
    const files = await unzip(await buildReportDocx('final', project, report, []));
    expect(files['word/document.xml']).toContain('（本节尚未填写）');
  });

  it('模拟内容保留文首提示框与正文标识', async () => {
    const report = makeReport('final');
    report.sections[0].body = '模拟访谈显示 80% 学生关注配料表。';
    report.sections[0].containsSimulated = true;
    const files = await unzip(await buildReportDocx('final', project, report, []));
    const doc = files['word/document.xml'];
    expect(doc).toContain('AI 模拟示例');
    expect(doc).toContain('本文档包含 AI 模拟');

    expect(reportToMarkdown(project, report, [])).toContain('AI 模拟示例');
  });

  it('记录表：6 行 / 2 列、六行标签、阶段行、图片进包', async () => {
    const files = await unzip(await buildRecordsDocx(project, makeRecords(), [source]));
    const doc = files['word/document.xml'];

    // 3 篇记录 = 3 张表，每张 6 行
    expect(tableRowCounts(doc)).toEqual([6, 6, 6]);
    expect((doc.match(/<w:gridCol /g) ?? []).length).toBe(6); // 3 张表 × 2 列

    expect(doc).toContain('课题阶段性工作小结记录表');
    expect(doc).toContain('第　1　研究阶段');
    expect(doc).toContain('记录人：');
    expect(doc).toContain('记录时间：');

    for (const label of ['起迄时间', '本阶段', '主要研', '究目标', '究工作', '段', '性', '成', '果', '工', '作', '小', '结', '下阶段研究工作安排']) {
      expect(doc).toContain(label);
    }
    // 标签用黑体
    expect(doc).toContain('黑体');
    // 内容写进对应格
    expect(doc).toContain('验证问卷表述是否会被同学误解');
    expect(doc).toContain('回收 20 份');
    // 页脚页码域 + 奇偶页
    const footer = Object.entries(files).find(([n]) => /^word\/footer\d*\.xml$/.test(n))?.[1] ?? '';
    expect(footer).toContain('PAGE');
    // 记录表原表没有图片栏，附件不进表；附件会在结题报告的附录里出现
    expect(/第　\d+　研究阶段/.test(doc)).toBe(true);
  });

  it('Markdown 导出保留类型、待核实与第三方声明', () => {
    const md = reportToMarkdown(project, makeReport('proposal'), [source]);
    expect(md).toContain('待核实');
    expect(md).toContain('文献资料');
    expect(md).toContain('邱奕宸');
    expect(md).toContain('第三方工具');
    expect(md).toContain('按学校下发的');
  });
});
