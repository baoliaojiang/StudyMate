<script setup lang="ts">
/** 设置分组：一张圆角卡片，内部行自动加分隔线 */
defineProps<{ title?: string; note?: string }>();
</script>

<template>
  <section class="group">
    <h2 v-if="title" class="group-title">{{ title }}</h2>
    <div class="group-card"><slot /></div>
    <p v-if="note" class="group-note">{{ note }}</p>
  </section>
</template>

<style scoped>
.group { margin-bottom: 18px; }
.group-title {
  margin: 0 0 8px 4px;
  font-size: 12.5px;
  font-weight: var(--fw-medium);
  color: var(--text-3);
  letter-spacing: 0.02em;
}
.group-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  overflow: hidden;
}
.group-note {
  margin: 8px 6px 0;
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--text-3);
}
@media (max-width: 700px) {
  .group-card { border-radius: var(--r-3); }
  .group-title { margin-left: 8px; }
}
</style>
