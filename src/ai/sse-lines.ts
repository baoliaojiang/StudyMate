/**
 * SSE 行解析（两条通道共用）
 *
 * 一条是浏览器 fetch 的 ReadableStream，一条是安卓原生插件的批量文本；
 * 两边拿到的都是「一行一行」的原文，解析规则必须完全一致，否则同一个模型
 * 在 Web 和手机上表现会不一样。
 */

/** 解析一行 SSE；返回是否解析出了有效数据 */
export function emitSseLine(line: string, onData: (data: any) => void): boolean {
  const raw = line.replace(/\r$/, '').trim();
  if (!raw) return false;
  // 标准 SSE 用 `data:` 前缀；个别网关直接吐 NDJSON，也一并兼容
  const payload = raw.startsWith('data:') ? raw.slice(5).trim() : raw;
  if (!payload || payload === '[DONE]') return false;
  if (!payload.startsWith('{') && !payload.startsWith('[')) return false;
  try {
    onData(JSON.parse(payload));
    return true;
  } catch {
    return false;
  }
}

/** 把一段完整文本按行切开解析（给不支持流式读取的桥接用） */
export function emitSseText(text: string, onData: (data: any) => void): number {
  let n = 0;
  for (const line of text.split('\n')) {
    if (emitSseLine(line, onData)) n++;
  }
  return n;
}
