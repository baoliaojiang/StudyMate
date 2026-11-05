/**
 * 模板导入
 *
 * 只做「结构识别」：从 .docx / .md / .txt 里抽出标题行，
 * 让用户确认后再套用到报告章节。不复制原文档的样式、图片和校徽，
 * 也不假装导入后就和学校模板一模一样 —— 复杂模板仍需手动调整。
 */
import JSZip from 'jszip';

export interface DetectedHeading {
  text: string;
  level: 1 | 2 | 3;
  /** 来源线索：样式名 / Markdown 井号 / 编号 */
  via: string;
}

function clean(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从 DOCX 的 document.xml 抽标题 */
export async function headingsFromDocx(file: File): Promise<DetectedHeading[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('这不是有效的 DOCX（缺少 word/document.xml）');
  const xml = await doc.async('string');

  const out: DetectedHeading[] = [];
  const paras = xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? [];
  for (const p of paras) {
    const text = clean(
      (p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, ''))
        .join(''),
    );
    if (!text || text.length > 40) continue;

    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '';
    const bold = /<w:b\s*\/>|<w:b w:val="(?:1|true)"/.test(p);
    const numbered = /^([一二三四五六七八九十]+[、.．]|\d+[、.．]|第[一二三四五六七八九十]+[部章节])/.test(text);

    let level: 1 | 2 | 3 | null = null;
    let via = '';
    if (/^(Heading|heading|标题)\s*1$/.test(style)) {
      level = 1;
      via = `样式 ${style}`;
    } else if (/Heading\s*2/.test(style)) {
      level = 2;
      via = `样式 ${style}`;
    } else if (/Heading\s*3/.test(style)) {
      level = 3;
      via = `样式 ${style}`;
    } else if (numbered && text.length <= 30) {
      level = /^[一二三四五六七八九十]+、/.test(text) ? 1 : 2;
      via = '编号识别';
    } else if (bold && text.length <= 20 && !/[。；，]/.test(text)) {
      level = 2;
      via = '加粗短行';
    }
    if (level) out.push({ text, level, via });
  }
  return dedupe(out);
}

/** 从 Markdown / 纯文本抽标题 */
export async function headingsFromText(file: File): Promise<DetectedHeading[]> {
  const text = (await file.text()).replace(/\r\n/g, '\n');
  const out: DetectedHeading[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const md = /^(#{1,4})\s+(.*)$/.exec(line);
    if (md) {
      out.push({ text: md[2].trim(), level: Math.min(3, md[1].length) as 1 | 2 | 3, via: `Markdown ${md[1].length} 级` });
      continue;
    }
    if (/^[一二三四五六七八九十]+、/.test(line) && line.length <= 40) {
      out.push({ text: line, level: 1, via: '中文编号' });
      continue;
    }
    if (/^\d+[、.．]\s*\S/.test(line) && line.length <= 40) {
      out.push({ text: line, level: 2, via: '数字编号' });
    }
  }
  return dedupe(out);
}

function dedupe(list: DetectedHeading[]): DetectedHeading[] {
  const seen = new Set<string>();
  return list.filter((h) => {
    const k = h.text + h.level;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function detectHeadings(file: File): Promise<DetectedHeading[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return headingsFromDocx(file);
  if (name.endsWith('.doc')) {
    throw new Error('旧版 .doc 无法直接识别，请先另存为 .docx 再导入');
  }
  if (name.endsWith('.md') || name.endsWith('.txt')) return headingsFromText(file);
  throw new Error('只支持 .docx / .md / .txt');
}
