<script setup lang="ts">
/** 设置二级页外壳：圆形返回键 + 居中标题，手机与桌面同一套 */
defineProps<{ title: string; subtitle?: string }>();
const emit = defineEmits<{ (e: 'back'): void }>();
</script>

<template>
  <div class="subpage">
    <header class="sub-head">
      <button class="back" type="button" aria-label="返回" @click="emit('back')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6" /></svg>
      </button>
      <h1>{{ title }}</h1>
      <span class="head-slot"><slot name="head" /></span>
    </header>
    <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
    <div class="sub-body"><slot /></div>
  </div>
</template>

<style scoped>
.subpage { max-width: 720px; margin: 0 auto; padding: 4px 0 60px; }
.sub-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.back {
  width: 34px; height: 34px; flex: 0 0 34px;
  display: grid; place-items: center;
  border: none; border-radius: 50%;
  background: var(--surface-2);
  color: var(--text-2);
  cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.back:hover { background: var(--surface-3); }
.back:active { transform: scale(0.94); }
h1 { flex: 1; margin: 0; font-size: 17px; font-weight: var(--fw-strong); letter-spacing: -0.01em; }
.head-slot { min-width: 34px; display: inline-flex; justify-content: flex-end; }
.subtitle { margin: 2px 0 18px; font-size: 12.5px; line-height: 1.7; color: var(--text-3); }
.sub-body { display: flex; flex-direction: column; }
@media (max-width: 700px) {
  .subpage { padding-bottom: 40px; }
  h1 { font-size: 18px; text-align: center; }
}
</style>
