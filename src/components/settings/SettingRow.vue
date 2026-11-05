<script setup lang="ts">
/**
 * 设置行 —— 参考主流移动端「分组卡片 + 左图标 + 右值 + 箭头」的结构。
 * 这里只做一套，PC 与手机共用，不再各写一版导致两边功能对不上。
 */
withDefaults(
  defineProps<{
    label: string;
    /** 右侧当前值 */
    value?: string;
    /** 补充说明 */
    note?: string;
    /** 显示箭头（可点进下一级） */
    chevron?: boolean;
    /** 危险操作：文字用警示色 */
    danger?: boolean;
    /** 关闭态：整行变灰且不可点 */
    disabled?: boolean;
  }>(),
  { chevron: false, danger: false, disabled: false },
);
</script>

<template>
  <component
    :is="chevron ? 'button' : 'div'"
    class="row"
    :class="{ danger, disabled, tappable: chevron }"
    :type="chevron ? 'button' : undefined"
    :disabled="chevron ? disabled : undefined"
  >
    <span v-if="$slots.icon" class="row-icon"><slot name="icon" /></span>
    <span class="row-text">
      <b class="row-label">{{ label }}</b>
      <span v-if="note" class="row-note">{{ note }}</span>
    </span>
    <span v-if="value" class="row-value">{{ value }}</span>
    <slot name="right" />
    <span v-if="chevron" class="row-chev" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
    </span>
  </component>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
  font: inherit;
  border-radius: var(--r-2);
  transition: background var(--dur-2) var(--ease-out);
}
.row + .row { border-top: 1px solid var(--line); border-radius: 0; }
.row.tappable { cursor: pointer; }
.row.tappable:hover { background: var(--surface-2); }
.row.tappable:active { background: var(--surface-3); }
.row:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.row.disabled { opacity: 0.45; cursor: not-allowed; }

.row-icon {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-2);
}
.row.danger .row-icon { color: var(--danger, #c0392b); }

.row-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.row-label { font-size: 15px; font-weight: var(--fw-medium); line-height: 1.35; }
.row-note { font-size: 12px; color: var(--text-3); line-height: 1.5; }
.row-value {
  font-size: 13px;
  color: var(--text-3);
  max-width: 56%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row.danger .row-label { color: var(--danger, #c0392b); }
.row-chev { display: inline-flex; color: var(--text-3); opacity: 0.7; }

@media (max-width: 700px) {
  .row { min-height: 56px; padding: 12px 16px; }
  .row-label { font-size: 16px; }
}
</style>
