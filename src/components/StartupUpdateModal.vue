<script setup lang="ts">
/**
 * 启动更新弹窗（强制模态）
 *
 * 「强制模态」的边界：遮罩点不关、没有关闭 X、Esc 与安卓返回键都被吃掉，
 * 但它默认仍然给「下次再说」——弹窗不能替用户决定什么时候升级。
 * 只有在配置里明确写死某个版本为强制升级时，才只留「去更新」；
 * 即便如此，点「去更新」打开下载链接后也会关闭弹窗，不会把应用锁死。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue';
import MarkdownText from './MarkdownText.vue';
import { openExternal } from '../core/shell';
import { pushOverlay } from '../core/task-guard';
import { useAppStore } from '../stores/app';
import type { StartupUpdate } from '../core/startup-update';

const app = useAppStore();
/**
 * 未成年人模式仍允许「检查更新」，所以官方 GitHub 的「去更新 / 查看发布页」照常可用；
 * 但镜像站是第三方反代，按统一外链规则隐藏，避免把未成年人引到非官方站点。
 */
const minorHide = computed(() => app.settings.minor.enabled && app.settings.minor.hideExternal);

const props = defineProps<{ update: StartupUpdate }>();
const emit = defineEmits<{ (e: 'close', kind: 'go' | 'later'): void }>();

let unregisterOverlay: (() => void) | null = null;

function swallowEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
}

onMounted(() => {
  // 返回键先问最上层遮罩；这里永远返回 false，事件被消费但弹层不关
  unregisterOverlay = pushOverlay('startup-update', () => false);
  window.addEventListener('keydown', swallowEscape, true);
});

onBeforeUnmount(() => {
  unregisterOverlay?.();
  unregisterOverlay = null;
  window.removeEventListener('keydown', swallowEscape, true);
});

const dateText = (() => {
  const raw = props.update.publishedAt;
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN');
})();

function go() {
  openExternal(props.update.downloadUrl);
  emit('close', 'go');
}

function openMirror() {
  if (props.update.mirrorUrl) openExternal(props.update.mirrorUrl);
}

function openRelease() {
  openExternal(props.update.releaseUrl);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="up" appear>
      <div class="up-scrim">
        <div class="up-card" role="dialog" aria-modal="true" aria-labelledby="up-title">
          <div class="up-top">
            <span class="up-badge">有新版本</span>
            <span class="up-tag">v{{ update.version }}</span>
          </div>
          <h2 id="up-title" class="up-title">发现新版本 v{{ update.version }}</h2>
          <p class="up-meta">
            当前 v{{ update.currentVersion }}<template v-if="dateText"> · 发布于 {{ dateText }}</template>
          </p>

          <div class="up-scroll">
            <div class="up-md"><MarkdownText :text="update.changelogMd" /></div>
            <p v-if="!update.isDirectAsset" class="up-note">
              没有找到当前平台的安装包直链，点「去更新」会打开发布页，请在页面里选对应文件。
            </p>
          </div>

          <div class="up-actions">
            <button v-if="update.allowLater" class="btn btn-sm" type="button" @click="emit('close', 'later')">
              下次再说
            </button>
            <button class="btn btn-sm btn-primary" type="button" @click="go">去更新</button>
          </div>

          <div class="up-links">
            <button v-if="update.mirrorUrl && !minorHide" class="up-link" type="button" @click="openMirror">
              换镜像下载
            </button>
            <button class="up-link" type="button" @click="openRelease">查看发布页</button>
            <span class="up-safety">只跳转官方发布地址，不会自动下载或安装</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.up-scrim {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: grid;
  place-items: center;
  padding: calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));
  background: rgba(8, 9, 11, 0.72);
}
.up-card {
  width: min(520px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  padding: 22px;
  border-radius: var(--r-3);
  background: var(--surface);
  box-shadow: var(--shadow-3);
}
.up-top { display: flex; align-items: center; gap: 8px; }
.up-badge {
  padding: 4px 9px; border-radius: 999px;
  background: var(--primary); color: #fff;
  font-size: calc(11px * var(--font-scale)); font-weight: var(--fw-strong);
}
.up-tag {
  font-size: calc(12px * var(--font-scale)); color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.up-title {
  margin: 14px 0 0; font-size: calc(20px * var(--font-scale));
  font-weight: var(--fw-strong); color: var(--text); text-wrap: pretty;
}
.up-meta {
  margin: 6px 0 0; font-size: calc(12px * var(--font-scale));
  color: var(--text-3); font-variant-numeric: tabular-nums;
}
.up-scroll {
  flex: 1; min-height: 0; overflow-y: auto;
  margin-top: 16px; padding: 14px;
  border-radius: var(--r-2);
  background: var(--surface-2);
}
.up-md { font-size: calc(13px * var(--font-scale)); line-height: 1.8; color: var(--text-2); }
.up-md :deep(.md) { white-space: normal; }
.up-md :deep(a) { color: var(--primary); }
.up-note {
  margin: 12px 0 0; font-size: calc(12px * var(--font-scale));
  color: var(--text-3); line-height: 1.7;
}
.up-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.up-links {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-top: 12px; padding-top: 12px;
  border-top: 1px solid var(--line);
}
.up-link {
  padding: 0; border: 0; background: none; cursor: pointer;
  color: var(--primary); font-size: calc(12px * var(--font-scale));
}
.up-safety {
  margin-left: auto; font-size: calc(11px * var(--font-scale)); color: var(--text-3);
}
.up-enter-active, .up-leave-active { transition: opacity 220ms var(--ease-out); }
.up-enter-active .up-card, .up-leave-active .up-card { transition: transform 220ms var(--ease-out); }
.up-enter-from, .up-leave-to { opacity: 0; }
.up-enter-from .up-card, .up-leave-to .up-card { transform: translateY(14px); }
html[data-motion='off'] .up-enter-active,
html[data-motion='off'] .up-leave-active,
html[data-motion='off'] .up-enter-active .up-card,
html[data-motion='off'] .up-leave-active .up-card { transition: none; }
@media (max-width: 520px) {
  .up-card { padding: 18px; }
  .up-safety { margin-left: 0; width: 100%; }
}
</style>
