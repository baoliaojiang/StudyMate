/**
 * 微软 Azure 语音合成（可选）
 *
 * 为什么接它：系统 TTS 在安卓上音色参差，英文名念得像机器人；
 * Azure 的 Neural 音色读中文自然得多，学生听报告要点不费劲。
 *
 * 边界：
 * - 只走官方 REST 接口，`POST /cognitiveservices/v1`，返回 mp3；
 * - Key 只放请求头，不拼进 URL；不写日志；
 * - 长文本按 1800 字切段，逐段播放，避免一次请求过大。
 */

export interface AzureTtsOptions {
  key: string;
  region: string;
  voiceName: string;
  /** 0.5 - 2 */
  rate?: number;
}

export interface AzureSpeakResult {
  ok: boolean;
  reason?: string;
}

const MAX_CHUNK = 1800;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 按句号切段，尽量在语义边界断开 */
function splitChunks(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_CHUNK) return [clean];
  const parts: string[] = [];
  let buf = '';
  for (const sent of clean.split(/(?<=[。！？；.!?])/)) {
    if ((buf + sent).length > MAX_CHUNK && buf) {
      parts.push(buf);
      buf = '';
    }
    buf += sent;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}

function ssml(text: string, voiceName: string, rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  const rateAttr = pct === 0 ? '' : ` rate="${pct > 0 ? '+' : ''}${pct}%"`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="${voiceName}"><prosody${rateAttr}>${esc(text)}</prosody></voice></speak>`;
}

/** 合成一段并播放，返回是否播放完成 */
async function speakChunk(text: string, opts: AzureTtsOptions): Promise<void> {
  const url = `https://${opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': opts.key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
    },
    body: ssml(text, opts.voiceName || 'zh-CN-XiaoxiaoNeural', opts.rate ?? 1),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const hint =
      res.status === 401
        ? 'Key 无效或区域填错'
        : res.status === 403
          ? 'Key 权限不足或配额用尽'
          : res.status === 404
            ? '区域不对（应填 eastasia、eastus 这类）'
            : '合成失败';
    throw new Error(`微软语音：${hint}（${res.status}）${detail.slice(0, 120)}`);
  }

  const blob = await res.blob();
  const src = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(src);
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('音频播放失败'));
      void audio.play().catch(() => reject(new Error('浏览器拒绝了播放，请先点一下页面再试')));
    });
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** 用微软语音朗读；失败时抛出可读错误，由上层决定是否回退系统语音 */
export async function azureSpeak(text: string, opts: AzureTtsOptions): Promise<AzureSpeakResult> {
  if (!text.trim()) return { ok: false, reason: '没有可朗读的内容' };
  if (!opts.key || !opts.region) return { ok: false, reason: '微软语音还没填 Key 或区域' };
  try {
    for (const chunk of splitChunks(text)) {
      await speakChunk(chunk, opts);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
