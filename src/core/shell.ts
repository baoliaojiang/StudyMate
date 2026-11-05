/**
 * 外链打开：直接跳转系统浏览器。
 *
 * 三个环境三条路：
 * - 安卓壳（Capacitor）：WebView 里 window.open 会被吞掉，必须走 Browser 插件的 _system；
 *   插件缺失时退到 location，让系统 Intent 处理，至少不会「点了没反应」。
 * - 桌面壳（Electron）：主进程已用 setWindowOpenHandler 接管 _blank，window.open 可用。
 * - 浏览器 / PWA：window.open 即可，被拦时退回当前页跳转。
 */
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

export function openExternal(url: string): void {
  if (!url) return;

  if (Capacitor.isNativePlatform()) {
    void Browser.open({ url }).catch(() => {
      window.location.href = url;
    });
    return;
  }

  try {
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) window.location.href = url;
  } catch {
    window.location.href = url;
  }
}
