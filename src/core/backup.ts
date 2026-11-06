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
  WorkflowRun,
  AgentDefinition,
} from './types';
import type { LocalFileRow, ProviderRow } from './db';

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
  /** 本地文件全文索引与自动推进的历史运行：老备份没有，恢复时按空处理 */
  localFiles?: LocalFileRow[];
  workflowRuns?: WorkflowRun[];
}

export interface BackupCounts {
  projects: number;
  reports: number;
  records: number;
  sources: number;
  providers: number;
  localFiles?: number;
  workflowRuns?: number;
  /** 换过设备/密钥后解不开的 Key 条数：备份里留空，界面必须提示用户重填 */
  skippedKeys?: number;
}

/** 导出：返回可直接下载的 JSON 文本（整体加密）。onStage 供界面显示当前阶段 */
export async function exportAllData(
  passphrase: string,
  onStage?: (stage: string) => void,
): Promise<{ text: string; counts: BackupCounts }> {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('备份口令至少 8 位');
  }

  onStage?.('正在读取本机数据…');
  const providerRows = await db.providers.toArray();
  const providers: ProviderBackup[] = [];
  let skippedKeys = 0;
  for (const p of providerRows) {
    // 单条 Key 解不开（换过设备、历史明文格式、密钥库被清过）不能拖垮整份备份。
    // 留空并在界面上如实报条数，让用户自己重填，绝不编一个假 Key 进去。
    let apiKey = '';
    try {
      apiKey = await open_(p.apiKeySealed);
    } catch {
      skippedKeys += 1;
    }
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
      apiKey,
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
    localFiles: await db.localFiles.toArray(),
    workflowRuns: await db.workflowRuns.toArray(),
  };

  onStage?.('正在加密备份…');
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
      localFiles: payload.localFiles?.length ?? 0,
      workflowRuns: payload.workflowRuns?.length ?? 0,
      skippedKeys,
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

  // 关键：Key 的重新封装必须在 Dexie 事务之外做完。
  // seal() 会打开另一个 IndexedDB 库并 await WebCrypto，放在事务里会让事务
  // 提前失效（表现为「恢复点了没反应 / 提示失败」）。事务里只留纯 Dexie 写操作。
  const providerRows: ProviderRow[] = [];
  for (const p of payload.providers ?? []) {
    const key = p.apiKey ?? '';
    providerRows.push({
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
    });
  }

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
      db.localFiles,
      db.workflowRuns,
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
        db.localFiles.clear(),
        db.workflowRuns.clear(),
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
      if (payload.localFiles?.length) await db.localFiles.bulkAdd(payload.localFiles);
      if (payload.workflowRuns?.length) await db.workflowRuns.bulkAdd(payload.workflowRuns);
      if (providerRows.length) await db.providers.bulkAdd(providerRows);
    },
  );

  return {
    createdAt: envelope.createdAt ?? Date.now(),
    projects: payload.projects.length,
    reports: payload.reports?.length ?? 0,
    records: payload.records?.length ?? 0,
    sources: payload.sources?.length ?? 0,
    providers: payload.providers?.length ?? 0,
    localFiles: payload.localFiles?.length ?? 0,
    workflowRuns: payload.workflowRuns?.length ?? 0,
  };
}

