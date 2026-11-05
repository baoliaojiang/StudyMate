<script setup lang="ts">
/**
 * 设置页行内图标。
 *
 * 只画 20×20 的线性图形，统一 1.6 描边、圆头圆角，
 * 不填色、不带底色块 —— 与设置行同一色的灰，避免一屏出现十种彩色小方块。
 * 风格对照帮助中心：线性、单色、与行文字同色。
 */
type IconName =
  | 'chip'
  | 'search'
  | 'book'
  | 'invoice'
  | 'help'
  | 'more'
  | 'account'
  | 'bell'
  | 'palette'
  | 'voice'
  | 'ai'
  | 'memory'
  | 'phrases'
  | 'subscription'
  | 'feedback'
  | 'about'
  | 'update'
  | 'changelog'
  | 'restart'
  | 'terms'
  | 'privacy'
  | 'license'
  | 'dev'
  | 'doc'
  | 'storage';

withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 20 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <!-- 模型：芯片 -->
    <g v-if="name === 'chip'">
      <rect x="7" y="7" width="10" height="10" rx="2.2" />
      <path d="M10 3.6v2.2M14 3.6v2.2M10 18.2v2.2M14 18.2v2.2M3.6 10h2.2M3.6 14h2.2M18.2 10h2.2M18.2 14h2.2" />
    </g>

    <!-- 检索：放大镜 -->
    <g v-else-if="name === 'search'">
      <circle cx="10.6" cy="10.6" r="6.1" />
      <path d="m15.2 15.2 4.1 4.1" />
    </g>

    <!-- 指引：摊开的书 -->
    <g v-else-if="name === 'book'">
      <path d="M12 7.2C10.4 5.9 8.2 5.3 4.6 5.4v12c3.6-.1 5.8.5 7.4 1.8 1.6-1.3 3.8-1.9 7.4-1.8v-12c-3.6-.1-5.8.5-7.4 1.8Z" />
      <path d="M12 7.2v12" />
    </g>

    <!-- 数据与备份：归档盒 -->
    <g v-else-if="name === 'invoice'">
      <rect x="3.6" y="4.4" width="16.8" height="4.2" rx="1.4" />
      <path d="M5.2 8.6v9.4a1.6 1.6 0 0 0 1.6 1.6h10.4a1.6 1.6 0 0 0 1.6-1.6V8.6" />
      <path d="M10.1 12.2h3.8" />
    </g>

    <!-- 帮助：问号 -->
    <g v-else-if="name === 'help'">
      <circle cx="12" cy="12" r="8.2" />
      <path d="M9.7 9.4a2.4 2.4 0 1 1 3.2 2.3c-.6.2-.9.8-.9 1.5v.3" />
      <path d="M12 16.6h.01" />
    </g>

    <!-- 其他设置：三点 -->
    <g v-else-if="name === 'more'">
      <circle cx="6.4" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="17.6" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </g>

    <!-- 账号：单人 -->
    <g v-else-if="name === 'account'">
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M5.4 19.2a6.6 6.6 0 0 1 13.2 0" />
    </g>

    <!-- 通知：铃铛 -->
    <g v-else-if="name === 'bell'">
      <path d="M7 17h10l-1.2-1.6V10a3.8 3.8 0 0 0-7.6 0v5.4L7 17Z" />
      <path d="M10.2 19.4a1.8 1.8 0 0 0 3.6 0" />
    </g>

    <!-- 外观：调色板 -->
    <g v-else-if="name === 'palette'">
      <path d="M12 3.4a8.6 8.6 0 1 0 0 17.2c1 0 1.6-.8 1.6-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.7 1.7-1.7H15a4.3 4.3 0 0 0 4.3-4.3A8.6 8.6 0 0 0 12 3.4Z" />
      <circle cx="8.4" cy="9.2" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.2" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="9.2" r="1.05" fill="currentColor" stroke="none" />
    </g>

    <!-- 语音：麦克风 -->
    <g v-else-if="name === 'voice'">
      <rect x="9" y="4" width="6" height="10" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v3M9.4 20h5.2" />
    </g>

    <!-- AI 模式：星火 -->
    <g v-else-if="name === 'ai'">
      <path d="M12 4.5l1.6 3.7 3.7 1.6-3.7 1.6L12 15.1l-1.6-3.7L6.7 9.8l3.7-1.6L12 4.5Z" />
      <path d="M18.2 14.5l.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8.8-1.8Z" />
    </g>

    <!-- 记忆：书签 -->
    <g v-else-if="name === 'memory'">
      <path d="M7 4.5h10a1 1 0 0 1 1 1v14l-6-3.6L6 19.5V5.5a1 1 0 0 1 1-1Z" />
    </g>

    <!-- 常用语：对话气泡 -->
    <g v-else-if="name === 'phrases'">
      <path d="M5 5.5h14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-3 3v-3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" />
      <path d="M8.5 9.2h7M8.5 11.6h4.5" />
    </g>

    <!-- 订阅与用量：卡片 -->
    <g v-else-if="name === 'subscription'">
      <rect x="3.8" y="6.5" width="16.4" height="11" rx="2.2" />
      <path d="M3.8 10h16.4" />
      <path d="M7 14h3" />
    </g>

    <!-- 反馈：笑脸气泡 -->
    <g v-else-if="name === 'feedback'">
      <circle cx="12" cy="12" r="8.2" />
      <path d="M9.2 10.6h.01M12 10.6h.01M14.8 10.6h.01" />
      <path d="M9 14.2c.7.8 1.7 1.2 3 1.2s2.3-.4 3-1.2" />
    </g>

    <!-- 关于：信息圈 -->
    <g v-else-if="name === 'about'">
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 10.6v4.2" />
      <circle cx="12" cy="7.9" r="1" fill="currentColor" stroke="none" />
    </g>

    <!-- 检查更新：刷新 -->
    <g v-else-if="name === 'update'">
      <path d="M5.5 12a6.5 6.5 0 0 1 11.2-4.6" />
      <path d="M18.5 5.5v3.4h-3.4" />
      <path d="M18.5 12a6.5 6.5 0 0 1-11.2 4.6" />
      <path d="M5.5 18.5v-3.4h3.4" />
    </g>

    <!-- 更新日志：列表 -->
    <g v-else-if="name === 'changelog'">
      <rect x="5" y="3.6" width="14" height="16.8" rx="2.2" />
      <path d="M8.5 8h7M8.5 11.4h7M8.5 14.8h4.5" />
    </g>

    <!-- 重新引导：回环箭头 -->
    <g v-else-if="name === 'restart'">
      <path d="M5.5 12a6.5 6.5 0 1 0 1.9-4.6" />
      <path d="M4 4.5v3.6h3.6" />
    </g>

    <!-- 用户协议：带笔文件 -->
    <g v-else-if="name === 'terms'">
      <path d="M7 3.6h6l4 4v12.8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.6a1 1 0 0 1 1-1Z" />
      <path d="M13 3.6V8h4" />
      <path d="M8.6 11.4h7M8.6 14.4h7M8.6 17.2h4.5" />
    </g>

    <!-- 隐私政策：盾牌 -->
    <g v-else-if="name === 'privacy'">
      <path d="M12 3.4l7 2.8v5c0 4.4-3 8.2-7 9.4-4-1.2-7-5-7-9.4v-5l7-2.8Z" />
      <path d="M9.2 11.8l2 2 3.6-3.8" />
    </g>

    <!-- 开源许可：奖章 -->
    <g v-else-if="name === 'license'">
      <circle cx="12" cy="9.5" r="5" />
      <path d="M9 13.6l-1.6 6 4.6-2.4 4.6 2.4-1.6-6" />
    </g>

    <!-- 开发者：代码括号 -->
    <g v-else-if="name === 'dev'">
      <path d="M9 8.5 5.5 12 9 15.5" />
      <path d="M15 8.5 18.5 12 15 15.5" />
      <path d="M12.5 6.5 11.5 17.5" />
    </g>

    <!-- 报告/文档：文件 -->
    <g v-else-if="name === 'doc'">
      <path d="M7 3.6h6l4 4v12.8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.6a1 1 0 0 1 1-1Z" />
      <path d="M13 3.6V8h4" />
    </g>

    <!-- 存储：叠放的硬盘 -->
    <g v-else-if="name === 'storage'">
      <ellipse cx="12" cy="6.4" rx="7" ry="2.8" />
      <path d="M5 6.4v5.2c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8V6.4" />
      <path d="M5 11.6v5.2c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-5.2" />
    </g>
  </svg>
</template>

<style scoped>
svg { display: block; }
</style>
