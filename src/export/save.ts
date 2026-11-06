/**
 * 保存 / 分享 / 选择文件
 *
 * 三条路按平台分开，能力与失败都如实告诉用户，不假装成功：
 *  - 网页 / 桌面：能弹「另存为」就弹，否则落到默认下载文件夹；
 *  - 安卓壳：WebView 里的 <a download> 不会真的落盘，改走自研原生插件
 *    FilesBridge（系统保存对话框 / 下载目录 / 系统分享 / 系统文件选择器）；
 *  - 插件缺失（旧安装包）时明确报错，不静默说「已保存」。
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { downloadBlob, mimeOf } from './download';

export type SaveHow = 'picked' | 'shared' | 'downloaded' | 'cancelled';

export interface SaveResult {
  how: SaveHow;
  /** 给用户看的一句话说明 */
  note: string;
}

interface FilesBridgePlugin {
  save(opts: {
    base64: string;
    filename: string;
    mime: string;
    pick: boolean;
  }): Promise<{ how?: string; note?: string }>;
  share(opts: { base64: string; filename: string; mime: string }): Promise<{ ok?: boolean }>;
  pickText(opts: { mime: string }): Promise<{ text?: string | null; name?: string }>;
}

let bridgeCache: FilesBridgePlugin | null | undefined;

function nativeBridge(): FilesBridgePlugin | null {
  if (bridgeCache !== undefined) return bridgeCache;
  try {
    bridgeCache = Capacitor.isNativePlatform()
      ? registerPlugin<FilesBridgePlugin>('FilesBridge')
      : null;
  } catch {
    bridgeCache = null;
  }
  return bridgeCache;
}

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Blob 转 base64：分块拼接，避免大文件把参数栈撑爆 */
async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

interface PickerWindow extends Window {
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }>;
}

/**
 * 保存一个文件。pick = true 表示这次是「另存为」：让用户自己挑位置。
 */
export async function saveFile(
  blob: Blob,
  filename: string,
  opts: { pick?: boolean } = {},
): Promise<SaveResult> {
  const bridge = nativeBridge();
  if (bridge) {
    const res = await bridge.save({
      base64: await toBase64(blob),
      filename,
      mime: mimeOf(filename),
      pick: Boolean(opts.pick),
    });
    const how: SaveHow =
      res.how === 'cancelled' || res.how === 'picked' || res.how === 'shared' ? res.how : 'downloaded';
    return { how, note: res.note ?? (how === 'cancelled' ? '没有保存' : '已保存') };
  }

  if (opts.pick) {
    const w = window as PickerWindow;
    if (typeof w.showSaveFilePicker === 'function') {
      try {
        const handle = await w.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: '文件', accept: { [mimeOf(filename)]: [`.${filename.split('.').pop()}`] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { how: 'picked', note: '已保存到你选的位置' };
      } catch (e) {
        // 用户点了取消：不当成失败，也不要偷偷下载到别处
        if (e instanceof DOMException && e.name === 'AbortError') {
          return { how: 'cancelled', note: '没有保存' };
        }
        // 其他错误（浏览器不支持、权限被拒）落回下载
      }
    }
  }

  downloadBlob(blob, filename);
  return { how: 'downloaded', note: '已保存到默认下载文件夹' };
}

/** 文本文件（备份 JSON 等）走同一套保存通道 */
export function saveText(
  text: string,
  filename: string,
  opts: { pick?: boolean } = {},
): Promise<SaveResult> {
  return saveFile(new Blob([text], { type: 'application/json;charset=utf-8' }), filename, opts);
}

/** 发到其它应用：只有安卓版提供；网页版如实说明，不假装能分享 */
export async function shareFile(blob: Blob, filename: string): Promise<SaveResult> {
  const bridge = nativeBridge();
  if (!bridge) {
    throw new Error('分享到其它应用只在安卓版可用；网页版请用「另存为」保存后自行发送。');
  }
  await bridge.share({ base64: await toBase64(blob), filename, mime: mimeOf(filename) });
  return { how: 'shared', note: '已打开系统分享，选微信、QQ 或邮件即可发出' };
}

export interface PickedText {
  text: string;
  name: string;
}

/**
 * 选一个文本文件读进来（备份恢复用）。
 * 安卓走系统文件选择器；网页端临时建一个 input，选完就读，取消返回 null。
 */
export async function pickTextFile(): Promise<PickedText | null> {
  const bridge = nativeBridge();
  if (bridge) {
    const res = await bridge.pickText({ mime: '*/*' });
    return typeof res.text === 'string' ? { text: res.text, name: res.name ?? 'backup.json' } : null;
  }

  return new Promise<PickedText | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt,application/json,text/plain';
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    let timer = 0;
    const finish = (value: PickedText | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      file
        .text()
        .then((text) => finish({ text, name: file.name }))
        .catch(() => finish(null));
    });
    input.addEventListener('cancel', () => finish(null));
    // 老浏览器没有 cancel 事件：兜一个超时，别让 Promise 永远挂着
    timer = window.setTimeout(() => finish(null), 120000);
    input.click();
  });
}
