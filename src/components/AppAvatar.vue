<script setup lang="ts">
/**
 * 统一头像
 *
 * 有图用图；没图用系统默认的人形剪影（不是姓名首字，也不是假照片）。
 * 剪影按 Win11 账户头像的比例画：圆头 + 圆角肩膀，中性灰，深浅色都能看清。
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{ name?: string; src?: string | null; size?: number }>(),
  { name: '同学', src: null, size: 36 },
);

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}));
</script>

<template>
  <span class="avatar" :style="style" :aria-label="name || '账户头像'" role="img">
    <img v-if="src" :src="src" alt="" />
    <svg v-else class="glyph" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="17.5" r="8.2" />
      <path d="M9.6 40.2c0-7.6 6.4-12.6 14.4-12.6s14.4 5 14.4 12.6c0 1.1-.9 2-2 2H11.6c-1.1 0-2-.9-2-2Z" />
    </svg>
  </span>
</template>

<style scoped>
.avatar {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: var(--surface-3);
  color: var(--text-3);
  line-height: 1;
  user-select: none;
}
.avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.glyph { width: 100%; height: 100%; display: block; fill: var(--text-3); }
</style>
