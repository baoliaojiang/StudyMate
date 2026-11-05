<script setup lang="ts">
/**
 * 轻量 Markdown 渲染
 *
 * 只做模型回复里真正常用的那几种：标题、列表、代码块、引用、表格、粗体、行内代码、链接。
 * 不引第三方库（体积 + 安全），也不允许任意 HTML —— 先整体转义，再逐段替换。
 */
import { computed } from 'vue';

const props = defineProps<{ text: string }>();

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内格式：代码 → 粗体 → 斜体 → 链接（链接只放行 http/https） */
function inline(raw: string): string {
  let s = esc(raw);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
  return s;
}

/** 表格：| a | b | 形式，含分隔行 */
function isTable(lines: string[], i: number): boolean {
  return /^\s*\|.*\|\s*$/.test(lines[i] ?? '') && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '');
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

const html = computed(() => {
  const lines = (props.text ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // 代码块
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) buf.push(lines[i++] ?? '');
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    // 标题
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(4, h[1].length) + 2; // h1 → h3，别抢页面层级
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      out.push('<hr />');
      i++;
      continue;
    }

    // 表格
    if (isTable(lines, i)) {
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? '')) body.push(cells(lines[i++] ?? ''));
      out.push(
        '<div class="md-table"><table><thead><tr>' +
          head.map((c) => `<th>${inline(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table></div>',
      );
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) buf.push((lines[i++] ?? '').replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${buf.map((b) => inline(b)).join('<br />')}</blockquote>`);
      continue;
    }

    // 有序 / 无序列表
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i] ?? '')) {
        items.push((lines[i++] ?? '').replace(/^\s*([-*+]|\d+\.)\s+/, ''));
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }

    // 普通段落：连续非空行合并
    const buf: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^```/.test(lines[i] ?? '') &&
      !/^(#{1,4})\s/.test(lines[i] ?? '') &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i] ?? '') &&
      !/^\s*>\s?/.test(lines[i] ?? '') &&
      !isTable(lines, i)
    ) {
      buf.push(lines[i++] ?? '');
    }
    out.push(`<p>${buf.map((b) => inline(b)).join('<br />')}</p>`);
  }

  // 块之间不留换行符：气泡继承了 pre-wrap，一个 \n 会被渲染成一整行空白
  return out.join('');
});
</script>

<template>
  <div class="md" v-html="html" />
</template>

<style scoped>
.md {
  font-size: inherit;
  line-height: 1.72;
  color: inherit;
  word-break: break-word;
  text-wrap: pretty;
  /* 气泡是 pre-wrap：这里改回正常换行，块间空白由 margin 决定 */
  white-space: normal;
}
.md :deep(> *:first-child) { margin-top: 0; }
.md :deep(> *:last-child) { margin-bottom: 0; }
.md :deep(p) { margin: 0 0 0.55em; }
.md :deep(h3), .md :deep(h4), .md :deep(h5), .md :deep(h6) {
  margin: 0.8em 0 0.35em;
  font-size: 1em;
  font-weight: var(--fw-strong);
  color: var(--text);
  letter-spacing: -0.005em;
}
.md :deep(h3) { font-size: 1.06em; }
.md :deep(ul), .md :deep(ol) { margin: 0 0 0.55em; padding-left: 1.35em; }
.md :deep(li) { margin: 0.12em 0; }
.md :deep(code) {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.9em;
  padding: 0.1em 0.36em;
  border-radius: 5px;
  background: var(--surface-3);
  color: var(--text);
}
.md :deep(pre) {
  margin: 0 0 0.8em;
  padding: 12px 14px;
  border-radius: var(--r-2);
  background: var(--surface-3);
  overflow-x: auto;
}
.md :deep(pre code) { background: none; padding: 0; font-size: 0.86em; line-height: 1.7; }
.md :deep(blockquote) {
  margin: 0 0 0.8em;
  padding: 2px 0 2px 12px;
  border-left: 2px solid var(--line-strong);
  color: var(--text-2);
}
.md :deep(hr) { border: none; border-top: 1px solid var(--line); margin: 0.7em 0; }
.md :deep(a) { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
.md :deep(strong) { font-weight: var(--fw-strong); color: var(--text); }
.md :deep(.md-table) { overflow-x: auto; margin: 0 0 0.6em; }
/* 窄屏让单元格换行，而不是把右边几列顶出屏幕 */
.md :deep(table) { border-collapse: collapse; width: 100%; table-layout: auto; font-size: 0.94em; }
.md :deep(th), .md :deep(td) {
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid var(--line);
  white-space: normal;
  word-break: break-word;
  vertical-align: top;
}
.md :deep(th) { color: var(--text-2); font-weight: var(--fw-medium); }
</style>
