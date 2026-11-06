<script setup lang="ts">
/**
 * 新建服务商：预设选择面板
 *
 * 按接口协议 / 国内服务 / 聚合与云 / 本地部署 / 自定义分组，支持搜索。
 * 预设只填地址与接口类型，Key 仍然要用户自己填——不预置任何密钥。
 */
import { computed, ref } from 'vue';
import { PRESET_GROUP_LABEL, PROVIDER_PRESETS, type PresetGroup } from '../../ai/catalog';
import ProviderLogo from './ProviderLogo.vue';

const emit = defineEmits<{ pick: [string]; close: [] }>();

const kw = ref('');
const group = ref<PresetGroup | ''>('');

const groups = Object.keys(PRESET_GROUP_LABEL) as PresetGroup[];

const list = computed(() => {
  const q = kw.value.trim().toLowerCase();
  return PROVIDER_PRESETS.filter(
    (p) =>
      // 地址还没核实过的预设不再列出：与其让用户撞墙，不如只给确认可用的那批
      !p.needsConfirm &&
      (!group.value || p.group === group.value) &&
      (!q || p.label.toLowerCase().includes(q) || p.hint.toLowerCase().includes(q)),
  );
});

/** 中性标识：不复制任何厂商标识，用品牌色块 + 缩写 / 几何标记区分 */
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="panel" role="dialog" aria-label="新建模型提供商">
      <header class="head">
        <h2>新建模型提供商</h2>
        <div class="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input v-model="kw" placeholder="搜索" aria-label="搜索服务商" />
        </div>
        <button class="x" type="button" aria-label="关闭" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>

      <div class="chips">
        <button class="chip" :class="{ on: group === '' }" type="button" @click="group = ''">全部</button>
        <button
          v-for="g in groups"
          :key="g"
          class="chip"
          :class="{ on: group === g }"
          type="button"
          @click="group = g"
        >
          {{ PRESET_GROUP_LABEL[g] }}
        </button>
      </div>

      <div class="grid">
        <button
          v-for="p in list"
          :key="p.key"
          class="item"
          type="button"
          :title="p.hint"
          @click="emit('pick', p.key)"
        >
          <ProviderLogo :preset-key="p.key" :label="p.label" :size="32" :radius="9" />
          <span class="label">{{ p.label }}</span>
          <span v-if="p.beta" class="badge">Beta</span>
          <span v-else-if="p.needsConfirm" class="badge warn" title="地址以官方文档为准">待确认</span>
        </button>
        <p v-if="!list.length" class="empty">没有匹配的预设，可关闭后选「自定义」。</p>
      </div>

      <footer class="foot">
        <span>预设只填接口类型与地址，不包含任何密钥。</span>
        <button type="button" class="link" @click="emit('pick', 'custom')">直接自定义</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed; inset: 0; z-index: 80;
  background: rgba(10, 11, 12, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 18px;
  animation: fade var(--dur-2) var(--ease-out);
}
.panel {
  width: min(760px, 100%); max-height: min(86vh, 780px);
  display: flex; flex-direction: column;
  background: var(--bg); border-radius: var(--r-4);
  box-shadow: var(--shadow-3); overflow: hidden;
  animation: rise var(--dur-3) var(--spring-over);
}
.head { display: flex; align-items: center; gap: 14px; padding: 18px 20px 12px; }
.head h2 { margin: 0; font-size: calc(17px * var(--font-scale)); letter-spacing: -0.01em; flex: 0 0 auto; }
.search {
  flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 12px; border-radius: var(--r-full);
  background: var(--surface-2); color: var(--text-3);
}
.search input {
  flex: 1 1 auto; min-width: 0; border: none; background: none;
  color: var(--text); font-size: calc(13px * var(--font-scale)); outline: none;
}
.x {
  width: 32px; height: 32px; flex: 0 0 32px; border: none; border-radius: 50%;
  background: transparent; color: var(--text-3); display: grid; place-items: center; cursor: pointer;
}
.x:hover { background: var(--surface-2); color: var(--text); }

.chips { display: flex; gap: 6px; overflow-x: auto; padding: 0 20px 10px; scrollbar-width: none; }
.chips::-webkit-scrollbar { display: none; }
.chip {
  flex: 0 0 auto; height: 28px; padding: 0 12px; border: none;
  border-radius: var(--r-full); background: var(--surface-2); color: var(--text-3);
  font-size: calc(12px * var(--font-scale)); cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.chip.on { background: var(--text); color: var(--bg); }

.grid {
  flex: 1 1 auto; overflow-y: auto;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  padding: 6px 20px 16px; align-content: start;
}
.item {
  display: flex; align-items: center; gap: 10px; min-height: 60px;
  padding: 10px 12px; text-align: left; cursor: pointer;
  border: 1px solid var(--line); border-radius: var(--r-3);
  background: var(--surface);
  transition: background var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.item:hover { background: var(--surface-2); border-color: var(--line-strong); transform: translateY(-1px); }
.item:active { transform: scale(0.99); }
.mark {
  width: 32px; height: 32px; flex: 0 0 32px;
  display: grid; place-items: center;
  border-radius: 9px; background: var(--surface-3);
  color: var(--text-2); font-size: calc(12px * var(--font-scale)); font-weight: var(--fw-strong);
  letter-spacing: 0.02em;
}
.mark.local { background: var(--primary-soft); color: var(--primary); }
.label { flex: 1 1 auto; font-size: calc(13px * var(--font-scale)); color: var(--text); line-height: 1.35; }
.badge {
  flex: 0 0 auto; font-size: calc(9.5px * var(--font-scale)); padding: 2px 5px; border-radius: 4px;
  background: var(--surface-3); color: var(--text-3);
}
.badge.warn { background: rgba(138, 90, 0, 0.14); color: #8a5a00; }
.empty { grid-column: 1 / -1; color: var(--text-3); font-size: calc(12.5px * var(--font-scale)); padding: 20px 4px; }

.foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 20px; border-top: 1px solid var(--line);
  font-size: calc(11.5px * var(--font-scale)); color: var(--text-3);
}
.link { border: none; background: none; color: var(--primary); font-size: calc(12px * var(--font-scale)); cursor: pointer; }

@keyframes fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes rise { from { opacity: 0; transform: translateY(10px) scale(0.985) } to { opacity: 1; transform: none } }

@media (max-width: 640px) {
  .scrim { padding: 0; align-items: flex-end; }
  .panel { max-height: 92vh; border-radius: var(--r-4) var(--r-4) 0 0; }
  .head { flex-wrap: wrap; padding: 16px 16px 10px; gap: 10px; }
  .head h2 { flex: 1 1 auto; font-size: calc(16px * var(--font-scale)); }
  .search { order: 3; flex: 1 0 100%; }
  .chips { padding: 0 16px 10px; }
  .grid { grid-template-columns: 1fr 1fr; gap: 8px; padding: 4px 16px 16px; }
  .item { min-height: 56px; padding: 9px 10px; }
  .foot { padding: 10px 16px calc(var(--safe-bottom, env(safe-area-inset-bottom, 0px)) + 10px); }
}
</style>
