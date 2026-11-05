import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSse } from '../src/ai/http';

/** 把文本按字节切成若干段，模拟 SSE 分片（含多字节中文被切断的情况） */
function chunked(text: string, size: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) parts.push(bytes.slice(i, i + size));
  return parts;
}

function mockSse(raw: string, size = 7) {
  const parts = chunked(raw, size);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(p);
      c.close();
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })),
  );
}

const RAW = [
  'data: {"choices":[{"delta":{"reasoning_content":"先看题目"}}]}',
  '',
  'data: {"choices":[{"delta":{"content":"福州鱼丸"}}]}',
  '',
  'data: {"choices":[{"delta":{"content":"很好吃。"}}]}',
  '',
  'data: [DONE]',
  '',
].join('\n');

describe('SSE 流式解析', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('跨分片、跨多字节也能拼出完整增量', async () => {
    mockSse(RAW, 7);
    let text = '';
    let reasoning = '';
    await fetchSse('https://example.com/chat', {
      timeoutMs: 5000,
      maxRetries: 0,
      onData: (d: any) => {
        const piece = d.choices?.[0]?.delta ?? {};
        if (piece.reasoning_content) reasoning += piece.reasoning_content;
        if (piece.content) text += piece.content;
      },
    });
    expect(reasoning).toBe('先看题目');
    expect(text).toBe('福州鱼丸很好吃。');
  });

  it('忽略 [DONE] 与心跳空行，不产生垃圾数据', async () => {
    mockSse('data:\n\n: ping\n\ndata: [DONE]\n\n', 3);
    let count = 0;
    await fetchSse('https://example.com/chat', {
      timeoutMs: 5000,
      maxRetries: 0,
      onData: () => count++,
    });
    expect(count).toBe(0);
  });

  it('非 2xx 直接报错，不把错误当内容', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"invalid key"}', { status: 401 })),
    );
    await expect(
      fetchSse('https://example.com/chat', { timeoutMs: 5000, maxRetries: 0, onData: () => {} }),
    ).rejects.toThrow(/API Key/);
  });
});
