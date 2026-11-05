/**
 * 全量本地数据备份 / 恢复
 *
 * 约束：
 * 1. 备份文件整体用用户口令加密（PBKDF2-SHA256 210000 轮 + AES-GCM），
 *    因为里面含 API Key 明文——不加密等于把 Key 写成明文文件。
 * 2. Provider 的 Key 在本机是用不可导出的 CryptoKey 加密的，换设备解不开，
 *    所以备份里改为「口令信封里的明文」，恢复时再用本机 Key 重新封装。
 * 3. 恢复是覆盖式：先清空对应表再写入，避免主键冲突产生半新半旧的数据。
 */

import { db } from './db';
import { maskKey, open_, openWithPassphrase, seal, sealWithPassphrase } from './crypto';
import type {
  ActivityRecord,
  AppSettings,
  Dataset,
  Project,
  Report,
  SkillDefinition,
  Source,
  StudyRecord,
  UsageRecord,
  WorkflowDef,
  AgentDefinition,
} from './types';
import type { ProviderRow } from './db';

export const BACKUP_FORMAT = 'studymate-backup';
export const BACKUP_VERSION = 1;

interface ProviderBackup {
  id: string;
  kind: ProviderRow['kind'];
  label: string;
  baseUrl: string;
  models: ProviderRow['models'];
  defaultModel?: string;
  supportsModelList: boolean;
  timeoutMs: number;
  maxRetries: number;
  createdAt: number;
  fallbackOf?: string;
  /** 明文 Key，只存在于加密信封内部 */
  apiKey: string;
}

interface Payload {
  projects: Project[];
  reports: Report[];
  records: StudyRecord[];
  activities: ActivityRecord[];
  datasets: Dataset[];
  sources: Source[];
  providers: ProviderBackup[];
  settings: AppSettings[];
  usage: UsageRecord[];
  /** 开发者配置：自定义 Agent、导入的 Skill、工作流。老备份里没有这些字段，恢复时按空处理 */
  customAgents?: AgentDefinition[];
  customSkills?: SkillDefinition[];
  decks?: import('./types').Deck[];
  workflows?: WorkflowDef[];
}

export interface BackupCounts {
  projects: number;
  reports: number;
  records: number;
  sources: number;
  providers: number;
}

/** 导出：返回可直接下载的 JSON 文本（整体加密） */
export async function exportAllData(passphrase: string): Promise<{ text: string; counts: BackupCounts }> {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('备份口令至少 8 位');
  }

  const providerRows = await db.providers.toArray();
  const providers: ProviderBackup[] = [];
  for (const p of providerRows) {
    providers.push({
      id: p.id,
      kind: p.kind,
      label: p.label,
      baseUrl: p.baseUrl,
      models: p.models,
      defaultModel: p.defaultModel,
      supportsModelList: p.supportsModelList,
      timeoutMs: p.timeoutMs,
      maxRetries: p.maxRetries,
      createdAt: p.createdAt,
      fallbackOf: p.fallbackOf,
      apiKey: await open_(p.apiKeySealed),
    });
  }

  const payload: Payload = {
    projects: await db.projects.toArray(),
    reports: await db.reports.toArray(),
    records: await db.records.toArray(),
    activities: await db.activities.toArray(),
    datasets: await db.datasets.toArray(),
    sources: await db.sources.toArray(),
    providers,
    settings: await db.settings.toArray(),
    usage: await db.usage.toArray(),
    customAgents: await db.customAgents.toArray(),
    customSkills: await db.customSkills.toArray(),
    decks: await db.decks.toArray(),
    workflows: await db.workflows.toArray(),
  };

  const sealed = await sealWithPassphrase(JSON.stringify(payload), passphrase);
  const envelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    counts: {
      projects: payload.projects.length,
      reports: payload.reports.length,
      records: payload.records.length,
      sources: payload.sources.length,
      providers: providers.length,
    },
    // 密文信封：{ v, salt, iv, data }
    data: sealed,
  };

  return { text: JSON.stringify(envelope, null, 2), counts: envelope.counts };
}

export interface ImportResult extends BackupCounts {
  createdAt: number;
}

/** 恢复：覆盖写入。失败时不留下半截数据（先解析校验，再清表写入） */
export async function importAllData(text: string, passphrase: string): Promise<ImportResult> {
  let envelope: { format?: string; version?: number; createdAt?: number; data?: unknown };
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON 文件');
  }
  if (envelope.format !== BACKUP_FORMAT) {
    throw new Error('这不是研学帮的备份文件');
  }
  if (typeof envelope.version === 'number' && envelope.version > BACKUP_VERSION) {
    throw new Error('备份文件来自更新版本的研学帮，请先升级');
  }

  let payload: Payload;
  try {
    const plain = await openWithPassphrase(envelope.data as never, passphrase);
    payload = JSON.parse(plain);
  } catch {
    throw new Error('口令错误，或文件已损坏');
  }
  if (!Array.isArray(payload.projects)) throw new Error('备份内容不完整');

  await db.transaction(
    'rw',
    [
      db.projects,
      db.reports,
      db.records,
      db.activities,
      db.datasets,
      db.sources,
      db.providers,
      db.settings,
      db.usage,
      db.customAgents,
      db.customSkills,
      db.decks,
      db.workflows,
    ],
    async () => {
      await Promise.all([
        db.projects.clear(),
        db.reports.clear(),
        db.records.clear(),
        db.activities.clear(),
        db.datasets.clear(),
        db.sources.clear(),
        db.providers.clear(),
        db.settings.clear(),
        db.usage.clear(),
        db.customAgents.clear(),
        db.customSkills.clear(),
        db.decks.clear(),
        db.workflows.clear(),
      ]);

      if (payload.projects?.length) await db.projects.bulkAdd(payload.projects);
      if (payload.reports?.length) await db.reports.bulkAdd(payload.reports);
      if (payload.records?.length) await db.records.bulkAdd(payload.records);
      if (payload.activities?.length) await db.activities.bulkAdd(payload.activities);
      if (payload.datasets?.length) await db.datasets.bulkAdd(payload.datasets);
      if (payload.sources?.length) await db.sources.bulkAdd(payload.sources);
      if (payload.settings?.length) await db.settings.bulkAdd(payload.settings);
      if (payload.usage?.length) await db.usage.bulkAdd(payload.usage);
      if (payload.customAgents?.length) await db.customAgents.bulkAdd(payload.customAgents);
      if (payload.customSkills?.length) await db.customSkills.bulkAdd(payload.customSkills);
      if (payload.decks?.length) await db.decks.bulkAdd(payload.decks);
      if (payload.workflows?.length) await db.workflows.bulkAdd(payload.workflows);

      for (const p of payload.providers ?? []) {
        const key = p.apiKey ?? '';
        const row: ProviderRow = {
          id: p.id,
          kind: p.kind,
          label: p.label,
          baseUrl: p.baseUrl,
          models: p.models ?? [],
          defaultModel: p.defaultModel,
          supportsModelList: p.supportsModelList,
          timeoutMs: p.timeoutMs,
          maxRetries: p.maxRetries,
          createdAt: p.createdAt,
          fallbackOf: p.fallbackOf,
          apiKeySealed: await seal(key),
          apiKeyPreview: maskKey(key),
          apiKeyLen: key.length,
        };
        await db.providers.put(row);
      }
    },
  );

  return {
    createdAt: envelope.createdAt ?? Date.now(),
    projects: payload.projects.length,
    reports: payload.reports?.length ?? 0,
    records: payload.records?.length ?? 0,
    sources: payload.sources?.length ?? 0,
    providers: payload.providers?.length ?? 0,
  };
}

/** 触发浏览器下载 */
export function downloadBackup(text: string, name?: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name ?? `studymate-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
