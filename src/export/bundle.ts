import JSZip from 'jszip';
import type { Project, Report, Source, StudyRecord } from '../core/types';
import {
  buildRecordsDocx,
  buildReportDocx,
  recordsToMarkdown,
  reportToMarkdown,
} from '../docx/builder';

export interface BundleInput {
  project: Project;
  reports: Report[];
  records: StudyRecord[];
  sources: Source[];
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeName(s: string): string {
  return (s || '未命名').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
}

/** 单份导出 */
export async function exportOne(
  kind: 'proposal' | 'midterm' | 'final' | 'progress' | 'md',
  input: BundleInput,
): Promise<void> {
  const { project, reports, records, sources } = input;
  const base = safeName(`${project.topic}_${project.groupName || ''}`);

  if (kind === 'progress') {
    const blob = await buildRecordsDocx(project, records, sources);
    downloadBlob(blob, `${base}_研究记录（${records.length}篇）.docx`);
    return;
  }
  if (kind === 'md') {
    const md = [
      ...reports.map((r) => reportToMarkdown(project, r, sources)),
      recordsToMarkdown(project, records),
    ].join('\n\n---\n\n');
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${base}_全部报告.md`);
    return;
  }
  const report = reports.find((r) => r.kind === kind);
  if (!report) throw new Error(`找不到 ${kind} 报告`);
  const blob = await buildReportDocx(kind, project, report, sources, records);
  downloadBlob(blob, `${base}_${report.title}.docx`);
}

/** 四份打包：ZIP 项目资料包 */
export async function exportBundle(input: BundleInput): Promise<void> {
  const { project, reports, records, sources } = input;
  const base = safeName(`${project.topic}_${project.groupName || ''}`);
  const zip = new JSZip();
  const root = zip.folder(base)!;

  for (const r of reports) {
    if (r.kind === 'progress') continue;
    const kind = r.kind as 'proposal' | 'midterm' | 'final';
    const blob = await buildReportDocx(kind, project, r, sources, records);
    root.file(`${safeName(r.title)}.docx`, blob);
    root.file(`${safeName(r.title)}.md`, reportToMarkdown(project, r, sources));
  }

  if (records.length) {
    root.file(`研究记录（${records.length}篇）.docx`, await buildRecordsDocx(project, records, sources));
    root.file('研究记录.md', recordsToMarkdown(project, records));
  }

  root.file(
    '项目资料.json',
    JSON.stringify(
      {
        导出时间: new Date().toISOString(),
        声明:
          '本资料包由研学帮 StudyMate（第三方开源工具）生成，不代表学校、教师或教育主管部门立场。AI 生成内容须核实后使用。',
        项目: project,
        报告: reports,
        研究记录: records,
        来源: sources,
      },
      null,
      2,
    ),
  );

  root.file('来源清单.md', renderSourceMarkdown(sources));
  root.file('README.txt', renderReadme(project, reports.length, records.length, sources.length));

  const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  downloadBlob(out, `${base}_项目资料包.zip`);
}

function renderSourceMarkdown(sources: Source[]): string {
  const lines = ['# 来源清单', '', `共 ${sources.length} 条。`, ''];
  sources.forEach((s, i) => {
    lines.push(
      `## [${i + 1}] ${s.title}`,
      '',
      `- 作者/机构：${s.authors || '未填写'}`,
      `- 日期：${s.date || '未填写'}`,
      `- DOI：${s.doi || '无'}`,
      `- URL：${s.url || '无'}`,
      `- 来源类型：${s.sourceType}`,
      `- 核验状态：${s.verifyStatus === 'verified' ? '已核验' : s.verifyStatus === 'failed' ? '核验失败' : '待核实'}`,
      `- 检索于：${new Date(s.retrievedAt).toLocaleString('zh-CN')}`,
      '',
      s.abstract ? `> ${s.abstract}` : '',
      '',
    );
  });
  return lines.join('\n');
}

function renderReadme(project: Project, reports: number, records: number, sources: number): string {
  return [
    `研学帮 StudyMate 导出包`,
    `课题：${project.topic}`,
    `学校：${project.school}　年级：${project.grade}　班级：${project.className}`,
    `成员：${project.members.map((m) => m.name).join('、')}`,
    `指导教师：${project.teacher}`,
    `报告 ${reports} 份　研究记录 ${records} 篇　来源 ${sources} 条`,
    '',
    '重要声明：',
    '1. 本软件为个人开发的第三方 AI 辅助工具，与学校及其管理部门不存在官方隶属、授权、合作或背书关系。',
    '2. AI 生成内容可能存在错误、遗漏或过时信息，请逐条核实；AI 生成报告不代表研究活动已经真实开展。',
    '3. 标有「（AI 模拟示例）」的内容为虚拟示例，不得作为真实调查、实验或访谈结果提交。',
    '4. 提交前请按学校要求检查格式，并交由指导教师审阅。',
  ].join('\n');
}
