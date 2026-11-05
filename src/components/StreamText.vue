<script setup lang="ts">
/**
 * 逐字浮现的文本
 *
 * 只在“刚生成完”的内容上用：每个字 90ms 从 blur(6px) 到清晰，
 * 相邻字错开 30ms，读起来像墨刚落到纸上。
 * 长文本（> 900 字）自动改为整段淡入 —— 逐字动画在长文上只会拖慢阅读。
 */
import { computed } from 'vue';

const props = withDefaults(defineProps<{ text: string; animate?: boolean }>(), { animate: true });

const chars = computed(() => Array.from(props.text || ''));
const long = computed(() => chars.value.length > 900);
const animating = computed(() => props.animate && !long);
</script>

<template>
  <p v-if="animating" class="stream" :aria-label="text">
    <span
      v-for="(ch, i) in chars"
      :key="i"
      class="char"
      :style="{ '--ci': Math.min(i, 40) }"
      aria-hidden="true"
    >{{ ch }}</span>
  </p>
  <p v-else class="stream plain">{{ text }}</p>
</template>

<style scoped>
.stream {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  text-wrap: pretty;
}
.stream.plain { animation: rise var(--dur-3) var(--ease-out); }
@keyframes rise { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
</style>
