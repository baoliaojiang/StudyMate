/**
 * 图片处理：头像与记录附件都在本地压缩，避免把原图原封不动塞进 IndexedDB。
 * 只依赖浏览器 Canvas，不引入额外依赖。
 */
export async function resizeImage(file: File, max = 256, quality = 0.86): Promise<string> {
  const bitmap = await loadImage(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持 Canvas');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

function loadImage(file: File): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

/** dataURL 的字节数估算：base64 每 4 字符约 3 字节 */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',');
  const body = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.round((body.length * 3) / 4);
}

/** dataURL -> Uint8Array，DOCX 内嵌图片要用 */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const i = dataUrl.indexOf(',');
  const body = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return out;
}
