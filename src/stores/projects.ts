import type { Term } from '../core/types';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../core/db';
import { uid, todayISO } from '../core/id';
import {
  DEFAULT_RECORD_PLAN,
  REPORT_KINDS,
  REPORT_KIND_LABEL,
  REPORT_STATUS_LABEL,
  deriveRecordsStatus,
  type Dataset,
  type Member,
  type Project,
  type RecordPlan,
  type Report,
  type ReportKind,
  type ReportStatus,
  type Source,
  type StudyRecord,
} from '../core/types';
import { blankSections, templateFor } from '../reports/templates';

/** 四大报告状态摘要（含派生出来的「研究记录」） */
export interface ReportStatusItem {
  kind: ReportKind;
  label: string;
  status: ReportStatus;
  statusLabel: string;
}

/**
 * 交付顺序：开题 → 上学期记录 → 中期 → 下学期记录 → 结题
 * 记录按学期拆成两条，用户在概览里能一眼看出「下学期的还没记」。
 */
function materialItems(reports: Report[], records: StudyRecord[]): ReportStatusItem[] {
  const pick = (kind: ReportKind): ReportStatus =>
    reports.find((r) => r.kind === kind)?.status ?? 'not-started';
  const byTerm = (t: Term) => records.filter((r) => r.term === t);
  return [
    toItem('proposal', pick('proposal')),
    toItem('records-t1', deriveRecordsStatus(byTerm(1))),
    toItem('midterm', pick('midterm')),
    toItem('records-t2', deriveRecordsStatus(byTerm(2))),
    toItem('final', pick('final')),
  ];
}

function toItem(kind: ReportKind, status: ReportStatus): ReportStatusItem {
  return {
    kind,
    label: REPORT_KIND_LABEL[kind] ?? kind,
    status,
    statusLabel: REPORT_STATUS_LABEL[status],
  };
}

/** 深拷贝成纯对象：Vue 的响应式 Proxy 不能直接交给 IndexedDB（会 DataCloneError） */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function emptyRecord(projectId: string, index: number, term: 1 | 2): StudyRecord {
  return {
    id: uid('rec'),
    projectId,
    index,
    term,
    stageName: '',
    activityName: '',
    startDate: '',
    endDate: '',
    place: '',
    participants: [],
    recorder: '',
    recordedAt: todayISO(),
    goal: '',
    work: '',
    materials: '',
    outputs: '',
    summary: '',
    nextPlan: '',
    attachments: [],
    activityIds: [],
    sourceType: 'real',
    confirmed: false,
    updatedAt: Date.now(),
  };
}

export const useProjectStore = defineStore('projects', () => {
  const list = ref<Project[]>([]);
  const current = ref<Project | null>(null);
  const reports = ref<Report[]>([]);
  const records = ref<StudyRecord[]>([]);
  const sources = ref<Source[]>([]);
  const datasets = ref<Dataset[]>([]);
  const loading = ref(false);
  /** projectId -> 四大报告状态，首页列表用 */
  const statusMap = ref<Record<string, ReportStatusItem[]>>({});

  const proposal = computed(() => reports.value.find((r) => r.kind === 'proposal'));
  const midterm = computed(() => reports.value.find((r) => r.kind === 'midterm'));
  const final = computed(() => reports.value.find((r) => r.kind === 'final'));

  const progressStats = computed(() => {
    const total = records.value.length;
    const filled = records.value.filter((r) => r.work.trim() || r.goal.trim()).length;
    const confirmed = records.value.filter((r) => r.confirmed).length;
    return { total, filled, confirmed, percent: total ? Math.round((filled / total) * 100) : 0 };
  });

  /** 当前项目的四大报告状态，固定顺序 */
  const reportStatuses = computed<ReportStatusItem[]>(() => materialItems(reports.value, records.value));

  const confirmedReportCount = computed(
    () => reportStatuses.value.filter((r) => r.status === 'confirmed').length,
  );

  async function loadStatusMap() {
    const ids = list.value.map((p) => p.id);
    if (!ids.length) {
      statusMap.value = {};
      return;
    }
    // 只取当前列表里项目的报告与记录：以前扫全库，项目一多首页会明显变慢。
    // 两张表都有 projectId 索引，anyOf 走索引不会把长正文和图片整库读进内存。
    const [allReports, allRecords] = await Promise.all([
      db.reports.where('projectId').anyOf(ids).toArray(),
      db.records.where('projectId').anyOf(ids).toArray(),
    ]);
    const byProject = new Map<string, { reports: Report[]; records: StudyRecord[] }>();
    for (const id of ids) byProject.set(id, { reports: [], records: [] });
    for (const r of allReports) byProject.get(r.projectId)?.reports.push(r);
    for (const r of allRecords) byProject.get(r.projectId)?.records.push(r);

    const next: Record<string, ReportStatusItem[]> = {};
    for (const [pid, group] of byProject) {
      next[pid] = materialItems(group.reports, group.records);
    }
    statusMap.value = next;
  }

  /** App.vue 与 Home.vue 会在同一轮挂载里各调一次，合并成一次查询 */
  let inflight: Promise<void> | null = null;
  async function loadList(): Promise<void> {
    if (inflight) return inflight;
    inflight = (async () => {
      loading.value = true;
      try {
        list.value = await db.projects.orderBy('updatedAt').reverse().toArray();
        await loadStatusMap();
      } finally {
        loading.value = false;
      }
    })();
    try {
      await inflight;
    } finally {
      inflight = null;
    }
  }

  /** 首页用：某个项目的四大报告状态 */
  function statusesOf(projectId: string): ReportStatusItem[] {
    return statusMap.value[projectId] ?? materialItems([], []);
  }

  async function setReportStatus(kind: ReportKind, status: ReportStatus) {
    const report = reports.value.find((r) => r.kind === kind);
    if (!report) return;
    report.status = status;
    report.updatedAt = Date.now();
    await db.reports.put(JSON.parse(JSON.stringify(report)));
    const idx = list.value.findIndex((p) => p.id === report.projectId);
    if (idx >= 0) list.value[idx] = { ...list.value[idx] };
    await loadStatusMap();
  }

  async function open(id: string) {
    loading.value = true;
    try {
      const p = await db.projects.get(id);
      if (!p) throw new Error('项目不存在或已被删除');
      current.value = p;
      reports.value = await db.reports.where('projectId').equals(id).toArray();
      records.value = (await db.records.where('projectId').equals(id).toArray()).sort(
        (a, b) => a.index - b.index,
      );
      sources.value = await db.sources.where('projectId').equals(id).toArray();
      datasets.value = await db.datasets.where('projectId').equals(id).toArray();
    } finally {
      loading.value = false;
    }
  }

  async function createProject(input: {
    meta: Partial<Project>;
    recordPlan: RecordPlan;
  }): Promise<Project> {
    const plan =
      input.recordPlan.total > 0
        ? {
            total: input.recordPlan.total,
            firstTerm: input.recordPlan.firstTerm,
            secondTerm: input.recordPlan.total - input.recordPlan.firstTerm,
          }
        : { ...DEFAULT_RECORD_PLAN };

    const project: Project = {
      id: uid('prj'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      topic: input.meta.topic ?? '',
      teacher: input.meta.teacher ?? '',
      school: input.meta.school ?? '',
      grade: input.meta.grade ?? '',
      className: input.meta.className ?? '',
      groupName: input.meta.groupName ?? '',
      startDate: input.meta.startDate ?? '',
      endDate: input.meta.endDate ?? '',
      requirementText: input.meta.requirementText ?? '',
      requirementSource: input.meta.requirementSource,
      members: input.meta.members ?? [],
      modes: input.meta.modes ?? ['theory'],
      aiMode: input.meta.aiMode ?? 'assist',
      recordPlan: plan,
      stageIndex: 0,
      confirmations: [],
      status: 'active',
    };

    await db.projects.add(plain(project));

    // 三份章节型报告：开题 / 中期 / 结题
    for (const kind of ['proposal', 'midterm', 'final'] as const) {
      const tpl = templateFor(kind);
      const report: Report = {
        id: uid('rpt'),
        projectId: project.id,
        kind,
        title: tpl.name,
        sections: blankSections(kind),
        version: 1,
        updatedAt: Date.now(),
        status: 'not-started',
      };
      await db.reports.add(plain(report));
    }

    // 15 篇研究记录，按学期拆分
    const recs: StudyRecord[] = [];
    for (let i = 1; i <= plan.total; i++) {
      recs.push(emptyRecord(project.id, i, i <= plan.firstTerm ? 1 : 2));
    }
    await db.records.bulkAdd(plain(recs));

    await loadList();
    return project;
  }

  async function updateProject(patch: Partial<Project>) {
    if (!current.value) return;
    current.value = { ...current.value, ...patch, updatedAt: Date.now() };
    await db.projects.put(JSON.parse(JSON.stringify(current.value)));
    const idx = list.value.findIndex((p) => p.id === current.value!.id);
    if (idx >= 0) list.value[idx] = current.value;
  }

  async function saveReport(report: Report) {
    report.updatedAt = Date.now();
    // 有正文却还停在「未开始」，自动进草稿；已确认的不动
    if (report.status === 'not-started' && report.sections.some((s) => s.body.trim())) {
      report.status = 'draft';
    }
    await db.reports.put(JSON.parse(JSON.stringify(report)));
    const i = reports.value.findIndex((r) => r.id === report.id);
    if (i >= 0) reports.value[i] = report;
  }

  async function saveRecord(record: StudyRecord) {
    record.updatedAt = Date.now();
    await db.records.put(JSON.parse(JSON.stringify(record)));
    const i = records.value.findIndex((r) => r.id === record.id);
    if (i >= 0) records.value[i] = { ...record };
  }

  /* ---------------------- 成员与分工 ---------------------- */

  /** 成员直接存在 project.members 内，改完立即落库（自动保存） */
  async function saveMembers(members: Member[]) {
    if (!current.value) return;
    await updateProject({ members: JSON.parse(JSON.stringify(members)) });
  }

  async function upsertMember(member: Member) {
    if (!current.value) return;
    const members = current.value.members.slice();
    const i = members.findIndex((m) => m.id === member.id);
    if (i >= 0) members[i] = member;
    else members.push({ ...member, role: member.role ?? (members.length ? 'member' : 'leader') });
    await saveMembers(members);
  }

  async function removeMember(id: string) {
    if (!current.value) return;
    let members = current.value.members.filter((m) => m.id !== id);
    if (members.length && !members.some((m) => m.role === 'leader')) {
      members = members.map((m, i) => ({ ...m, role: i === 0 ? 'leader' : 'member' }));
    }
    await saveMembers(members);
  }

  async function setMemberLeader(id: string) {
    if (!current.value) return;
    await saveMembers(
      current.value.members.map((m) => ({ ...m, role: m.id === id ? 'leader' : 'member' })),
    );
  }

  /** 调整记录篇数与学期分配：多退少补，已填内容的记录不删 */
  async function applyRecordPlan(plan: RecordPlan) {
    if (!current.value) return;
    const total = Math.max(1, Math.min(60, Math.round(plan.total) || DEFAULT_RECORD_PLAN.total));
    const firstTerm = Math.max(0, Math.min(total, Math.round(plan.firstTerm)));
    const next: RecordPlan = { total, firstTerm, secondTerm: total - firstTerm };
    await updateProject({
      recordPlan: next,
      members: current.value.members,
    } as Partial<Project>);

    const existing = records.value.slice().sort((a, b) => a.index - b.index);
    const keep = existing.slice(0, total);
    const drop = existing.slice(total);
    if (drop.length) await db.records.bulkDelete(drop.map((r) => r.id));

    const kept: StudyRecord[] = [];
    for (let i = 0; i < total; i++) {
      const term: 1 | 2 = i < firstTerm ? 1 : 2;
      const rec = keep[i];
      if (rec) {
        rec.index = i + 1;
        rec.term = term;
        await db.records.put(JSON.parse(JSON.stringify(rec)));
        kept.push(rec);
      } else {
        const fresh = emptyRecord(current.value!.id, i + 1, term);
        await db.records.add(fresh);
        kept.push(fresh);
      }
    }
    records.value = kept;
    await loadStatusMap();
  }

  async function addSource(source: Source) {
    await db.sources.add(plain(source));
    sources.value.push(source);
  }

  async function removeSource(id: string) {
    await db.sources.delete(id);
    sources.value = sources.value.filter((s) => s.id !== id);
  }

  async function deleteProject(id: string) {
    await db.reports.where('projectId').equals(id).delete();
    await db.records.where('projectId').equals(id).delete();
    await db.sources.where('projectId').equals(id).delete();
    await db.activities.where('projectId').equals(id).delete();
    await db.datasets.where('projectId').equals(id).delete();
    await db.projects.delete(id);
    list.value = list.value.filter((p) => p.id !== id);
    delete statusMap.value[id];
    if (current.value?.id === id) current.value = null;
  }

  return {
    list,
    current,
    reports,
    records,
    sources,
    datasets,
    loading,
    statusMap,
    proposal,
    midterm,
    final,
    progressStats,
    reportStatuses,
    confirmedReportCount,
    loadList,
    loadStatusMap,
    statusesOf,
    setReportStatus,
    open,
    createProject,
    updateProject,
    saveReport,
    saveRecord,
    saveMembers,
    upsertMember,
    removeMember,
    setMemberLeader,
    applyRecordPlan,
    addSource,
    removeSource,
    deleteProject,
  };
});
