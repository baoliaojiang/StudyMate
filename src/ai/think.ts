/**
 * 内联思考标签的处理
 *
 * 官方接口一般把思考放在独立字段（reasoning_content / thinking block / thought part），
 * 但第三方网关经常偷懒，直接把 `<think>…</think>` 拼在 content 里。
 * 这类内容绝不能留在正文里，否则「思考」就变成了交上去的段落。
 */

const INLINE_THINK = /<\s*(think|thinking|thought|reasoning)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi;

export function stripInlineThink(raw: string): { text: string; reasoning?: string } {
  const thinks: string[] = [];
  const text = (raw ?? '')
    .replace(INLINE_THINK, (_m, _tag, inner: string) => {
      const t = String(inner ?? '').trim();
      if (t) thinks.push(t);
      return '';
    })
    // 有些网关用「思考过程：」当分隔符
    .replace(/^\s*(?:思考过程|推理过程|thinking)\s*[:：]\s*/i, '')
    .trim();
  return { text, reasoning: thinks.length ? thinks.join('\n\n') : undefined };
}
