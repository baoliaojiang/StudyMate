<script setup lang="ts">
/**
 * 存储与空间
 *
 * 只做「可以安全清」的清理：缓存、对话记录、用量日志、语音临时文件。
 * 项目、报告、记录、来源属于交付物，不在这里删——那些在「数据与备份」里，
 * 而且要先导出备份再动手。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { backOr } from '../../core/nav';
import { useAppStore } from '../../stores/app';
import { db } from '../../core/db';
import SubPage from '../../components/settings/SubPage.vue';
import SettingGroup from '../../components/settings/SettingGroup.vue';
import SettingRow from '../../components/settings/SettingRow.vue';

const app = useAppStore();
const router = useRouter();

const loading = ref(true);
const busy = ref(false);
/** 浏览器给出的整体用量（含 IndexedDB、缓存等） */
const usage = ref(0);
const quota = ref(0);

const counts = ref({
  projects: 0,
  reports: 0,
  records: 0,
  sources: 0,
  datasets: 0,
  usage: 0,
  chats: 0,
  cacheEntries: 0,
  ttsFiles: 0,
});

const CHAT_KEY = 'studymate:chat:v2';
const TTS_KEY = 'studymate:tts-cache:v1';

function fmtSize(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** localStorage 里某个键占多少字节（UTF-16 按 2 字节估） */
function lsSize(key: string): number {
  const v = localStorage.getItem(key);
  return v ? v.length * 2 : 0;
}

async function refresh() {
  loading.value = true;
  try {
    const [projects, reports, records, sources, datasets, usageRows] = await Promise.all([
      db.projects.count(),
      db.reports.count(),
      db.records.count(),
      db.sources.count(),
      db.datasets.count(),
      db.usage.count(),
    ]);
    const chatsRaw = localStorage.getItem(CHAT_KEY);
    let chats = 0;
    try {
      const arr = chatsRaw ? JSON.parse(chatsRaw) : [];
      chats = Array.isArray(arr) ? arr.length : 0;
    } catch {
      chats = 0;
    }

    let cacheEntries = 0;
    try {
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        cacheEntries = keys.length;
      }
    } catch {
      cacheEntries = 0;
    }

    let ttsFiles = 0;
    try {
      const raw = localStorage.getItem(TTS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      ttsFiles = Array.isArray(arr) ? arr.length : 0;
    } catch {
      ttsFiles = 0;
    }

    counts.value = { projects, reports, records, sources, datasets, usage: usageRows, chats, cacheEntries, ttsFiles };

    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usage.value = est.usage ?? 0;
      quota.value = est.quota ?? 0;
    }
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);

const chatSize = computed(() => lsSize(CHAT_KEY));
const ttsSize = computed(() => lsSize(TTS_KEY));
const quotaText = computed(() => (quota.value ? `可用配额 ${fmtSize(quota.value)}` : '配额信息不可用'));
const usagePct = computed(() => (quota.value ? Math.min(100, (usage.value / quota.value) * 100) : 0));

async function clearChats() {
  if (!confirm('清空全部历史对话？项目、报告、记录都不会受影响，但对话记录无法恢复。')) return;
  busy.value = true;
  try {
    localStorage.removeItem(CHAT_KEY);
    app.toast('历史对话已清空', 'ok');
    await refresh();
  } finally {
    busy.value = false;
  }
}

async function clearUsageLogs() {
  if (!confirm('清空用量与调用记录？只影响统计数字，不影响项目内容。')) return;
  busy.value = true;
  try {
    await db.usage.clear();
    app.toast('用量记录已清空', 'ok');
    await refresh();
  } finally {
    busy.value = false;
  }
}

async function clearTtsCache() {
  busy.value = true;
  try {
    localStorage.removeItem(TTS_KEY);
    app.toast('语音临时文件已清理', 'ok');
    await refresh();
  } finally {
    busy.value = false;
  }
}

async function clearCaches() {
  if (!confirm('清理缓存？下次打开需要重新加载界面资源，数据不受影响。')) return;
  busy.value = true;
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    app.toast('缓存已清理', 'ok');
    await refresh();
  } finally {
    busy.value = false;
  }
}

/** 一次清掉全部「可安全清理」的项 */
async function clearAllSafe() {
  if (
    !confirm(
      '将清理：缓存、历史对话、用量记录、语音临时文件。\n\n项目、报告、过程记录、来源不会删除。清理后无法恢复，继续？',
    )
  )
    return;
  busy.value = true;
  try {
    localStorage.removeItem(CHAT_KEY);
    localStorage.removeItem(TTS_KEY);
    await db.usage.clear();
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    app.toast('已清理完成，项目数据都还在', 'ok', 3600);
    await refresh();
  } finally {
    busy.value = false;
  }
}

function back() {
  backOr(router, '/settings');
}
</script>

<template>
  <SubPage title="存储与空间" subtitle="看清本机存了什么，只清理可以安全删的部分。" @back="back">
    <SettingGroup title="总体占用">
      <div class="usage-box">
        <div class="usage-top">
          <b>{{ loading ? '统计中…' : fmtSize(usage) }}</b>
          <span class="muted small">{{ quotaText }}</span>
        </div>
        <div class="bar"><div class="bar-fill" :style="{ width: Math.max(1, usagePct) + '%' }" /></div>
        <p class="note" style="margin: 8px 0 0">
          包含项目数据、对话、缓存与临时文件。浏览器按域名统计，可能与实际略有出入。
        </p>
      </div>
    </SettingGroup>

    <SettingGroup title="本机内容">
      <SettingRow label="项目 / 报告 / 记录" :value="`${counts.projects} / ${counts.reports} / ${counts.records}`" />
      <SettingRow label="来源 / 数据集" :value="`${counts.sources} / ${counts.datasets}`" />
      <SettingRow label="历史对话" :value="`${counts.chats} 段 · ${fmtSize(chatSize)}`" />
      <SettingRow label="用量记录" :value="`${counts.usage} 条`" />
      <SettingRow label="界面缓存" :value="`${counts.cacheEntries} 组`" />
      <SettingRow
        label="语音文件"
        note="朗读是现合成现播，播完即释放，不长期占空间"
        :value="`${counts.ttsFiles} 个 · ${fmtSize(ttsSize)}`"
      />
    </SettingGroup>

    <SettingGroup title="清理">
      <p class="note" style="margin: 0 0 6px">
        下面这些删掉不影响项目内容。每项都会再确认一次。
      </p>
      <button class="act" type="button" :disabled="busy" @click="clearCaches">
        <span>
          <b>清理缓存</b>
          <span>界面资源与旧版本文件，下次打开重新加载</span>
        </span>
        <span class="act-go">›</span>
      </button>
      <button class="act" type="button" :disabled="busy" @click="clearChats">
        <span>
          <b>清空历史对话</b>
          <span>共 {{ counts.chats }} 段，删除后无法恢复</span>
        </span>
        <span class="act-go">›</span>
      </button>
      <button class="act" type="button" :disabled="busy" @click="clearUsageLogs">
        <span>
          <b>清空用量记录</b>
          <span>调用次数与费用统计会归零</span>
        </span>
        <span class="act-go">›</span>
      </button>
      <button class="act" type="button" :disabled="busy" @click="clearTtsCache">
        <span>
          <b>清理语音临时文件</b>
          <span>朗读用的音频不留档，这里只清残留</span>
        </span>
        <span class="act-go">›</span>
      </button>

      <button class="btn btn-block" type="button" style="margin-top: 10px" :disabled="busy" @click="clearAllSafe">
        {{ busy ? '处理中…' : '全部清理（不含项目数据）' }}
      </button>
    </SettingGroup>

    <p class="note">
      要删除整个项目或重装清档，请到「数据与备份」——那里会要求先导出备份。
    </p>
  </SubPage>
</template>

<style scoped>
.usage-box { padding: 6px 2px 2px; }
.usage-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.usage-top b { font-size: 22px; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.bar { height: 6px; margin-top: 10px; border-radius: 3px; background: var(--surface-3); overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; background: var(--primary); transition: width var(--dur-2) var(--ease-out); }

.act {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 10px 4px; border: none; background: transparent;
  color: var(--text); font: inherit; text-align: left; cursor: pointer;
  border-top: 1px solid var(--line);
}
.act:first-of-type { border-top: none; }
.act > span:first-child { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.act b { font-size: 13.5px; font-weight: var(--fw-medium); }
.act span span { font-size: 11.5px; color: var(--text-3); line-height: 1.6; }
.act-go { color: var(--text-3); font-size: 16px; }
.act:disabled { opacity: 0.5; }
</style>
