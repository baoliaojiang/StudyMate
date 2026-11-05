/**
 * 语音播报
 *
 * 只朗读自然音色（Neural / Natural / Enhanced / Premium / 在线神经语音）。
 * 本机没有可用自然音色时，不朗读，并在设置里提示去安装语音包或开启在线音色。
 */

export interface VoiceOption {
  name: string;
  lang: string;
  /** 是否判定为自然音色 */
  natural: boolean;
  /** 本地合成 / 在线合成（在线音色通常更自然） */
  local: boolean;
}

const NATURAL_RE = /natural|neural|online|enhanced|premium|siri|xiaoxiao|xiaoyi|yunxi|yunjian/i;
const ROBOTIC_RE = /compact|espeak|pico|festival|sam\b|robot/i;

export function isNaturalVoice(v: SpeechSynthesisVoice): boolean {
  if (ROBOTIC_RE.test(v.name)) return false;
  return NATURAL_RE.test(v.name);
}

function ready(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** 部分浏览器首次调用时语音列表为空，需要等 voiceschanged */
export function loadVoices(timeoutMs = 1200): Promise<SpeechSynthesisVoice[]> {
  if (!ready()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener?.('voiceschanged', finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener?.('voiceschanged', finish);
    window.setTimeout(finish, timeoutMs);
  });
}

/** 中文优先，自然音色优先；返回的列表里 natural=false 的只用于说明「只有机械音」 */
export function voiceOptions(all: SpeechSynthesisVoice[], onlyNatural = true): VoiceOption[] {
  const zh = all.filter((v) => /^zh/i.test(v.lang) || /chinese|中文|普通话/i.test(v.name));
  const pool = zh.length ? zh : all;
  return pool
    .map((v) => ({ name: v.name, lang: v.lang, natural: isNaturalVoice(v), local: v.localService }))
    .filter((v) => (onlyNatural ? v.natural : true))
    .sort((a, b) => Number(b.local) - Number(a.local) || a.name.localeCompare(b.name));
}

export interface SpeakResult {
  ok: boolean;
  /** 失败原因，直接用于界面提示 */
  reason?: string;
}

/** 朗读一段文字；找不到自然音色时直接返回失败，不播放机械音 */
export async function speakNatural(
  text: string,
  opts: { voiceName?: string; rate?: number } = {},
): Promise<SpeakResult> {
  if (!ready()) return { ok: false, reason: '这台设备不支持语音合成' };
  if (!text.trim()) return { ok: false, reason: '没有可朗读的内容' };

  const all = await loadVoices();
  const options = voiceOptions(all);
  if (!options.length) {
    return {
      ok: false,
      reason: '本机没有自然音色，已跳过朗读。可在 Edge 中启用在线自然音色，或在系统里安装增强语音包。',
    };
  }
  const chosen = options.find((v) => v.name === opts.voiceName) ?? options[0];
  const raw = all.find((v) => v.name === chosen.name);

  const u = new SpeechSynthesisUtterance(text);
  if (raw) u.voice = raw;
  u.lang = chosen.lang || 'zh-CN';
  u.rate = Math.min(2, Math.max(0.6, opts.rate ?? 1));
  window.speechSynthesis.cancel();

  return new Promise((resolve) => {
    let settled = false;
    const done = (r: SpeakResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    u.onend = () => done({ ok: true });
    u.onerror = (e) => done({ ok: false, reason: `朗读失败：${e.error || '未知原因'}` });
    // 某些环境不会触发 onend，给一个兜底
    window.setTimeout(() => done({ ok: true }), Math.max(3000, text.length * 180));
    window.speechSynthesis.speak(u);
  });
}
