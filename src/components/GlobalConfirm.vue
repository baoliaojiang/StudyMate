<script setup lang="ts">
/** 全局确认 / 输入弹层：替代 window.confirm、window.prompt（安卓 WebView 里系统弹窗会被拦掉） */
import { nextTick, ref, watch } from 'vue';
import { confirmState, resolveConfirm, promptState, resolvePrompt } from '../core/task-guard';

/** 输入框本地值：每次打开时取 initialValue，避免复用上一次的残留 */
const promptValue = ref('');
const promptInput = ref<HTMLInputElement | null>(null);
watch(promptState, async (s) => {
  if (!s) return;
  promptValue.value = s.initialValue ?? '';
  await nextTick();
  promptInput.value?.focus();
});

function confirmPrompt() {
  resolvePrompt(promptValue.value);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="cf">
      <div v-if="confirmState" class="cf-scrim" @click.self="resolveConfirm(false)">
        <div class="cf-card" role="dialog" aria-modal="true">
          <h3 class="cf-title">{{ confirmState.title }}</h3>
          <p v-if="confirmState.message" class="cf-msg">{{ confirmState.message }}</p>
          <div class="cf-actions">
            <button class="btn btn-sm" type="button" @click="resolveConfirm(false)">
              {{ confirmState.cancelText || '取消' }}
            </button>
            <button
              class="btn btn-sm"
              :class="confirmState.tone === 'warn' ? 'cf-danger' : 'btn-primary'"
              type="button"
              @click="resolveConfirm(true)"
            >
              {{ confirmState.confirmText || '确定' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- 输入框：替代 window.prompt，同样 Teleport 到 body，不受父级层叠影响 -->
  <Teleport to="body">
    <Transition name="cf">
      <div v-if="promptState" class="cf-scrim" @click.self="resolvePrompt(null)">
        <div class="cf-card" role="dialog" aria-modal="true">
          <h3 class="cf-title">{{ promptState.title }}</h3>
          <p v-if="promptState.message" class="cf-msg">{{ promptState.message }}</p>
          <input
            ref="promptInput"
            v-model="promptValue"
            class="cf-input"
            type="text"
            :placeholder="promptState.placeholder || ''"
            @keydown.enter="confirmPrompt"
          />
          <div class="cf-actions">
            <button class="btn btn-sm" type="button" @click="resolvePrompt(null)">
              {{ promptState.cancelText || '取消' }}
            </button>
            <button class="btn btn-sm btn-primary" type="button" @click="confirmPrompt">
              {{ promptState.confirmText || '确定' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cf-scrim {
  position: fixed; inset: 0; z-index: 300;
  display: grid; place-items: center;
  padding: 24px;
  background: rgba(8, 9, 11, 0.56);
}
.cf-card {
  width: min(360px, 100%);
  padding: 20px;
  border-radius: var(--r-3);
  background: var(--surface);
  box-shadow: var(--shadow-3);
}
.cf-title { margin: 0; font-size: var(--fs-3); font-weight: var(--fw-strong); color: var(--text); }
.cf-msg {
  margin: 10px 0 0; font-size: var(--fs-1); line-height: 1.75;
  color: var(--text-2); text-wrap: pretty;
}
.cf-input {
  box-sizing: border-box; width: 100%;
  margin: 14px 0 0; padding: 9px 11px;
  border: 1px solid var(--line); border-radius: var(--r-2);
  background: var(--surface); color: var(--text);
  font-family: inherit; font-size: calc(13px * var(--font-scale)); line-height: 1.5;
}
/* 聚焦用双环 box-shadow，不用 outline（outline 在部分 WebView 里会被裁切） */
.cf-input:focus {
  outline: none; border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--primary);
}
.cf-input::placeholder { color: var(--text-3); }
.cf-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.cf-danger { background: var(--danger); color: #fff; border-color: var(--danger); }
.cf-enter-active, .cf-leave-active { transition: opacity 200ms var(--ease-out); }
.cf-enter-active .cf-card, .cf-leave-active .cf-card { transition: transform 200ms var(--ease-out); }
.cf-enter-from, .cf-leave-to { opacity: 0; }
.cf-enter-from .cf-card, .cf-leave-to .cf-card { transform: translateY(8px); }
html[data-motion='off'] .cf-enter-active,
html[data-motion='off'] .cf-leave-active,
html[data-motion='off'] .cf-enter-active .cf-card,
html[data-motion='off'] .cf-leave-active .cf-card { transition: none; }
</style>
