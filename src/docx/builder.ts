/**
 * DOCX 生成引擎 —— 按学校下发的四份原始表格逐行还原
 *
 * 使用 `docx` 库直接产出 Office Open XML（真 .docx，不是改扩展名）。
 *
 * 版式来源（用户提供的鼓山中学模板）：
 * - 开题：8 行 / 7 列网格，网格宽 1575 60 1470 1230 1950 855 1845，页边距 1460/1800/1768/1800
 * - 阶段性记录表：6 行 / 2 列网格，网格宽 1114 8460，页边距 1134，页脚奇偶页（奇数页印页码）
 * - 中期检查：7 行 / 6 列网格，网格宽 1546 1260 868 1652 1173 2023，页边距 1440/1800
 * - 结题：十章长文，正文四号宋体、标题加粗、首行缩进 2 字符、1.5 倍行距
 *
 * 不改行列、不改列宽、不改字号字体、不加额外的行。
 * 强制规则：
 * - 空内容只写「（本节尚未填写）」，不补一段看起来像真的文字；
 * - 模拟内容必须带「（AI 模拟示例）」，导出后仍可辨认；
 * - 来源与参考只在有真实来源时列出，不编造。
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeightRule,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  convertMillimetersToTwip,
  type ISectionOptions,
} from 'docx';
import type { Project, Report, ReportSection, Source, StudyRecord } from '../core/types';
import { SOURCE_TYPE_LABEL } from '../core/types';
import { RECORD_FIELDS, RECORD_TEMPLATE, templateFor, type FieldKey, type FormCell, type TemplateForm } from '../reports/templates';
import { dataUrlToBytes } from '../core/image';

/** DOCX 字体：中文宋体 / 黑体，西文 Times New Roman（与界面字体解耦） */
const FONT_SONG = '宋体';
const FONT_HEI = '黑体';
const FONT_LATIN = 'Times New Roman';

const SIM_NOTICE = '（AI 模拟示例）';
const UNFILLED = '（本节尚未填写）';

/** 原表边框：单线、0.5 磅、黑色 */
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const thin = BORDER;

export interface DocxOptions {
  /** 结题报告是否加封面与目录（学校模板没有，默认不加） */
  cover?: boolean;
}

function p(
  text: string,
  opts: {
    bold?: boolean;
    size?: number;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    font?: string;
    spacing?: number;
    indent?: boolean;
    color?: string;
    after?: number;
  } = {},
): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    spacing: { line: (opts.spacing ?? 1.5) * 240, after: opts.after ?? 120 },
    indent: opts.indent ? { firstLineChars: 200, firstLine: 560 } : undefined,
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        size: opts.size ?? 24, // 半磅：24 = 小四
        color: opts.color,
        font: { ascii: FONT_LATIN, eastAsia: opts.font ?? FONT_SONG },
      }),
    ],
  });
}

/** 表格上方的标题行：居中、按原表字号（16 / 18 / 20 / 22 磅） */
function titleLine(text: string, sizePt: number, bold = false): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { line: 360, after: 0 },
    children: [
      new TextRun({
        text,
        bold: bold || undefined,
        size: sizePt * 2,
        font: { ascii: FONT_LATIN, eastAsia: FONT_SONG },
      }),
    ],
  });
}

function h1(text: string): Paragraph {
  return new Paragraph({
    spacing: { line: 360, before: 120, after: 120 },
    indent: { firstLineChars: 200, firstLine: 560 },
    children: [
      new TextRun({ text, bold: true, size: 28, font: { ascii: FONT_LATIN, eastAsia: FONT_SONG } }),
    ],
  });
}

function h2(text: string): Paragraph {
  return new Paragraph({
    spacing: { line: 360, before: 80, after: 80 },
    indent: { firstLineChars: 200, firstLine: 560 },
    children: [
      new TextRun({ text, bold: true, size: 28, font: { ascii: FONT_LATIN, eastAsia: FONT_HEI } }),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* 表格单元                                                             */
/* ------------------------------------------------------------------ */

const CELL_MARGIN = { top: 0, bottom: 0, left: 108, right: 108 };

/** 标签格：12 磅，居中，垂直居中；换行按原表分行 */
function labelCell(
  text: string,
  opts: { span?: number; font?: 'song' | 'hei'; bold?: boolean } = {},
): TableCell {
  const font = opts.font === 'hei' ? FONT_HEI : FONT_SONG;
  const lines = text.split('\n');
  return new TableCell({
    columnSpan: opts.span && opts.span > 1 ? opts.span : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { ...CELL_MARGIN, top: 20, bottom: 20 },
    children: lines.map(
      (line) =>
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { line: 240, after: 0 },
          children: [
            new TextRun({
              text: line,
              bold: opts.bold || undefined,
              size: 24,
              font: { ascii: FONT_LATIN, eastAsia: font },
            }),
          ],
        }),
    ),
  });
}

/** 取值格 / 内容格：12 磅，左对齐，顶端；首行不缩进（与表格原样一致） */
function bodyCell(
  paragraphs: Paragraph[],
  opts: { span?: number; valign?: 'top' | 'center' | 'bottom' } = {},
): TableCell {
  return new TableCell({
    columnSpan: opts.span && opts.span > 1 ? opts.span : undefined,
    verticalAlign: opts.valign ?? VerticalAlign.TOP,
    margins: { ...CELL_MARGIN, top: 32, bottom: 32 },
    children: paragraphs.length ? paragraphs : [new Paragraph({ children: [] })],
  });
}

/** 12 磅正文段落（表格内用，1.5 倍行距、不缩进） */
function cellText(text: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph[] {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const out: Paragraph[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      out.push(new Paragraph({ spacing: { line: 300, after: 0 }, children: [] }));
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      out.push(
        new Paragraph({
          spacing: { line: 300, after: 0 },
          indent: { left: 280, hanging: 140 },
          children: [
            new TextRun({
              text: `· ${bullet[1]}`,
              size: 24,
              bold: opts.bold || undefined,
              font: { ascii: FONT_LATIN, eastAsia: FONT_SONG },
            }),
          ],
        }),
      );
      continue;
    }
    out.push(
      new Paragraph({
        alignment: opts.align,
        spacing: { line: 300, after: 0 },
        children: [
          new TextRun({
            text: line,
            size: 24,
            bold: opts.bold || undefined,
            font: { ascii: FONT_LATIN, eastAsia: FONT_SONG },
          }),
        ],
      }),
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 取值                                                                 */
/* ------------------------------------------------------------------ */

interface RenderCtx {
  project: Project;
  report?: Report;
  record?: StudyRecord;
}

function fieldValue(key: FieldKey, ctx: RenderCtx): string {
  const { project, record } = ctx;
  switch (key) {
    case 'topic':
      return project.topic || '';
    case 'members':
      return project.members.map((m) => m.name).join('、');
    case 'leader':
      return project.members.find((m) => m.role === 'leader')?.name ?? '';
    case 'teacher':
      return project.teacher || '';
    case 'class':
      return [project.grade, project.className].filter(Boolean).join(' ');
    case 'mainCourse':
      return project.mainCourse || '';
    case 'relatedCourse':
      return project.relatedCourse || '';
    case 'group':
      return project.groupName || '';
    case 'recordIndex':
      return record ? String(record.index) : '';
    case 'recorder':
      return record?.recorder ?? '';
    case 'recordedAt':
      return record?.recordedAt ?? '';
    case 'period':
      return record
        ? `${record.startDate || '　'} 至 ${record.endDate || '　'}`
        : `${project.startDate || '　'} 至 ${project.endDate || '　'}`;
    default:
      return '';
  }
}

/* ------------------------------------------------------------------ */
/* 表格渲染                                                             */
/* ------------------------------------------------------------------ */

function bodyOf(s: ReportSection | undefined): string {
  const body = s?.body?.trim();
  if (!body) return UNFILLED;
  if (!s?.containsSimulated) return body;
  if (body.includes(SIM_NOTICE)) return body;
  return `${SIM_NOTICE}\n${body}`;
}

function renderForm(
  form: TemplateForm,
  ctx: RenderCtx,
  opts: { labelBold: boolean; sectionOf: (heading: string) => ReportSection | undefined; hideSectionLabels?: boolean },
): (Paragraph | Table)[] {
  const rows: TableRow[] = [];

  for (const row of form.rows) {
    const cells: TableCell[] = [];
    for (const c of row.cells) {
      cells.push(renderCell(c, ctx, opts));
    }
    rows.push(
      new TableRow({
        height: row.height ? { value: row.height, rule: HeightRule.ATLEAST } : undefined,
        // 行不跨页拆开：一格内容不会被切成两半，与学校原表一致
        cantSplit: true,
        children: cells,
      }),
    );
  }

  const totalWidth = form.grid.reduce((a, b) => a + b, 0);

  return [
    new Table({
      width: { size: totalWidth, type: WidthType.DXA },
      columnWidths: form.grid,
      layout: TableLayoutType.FIXED,
      rows,
    }),
  ];
}

function renderCell(
  c: FormCell,
  ctx: RenderCtx,
  opts: { labelBold: boolean; sectionOf: (heading: string) => ReportSection | undefined; hideSectionLabels?: boolean },
): TableCell {
  switch (c.t) {
    case 'label':
      return labelCell(c.text, { span: c.span, font: c.font ?? 'song', bold: opts.labelBold });
    case 'field': {
      const v = fieldValue(c.key, ctx);
      return bodyCell(cellText(v || '　'), { span: c.span, valign: VerticalAlign.CENTER });
    }
    case 'empty':
      return bodyCell([new Paragraph({ children: [] })], { span: c.span });
    case 'section': {
      const sec = opts.sectionOf(c.heading);
      const paras: Paragraph[] = [];
      if (!opts.hideSectionLabels && !c.hideLabel) {
        const label = `${c.label ?? c.heading}${c.suffix ?? ''}`;
        paras.push(...cellText(label, { bold: opts.labelBold }));
      }
      paras.push(...cellText(bodyOf(sec)));
      for (const line of c.tail ?? []) {
        paras.push(
          new Paragraph({
            spacing: { line: 300, after: 0 },
            children: [
              new TextRun({
                text: line,
                size: 24,
                font: { ascii: FONT_LATIN, eastAsia: FONT_SONG },
              }),
            ],
          }),
        );
      }
      return bodyCell(paras, { span: c.span });
    }
    default:
      return bodyCell([new Paragraph({ children: [] })]);
  }
}

/* ------------------------------------------------------------------ */
/* 简单 Markdown -> 段落（编辑器可能写列表 / 加粗）                      */
/* ------------------------------------------------------------------ */

/** 处理 **加粗** */
function runs(text: string, bold?: boolean, size = 24, font = FONT_SONG): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part);
    if (m) {
      return new TextRun({
        text: m[1],
        bold: true,
        size,
        font: { ascii: FONT_LATIN, eastAsia: font },
      });
    }
    return new TextRun({
      text: part,
      bold: bold || undefined,
      size,
      font: { ascii: FONT_LATIN, eastAsia: font },
    });
  });
}

function simBanner(): Paragraph[] {
  return [
    new Paragraph({
      spacing: { after: 200 },
      border: { top: thin, bottom: thin, left: thin, right: thin },
      children: [
        new TextRun({
          text: `本文档包含 AI 模拟 / 虚拟示例内容：标有「${SIM_NOTICE}」的段落不属于真实研究数据，不得作为真实调查、实验或访谈结果提交。`,
          bold: true,
          size: 20,
          color: '7A4BFF',
          font: { ascii: FONT_LATIN, eastAsia: FONT_SONG },
        }),
      ],
    }),
  ];
}

/** 封面（仅结题可选，学校模板本身没有封面） */
function coverPage(project: Project, report: Report, subtitle: string): (Paragraph | Table)[] {
  return [
    new Paragraph({
      spacing: { before: 1600, after: 200 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: project.school || '研究性学习',
          size: 32,
          color: '666666',
          font: { ascii: FONT_LATIN, eastAsia: FONT_SONG },
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 320 },
      children: [
        new TextRun({
          text: subtitle,
          bold: true,
          size: 52,
          font: { ascii: FONT_LATIN, eastAsia: FONT_SONG },
        }),
      ],
    }),
    p(`课题：${project.topic || '（未填写）'}`, {
      bold: true,
      size: 30,
      align: AlignmentType.CENTER,
    }),
    p(`${project.grade || ''} ${project.className || ''}　${project.groupName || ''}`.trim() || '　', {
      size: 24,
      align: AlignmentType.CENTER,
      color: '666666',
    }),
    p(`课题组成员：${project.members.map((m) => m.name).join('、') || '（未填写）'}`, {
      size: 24,
      align: AlignmentType.CENTER,
    }),
    p(`指导教师：${project.teacher || '（未填写）'}`, { size: 24, align: AlignmentType.CENTER }),
    p(`研究周期：${project.startDate || '　'} 至 ${project.endDate || '　'}`, {
      size: 22,
      align: AlignmentType.CENTER,
    }),
    p(`导出：研学帮 StudyMate　版本 v${report.version}　${new Date().toLocaleDateString('zh-CN')}`, {
      size: 16,
      align: AlignmentType.CENTER,
      color: '888888',
    }),
    new Paragraph({ pageBreakBefore: true, children: [] }),
  ];
}

/* ------------------------------------------------------------------ */
/* 来源                                                                 */
/* ------------------------------------------------------------------ */

function sourceList(sources: Source[]): Paragraph[] {
  if (!sources.length) {
    return [p('（暂无来源。请在软件内补充真实来源后再导出。）', { size: 24 })];
  }
  return sources.map((s, i) =>
    p(
      `[${i + 1}] ${s.authors || '作者未填'}. ${s.title}[${s.doi ? 'J/OL' : 'EB/OL'}]. ${s.date || '日期未填'}. ${s.doi ? `DOI: ${s.doi}` : s.url || '无链接'}（检索于 ${new Date(s.retrievedAt).toLocaleDateString('zh-CN')}）〔${SOURCE_TYPE_LABEL[s.sourceType]}〕${s.verifyStatus === 'verified' ? '' : '【待核实】'}`,
      { size: 28 },
    ),
  );
}

function imageParagraphs(records: StudyRecord[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const images = records.flatMap((r) =>
    r.attachments
      .filter((a) => a.kind === 'image' && a.dataUrl)
      .map((a) => ({ ...a, record: r })),
  );
  if (!images.length) return out;
  out.push(h1('附：过程照片与附件'));
  for (const img of images) {
    const bytes = dataUrlToBytes(img.dataUrl!);
    const ext = /^data:image\/(\w+)/.exec(img.dataUrl!)?.[1]?.toLowerCase() ?? 'jpeg';
    const type = ext === 'png' ? 'png' : ext === 'gif' ? 'gif' : 'jpg';
    out.push(
      new Paragraph({
        spacing: { before: 160, after: 60 },
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: bytes,
            type: type as 'png' | 'jpg' | 'gif',
            transformation: { width: 420, height: 280 },
          }),
        ],
      }),
      p(`图：第 ${img.record.index} 篇「${img.record.activityName || img.record.stageName || '研究记录'}」附件 ${img.name}`, {
        size: 18,
        align: AlignmentType.CENTER,
      }),
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 四类文档                                                             */
/* ------------------------------------------------------------------ */

/** 表格型（开题 / 中期）：标题两行 + 原表 */
function formDoc(
  kind: 'proposal' | 'midterm',
  project: Project,
  report: Report,
  _sources: Source[],
): Document {
  const tpl = templateFor(kind);
  const form = tpl.form!;
  const titles = form.titleLines.map((t) =>
    titleLine(t.text.replace('鼓山中学', project.school || '鼓山中学'), t.size, t.bold),
  );
  const ctx: RenderCtx = { project, report };
  const rowOf = (heading: string) => report.sections.find((s) => s.heading === heading);

  const body = [
    ...titles,
    new Paragraph({ spacing: { line: 120, after: 0 }, children: [] }),
    ...renderForm(form, ctx, { labelBold: kind === 'proposal', sectionOf: rowOf }),
  ];

  return buildDoc(body, project, report, {
    margin: form.margin,
    footer: false,
    header: false,
  });
}

/** 结题：十章长文，正文四号宋体、标题加粗、首行缩进 2 字符、1.5 倍行距 */
function finalDoc(
  project: Project,
  report: Report,
  sources: Source[],
  records: StudyRecord[] = [],
  opts: DocxOptions = {},
): Document {
  const body: (Paragraph | Table | TableOfContents)[] = [];

  if (opts.cover) {
    body.push(...coverPage(project, report, '研究性学习结题报告'));
    // 目录是 Word 域，首次打开需右键「更新域」
    body.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 360, after: 240 },
        children: [
          new TextRun({
            text: '目　　录',
            bold: true,
            size: 32,
            font: { ascii: FONT_LATIN, eastAsia: FONT_SONG },
          }),
        ],
      }),
    );
    body.push(new TableOfContents('目录', { hyperlink: true, headingStyleRange: '1-2' }));
    body.push(new Paragraph({ pageBreakBefore: true, children: [] }));
  } else {
    // 学校范例格式：只有一行居中的报告名，不加封面不加目录
    body.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 360, after: 240 },
        children: [
          new TextRun({
            text: '研究性学习结题报告',
            bold: true,
            size: 40,
            font: { ascii: FONT_LATIN, eastAsia: FONT_SONG },
          }),
        ],
      }),
    );
    body.push(
      p(`课题：${project.topic || '（未填写）'}`, { align: AlignmentType.CENTER, after: 0 }),
      p(
        `${project.school || ''}　${project.grade || ''} ${project.className || ''}　${project.groupName || ''}`.trim() ||
          '　',
        { align: AlignmentType.CENTER, after: 0 },
      ),
      p(
        `课题组成员：${project.members.map((m) => m.name).join('、') || '（未填写）'}　指导教师：${project.teacher || '（未填写）'}`,
        { align: AlignmentType.CENTER, after: 240 },
      ),
    );
  }

  for (const s of report.sections) {
    // 一级标题：四号宋体加粗；正文：四号宋体，首行缩进 2 字符
    body.push(
      new Paragraph({
        spacing: { line: 360, before: 120, after: 60 },
        indent: { firstLineChars: 200, firstLine: 560 },
        children: [
          new TextRun({
            text: s.heading,
            bold: true,
            size: 28,
            font: { ascii: FONT_LATIN, eastAsia: FONT_SONG },
          }),
        ],
      }),
    );
    for (const para of markdownParagraphs(bodyOf(s))) body.push(para);
  }

  if (sources.length) {
    body.push(h1('参考文献'));
    body.push(...sourceList(sources));
  }
  body.push(...imageParagraphs(records));

  return buildDoc(body, project, report, {
    margin: { top: 1440, right: 1800, bottom: 1440, left: 1800 },
    footer: false,
    header: false,
  });
}

/** 结题正文：四号宋体，段落首行缩进 2 字符，列表降为普通段 */
function markdownParagraphs(md: string): Paragraph[] {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  const out: Paragraph[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      out.push(new Paragraph({ spacing: { line: 360, after: 0 }, children: [] }));
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const num = /^\s*(\d+)[.、)]\s+(.*)$/.exec(line);
    if (h) {
      out.push(h2(h[2]));
      continue;
    }
    if (bullet) {
      out.push(
        new Paragraph({
          spacing: { line: 360, after: 0 },
          indent: { left: 560, hanging: 280 },
          children: runs(`· ${bullet[1]}`, false, 28),
        }),
      );
      continue;
    }
    if (num) {
      out.push(
        new Paragraph({
          spacing: { line: 360, after: 0 },
          indent: { firstLineChars: 200, firstLine: 560 },
          children: runs(`${num[1]}. ${num[2]}`, false, 28),
        }),
      );
      continue;
    }
    out.push(
      new Paragraph({
        spacing: { line: 360, after: 0 },
        indent: { firstLineChars: 200, firstLine: 560 },
        children: runs(line, false, 28),
      }),
    );
  }
  return out;
}

/** 阶段性记录表：每篇记录一页，标题两行 + 表头小字 + 原表六行 */
function recordDoc(project: Project, records: StudyRecord[], _sources: Source[]): Document {
  const form = RECORD_TEMPLATE.form!;
  const children: (Paragraph | Table)[] = [];

  records.forEach((r, i) => {
    if (i > 0) children.push(new Paragraph({ pageBreakBefore: true, children: [] }));

    for (const t of form.titleLines) {
      children.push(titleLine(t.text, t.size, t.bold));
    }

    // 「第 __ 研究阶段     记录人：      记录时间：」——黑体 12 磅居中
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 300, before: 60, after: 60 },
        children: [
          new TextRun({
            text: `第　${r.index}　研究阶段　　　　记录人：${r.recorder || '　　　　'}　　记录时间：${r.recordedAt || '　　　　'}`,
            size: 24,
            font: { ascii: FONT_LATIN, eastAsia: FONT_HEI },
          }),
        ],
      }),
    );

    const sectionOf = (heading: string) =>
      ({ heading, level: 1, id: '', body: (r as unknown as Record<string, string>)[recordKeyOf(heading)] ?? '', origin: 'template', updatedAt: 0 }) as ReportSection;

    children.push(
      ...renderForm(form, { project, record: r }, { labelBold: false, sectionOf, hideSectionLabels: true }),
    );
  });

  if (!records.length) {
    children.push(p('（还没有研究记录。先在软件里填写阶段性记录，再导出。）', { size: 24 }));
  }

  return buildDoc(children, project, pseudoProgress(project), {
    margin: form.margin,
    footer: 'dash',
    header: false,
  });
}

/** 表格行标题 -> StudyRecord 字段名 */
function recordKeyOf(heading: string): string {
  const hit = RECORD_FIELDS.find((f) => f.label === heading);
  return hit ? hit.key : 'summary';
}

function pseudoProgress(project: Project): Report {
  return {
    id: 'records',
    projectId: project.id,
    kind: 'progress',
    title: '研究性学习课题阶段性工作小结记录表',
    sections: [],
    version: 1,
    updatedAt: Date.now(),
    status: 'not-started',
  };
}

/* ------------------------------------------------------------------ */
/* 文档装配                                                             */
/* ------------------------------------------------------------------ */

function buildDoc(
  children: (Paragraph | Table | TableOfContents)[],
  project: Project,
  report: Report,
  opts: {
    margin: { top: number; right: number; bottom: number; left: number };
    footer: false | 'dash';
    header: boolean;
  },
): Document {
  const hasSim =
    report.sections.some((s) => s.containsSimulated) || project.modes.includes('simulated');
  const body: (Paragraph | Table | TableOfContents)[] = [];
  if (hasSim) body.push(...simBanner());
  body.push(...children);

  const section: ISectionOptions = {
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: {
          top: opts.margin.top,
          right: opts.margin.right,
          bottom: opts.margin.bottom,
          left: opts.margin.left,
          header: 851,
          footer: 992,
        },
      },
    },
    ...(opts.header
      ? {
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: `${project.topic || '研究性学习'}　|　${report.title}　|　研学帮 StudyMate 导出`,
                      size: 16,
                      color: '808080',
                      font: { ascii: FONT_LATIN, eastAsia: FONT_SONG },
                    }),
                  ],
                }),
              ],
            }),
          },
        }
      : {}),
    ...(opts.footer === 'dash'
      ? {
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      children: ['- ', PageNumber.CURRENT, ' -'],
                      size: 30,
                      font: { ascii: FONT_LATIN, eastAsia: FONT_SONG },
                    }),
                  ],
                }),
              ],
            }),
          },
        }
      : {}),
    children: body,
  };

  return new Document({
    creator: '研学帮 StudyMate',
    title: report.title,
    description: '由研学帮 StudyMate 按学校下发的表格结构生成，使用前请核对内容真实性',
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: { ascii: FONT_LATIN, eastAsia: FONT_SONG }, size: 24 },
          paragraph: { spacing: { line: 360 } },
        },
      },
    },
    sections: [section],
  });
}

/* ------------------------------------------------------------------ */
/* 导出入口                                                             */
/* ------------------------------------------------------------------ */

export async function buildReportDocx(
  kind: 'proposal' | 'midterm' | 'final',
  project: Project,
  report: Report,
  sources: Source[],
  records: StudyRecord[] = [],
  opts: DocxOptions = {},
): Promise<Blob> {
  const doc =
    kind === 'proposal'
      ? formDoc('proposal', project, report, sources)
      : kind === 'midterm'
        ? formDoc('midterm', project, report, sources)
        : finalDoc(project, report, sources, records, opts);
  return Packer.toBlob(doc);
}

export async function buildRecordsDocx(
  project: Project,
  records: StudyRecord[],
  sources: Source[],
): Promise<Blob> {
  return Packer.toBlob(recordDoc(project, records, sources));
}

/** Markdown 版本（便于二次编辑 / 版本对比） */
export function reportToMarkdown(
  project: Project,
  report: Report,
  sources: Source[],
): string {
  const lines: string[] = [];
  const tpl = templateFor(report.kind);
  lines.push(`# ${project.topic || '研究性学习'}｜${report.title}`, '');
  lines.push(
    `> 学校：${project.school || '未填'}　年级：${project.grade || '—'}　班级：${project.className || '—'}`,
  );
  lines.push(`> 成员：${project.members.map((m) => m.name).join('、') || '未填'}　指导教师：${project.teacher || '未填'}`);
  lines.push(`> 模板：${report.templateNote || tpl.note}`);
  lines.push('> 生成：研学帮 StudyMate（第三方工具，非学校官方）', '');

  for (const s of report.sections) {
    lines.push(`## ${s.heading}`, '');
    lines.push(bodyOf(s), '');
  }

  if (sources.length) {
    lines.push('## 参考文献', '');
    sources.forEach((s, i) => {
      lines.push(
        `[${i + 1}] ${s.authors || '作者未填'}. ${s.title}. ${s.date || '日期未填'}. ${s.doi ? `DOI: ${s.doi}` : s.url || ''}〔${SOURCE_TYPE_LABEL[s.sourceType]}〕${s.verifyStatus === 'verified' ? '' : '【待核实】'}`,
      );
    });
  }
  return lines.join('\n');
}

/** 研究记录的 Markdown（六行表格的等价文本） */
export function recordsToMarkdown(project: Project, records: StudyRecord[]): string {
  const lines: string[] = [`# ${project.topic || '研究性学习'}｜阶段性工作小结记录表`, ''];
  for (const r of records) {
    // 导出稿里不写学期：序号是连续的「第 X 次」，学期只是本软件的组织方式
    lines.push(`## 第 ${r.index} 研究阶段`, '');
    lines.push(`- 起迄时间：${r.startDate || '　'} 至 ${r.endDate || '　'}`);
    lines.push(`- 记录人：${r.recorder || '　'}　记录时间：${r.recordedAt || '　'}`);
    const sim = r.sourceType === 'simulated';
    for (const f of RECORD_FIELDS) {
      const v = (r as unknown as Record<string, string>)[f.key] || '';
      lines.push(`- ${f.label}：${sim && v ? SIM_NOTICE : ''}${v || UNFILLED}`);
    }
    if (r.attachments.length) {
      lines.push(`- 附件：${r.attachments.map((a) => a.name).join('、')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export { FONT_HEI, FONT_LATIN, FONT_SONG, convertMillimetersToTwip };
