<script setup lang="ts">
/** 全局确认弹层：替代 window.confirm（安卓 WebView 里系统弹窗会被拦掉） */
import { confirmState, resolveConfirm } from '../core/task-guard';
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
