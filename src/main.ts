import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import './styles/base.css';

/**
 * 安全区兜底
 *
 * 安卓 targetSdk 36 强制 edge-to-edge，WebView 里 env(safe-area-inset-top)
 * 有时会返回 0，导致顶栏和提示直接压在状态栏下面。
 * 这里实测一次 env()，拿不到就按平台给个合理兜底，结果写进 --safe-top，
 * 全站用 var(--safe-top) 而不是裸 env()。
 */
function installSafeArea() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const top = parseFloat(cs.paddingTop) || 0;
  const bottom = parseFloat(cs.paddingBottom) || 0;
  probe.remove();

  const native = Boolean(
    (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
  );

  /**
   * 实测值单独存一份（--sa-top / --sa-bottom），
   * 用户手动加的留白在 app store 里叠上去，两者互不覆盖。
   */
  const root = document.documentElement;
  // 安卓 targetSdk 36 的 WebView 里 env() 常常直接给 0；给一个偏大的兜底，
  // 宁可多留一点，也不要顶栏压在状态栏下面（顶栏重叠是可读性问题，多几像素只是不好看）
  const safeTop = top || (native ? 32 : 0);
  const safeBottom = bottom || (native ? 16 : 0);
  root.style.setProperty('--sa-top', `${safeTop}px`);
  root.style.setProperty('--sa-bottom', `${safeBottom}px`);
  root.style.setProperty('--safe-top', `${safeTop}px`);
  root.style.setProperty('--safe-bottom', `${safeBottom}px`);

  return native;
}

/**
 * 安卓壳清理旧 Service Worker
 *
 * 早期安卓包用的是带 PWA 的 Web 构建，SW 注册在 https://localhost 上、
 * 一直把旧 JS 从缓存里发出来，表现就是「重新打了包，功能还是点不动」。
 * 现在安卓构建已关掉 PWA，这里再把历史遗留的注册和缓存清掉，
 * 保证装上新包就是新代码。只对原生端执行，不影响浏览器里的 PWA。
 */
async function purgeLegacyServiceWorker() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* 清不掉也不阻断启动 */
  }
}

const isNative = installSafeArea();
if (isNative) void purgeLegacyServiceWorker();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
