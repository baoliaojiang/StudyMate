/**
 * 密钥保护
 *
 * 诚实说明（UI 里也会原样展示，不许美化）：
 * - 本模块用 WebCrypto AES-GCM 加密 API Key 后落 IndexedDB。
 * - 设备主密钥以「不可导出（non-extractable）」的 CryptoKey 形式存放，无法被脚本读出原始字节。
 * - 但**任何能在本页面同源执行的代码（含恶意浏览器扩展、被注入的脚本、调试器）都可以调用解密**。
 *   因此前端加密只能降低「明文被随手翻到 / 被备份文件带出」的风险，
 *   **无法抵御本机恶意软件或浏览器调试**。桌面包 / 安卓包在此基础上依赖系统级密钥库，能力更强，
 *   但仍不能宣称绝对安全。
 */

const DB_NAME = 'studymate-keystore';
const STORE = 'keys';
const DEVICE_KEY_ID = 'device-master';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let cachedKey: CryptoKey | null = null;

async function getDeviceKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const existing = await idbGet<CryptoKey>(DEVICE_KEY_ID);
  if (existing) {
    cachedKey = existing;
    return existing;
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await idbSet(DEVICE_KEY_ID, key);
  cachedKey = key;
  return key;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 加密后的密文信封，可直接序列化进 IndexedDB / 备份文件 */
export interface Sealed {
  v: 1;
  iv: string;
  data: string;
}

export async function seal(plain: string): Promise<Sealed> {
  if (!plain) return { v: 1, iv: '', data: '' };
  const key = await getDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return { v: 1, iv: toB64(iv.buffer), data: toB64(cipher) };
}

export async function open_(sealed: Sealed | string | undefined): Promise<string> {
  if (!sealed) return '';
  if (typeof sealed === 'string') return sealed; // 兼容历史明文（读取后应尽快重新封存）
  if (!sealed.data) return '';
  const key = await getDeviceKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(sealed.iv) as unknown as BufferSource },
    key,
    fromB64(sealed.data) as unknown as BufferSource,
  );
  return dec.decode(plain);
}

/* ------------------------------------------------------------------ */
/* 口令加密的备份导出（跨设备恢复用）                                    */
/* ------------------------------------------------------------------ */

async function deriveFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  // 必须是 WebCrypto 规定的算法名 PBKDF2；写错会直接抛 NotSupportedError，
  // 表现为「备份导不出来 / 恢复永远提示口令错误」。
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 210000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface PassphraseSealed {
  v: 1;
  kdf: 'PBKDF2-SHA256-210000';
  salt: string;
  iv: string;
  data: string;
}

export async function sealWithPassphrase(
  plain: string,
  passphrase: string,
): Promise<PassphraseSealed> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveFromPassphrase(passphrase, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    enc.encode(plain),
  );
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256-210000',
    salt: toB64(salt.buffer),
    iv: toB64(iv.buffer),
    data: toB64(cipher),
  };
}

export async function openWithPassphrase(
  sealed: PassphraseSealed,
  passphrase: string,
): Promise<string> {
  const key = await deriveFromPassphrase(passphrase, fromB64(sealed.salt));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(sealed.iv) as unknown as BufferSource },
    key,
    fromB64(sealed.data) as unknown as BufferSource,
  );
  return dec.decode(plain);
}

/** 生成便于肉眼核对的短指纹，用于确认「同一个 Key 备份」 */
export async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/* ------------------------------------------------------------------ */
/* 脱敏                                                                */
/* ------------------------------------------------------------------ */

/** 任何要打印、记录、展示的 key 都必须先过这里 */
export function maskKey(key: string): string {
  if (!key) return '（未配置）';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * 保证错误信息里不残留 key。
 * 除了调用方传入的具体 key，还会拦截常见 Key 形态——
 * 服务商有时会把 Key 回显在错误报文里（例如 `sk-xxx is invalid`），
 * 这类字符串不经过我们的变量也会进提示，所以按形态兜住。
 */
export function scrubSecrets(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('***');
  }
  return out
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/\bsk-proj-[A-Za-z0-9_-]{8,}/g, 'sk-proj-***')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza***')
    .replace(/\bAKIA[0-9A-Z]{12,}/g, 'AKIA***')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, 'xox-***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, '$1***')
    .replace(/("(?:api_?key|apiKey|x-api-key|authorization)"\s*:\s*")[^"]{6,}"/gi, '$1***"')
    .replace(/([?&](?:key|api_key|apikey|access_token)=)[^&\s]{6,}/gi, '$1***');
}
