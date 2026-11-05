<script setup lang="ts">
/**
 * 模型服务商图标：渲染各厂商自己的品牌 SVG（来自 brandLogos.generated.ts）。
 * 无标准图标的服务商显示「品牌色 + 真实简称」占位块，不是自绘 logo。
 */
import { computed } from 'vue';
import { resolveLogo } from '../../ai/logos';

const props = withDefaults(
  defineProps<{
    presetKey?: string;
    kind?: string;
    label?: string;
    size?: number;
    radius?: number;
  }>(),
  { size: 34, radius: 10 },
);

const def = computed(() => resolveLogo({ key: props.presetKey, kind: props.kind, label: props.label }));

/**
 * 品牌色普遍是深色（OpenAI、xAI 甚至接近纯黑），暗色主题下会整个糊在背景里。
 * 亮度低于 22% 的一律改用正文色，保证两种主题都看得见。
 */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const ink = computed(() => (luminance(def.value.hex) < 0.22 ? 'var(--text)' : def.value.hex));
</script>

<template>
  <span
    class="plogo"
    :style="{
      width: size + 'px',
      height: size + 'px',
      borderRadius: radius + 'px',
      color: ink,
      fontSize: Math.max(11, Math.round(size * 0.32)) + 'px',
    }"
    :aria-label="label || def.mono || '服务商'"
    role="img"
  >
    <span v-if="def.svg" class="g" v-html="def.svg" />
    <span v-else class="m">{{ def.mono }}</span>
  </span>
</template>

<style scoped>
.plogo {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1;
  overflow: hidden;
  user-select: none;
  /* 中性芯片底，浅色/深色都合适，不强加品牌色块 */
  background: rgba(125, 130, 140, 0.16);
}
.g {
  width: 64%;
  height: 64%;
  display: block;
}
.g :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.m {
  transform: translateY(0.5px);
}
</style>
