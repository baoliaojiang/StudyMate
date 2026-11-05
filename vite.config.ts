import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

/** Electron 打包构建：用相对基路径（file:// 可加载），并关闭 PWA Service Worker（桌面端无意义且会报错） */
const isElectron = process.env.BUILD_TARGET === 'electron';
/**
 * 安卓（Capacitor）构建：也必须关掉 Service Worker。
 * 否则装进 WebView 后会注册到 https://localhost，之后一直用缓存里的旧 JS，
 * 表现就是「重新打包了，功能还是点不动」。
 */
const isAndroid = process.env.BUILD_TARGET === 'android';
/** 在线版（GitHub Pages 项目站点）：用相对基路径适配 /StudyMate/ 子路径，关闭 Service Worker */
const isPages = process.env.BUILD_TARGET === 'pages';

export default defineConfig({
  base: isElectron || isPages ? './' : '/',
  plugins: [
    vue(),
    VitePWA({
      disable: isElectron || isAndroid || isPages,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'apple-touch-icon.png'],
      manifest: {
        name: '研学帮 StudyMate',
        short_name: '研学帮',
        description: 'AI 研究性学习助手（第三方开源软件）',
        lang: 'zh-CN',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b0b0f',
        theme_color: '#0b0b0f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-1024.png', sizes: '1024x1024', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    outDir: isElectron
      ? 'dist-electron'
      : isAndroid
        ? 'dist-android'
        : isPages
          ? 'dist-pages'
          : 'dist',
  },
  server: { port: 5173, host: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 本机并行 worker 会触发沙箱文件权限问题，单进程跑更稳定
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
} as any);
