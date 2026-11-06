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
import { dataUrlBytes } from '../../core/image';
import { askConfirm } from '../../core/task-guard';
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
  localFiles: 0,
  workflowRuns: 0,
});

/** 大字段（导入文件全文、记录里的图片）按需计算，首屏不扫全库 */
const measuring = ref(false);
const measured = ref(false);
const big = ref({ files: 0, images: 0, bytes: 0 });

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
    const [projects, reports, records, sources, datasets, usageRows, localFiles, workflowRuns] =
      await Promise.all([
        db.projects.count(),
        db.reports.count(),
        db.records.count(),
        db.sources.count(),
        db.datasets.count(),
        db.usage.count(),
        db.localFiles.count(),
        db.workflowRuns.count(),
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

    counts.value = {
      projects,
      reports,
      records,
      sources,
      datasets,
      usage: usageRows,
      chats,
      cacheEntries,
      ttsFiles,
      localFiles,
      workflowRuns,
    };

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
const quotaText = computed(() => (quota.value ? `可用配额 ${fmtSize(quota.value)}` : '配额信息不可用'));
const usagePct = computed(() => (quota.value ? Math.min(100, (usage.value / quota.value) * 100) : 0));

async function clearChats() {
  const ok = await askConfirm({
    title: '清空全部历史对话',
    message: '项目、报告、记录不受影响，但对话记录删掉后无法恢复。',
    confirmText: '清空',
    cancelText: '先不清',
    tone: 'warn',
  });
  if (!ok) return;
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
  const ok = await askConfirm({
    title: '清空用量与调用记录',
    message: '只影响统计数字，不影响项目内容。',
    confirmText: '清空',
    cancelText: '先不清',
    tone: 'warn',
  });
  if (!ok) return;
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
  const ok = await askConfirm({
    title: '清理界面缓存',
    message: '下次打开需要重新加载界面资源，数据不受影响。',
    confirmText: '清理',
    cancelText: '先不清',
    tone: 'warn',
  });
  if (!ok) return;
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

/** 按需估算真正占地方的大字段：导入文件全文 + 记录里的图片 */
async function measureBig() {
  if (measuring.value) return;
  measuring.value = true;
  try {
    let bytes = 0;
    let files = 0;
    let images = 0;
    await db.localFiles.each((r) => {
      files++;
      bytes += new Blob([r.text ?? '']).size;
    });
    await db.records.each((r) => {
      for (const a of r.attachments ?? []) {
        if (a.kind !== 'image' || !a.dataUrl) continue;
        images++;
        bytes += dataUrlBytes(a.dataUrl);
      }
    });
    big.value = { files, images, bytes };
    measured.value = true;
  } finally {
    measuring.value = false;
  }
}

/** 只清检索用的全文快照与已结束的推进历史，运行中的任务不动 */
async function clearIndexes() {
  const ok = await askConfirm({
    title: '清理索引与推进历史',
    message: `将删掉 ${counts.value.localFiles} 份导入文件的全文索引和已结束的推进历史。项目、报告、记录、来源不受影响；正在推进的任务会保留。`,
    confirmText: '清理',
    cancelText: '先不清',
    tone: 'warn',
  });
  if (!ok) return;
  busy.value = true;
  try {
    await db.localFiles.clear();
    const rows = await db.workflowRuns.toArray();
    const done = rows
      .filter((r) => !['running', 'awaiting', 'paused'].includes(r.status))
      .map((r) => r.id);
    if (done.length) await db.workflowRuns.bulkDelete(done);
    app.toast('索引与历史已清理，项目数据都还在', 'ok', 3600);
    measured.value = false;
    await refresh();
  } finally {
    busy.value = false;
  }
}

/** 一次清掉全部「可安全清理」的项 */
async function clearAllSafe() {
  const ok = await askConfirm({
    title: '清理可安全删除的内容',
    message: '将清理：缓存、历史对话、用量记录、语音临时文件。项目、报告、过程记录、来源不会删除，清理后无法恢复。',
    confirmText: '全部清理',
    cancelText: '先不清',
    tone: 'warn',
  });
  if (!ok) return;
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
      <SettingRow label="导入文件全文索引" :value="`${counts.localFiles} 份`" />
      <SettingRow label="自动推进历史" :value="`${counts.workflowRuns} 次`" />
      <SettingRow label="语音文件" note="朗读现合成现播，播完即释放" value="不占空间" />
    </SettingGroup>

    <SettingGroup title="大字段占用">
      <p class="note" style="margin: 0 0 8px">
        导入文件的全文和记录里的图片最占地方。点一下才统计，避免打开这页就翻全库。
      </p>
      <div class="measure">
        <b v-if="measured">{{ fmtSize(big.bytes) }}</b>
        <span v-if="measured" class="muted small">全文 {{ big.files }} 份 · 图片 {{ big.images }} 张</span>
        <button class="btn btn-sm" type="button" :disabled="measuring" @click="measureBig">
          {{ measuring ? '统计中…' : measured ? '重新统计' : '统计占用' }}
        </button>
      </div>
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
      <button class="act" type="button" :disabled="busy" @click="clearIndexes">
        <span>
          <b>清理索引与推进历史</b>
          <span>导入文件全文快照、已结束的推进记录；项目内容不动</span>
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
.usage-top b { font-size: calc(22px * var(--font-scale)); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
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
.act b { font-size: calc(13.5px * var(--font-scale)); font-weight: var(--fw-medium); }
.act span span { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); line-height: 1.6; }
.act-go { color: var(--text-3); font-size: calc(16px * var(--font-scale)); }
.act:disabled { opacity: 0.5; }
.measure { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 2px 2px 6px; }
.measure b { font-size: calc(18px * var(--font-scale)); font-variant-numeric: tabular-nums; }
.measure button { margin-left: auto; }
</style>
