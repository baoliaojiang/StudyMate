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

const props = withDefaults(
  defineProps<{ text: string; active?: boolean; charsPerTick?: number }>(),
  { active: true, charsPerTick: 0 },
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
   * 按「整段约 2.6 秒播完」反推每拍字数：短回答是 1 字/28ms（约 35 字/秒，
   * 和真实流式手感接近），长回答自动加速，不会让人盯着等十几秒。
   */
  const TICK_MS = 28;
  const TARGET_MS = 2600;
  const step =
    props.charsPerTick || Math.max(1, Math.ceil(total.value / Math.round(TARGET_MS / TICK_MS)));
  timer = window.setInterval(() => {
    shown.value = Math.min(total.value, shown.value + step);
    if (shown.value >= total.value) {
      clear();
      emit('done');
    }
  }, TICK_MS);
}

watch(
  () => [props.text, props.active] as const,
  () => start(),
  { immediate: true },
);

onBeforeUnmount(clear);

const visible = computed(() => (props.text ?? '').slice(0, shown.value));
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
