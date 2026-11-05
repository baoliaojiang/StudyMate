/**
 * 打字机的 Markdown 安全边界
 *
 * 打字机每拍只露一部分文本，这一小部分会被当成完整 Markdown 交给渲染器。
 * 如果恰好切在 ``` 围栏、**加粗**、行内代码或表格行中间，半截语法会把后面的
 * 正文整块吃进去，屏幕上先蹦出一个畸形大块再突然收回。
 *
 * 两个纯函数配合：
 * - safeCut：把切点退到最近的标点/空白，最多回看 10 个字，且保证单调前进；
 * - completeMarkdown：给还没写完的围栏与行内标记临时补上闭合符。
 * 只在内存里补，不改消息正文，也不动流式链路。
 */

const BOUNDARY = /[\s，。！？；：、,.!?;:)）\]】》」』]/;

/** 把「想露到第几个字」修到安全位置；min 是上一拍的位置，保证不倒退 */
export function safeCut(text: string, target: number, min = 0): number {
  const total = (text ?? '').length;
  if (target >= total) return total;
  if (target <= 0) return 0;
  const floor = Math.max(0, Math.min(min, total));
  for (let i = target - 1; i >= Math.max(floor, target - 10); i--) {
    if (BOUNDARY.test(text[i])) return i + 1;
  }
  return target;
}

/** 给截断的片段补闭合符，避免渲染器把后面整块吞掉 */
export function completeMarkdown(part: string): string {
  let out = part ?? '';
  const fences = (out.match(/^\s*```/gm) ?? []).length;
  if (fences % 2 === 1) out += '\n```';
  // 围栏行不参与行内标记统计
  const inline = out.replace(/^\s*```.*$/gm, '');
  if ((inline.split('**').length - 1) % 2 === 1) out += '**';
  if ((inline.split('`').length - 1) % 2 === 1) out += '`';
  return out;
}
