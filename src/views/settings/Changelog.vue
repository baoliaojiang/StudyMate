<script setup lang="ts">
/** 更新日志：展示版本记录，只列真实完成的功能 */
import { useRouter } from 'vue-router';
import { CHANGELOG, LATEST_VERSION } from '../../core/changelog';
import { SITE } from '../../config/site';
import { openExternal } from '../../core/shell';
import { backOr } from '../../core/nav';

const router = useRouter();
function back() {
  backOr(router, '/settings');
}
</script>

<template>
  <div class="cl">
    <header class="sub-head">
      <button class="back" type="button" aria-label="返回" @click="back">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6" /></svg>
      </button>
      <h1>更新日志</h1>
      <span class="cur">当前 v{{ SITE.version }}</span>
    </header>

    <div v-for="e in CHANGELOG" :key="e.version" class="entry">
      <div class="entry-head">
        <b v-if="e.version === LATEST_VERSION" class="tag">最新</b>
        <span class="ver">v{{ e.version }}</span>
        <span class="date">{{ e.date }}</span>
      </div>
      <div v-for="g in e.groups" :key="g.title" class="group">
        <div class="gtitle" :class="g.title">{{ g.title }}</div>
        <ul>
          <li v-for="(it, i) in g.items" :key="i">{{ it }}</li>
        </ul>
      </div>
    </div>

    <p class="note">
      更多历史版本与下载以
      <a :href="SITE.releases" @click.prevent="openExternal(SITE.releases)">GitHub Releases</a>
      为准。想检查新版本，到「其他设置 → 检查更新」。
    </p>
  </div>
</template>

<style scoped>
.cl { padding: 0; }
.sub-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.sub-head h1 { margin: 0; font-size: 17px; font-weight: var(--fw-strong); }
.sub-head .cur { margin-left: auto; font-size: 11px; color: var(--text-3); }
.back {
  width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center;
  border: none; border-radius: 50%; background: var(--surface-2); color: var(--text-2); cursor: pointer;
}
.back:hover { background: var(--surface-3); }

.entry { padding: 14px 16px; background: var(--surface); border-radius: var(--r-3); margin-bottom: 12px; }
.entry-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tag {
  font-size: 10px; padding: 2px 7px; border-radius: var(--r-full);
  background: var(--primary-soft, rgba(31, 79, 216, 0.12)); color: var(--primary); font-weight: var(--fw-medium);
}
.ver { font-size: 14px; font-weight: var(--fw-strong); }
.date { font-size: 11.5px; color: var(--text-3); margin-left: auto; font-variant-numeric: tabular-nums; }

.group { margin-top: 8px; }
.gtitle {
  font-size: 11px; font-weight: var(--fw-strong); letter-spacing: 0.04em; margin-bottom: 4px;
}
.gtitle.新增 { color: #2e9e5b; }
.gtitle.优化 { color: #2b7de9; }
.gtitle.修复 { color: #d9772b; }
.gtitle.已知限制 { color: var(--text-3); }
.group ul { margin: 0; padding-left: 18px; }
.group li { font-size: 12.5px; line-height: 1.75; color: var(--text-2); margin-bottom: 4px; }

.note { font-size: 11.5px; color: var(--text-3); line-height: 1.7; margin: 4px 4px 0; }
.note a { color: var(--primary); text-decoration: none; }
</style>
