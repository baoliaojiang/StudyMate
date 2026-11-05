import Dexie, { type Table } from 'dexie';
import type {
  ActivityRecord,
  AgentDefinition,
  AppSettings,
  Dataset,
  Deck,
  Project,
  ProviderConfig,
  Report,
  SkillDefinition,
  Source,
  StudyRecord,
  UsageRecord,
  WorkflowDef,
  WorkflowRun,
} from './types';

/** 本地文件：正文原样存本机，不切片、不上传 */
export interface LocalFileRow {
  id: string;
  name: string;
  size: number;
  text: string;
  addedAt: number;
}

/** Provider 落库形态：apiKey 以密文信封存放，永不落明文 */
export interface ProviderRow extends Omit<ProviderConfig, 'apiKey'> {
  apiKeySealed: { v: 1; iv: string; data: string };
  /** 仅用于界面显示的脱敏预览 */
  apiKeyPreview: string;
  /** 加密前的明文长度，用于判断是否配置过 */
  apiKeyLen: number;
}

export class StudyMateDB extends Dexie {
  projects!: Table<Project, string>;
  reports!: Table<Report, string>;
  records!: Table<StudyRecord, string>;
  activities!: Table<ActivityRecord, string>;
  datasets!: Table<Dataset, string>;
  sources!: Table<Source, string>;
  providers!: Table<ProviderRow, string>;
  settings!: Table<AppSettings, string>;
  usage!: Table<UsageRecord, number>;
  /** 本地文本索引：只存用户主动导入的 txt / md，用于离线检索 */
  localFiles!: Table<LocalFileRow, string>;
  /** 本地覆盖 / 自定义的 Agent（内置同 id 即为覆盖） */
  customAgents!: Table<AgentDefinition, string>;
  /** 导入或自定义的 Skill */
  customSkills!: Table<SkillDefinition, string>;
  /** 工作流定义（内置一份默认，可改） */
  workflows!: Table<WorkflowDef, string>;
  /** 工作流运行记录 */
  workflowRuns!: Table<WorkflowRun, string>;
  /** 答辩演示稿：一个项目一份，id = projectId */
  decks!: Table<Deck, string>;

  constructor(name = 'studymate') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt, status',
      reports: 'id, projectId, kind',
      records: 'id, projectId, term, index',
      activities: 'id, projectId, stageId, sourceType',
      datasets: 'id, projectId',
      sources: 'id, projectId, verifyStatus, sourceType',
      providers: 'id, kind',
      settings: 'id',
      usage: '++id, at, providerId, agentId',
    });

    // v3：本地文本检索
    this.version(3).stores({ localFiles: 'id, addedAt' });

    // v4：自定义 Agent / 导入的 Skill / 工作流定义与运行记录
    this.version(4).stores({
      customAgents: 'id, order, updatedAt',
      customSkills: 'id, builtin, updatedAt',
      workflows: 'id, updatedAt',
      workflowRuns: 'id, projectId, startedAt, status',
    });

    // v5：答辩演示稿（PPTX），随备份一起走
    this.version(5).stores({ decks: 'id, projectId, updatedAt' });

    // v2：报告从「布尔确认」升级为四态，历史数据按有无正文回填
    this.version(2)
      .stores({ reports: 'id, projectId, kind, status' })
      .upgrade(async (tx) => {
        await tx
          .table('reports')
          .toCollection()
          .modify((r: Record<string, unknown>) => {
            if (!r.status) {
              const sections = Array.isArray(r.sections) ? (r.sections as { body?: string }[]) : [];
              const hasBody = sections.some((s) => (s.body ?? '').trim().length > 0);
              r.status = r.confirmed ? 'confirmed' : hasBody ? 'draft' : 'not-started';
            }
            delete r.confirmed;
          });
      });
  }
}

export const db = new StudyMateDB();

/** 测试用：内存库 */
export function createTestDb(name: string): StudyMateDB {
  return new StudyMateDB(name);
}
