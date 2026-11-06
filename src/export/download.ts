/**
 * 浏览器下载的统一出口
 *
 * 以前各页面各写一份 `<a download>`：有的没把 a 挂进 DOM，有的立刻 revoke URL，
 * 在部分浏览器/内嵌窗口里会「点了没反应还提示成功」。这里统一：
 * 挂进 DOM → 点击 → 移除 → 延迟释放，保证至少给出一次真实的下载机会。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 从文件名推断 MIME，原生保存/分享时需要告诉系统这是什么文件 */
export function mimeOf(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'json':
      return 'application/json';
    case 'zip':
      return 'application/zip';
    case 'md':
    case 'txt':
      return 'text/plain';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}
