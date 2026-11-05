<script setup lang="ts">
/**
 * 打字机式的 Markdown
 *
 * 模型不是流式返回，一次给全文。为了「像在写」而不是「啪一下出现」，
 * 这里把文本按节奏吐出来：每个 tick 露出几个字，末尾跟一条光标。
 * 长文自动加快步长，避免读一个五千字报告要等半分钟。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import MarkdownText from './MarkdownText.vue';
import { completeMarkdown, safeCut } from './typing';

const props = withDefaults(
  defineProps<{
    text: string;
    active?: boolean;
    charsPerTick?: number;
    /** 打字速度：适中按人类中文阅读速度；快速用于扫读，慢速用于逐句看 */
    speed?: 'slow' | 'normal' | 'fast';
  }>(),
  { active: true, charsPerTick: 0, speed: 'normal' },
);

const emit = defineEmits<{ done: [] }>();

const total = computed(() => (props.text ?? '').length);
const shown = ref(props.active ? 0 : total.value);
let timer: number | undefined;

function clear() {
  if (timer) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

function start() {
  clear();
  shown.value = props.active ? 0 : total.value;
  if (!props.active || total.value === 0) {
    emit('done');
    return;
  }
  /**
   * 速度按「每字多少毫秒」算，不再固定 2.6 秒播完：
   * 适中 70ms/字（约 14 字/秒，接近中文舒适阅读），慢速 140ms，快速 35ms。
   * 只有超长文才按比例提速，上限 120 秒，避免几千字要播十分钟。
   */
  const SPEED_MS = { fast: 35, normal: 70, slow: 140 } as const;
  const MAX_PLAY_MS = 120_000;
  const tick = SPEED_MS[props.speed] ?? SPEED_MS.normal;
  const step =
    props.charsPerTick ||
    Math.max(1, Math.ceil(total.value / Math.max(1, Math.round(MAX_PLAY_MS / tick))));
  timer = window.setInterval(() => {
    shown.value = Math.min(total.value, shown.value + step);
    if (shown.value >= total.value) {
      clear();
      emit('done');
    }
  }, tick);
}

watch(
  () => [props.text, props.active, props.speed] as const,
  () => start(),
  { immediate: true },
);

onBeforeUnmount(clear);

/** 切点退到标点边界，再给半截的 Markdown 补闭合符：中途不会渲染出畸形大块 */
const visible = computed(() => {
  const text = props.text ?? '';
  return completeMarkdown(text.slice(0, safeCut(text, shown.value)));
});
const typing = computed(() => shown.value < total.value);
</script>

<template>
  <div class="typing">
    <MarkdownText :text="visible" />
    <span v-if="typing" class="caret" aria-hidden="true" />
  </div>
</template>

<style scoped>
.typing { position: relative; }
.caret {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 1px;
  vertical-align: -0.14em;
  background: var(--text-3);
  border-radius: 1px;
  animation: caret-blink 1s steps(2, start) infinite;
}
@keyframes caret-blink {
  0%, 100% { opacity: 0.15; }
  50% { opacity: 0.9; }
}
html[data-motion='off'] .caret { animation: none; opacity: 0.5; }
</style>
