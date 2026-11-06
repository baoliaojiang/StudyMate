<script setup lang="ts">
/**
 * Agent 工作步骤条
 *
 * 长等待时把「在做什么、等了多久、卡在哪一步」摊开，而不是只转一个圈。
 * 数据来自 core/ai-progress.ts，报告、记录、批量起草共用同一套。
 */
import { reactive } from 'vue';
import type { AiProgress } from '../core/ai-progress';

const props = defineProps<{ progress: AiProgress; compact?: boolean }>();
// reactive 会把 composable 里的 ref 自动解包，模板里直接当普通值用
const p = reactive(props.progress);
</script>

<template>
  <div
    v-if="p.visible"
    class="ai-prog"
    :class="{ 'is-done': !p.active && !p.failed, 'is-failed': p.failed, 'is-compact': compact }"
    role="status"
    aria-live="polite"
  >
    <div class="ap-head">
      <span class="ap-indicator" :class="{ spin: p.active, bad: p.failed }" aria-hidden="true" />
      <b class="ap-title">{{ p.failed ? '这一步没完成' : p.active ? p.title : '已完成' }}</b>
      <span class="ap-time">{{ p.elapsedText }}</span>
    </div>

    <ol class="ap-steps">
      <li v-for="s in p.steps" :key="s.key" class="ap-step" :class="s.state">
        <span class="ap-mark" aria-hidden="true">
          <template v-if="s.state === 'done'">✓</template>
          <template v-else-if="s.state === 'failed'">!</template>
          <template v-else-if="s.state === 'running'">·</template>
        </span>
        <span class="ap-label">{{ s.label }}</span>
        <span v-if="s.state === 'running' && p.detail" class="ap-detail">{{ p.detail }}</span>
      </li>
    </ol>

    <p class="ap-note">{{ p.note }}</p>
  </div>
</template>

<style scoped>
.ai-prog {
  margin: 10px 0 12px;
  padding: 12px 14px 11px;
  border-radius: var(--r-3);
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-1);
}
.ai-prog.is-done { background: var(--surface-2); }
.ai-prog.is-failed { background: var(--surface-2); }
.ai-prog.is-compact { padding: 9px 12px; }

.ap-head { display: flex; align-items: center; gap: 9px; min-width: 0; }
.ap-title {
  flex: 1; min-width: 0;
  font-size: calc(12.5px * var(--font-scale));
  font-weight: var(--fw-medium);
  line-height: 1.5;
}
.ap-time {
  flex: 0 0 auto;
  font-size: calc(11.5px * var(--font-scale));
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.ap-indicator {
  width: 8px; height: 8px; flex: 0 0 8px; border-radius: 50%;
  background: var(--primary);
}
.ap-indicator.spin { animation: ap-breathe 1.5s ease-in-out infinite; }
.ap-indicator.bad { background: var(--danger); }
.is-done .ap-indicator { background: var(--ok, var(--primary)); }

.ap-steps {
  list-style: none; margin: 10px 0 0; padding: 0;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 5px 12px;
}
.is-compact .ap-steps { grid-template-columns: 1fr 1fr; }
.ap-step {
  display: flex; align-items: center; gap: 7px; min-width: 0;
  font-size: calc(11.5px * var(--font-scale));
  color: var(--text-3);
  line-height: 1.6;
}
.ap-step.done { color: var(--text-2); }
.ap-step.running { color: var(--text); font-weight: var(--fw-medium); }
.ap-step.failed { color: var(--danger); }
.ap-mark {
  width: 15px; height: 15px; flex: 0 0 15px;
  display: grid; place-items: center;
  border-radius: 50%;
  background: var(--surface-2);
  font-size: calc(10px * var(--font-scale));
  line-height: 1;
}
.ap-step.done .ap-mark { background: var(--primary); color: #fff; }
.ap-step.running .ap-mark { background: var(--primary); color: #fff; animation: ap-breathe 1.4s ease-in-out infinite; }
.ap-step.failed .ap-mark { background: var(--danger); color: #fff; }
.ap-label { flex: 1; min-width: 0; }
.ap-detail {
  flex: 0 0 auto; max-width: 45%;
  font-size: calc(10.5px * var(--font-scale)); color: var(--text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ap-note {
  margin: 9px 0 0;
  font-size: calc(11px * var(--font-scale));
  line-height: 1.7;
  color: var(--text-3);
  text-wrap: pretty;
}

@keyframes ap-breathe {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.82); }
}
html[data-motion='off'] .ai-prog * { animation: none !important; transition: none !important; }

@media (max-width: 640px) {
  .ap-steps, .is-compact .ap-steps { grid-template-columns: 1fr 1fr; }
  .ap-detail { display: none; }
}
</style>
