/**
 * 单篇过程记录导出
 *
 * 一篇一个 DOCX，文件名带「第 N 篇 + 学期」，方便老师按篇收。
 * 导出前把「未确认为真实」这件事写在提示里，不藏在文件里假装是真实记录。
 */
import type { Project, Source, StudyRecord } from '../core/types';
import { buildRecordsDocx } from '../docx/builder';
import { safeName } from './bundle';
import { saveFile, shareFile, type SaveResult } from './save';

export function recordFileName(project: Project, rec: StudyRecord): string {
  const base = safeName(`${project.topic}_${project.groupName || ''}`);
  const term = rec.term === 1 ? '上学期' : '下学期';
  const no = String(rec.index).padStart(2, '0');
  const name = safeName(rec.activityName || rec.stageName || '研究记录');
  return `${base}_${term}第${no}篇_${name}.docx`;
}

export async function exportRecordDocx(
  project: Project,
  rec: StudyRecord,
  sources: Source[],
  opts: { pick?: boolean } = {},
): Promise<SaveResult> {
  const blob = await buildRecordsDocx(project, [rec], sources);
  return saveFile(blob, recordFileName(project, rec), opts);
}

/** 发到微信 / QQ / 邮件：只有安卓版提供，网页版会明确报错而不是假装成功 */
export async function shareRecordDocx(
  project: Project,
  rec: StudyRecord,
  sources: Source[],
): Promise<SaveResult> {
  const blob = await buildRecordsDocx(project, [rec], sources);
  return shareFile(blob, recordFileName(project, rec));
}
