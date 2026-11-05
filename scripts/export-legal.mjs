/**
 * 把 src/core/legal.ts 里的法务全文导出成一份 Markdown。
 *
 * 直接 import 源文件，不复制粘贴文本，避免导出稿和软件内展示的版本不一致。
 * 用法：node scripts/export-legal.mjs [输出路径]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const { LEGAL_DOCS } = await import('../src/core/legal.ts');

const out = resolve(process.argv[2] ?? 'docs/legal-v2.0.md');

/** 正文按 \n 拆成段落，空行丢弃 */
function paragraphs(body) {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const version = '2.0';
const docs = LEGAL_DOCS.filter((d) => d.version === version);

const lines = [];
lines.push('# 研学帮 StudyMate · 法务文本');
lines.push('');
lines.push(`**版本 ${version}** ｜ 更新日期 2026-11-03 ｜ 共 ${docs.length} 份`);
lines.push('');
lines.push(
  '> 本文件由 `scripts/export-legal.mjs` 从 `src/core/legal.ts` 直接导出，' +
    '与软件内「设置 → 法务」展示的正文逐字一致。修改法务文本请改源码，不要改本文件。',
);
lines.push('');
lines.push('---');
lines.push('');

for (const doc of docs) {
  lines.push(`## ${doc.title}`);
  lines.push('');
  lines.push(`> ${doc.summary}`);
  lines.push('');
  lines.push(`**版本** ${doc.version} ｜ **更新日期** ${doc.updatedAt}`);
  lines.push('');
  for (const sec of doc.sections) {
    lines.push(`### ${sec.heading}`);
    lines.push('');
    for (const p of paragraphs(sec.body)) {
      lines.push(p);
      lines.push('');
    }
    // 表格照原样输出成 Markdown 表，别在导出稿里丢掉
    if (sec.table) {
      lines.push(`| ${sec.table.head.join(' | ')} |`);
      lines.push(`| ${sec.table.head.map(() => '---').join(' | ')} |`);
      for (const row of sec.table.rows) {
        lines.push(`| ${row.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`);
      }
      lines.push('');
    }
  }
  lines.push('---');
  lines.push('');
}

const rest = LEGAL_DOCS.filter((d) => d.version !== version);
if (rest.length) {
  lines.push('## 附：未随本次确定的文档');
  lines.push('');
  for (const d of rest) {
    lines.push(`- ${d.title}：版本 ${d.version}（更新日期 ${d.updatedAt}），正文见软件内「设置 → 法务」。`);
  }
  lines.push('');
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`已导出 ${out}（${docs.length} 份文档，${lines.length} 行）`);
