/**
 * PDF 导出：走系统打印（打印对话框里选「另存为 PDF」）。
 *
 * 不引入整套 PDF 排版引擎的原因：四份报告的版式已经按学校表格在
 * docx/builder.ts 里逐行还原，PDF 再造一份很难保证一致；浏览器/系统
 * 的打印管线本身就是成熟的排版器，用它输出 PDF 版式以打印预览为准。
 */

/** 极简 Markdown → HTML：标题、列表、加粗、斜体、代码、段落、分隔线 */
function mdToHtml(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  let inTable = false;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push('</tbody></table>');
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const t = line.trim();

    if (!t) {
      closeList();
      closeTable();
      continue;
    }
    // 表格行：| a | b |
    if (/^\|.*\|$/.test(t)) {
      const cells = t.slice(1, -1).split('|').map((c) => c.trim());
      if (/^[\s:|-]+$/.test(t)) continue; // 分隔行跳过
      if (!inTable) {
        closeList();
        out.push('<table><thead>');
        out.push(`<tr>${cells.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>`);
        out.push('</thead><tbody>');
        inTable = true;
      } else {
        out.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
      }
      continue;
    }
    closeTable();

    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) {
      closeList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      closeList();
      out.push('<hr />');
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(t);
    if (li) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(t)}</p>`);
  }
  closeList();
  closeTable();
  return out.join('\n');
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: "Times New Roman", SimSun, serif;
    font-size: 12pt; line-height: 1.8; color: #000;
    margin: 0; padding: 0;
  }
  .doc { max-width: 210mm; margin: 0 auto; padding: 25mm 20mm; }
  h1 { font-size: 16pt; text-align: center; margin: 0 0 1em; }
  h2 { font-size: 14pt; margin: 1.2em 0 0.5em; }
  h3 { font-size: 12.5pt; margin: 1em 0 0.4em; }
  p { margin: 0.4em 0; text-indent: 2em; }
  p.no-indent { text-indent: 0; }
  ul { margin: 0.4em 0; padding-left: 2.5em; }
  li { margin: 0.2em 0; }
  table { width: 100%; border-collapse: collapse; margin: 0.6em 0; }
  th, td { border: 1px solid #000; padding: 4px 6px; font-size: 10.5pt; text-align: left; }
  th { background: #f2f2f2; }
  hr { border: none; border-top: 1px dashed #999; margin: 1.2em 0; }
  code { font-family: Consolas, monospace; font-size: 10.5pt; }
  @media print {
    .doc { padding: 0; }
    @page { margin: 25mm 20mm; }
  }
`;

/**
 * 生成打印文档并触发系统打印。
 * 用隐藏 iframe：不弹新窗口，打印完自动回收。
 */
export function printHtml(title: string, bodyHtml: string): void {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${title.replace(/[<>&"]/g, '')}</title>
<style>${PRINT_CSS}</style>
</head>
<body><div class="doc">${bodyHtml}</div></body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.srcdoc = html;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      // 打印对话框关闭后回收（部分浏览器需要延时）
      window.setTimeout(() => iframe.remove(), 60_000);
    }
  };
  document.body.appendChild(iframe);
}

/** 报告 → 打印 PDF */
export function printReport(
  title: string,
  subtitle: string,
  markdown: string,
  footerNote?: string,
): void {
  const body = [
    `<h1>${title.replace(/[<>&"]/g, '')}</h1>`,
    subtitle ? `<p class="no-indent" style="text-align:center">${subtitle.replace(/[<>&"]/g, '')}</p>` : '',
    mdToHtml(markdown),
    footerNote
      ? `<hr /><p class="no-indent" style="font-size:10pt;color:#555">${footerNote.replace(/[<>&"]/g, '')}</p>`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  printHtml(title, body);
}

/** 研究记录合集 → 打印 PDF（每篇一节） */
export function printRecords(
  title: string,
  entries: { heading: string; markdown: string }[],
  footerNote?: string,
): void {
  const parts = entries.map(
    (e) => `<section style="break-inside:avoid-page"><h2>${e.heading.replace(/[<>&"]/g, '')}</h2>${mdToHtml(e.markdown)}</section>`,
  );
  const body = [
    `<h1>${title.replace(/[<>&"]/g, '')}</h1>`,
    ...parts,
    footerNote
      ? `<hr /><p class="no-indent" style="font-size:10pt;color:#555">${footerNote.replace(/[<>&"]/g, '')}</p>`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  printHtml(title, body);
}
