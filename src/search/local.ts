import { db, type LocalFileRow } from '../core/db';
import { uid } from '../core/id';

/**
 * 本地文件检索
 *
 * 只处理用户主动导入的纯文本（txt / md）。文件原样存在本机 IndexedDB，
 * 不上传、不送模型、不建立倒排索引——数据量小，线性扫描足够，也不用担心索引文件泄露。
 */

const TEXT_EXT = /\.(txt|md|markdown|csv|log)$/i;

export function isTextFile(name: string): boolean {
  return TEXT_EXT.test(name);
}

export async function importLocalFile(file: File): Promise<LocalFileRow> {
  if (!isTextFile(file.name)) {
    throw new Error('只支持 txt / md / csv / log 纯文本，请先另存为文本再导入');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('单个文件不能超过 2 MB，请拆分后再导入');
  }
  const text = await file.text();
  const row: LocalFileRow = {
    id: uid('lf'),
    name: file.name,
    size: file.size,
    text,
    addedAt: Date.now(),
  };
  await db.localFiles.put(row);
  return row;
}

export async function removeLocalFile(id: string): Promise<void> {
  await db.localFiles.delete(id);
}

export async function listLocalFiles(): Promise<LocalFileRow[]> {
  return db.localFiles.orderBy('addedAt').reverse().toArray();
}

export interface LocalMatch {
  fileId: string;
  name: string;
  /** 命中片段 */
  snippet: string;
  /** 命中次数 */
  hits: number;
  score: number;
}

function terms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s,，、;；]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 在段落里找命中位置，返回前后各 60 字的片段 */
function snippetOf(text: string, words: string[]): { snippet: string; hits: number } {
  const lower = text.toLowerCase();
  let first = -1;
  let hits = 0;
  for (const w of words) {
    let from = 0;
    while (from < lower.length) {
      const i = lower.indexOf(w, from);
      if (i < 0) break;
      hits += 1;
      if (first < 0 || i < first) first = i;
      from = i + w.length;
      if (hits > 200) break;
    }
  }
  if (first < 0) return { snippet: '', hits: 0 };
  const start = Math.max(0, first - 60);
  const end = Math.min(text.length, first + 160);
  return {
    snippet: `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`,
    hits,
  };
}

/** 线性扫描全部本地文件；按命中密度排序 */
export async function searchLocalFiles(query: string, limit = 10): Promise<LocalMatch[]> {
  const words = terms(query);
  if (!words.length) return [];
  const files = await db.localFiles.toArray();
  const out: LocalMatch[] = [];
  for (const f of files) {
    const { snippet, hits } = snippetOf(f.text, words);
    if (!hits) continue;
    // 密度：命中次数 / 文本长度，避免长文档单纯因为长而排前
    out.push({
      fileId: f.id,
      name: f.name,
      snippet,
      hits,
      score: hits / Math.max(1, Math.log10(f.text.length + 10)),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
