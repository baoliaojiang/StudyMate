<script setup lang="ts">
/** 数据备份与恢复 + 一键清档入口 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { backOr } from '../../core/nav';
import { db } from '../../core/db';
import { maskKey, open_, seal, sealWithPassphrase } from '../../core/crypto';
import { downloadBackup, exportAllData, importAllData } from '../../core/backup';
import { useAppStore } from '../../stores/app';
import { askConfirm } from '../../core/task-guard';
import type { ProviderKind } from '../../core/types';
import DangerWipe from '../../components/settings/DangerWipe.vue';
import SettingGroup from '../../components/settings/SettingGroup.vue';
import SettingRow from '../../components/settings/SettingRow.vue';
import SubPage from '../../components/settings/SubPage.vue';

const app = useAppStore();
const router = useRouter();

/** 返回上一级：有历史原路返回，没有则回设置首页 */
function back() {
  backOr(router, '/settings');
}

const backupPass = ref('');
const exportingAll = ref(false);
const exportStage = ref('');
const lastSize = ref(0);

function fmtSize(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const allFileInput = ref<HTMLInputElement | null>(null);
const keyFileInput = ref<HTMLInputElement | null>(null);
const showWipe = ref(false);
const counts = ref({ projects: 0, reports: 0, records: 0, sources: 0 });

onMounted(async () => {
  counts.value = {
    projects: await db.projects.count(),
    reports: await db.reports.count(),
    records: await db.records.count(),
    sources: await db.sources.count(),
  };
});

function passOk(): boolean {
  if (!backupPass.value || backupPass.value.length < 8) {
    app.toast('先填一个至少 8 位的备份口令', 'warn');
    return false;
  }
  return true;
}

async function exportAll() {
  if (!passOk()) return;
  exportingAll.value = true;
  exportStage.value = '正在准备…';
  try {
    const { text, counts: c } = await exportAllData(backupPass.value, (s) => (exportStage.value = s));
    lastSize.value = new Blob([text]).size;
    downloadBackup(text);
    app.toast(
      `已导出 ${c.projects} 个项目 / ${c.reports} 份报告 / ${c.records} 篇记录 · ${fmtSize(lastSize.value)}`,
      'ok',
      5000,
    );
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '导出失败', 'error', 5000);
  } finally {
    exportingAll.value = false;
    exportStage.value = '';
  }
}

async function importAll(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!passOk()) {
    input.value = '';
    return;
  }
  const ok = await askConfirm({
    title: '恢复会覆盖本机数据',
    message: '先清空本机现有全部数据，再写入备份内容。建议先导出一份当前备份。',
    confirmText: '仍然恢复',
    cancelText: '先不恢复',
    tone: 'warn',
  });
  if (!ok) {
    input.value = '';
    return;
  }
  try {
    const res = await importAllData(await file.text(), backupPass.value);
    app.toast(`已恢复 ${res.projects} 个项目 / ${res.records} 篇记录，正在重新加载…`, 'ok', 4000);
    setTimeout(() => location.reload(), 900);
  } catch (err) {
    app.toast(err instanceof Error ? err.message : '恢复失败', 'error', 6000);
    input.value = '';
  }
}

async function exportKeyBackup() {
  if (!passOk()) return;
  const all = await db.providers.toArray();
  const payload = [];
  for (const p of all) {
    payload.push({ id: p.id, label: p.label, kind: p.kind, baseUrl: p.baseUrl, apiKey: await open_(p.apiKeySealed) });
  }
  const sealed = await sealWithPassphrase(JSON.stringify(payload), backupPass.value);
  const blob = new Blob([JSON.stringify(sealed, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `studymate-keys-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  app.toast('已导出加密备份。口令丢了无法恢复。', 'ok', 5000);
}

async function importKeyBackup(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const { openWithPassphrase } = await import('../../core/crypto');
    const data = JSON.parse(await file.text());
    const plain = await openWithPassphrase(data, backupPass.value);
    const list = JSON.parse(plain) as { id: string; label: string; kind: ProviderKind; baseUrl: string; apiKey: string }[];
    for (const item of list) {
      const existing = await db.providers.get(item.id);
      if (existing) {
        existing.apiKeySealed = await seal(item.apiKey);
        existing.apiKeyPreview = maskKey(item.apiKey);
        existing.apiKeyLen = item.apiKey.length;
        await db.providers.put(existing);
      } else {
        await db.providers.add({
          id: item.id,
          label: item.label,
          kind: item.kind,
          baseUrl: item.baseUrl,
          models: [],
          supportsModelList: true,
          timeoutMs: 60000,
          maxRetries: 1,
          createdAt: Date.now(),
          apiKeySealed: await seal(item.apiKey),
          apiKeyPreview: maskKey(item.apiKey),
          apiKeyLen: item.apiKey.length,
        });
      }
    }
    app.toast(`已导入 ${list.length} 条配置`, 'ok');
  } catch {
    app.toast('导入失败：口令错误或文件损坏', 'error', 5000);
  } finally {
    if (keyFileInput.value) keyFileInput.value.value = '';
  }
}
</script>

<template>
  <SubPage title="数据与备份" subtitle="项目资料默认只存在本机，不上传开发者服务器。你可以随时导出或删除。" @back="back">
    <div class="stats">
      <div><b>{{ counts.projects }}</b><span>项目</span></div>
      <div><b>{{ counts.reports }}</b><span>报告</span></div>
      <div><b>{{ counts.records }}</b><span>记录</span></div>
      <div><b>{{ counts.sources }}</b><span>来源</span></div>
    </div>

    <label class="field">
      <span class="field-label">备份口令（至少 8 位）</span>
      <input v-model="backupPass" type="password" class="input" placeholder="整个备份文件用它加密" />
      <span class="field-hint">口令不会保存在任何地方，丢了就打不开备份。</span>
    </label>

    <SettingGroup title="全量备份">
      <SettingRow
        label="导出全部数据"
        :note="exportStage || '项目 / 报告 / 记录 / 来源 / 本地文件索引 / 推进历史 / Key，整体加密'"
      >
        <template #right>
          <button class="btn btn-sm btn-primary" type="button" :disabled="exportingAll" @click="exportAll">
            {{ exportingAll ? '导出中…' : '导出' }}
          </button>
        </template>
      </SettingRow>
      <SettingRow v-if="lastSize" label="上次备份体积" :value="fmtSize(lastSize)" />
      <SettingRow label="从备份恢复" note="覆盖式恢复：先清空本机数据，再写入备份">
        <template #right>
          <button class="btn btn-sm" type="button" @click="allFileInput?.click()">选择文件</button>
          <input ref="allFileInput" type="file" accept=".json" hidden @change="importAll" />
        </template>
      </SettingRow>
    </SettingGroup>

    <SettingGroup title="只备份 API 配置">
      <SettingRow label="导出密钥备份">
        <template #right>
          <button class="btn btn-sm" type="button" @click="exportKeyBackup">导出</button>
        </template>
      </SettingRow>
      <SettingRow label="导入密钥备份">
        <template #right>
          <button class="btn btn-sm" type="button" @click="keyFileInput?.click()">导入</button>
          <input ref="keyFileInput" type="file" accept=".json" hidden @change="importKeyBackup" />
        </template>
      </SettingRow>
    </SettingGroup>

    <SettingGroup title="危险操作">
      <SettingRow label="一键清档" value="三次确认" danger chevron @click="showWipe = true" />
    </SettingGroup>

    <DangerWipe v-if="showWipe" @close="showWipe = false" />
  </SubPage>
</template>

<style scoped>
.stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
  padding: 14px; margin-bottom: 16px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-3);
}
.stats div { display: flex; flex-direction: column; gap: 3px; }
.stats b { font-size: 18px; font-variant-numeric: tabular-nums; }
.stats span { font-size: 11px; color: var(--text-3); }
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
.field-label { font-size: 12px; color: var(--text-3); }
.field-hint { font-size: 11.5px; color: var(--text-3); }
@media (max-width: 700px) { .stats { grid-template-columns: repeat(2, 1fr); } }
</style>
