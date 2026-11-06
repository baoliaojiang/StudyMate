<script setup lang="ts">
/** 数据备份与恢复 + 一键清档入口 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { backOr } from '../../core/nav';
import { db } from '../../core/db';
import { maskKey, open_, seal, sealWithPassphrase } from '../../core/crypto';
import { exportAllData, importAllData } from '../../core/backup';
import { saveText, pickTextFile } from '../../export/save';
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

function backupFileName(): string {
  return `studymate-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

/** pick = true 走「另存为」：每次让用户自己选保存位置 */
async function exportAll(pick = false) {
  if (!passOk()) return;
  exportingAll.value = true;
  exportStage.value = '正在准备…';
  try {
    const { text, counts: c } = await exportAllData(backupPass.value, (s) => (exportStage.value = s));
    lastSize.value = new Blob([text]).size;
    const res = await saveText(text, backupFileName(), { pick });
    if (res.how === 'cancelled') return;
    app.toast(
      `已导出 ${c.projects} 个项目 / ${c.reports} 份报告 / ${c.records} 篇记录 · ${fmtSize(lastSize.value)} · ${res.note}`,
      'ok',
      5000,
    );
    if (c.skippedKeys) {
      app.toast(`有 ${c.skippedKeys} 条 API Key 在本机解不开，备份里留空了，恢复后请重新填写`, 'warn', 8000);
    }
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '导出失败', 'error', 6000);
  } finally {
    exportingAll.value = false;
    exportStage.value = '';
  }
}

async function importAll() {
  if (!passOk()) return;
  const picked = await pickTextFile();
  if (!picked) return; // 用户取消了选择
  const ok = await askConfirm({
    title: '恢复会覆盖本机数据',
    message: '先清空本机现有全部数据，再写入备份内容。建议先导出一份当前备份。',
    confirmText: '仍然恢复',
    cancelText: '先不恢复',
    tone: 'warn',
  });
  if (!ok) return;
  try {
    const res = await importAllData(picked.text, backupPass.value);
    app.toast(`已恢复 ${res.projects} 个项目 / ${res.records} 篇记录，正在重新加载…`, 'ok', 4000);
    setTimeout(() => location.reload(), 900);
  } catch (err) {
    app.toast(err instanceof Error ? err.message : '恢复失败', 'error', 8000);
  }
}

async function exportKeyBackup(pick = false) {
  if (!passOk()) return;
  try {
    const all = await db.providers.toArray();
    const payload = [];
    for (const p of all) {
      let key = '';
      try {
        key = await open_(p.apiKeySealed);
      } catch {
        // 单条解不开不拖垮整份配置备份，留空由用户重填
      }
      payload.push({ id: p.id, label: p.label, kind: p.kind, baseUrl: p.baseUrl, apiKey: key });
    }
    const sealed = await sealWithPassphrase(JSON.stringify(payload), backupPass.value);
    const res = await saveText(
      JSON.stringify(sealed, null, 2),
      `studymate-keys-backup-${new Date().toISOString().slice(0, 10)}.json`,
      { pick },
    );
    if (res.how === 'cancelled') return;
    app.toast(`已导出加密备份（${res.note}）。口令丢了无法恢复。`, 'ok', 5000);
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '导出失败', 'error', 6000);
  }
}

async function importKeyBackup() {
  const picked = await pickTextFile();
  if (!picked) return;
  if (!backupPass.value) {
    app.toast('先填备份口令', 'warn');
    return;
  }
  try {
    const { openWithPassphrase } = await import('../../core/crypto');
    const data = JSON.parse(picked.text);
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
  } catch (e) {
    app.toast(
      e instanceof Error ? `导入失败：${e.message}` : '导入失败：口令错误或文件损坏',
      'error',
      6000,
    );
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
          <div class="row-actions">
            <button class="btn btn-sm" type="button" :disabled="exportingAll" @click="exportAll(true)">
              另存为
            </button>
            <button class="btn btn-sm btn-primary" type="button" :disabled="exportingAll" @click="exportAll(false)">
              {{ exportingAll ? '导出中…' : '导出' }}
            </button>
          </div>
        </template>
      </SettingRow>
      <SettingRow v-if="lastSize" label="上次备份体积" :value="fmtSize(lastSize)" />
      <SettingRow label="从备份恢复" note="覆盖式恢复：先清空本机数据，再写入备份">
        <template #right>
          <button class="btn btn-sm" type="button" @click="importAll">选择文件</button>
        </template>
      </SettingRow>
    </SettingGroup>

    <SettingGroup title="只备份 API 配置">
      <SettingRow label="导出密钥备份">
        <template #right>
          <div class="row-actions">
            <button class="btn btn-sm" type="button" @click="exportKeyBackup(true)">另存为</button>
            <button class="btn btn-sm" type="button" @click="exportKeyBackup(false)">导出</button>
          </div>
        </template>
      </SettingRow>
      <SettingRow label="导入密钥备份">
        <template #right>
          <button class="btn btn-sm" type="button" @click="importKeyBackup">导入</button>
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
.stats b { font-size: calc(18px * var(--font-scale)); font-variant-numeric: tabular-nums; }
.stats span { font-size: calc(11px * var(--font-scale)); color: var(--text-3); }
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
.field-label { font-size: calc(12px * var(--font-scale)); color: var(--text-3); }
.field-hint { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); }
.row-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
@media (max-width: 700px) { .stats { grid-template-columns: repeat(2, 1fr); } }
</style>
