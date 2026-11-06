<script setup lang="ts">
/**
 * DOCX 预览（手机 / 电脑共用）
 *
 * 修的四个老毛病：
 * 1. 弹层只占一小块、背后内容透出来 —— 改成整屏实底，不再用半透明 scrim；
 * 2. A4 固定 794px 在手机上被裁掉右半页 —— 按容器宽度算缩放，用 zoom 真实影响布局；
 * 3. 暗色模式下正文黑字压在深底上看不清 —— 纸张恒为白底黑字，外层用不透明中性灰；
 * 4. 想看细节时没有放大手段 —— 提供「适配宽度 / 原始大小」切换。
 *
 * 渲染的就是导出的那份 blob，所见即所得。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { renderAsync } from 'docx-preview';
import { pushOverlay } from '../core/task-guard';

const props = defineProps<{
  open: boolean;
  blob: Blob | null;
  title?: string;
  loading?: boolean;
  error?: string;
}>();
const emit = defineEmits<{ close: [] }>();

const host = ref<HTMLElement | null>(null);
const stage = ref<HTMLElement | null>(null);
const scale = ref(1);
const fitMode = ref<'fit' | 'actual'>('fit');
const renderError = ref('');

let observer: ResizeObserver | null = null;
let releaseOverlay: (() => void) | null = null;
let renderSeq = 0;

function fit() {
  const el = host.value;
  const box = stage.value;
  if (!el || !box) return;
  // 先回到 1:1 再量真实页面宽，避免上一次 zoom 影响测量
  el.style.zoom = '';
  void el.offsetWidth;
  const page = el.querySelector('section.docx') as HTMLElement | null;
  const pageWidth = page?.offsetWidth || 816;
  const avail = Math.max(160, box.clientWidth - 24);
  const k = fitMode.value === 'fit' ? Math.min(1, Math.max(0.3, avail / pageWidth)) : 1;
  scale.value = k;
  el.style.zoom = String(k);
}

async function render() {
  const seq = ++renderSeq;
  renderError.value = '';
  await nextTick();
  const el = host.value;
  if (!el) return;
  el.innerHTML = '';
  if (!props.blob) return;
  try {
    await renderAsync(props.blob, el, undefined, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      experimental: true,
      useBase64URL: true,
    });
    if (seq !== renderSeq) return;
    await nextTick();
    fit();
  } catch (e) {
    if (seq !== renderSeq) return;
    renderError.value = e instanceof Error ? e.message : '这个文件没能渲染出来';
  }
}

watch(
  () => [props.open, props.blob] as const,
  ([open]) => {
    if (open) {
      void render();
      if (!observer && stage.value) {
        observer = new ResizeObserver(() => fit());
        observer.observe(stage.value);
      }
    }
  },
  { immediate: true },
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      if (!releaseOverlay) {
        releaseOverlay = pushOverlay('docx-preview', () => {
          emit('close');
          return true;
        });
      }
      void nextTick(() => {
        if (!observer && stage.value) {
          observer = new ResizeObserver(() => fit());
          observer.observe(stage.value);
        }
        fit();
      });
    } else {
      releaseOverlay?.();
      releaseOverlay = null;
      observer?.disconnect();
      observer = null;
    }
  },
  { immediate: true },
);

watch(fitMode, () => {
  if (props.open) fit();
});

function close() {
  emit('close');
}

onBeforeUnmount(() => {
  releaseOverlay?.();
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <div v-if="open" class="dp-scrim" role="dialog" aria-modal="true" :aria-label="title || 'DOCX 预览'">
    <div class="dp-card">
      <div class="dp-bar">
        <b class="dp-title">{{ title || 'DOCX 预览' }}</b>
        <span class="dp-sub">与导出的文件一致</span>
        <button class="dp-fit" type="button" @click="fitMode = fitMode === 'fit' ? 'actual' : 'fit'">
          {{ fitMode === 'fit' ? '原始大小' : '适配宽度' }}
        </button>
        <span class="dp-scale">{{ Math.round(scale * 100) }}%</span>
        <button class="dp-x" type="button" aria-label="关闭" @click="close">×</button>
      </div>

      <div ref="stage" class="dp-stage">
        <div ref="host" class="dp-docx" />
        <p v-if="loading || !blob" class="dp-tip">正在生成并渲染…</p>
        <p v-else-if="error || renderError" class="dp-tip dp-err">{{ error || renderError }}</p>
      </div>

      <div class="dp-foot">
        <span>预览只影响显示，交学校仍以下载的 DOCX 为准。</span>
        <span class="dp-hint">手机上可切到「原始大小」横向滚动看细节</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dp-scrim {
  position: fixed; inset: 0; z-index: 160;
  background: var(--bg); /* 实底：不让背后的页面透出来 */
  display: flex; align-items: stretch; justify-content: center;
}
.dp-card {
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  background: var(--bg);
  animation: dp-in var(--dur-3) var(--ease-out);
}
@keyframes dp-in { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }
html[data-motion='off'] .dp-card { animation: none; }

.dp-bar {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: 10px;
  padding: calc(10px + var(--safe-top, env(safe-area-inset-top, 0px))) 14px 10px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.dp-title { font-size: calc(13.5px * var(--font-scale)); font-weight: var(--fw-medium); white-space: nowrap; }
.dp-sub { flex: 1; min-width: 0; font-size: calc(11px * var(--font-scale)); color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-fit {
  flex: 0 0 auto; border: none; border-radius: var(--r-full);
  padding: 6px 11px; background: var(--surface-2); color: var(--text);
  font-size: calc(11px * var(--font-scale)); cursor: pointer;
}
.dp-scale {
  flex: 0 0 auto; min-width: 40px; text-align: right;
  font-size: calc(11px * var(--font-scale)); color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.dp-x {
  flex: 0 0 34px; width: 34px; height: 34px;
  border: none; border-radius: 50%; background: var(--surface-2);
  color: var(--text); font-size: calc(20px * var(--font-scale)); line-height: 1; cursor: pointer;
}

.dp-stage {
  flex: 1 1 auto; min-height: 0;
  overflow: auto;
  padding: 12px;
  background: #5b5b59; /* 中性灰托住白纸，明暗主题下都成立 */
  position: relative;
}
.dp-docx { color: #111; }
.dp-docx :deep(.docx-wrapper) { background: transparent; padding: 0; }
.dp-docx :deep(.docx-wrapper > section.docx) {
  margin: 0 auto 16px !important;
  background: #fff;
  color: #111;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.3);
}
.dp-docx :deep(section.docx p),
.dp-docx :deep(section.docx span),
.dp-docx :deep(section.docx td) { color: inherit; }
.dp-tip {
  position: sticky; top: 40%; margin: 0;
  text-align: center; color: #fff;
  font-size: calc(12.5px * var(--font-scale));
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
.dp-err { color: #ffd9d9; }

.dp-foot {
  flex: 0 0 auto;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 9px 14px calc(9px + var(--safe-bottom, env(safe-area-inset-bottom, 0px)));
  background: var(--surface); color: var(--text-3);
  font-size: calc(10.5px * var(--font-scale)); line-height: 1.6;
}
.dp-hint { text-align: right; }

@media (max-width: 640px) {
  .dp-sub, .dp-hint { display: none; }
  .dp-foot { justify-content: center; }
  .dp-stage { padding: 10px 6px; }
}
</style>
