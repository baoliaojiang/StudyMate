/**
 * 图片转述
 *
 * 主模型多数只吃文本，直接把图片塞进对话会 400。这里的做法是：
 * 用用户指定的「转述模型」先把图片讲成一段文字，再把文字交给主模型继续聊。
 *
 * 只实现 OpenAI 兼容的 /chat/completions（image_url + data URL）——市面上
 * 带视觉能力的服务商基本都认这套；Anthropic / Gemini 走各自的私有结构，
 * 这里不猜，直接给出可读的错误提示，让用户换一个兼容模型。
 */
import type { ProviderRow } from '../core/db';
import { open_ } from '../core/crypto';
import { ProviderError } from './types';

export interface DescribeOptions {
  /** 用户想问的关于图片的问题；为空则做通用转述 */
  question?: string;
  timeoutMs?: number;
}

const DEFAULT_PROMPT = [
  '请把这张图片里的信息完整、客观地转述成文字，供后续的文字模型使用。',
  '要求：',
  '1. 有文字就逐字抄录（保留数字、单位、编号），表格用「列名：值」逐行写。',
  '2. 有图表就说明图表类型、横纵轴、关键数据点和结论。',
  '3. 看不清或不确定的地方写「看不清」，不要猜。',
  '4. 不要评价图片质量，不要输出与图片无关的内容。',
].join('\n');

export async function describeImage(
  row: ProviderRow,
  model: string,
  dataUrl: string,
  opts: DescribeOptions = {},
): Promise<string> {
  if (row.kind !== 'openai-compatible') {
    throw new ProviderError(
      '当前转述模型不是 OpenAI 兼容接口，图片转述只支持这一类。请到「模型服务 → 分配与成本」里换一个兼容模型。',
      undefined,
      undefined,
      false,
    );
  }
  if (row.apiKeyLen === 0) {
    throw new ProviderError('转述模型还没有填 API Key', undefined, undefined, false);
  }

  const key = await open_(row.apiKeySealed);
  const base = (row.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new ProviderError('转述模型缺少接口地址', undefined, undefined, false);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: opts.question?.trim() || DEFAULT_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new ProviderError(
        `图片转述失败（${res.status}）：可能是该模型不支持图片输入，或额度不足`,
        res.status,
        text.slice(0, 300),
        false,
      );
    }
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ProviderError('转述模型返回的不是 JSON', res.status, text.slice(0, 200), false);
    }
    const out: string = data?.choices?.[0]?.message?.content ?? '';
    if (!out.trim()) throw new ProviderError('转述模型返回了空内容', res.status, undefined, false);
    return out.trim();
  } finally {
    clearTimeout(timer);
  }
}

/** 把图片压到长边 1024 以内再转 base64，避免几十 MB 的 data URL */
export function toDataUrl(file: File, maxSide = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('画布不可用');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('这张图片读不出来，换一张试试'));
    };
    img.src = url;
  });
}
