/**
 * 工作流运行器
 *
 * 一条 async 串行循环，每一步都做四件事：查预算 → 执行 → 记账 → 落库。
 * 暂停 / 继续 / 取消 / 重试都在这一层，步骤内部不各自处理中断。
 *
 * 记账方式：调用前后读一次 usage 表的新增记录（网关照常写日志），
 * 所以费用与次数是真实发生的量，不是估算。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../core/db';
import { todayISO, uid } from '../core/id';
import type {
  Report,
  ReportKind,
  WorkflowDef,
  WorkflowRun,
  WorkflowRunStep,
  WorkflowScope,
  WorkflowStepDef,
  WorkflowActivity,
  StudyRecord,
  Term,
} from '../core/types';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import { AgentRuntime, type RuntimeContext } from '../agents/runtime';
import { getAgentById } from '../agents/registry';
import { listSkills } from '../skills/registry';
import { contextText, gapsFor, sectionPrompt } from '../reports/context';
import { NON_AI_SECTIONS, templateFor } from '../reports/templates';
import { runCombinedSearch } from '../search/providers';
import { open_ } from '../core/crypto';
import { defaultWorkflow, selectSteps, gateNeedsConfirm, WORKFLOW_ID } from './graph';
import { batchCount, draftMessages, parseDrafts, termName, type DraftRecord } from './record-draft';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 单步的硬上限，和工作流上限取小值，避免某一步吃光整次预算 */
const STEP_MAX_CALLS = 6;

export const useWorkflowStore = defineStore('workflow', () => {
  const app = useAppStore();
  const projects = useProjectStore();

  const def = ref<WorkflowDef>(defaultWorkflow());
  const run = ref<WorkflowRun | null>(null);
  const history = ref<WorkflowRun[]>([]);
  const busy = ref(false);

  /** 暂停 / 确认门的等待器 */
  let pauseGate: (() => void) | null = null;
  let confirmGate: (() => void) | null = null;
  let cancelled = false;
  let abort: AbortController | null = null;

  const currentStep = computed(() =>
    run.value ? run.value.steps[run.value.current] : undefined,
  );
  const progress = computed(() => {
    if (!run.value) return 0;
    const done = run.value.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
    return Math.round((done / Math.max(1, run.value.steps.length)) * 100);
  });
  const isActive = computed(
    () => !!run.value && ['running', 'paused', 'awaiting'].includes(run.value.status),
  );

  async function loadDef(): Promise<WorkflowDef> {
    const saved = await db.workflows.get(WORKFLOW_ID);
    def.value = saved ?? defaultWorkflow();
    return def.value;
  }

  /** 开发者面板改完流程后落库；下一次推进按新顺序跑 */
  async function saveDef(next: WorkflowDef): Promise<void> {
    if (isActive.value) {
      app.toast('流程正在执行，改完会在下次推进时生效', 'warn', 3200);
    }
    const d: WorkflowDef = { ...clone(next), id: WORKFLOW_ID, updatedAt: Date.now() };
    await db.workflows.put(d);
    def.value = d;
  }

  /** 丢弃本地改动，恢复内置流程 */
  async function resetDef(): Promise<WorkflowDef> {
    if (isActive.value) {
      app.toast('流程正在执行，先暂停或取消再恢复默认', 'warn');
      return def.value;
    }
    await db.workflows.delete(WORKFLOW_ID);
    def.value = defaultWorkflow();
    return def.value;
  }

  async function loadHistory(projectId: string) {
    const rows = await db.workflowRuns.where('projectId').equals(projectId).toArray();
    history.value = rows.sort((a, b) => b.startedAt - a.startedAt);
  }

  function reset() {
    cancelled = true;
    abort?.abort();
    pauseGate?.();
    confirmGate?.();
    pauseGate = confirmGate = null;
    run.value = null;
    busy.value = false;
  }

  function toRunStep(s: WorkflowStepDef): WorkflowRunStep {
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      phase: s.phase,
      report: s.report,
      agentId: s.agentId,
      status: 'pending',
      calls: 0,
      cost: 0,
    };
  }

  async function persist() {
    if (!run.value) return;
    await db.workflowRuns.put(clone(run.value));
  }

  /**
   * 实时动作流水：一步一个动作，跑完就地打勾。
   * 同一步里同名的 running 会直接变 done，不会越跑越多行。
   */
  function act(
    stepId: string,
    label: string,
    status: WorkflowActivity['status'] = 'done',
    detail?: string,
  ) {
    const r = run.value;
    if (!r) return;
    const list = [...(r.activities ?? [])];
    if (status !== 'running') {
      const i = list.findIndex((a) => a.status === 'running' && a.stepId === stepId && a.label === label);
      if (i >= 0) {
        list[i] = { ...list[i], status, detail, at: Date.now() };
        r.activities = list;
        void persist();
        return;
      }
    }
    list.push({ id: uid('act'), stepId, label, detail, status, at: Date.now() });
    if (list.length > 80) list.splice(0, list.length - 80);
    r.activities = list;
    void persist();
  }

  /* ------------------------------ 控制 ------------------------------ */

  async function start(scope: WorkflowScope): Promise<void> {
    const p = projects.current;
    if (!p) return;
    if (isActive.value) {
      app.toast('已经有一次推进在跑，先暂停或取消它', 'warn');
      return;
    }
    const d = await loadDef();
    const steps = selectSteps(d, scope, { project: p, reports: projects.reports, records: projects.records });
    if (!steps.length) {
      app.toast('这次范围里没有可执行的步骤', 'warn');
      return;
    }

    cancelled = false;
    run.value = {
      id: uid('run'),
      projectId: p.id,
      scope,
      title: p.topic || '未命名课题',
      defId: d.id,
      status: 'running',
      steps: steps.map(toRunStep),
      current: 0,
      startedAt: Date.now(),
      calls: 0,
      cost: 0,
      maxCalls: Math.max(1, app.settings.budget.maxCallsPerTask || 12),
      maxCost: app.settings.budget.dailyCost || 0,
      confirmed: [],
      activities: [],
    };
    await persist();
    act('__start__', '读取项目资料与流程', 'done', `${steps.length} 步`);
    void loop();
  }

  function pause() {
    if (!run.value || run.value.status !== 'running') return;
    run.value.status = 'paused';
    run.value.message = '已暂停，正在进行的这一步会先做完';
    void persist();
  }

  function resume() {
    if (!run.value || run.value.status !== 'paused') return;
    run.value.status = 'running';
    run.value.message = undefined;
    pauseGate?.();
    pauseGate = null;
    void persist();
  }

  function cancel() {
    if (!run.value) return;
    cancelled = true;
    abort?.abort();
    run.value.status = 'cancelled';
    run.value.message = '已取消。已经写入报告的内容保留，未执行的步骤不再继续';
    run.value.endedAt = Date.now();
    const waiting = run.value.steps[run.value.current];
    if (waiting && ['running', 'awaiting'].includes(waiting.status)) waiting.status = 'pending';
    pauseGate?.();
    confirmGate?.();
    pauseGate = confirmGate = null;
    void persist();
    app.toast('已取消本次推进', 'info');
  }

  async function retry(index = -1) {
    if (!run.value) return;
    const i = index >= 0 ? index : run.value.steps.findIndex((s) => s.status === 'failed');
    if (i < 0) return;

    // 预算上限是钱，不能替用户加；调用次数是本地限制，可以自动放宽
    if (run.value.maxCost > 0 && run.value.cost >= run.value.maxCost) {
      app.toast('已达预算上限，请到「设置 → 模型与检索」调高预算后再重试', 'warn', 5200);
      return;
    }
    if (run.value.calls >= run.value.maxCalls) {
      const next = run.value.calls + Math.max(4, Math.ceil(run.value.maxCalls / 2));
      run.value.maxCalls = next;
      app.toast(`已达调用上限，已自动放宽到 ${next} 次，接着重试`, 'info', 4200);
    }
    run.value.steps[i] = { ...run.value.steps[i], status: 'pending', error: undefined, warnings: [] };
    run.value.current = i;
    run.value.status = 'running';
    run.value.endedAt = undefined;
    run.value.message = undefined;
    cancelled = false;
    await persist();
    void loop();
  }

  /** 用户点「确认」/「跳过」 */
  async function confirmStep(stepId?: string) {
    if (!run.value) return;
    const s = stepId ? run.value.steps.find((x) => x.id === stepId) : run.value.steps[run.value.current];
    if (!s) return;
    if (s.status !== 'awaiting') return;
    s.status = 'done';
    s.endedAt = Date.now();
    if (!run.value.confirmed.includes(s.id)) run.value.confirmed.push(s.id);
    run.value.status = 'running';
    run.value.message = '已确认，接着往下走';
    act(s.id, `你已确认 · ${s.name}`, 'done');
    await persist();
    confirmGate?.();
    confirmGate = null;
  }

  /** 确认门：重新生成上一步的产出，生成完仍停在同一扇门 */
  async function regenerateStep(): Promise<void> {
    const r = run.value;
    if (!r) return;
    const gateIdx = r.steps.findIndex((s) => s.status === 'awaiting');
    if (gateIdx < 0) {
      app.toast('现在没有等确认的步骤', 'warn');
      return;
    }
    let i = gateIdx - 1;
    while (i >= 0 && !['agent', 'guard'].includes(r.steps[i].kind)) i--;
    if (i < 0) {
      app.toast('前面没有可以重新生成的内容', 'warn');
      return;
    }
    if (r.calls >= r.maxCalls) {
      app.toast('已达本次调用上限，调高后再重试', 'warn');
      return;
    }
    const step = r.steps[i];
    const sdef = def.value.steps.find((s) => s.id === step.id);
    if (!sdef) return;
    const gateId = r.steps[gateIdx].id;
    act(gateId, '重新生成上一步', 'running');
    await execStep(step, sdef, r);
    act(gateId, '重新生成上一步', step.status === 'failed' ? 'failed' : 'done');
    r.message = step.status === 'failed' ? '重新生成失败，可以再试一次' : '已重新生成，看完再确认';
    await persist();
  }

  /** 确认门：用户自己改写产出，改完仍按「已确认」推进 */
  async function editStepOutput(stepId: string, text: string): Promise<void> {
    const r = run.value;
    if (!r) return;
    const s = r.steps.find((x) => x.id === stepId);
    if (!s) return;
    s.output = text;
    s.edited = true;
    act(stepId, '你改写了内容', 'done', `${text.length} 字`);
    await persist();
  }

  /* ------------------------------ 循环 ------------------------------ */

  async function waitWhilePaused() {
    while (run.value?.status === 'paused' && !cancelled) {
      await new Promise<void>((resolve) => {
        pauseGate = resolve;
      });
    }
  }

  async function waitForConfirm() {
    await new Promise<void>((resolve) => {
      confirmGate = resolve;
    });
  }

  async function loop() {
    const r = run.value;
    if (!r) return;
    busy.value = true;
    try {
      while (r.current < r.steps.length) {
        if (cancelled) break;
        await waitWhilePaused();
        if (cancelled) break;

        if (r.calls >= r.maxCalls) {
          r.status = 'failed';
          r.message = `已达本次调用上限（${r.maxCalls} 次）。可以调高上限后点重试，已完成的步骤不会重跑。`;
          r.endedAt = Date.now();
          break;
        }
        if (r.maxCost > 0 && r.cost >= r.maxCost) {
          r.status = 'failed';
          r.message = `已达预算上限（¥${r.maxCost}）。本次已花费 ¥${r.cost.toFixed(3)}，可到设置里调整预算后重试。`;
          r.endedAt = Date.now();
          break;
        }

        const step = r.steps[r.current];
        const stepDef = def.value.steps.find((s) => s.id === step.id);
        if (!stepDef) {
          step.status = 'skipped';
          r.current += 1;
          continue;
        }

        await execStep(step, stepDef, r);
        await persist();

        if (step.status === 'awaiting') {
          const needConfirm =
            step.kind === 'manual' ||
            gateNeedsConfirm(r.scope, r.steps.length, r.current);
          if (!needConfirm) {
            step.status = 'done';
            step.endedAt = Date.now();
            step.output = step.output ?? '本阶段自动通过（可在日志里回看）';
            await persist();
          } else {
            r.status = 'awaiting';
            r.message = step.kind === 'manual' ? '这一步需要你手动完成' : '等你确认后继续';
            await persist();
            await waitForConfirm();
            if (cancelled) break;
          }
        }

        if (step.status === 'failed') {
          r.status = 'failed';
          r.message = step.error ?? '这一步失败了';
          r.endedAt = Date.now();
          await persist();
          break;
        }

        r.current += 1;
        await persist();
      }

      if (r.status !== 'cancelled' && r.status !== 'failed' && r.current >= r.steps.length) {
        r.status = 'done';
        r.endedAt = Date.now();
        r.message = '全部步骤完成。提交前请自己再通读一遍，AI 写的地方要核对。';
        await persist();
        app.toast('推进完成', 'ok');
      }
    } finally {
      busy.value = false;
      await persist();
    }
  }

  /* ------------------------------ 执行 ------------------------------ */

  /** 这一步在做什么：给实时过程一个能看懂的短句 */
  function stepDetail(sdef: WorkflowStepDef): string {
    if (sdef.id === 'search') return '正在检索资料…';
    if (sdef.kind === 'gate') return '等你确认';
    if (sdef.kind === 'manual') return '等你手动完成';
    if (sdef.kind === 'guard') return '正在核对真实记录…';
    if (sdef.kind === 'records') return '正在分批起草这一学期的记录…';
    if (sdef.report) return '正在按章节整理答案…';
    return '正在调用模型，整理答案…';
  }

  /** 每一步都往流水里写「开始 / 结束」，中间的子动作由各执行函数补充 */
  async function execStep(step: WorkflowRunStep, sdef: WorkflowStepDef, r: WorkflowRun) {
    step.status = 'running';
    step.startedAt = Date.now();
    act(step.id, step.name, 'running', stepDetail(sdef));
    await persist();

    await execStepCore(step, sdef, r);

    // 取成 string 再比较：TS 会把上面的赋值窄化成 'running'，看不到 core 里的改动
    const finalStatus = String(step.status);
    const secs = step.endedAt ? `${Math.max(1, Math.round((step.endedAt - step.startedAt!) / 1000))}s` : '';
    const tail = [
      secs,
      `调用 ${step.calls} 次`,
      step.hits ? `命中 ${step.hits} 条` : '',
      finalStatus === 'awaiting' ? '等你确认' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    act(step.id, step.name, finalStatus === 'failed' ? 'failed' : 'done', tail);
    await persist();
  }

  async function execStepCore(step: WorkflowRunStep, sdef: WorkflowStepDef, r: WorkflowRun) {
    step.status = 'running';
    step.startedAt = Date.now();
    await persist();

    if (sdef.kind === 'gate') {
      step.status = 'awaiting';
      step.output = sdef.requires
        ? `确认要点：${sdef.requires}`
        : '确认后继续';
      return;
    }

    if (sdef.kind === 'manual') {
      step.status = 'awaiting';
      step.output = '点「导出 DOCX」生成文件；导出后这一步自动算完成。';
      return;
    }

    if (sdef.kind === 'guard' && sdef.id.startsWith('records-guard')) {
      // 纯 AI 项目本来就不该有真实记录：直接放行，但把话说清楚
      if (projects.current?.pureAi) {
        step.status = 'done';
        step.output =
          '本项目是「纯 AI 生成」（仅理论 / 模拟实践），没有真实记录要求。生成内容会逐段标注「（AI 模拟示例）」，不得作为真实研究数据提交。';
        step.endedAt = Date.now();
        return;
      }
      const term = sdef.term;
      const scope = term ? projects.records.filter((x) => x.term === term) : projects.records;
      const real = scope.filter((x) => x.confirmed && x.sourceType === 'real');
      const termName = term === 1 ? '上学期' : term === 2 ? '下学期' : '';
      if (!real.length) {
        const drafted = scope.filter((x) => x.activityName.trim() || x.work.trim()).length;
        step.status = 'failed';
        step.error = drafted
          ? `${termName}已经起草了 ${drafted} 篇，但都还是未确认状态。到「过程记录」逐篇核对时间、参与人、做了什么，点「确认真实」后再回来继续。`
          : `还没有${termName}的记录。先跑前面的「${termName}过程记录」起草（分批写，写一批存一批），或自己到「过程记录」写一篇并确认为真实。`;
        step.endedAt = Date.now();
        return;
      }
      step.status = 'done';
      step.output = `${termName}已确认的真实记录 ${real.length} 篇：${real
        .slice(0, 6)
        .map((x) => x.activityName || `第 ${x.index} 篇`)
        .join('、')}`;
      step.endedAt = Date.now();
      return;
    }

    const lastUsage = (await db.usage.orderBy('id').last())?.id ?? 0;

    try {
      if (sdef.kind === 'records') {
        await runRecordsStep(step, sdef, r);
      } else if (sdef.id === 'search') {
        await runSearchStep(step, sdef);
      } else if (sdef.report && sdef.kind === 'agent') {
        await runReportStep(step, sdef, r);
      } else {
        await runAgentOnce(step, sdef, r);
      }
      if (step.status === 'running') step.status = 'done';
    } catch (e) {
      step.status = 'failed';
      step.error = e instanceof Error ? e.message : String(e);
    } finally {
      step.endedAt = Date.now();
      const used = await usageSince(lastUsage);
      step.calls += used.calls;
      step.cost = Number((step.cost + used.cost).toFixed(6));
      r.calls += used.calls;
      r.cost = Number((r.cost + used.cost).toFixed(6));
    }
  }

  async function usageSince(afterId: number) {
    const rows = await db.usage.where('id').above(afterId).toArray();
    return {
      calls: rows.length,
      cost: rows.reduce((sum, x) => sum + (x.cost || 0), 0),
    };
  }

  function runtimeContext(report?: Report): RuntimeContext {
    const p = projects.current!;
    return {
      project: p,
      report,
      records: projects.records,
      activities: [],
      datasets: projects.datasets,
      sources: projects.sources,
    };
  }

  function recordsBrief(): string {
    const real = projects.records.filter((x) => x.confirmed && x.sourceType === 'real');
    if (!real.length) return '【研究记录】暂无已确认的真实记录。';
    return [
      '【已确认真实记录（节选）】',
      ...real
        .slice(0, 10)
        .map(
          (x) =>
            `- 第${x.index}篇 ${x.activityName || x.stageName || '未命名'}｜${x.startDate || ''}｜参与：${x.participants.join('、') || '未填'}｜做法：${x.work.slice(0, 120)}｜结果：${x.outputs.slice(0, 120)}`,
        ),
    ].join('\n');
  }

  async function makeRuntime(): Promise<AgentRuntime> {
    const skills = await listSkills();
    return new AgentRuntime(app.gateway, skills);
  }

  /**
   * 起草一学期的过程记录。
   *
   * 关键取舍：不一次生成整学期（7～8 篇要十几分钟，还容易被模型写飘），
   * 而是按批走 —— 每批 3 篇、落一次库、界面点亮一次。
   * 中途到调用上限就停下来说清楚还差几篇，下次接着补，已生成的不重写。
   */
  async function runRecordsStep(step: WorkflowRunStep, sdef: WorkflowStepDef, r: WorkflowRun) {
    const p = projects.current;
    if (!p) throw new Error('项目还没打开，先回到项目页再推进');
    const term = (sdef.term ?? 1) as Term;

    if (p.pureAi) {
      step.status = 'done';
      step.output = '本项目是纯 AI 生成，没有真实活动记录要求；生成的模拟内容会标注「（AI 模拟示例）」。';
      return;
    }

    const target =
      term === 1 ? Math.max(0, p.recordPlan?.firstTerm ?? 0) : Math.max(0, p.recordPlan?.secondTerm ?? 0);
    const existing = projects.records.filter((x) => x.term === term);
    const need = Math.max(0, target - existing.length);
    if (!need) {
      step.status = 'done';
      step.output = `${termName(term)}已经有 ${existing.length} 篇记录，这次没有新增。要重写请到「过程记录」里改。`;
      return;
    }

    let made = 0;
    let lastErr = '';
    let dry = 0;

    while (made < need) {
      if (cancelled) break;
      const leftCalls = r.maxCalls - r.calls - step.calls;
      if (leftCalls <= 0) break;
      const n = batchCount(need - made, leftCalls);
      if (n <= 0) break;

      const from = existing.length + made;
      act(step.id, `${termName(term)}第 ${from + 1}–${from + n} 篇`, 'running', '正在写这一批…');

      let drafts: DraftRecord[] = [];
      try {
        drafts = await draftBatch(p, term, n, from);
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        throw new Error(`第 ${from + 1} 篇起的草稿没写出来：${lastErr}`);
      }

      if (!drafts.length) {
        dry += 1;
        if (dry >= 2) break;
        continue;
      }
      dry = 0;

      for (const d of drafts.slice(0, need - made)) {
        const rec = toRecord(p.id, term, existing.length + made + 1, d);
        await db.records.put(rec);
        projects.records.push(rec);
        made += 1;
      }
      act(step.id, `已写入第 ${existing.length + made} 篇`, 'done', `本批 ${drafts.length} 篇`);
      await persist();
    }

    if (!made) {
      step.status = 'failed';
      step.error = lastErr
        ? `记录草稿没写出来：${lastErr}`
        : '模型这几次都没给出能用的记录，检查一下模型配置后点「只重跑这一步」再试。';
      step.output = '';
      return;
    }

    const rest = need - made;
    step.status = 'done';
    step.output =
      `${termName(term)}已起草 ${made} 篇（第 ${existing.length + 1}–${existing.length + made} 篇），共 ${target} 篇。` +
      (rest > 0 ? `还差 ${rest} 篇：到调用上限了，点「继续」再跑一次会接着写，已写好的不会重复。` : '') +
      '\n这些是「按计划该做的事」，不是已经发生的记录：逐篇改成真实时间、真实参与人、真实做法，再点确认。';
    step.warnings = [
      `草稿 ${made} 篇均为未确认状态，未经你核对不能当作真实记录导出。`,
      ...(rest > 0 ? [`还有 ${rest} 篇没起草，下次继续。`] : []),
    ];
  }

  async function draftBatch(p: NonNullable<typeof projects.current>, term: Term, n: number, from: number) {
    const ctx = {
      topic: p.topic,
      grade: p.grade,
      modes: (p.modes ?? []) as string[],
      members: (p.members ?? []).map((m) => m.name).filter(Boolean),
      startDate: p.startDate,
      endDate: p.endDate,
    };
    const res = await withTimeout(
      app.gateway.chat({
        messages: draftMessages(ctx, term, n, from),
        agentId: 'project-planner',
        tier: 'cheap',
        temperature: 0.5,
        maxTokens: 1600,
      }),
      120_000,
      `${termName(term)}过程记录草稿`,
    );
    return parseDrafts(res.text, n);
  }

  /** 草稿 → 记录：一律未确认，正文写清这是待核对的计划动作 */
  function toRecord(projectId: string, term: Term, index: number, d: DraftRecord): StudyRecord {
    return {
      id: uid('rec'),
      projectId,
      index,
      term,
      stageName: d.stageName,
      activityName: d.activityName,
      startDate: d.startDate,
      endDate: d.endDate,
      place: d.place,
      participants: d.participants,
      recorder: '',
      recordedAt: todayISO(),
      goal: d.goal,
      work: d.work,
      materials: d.materials,
      outputs: d.outputs,
      summary: d.summary,
      nextPlan: d.nextPlan,
      attachments: [],
      activityIds: [],
      sourceType: 'real',
      confirmed: false,
      updatedAt: Date.now(),
    };
  }

  async function runAgentOnce(step: WorkflowRunStep, sdef: WorkflowStepDef, r: WorkflowRun) {
    if (!sdef.agentId) {
      step.status = 'skipped';
      step.output = '这一步没有绑定 Agent，已跳过';
      return;
    }
    const agent = await getAgentById(sdef.agentId);
    if (!agent) {
      step.status = 'failed';
      step.error = `找不到 Agent「${sdef.agentId}」，可能已被删除。到开发者面板检查。`;
      return;
    }
    const instruction = instructionFor(sdef, recordsBrief());
    const runtime = await makeRuntime();
    const result = await withTimeout(
      runtime.run(sdef.agentId, agent, runtimeContext(), instruction, {
        maxCalls: Math.min(STEP_MAX_CALLS, Math.max(1, r.maxCalls - r.calls)),
        maxLoops: sdef.maxLoops ?? agent.maxLoops,
        signal: abort?.signal,
      }),
      sdef.timeoutMs ?? agent.timeoutMs,
      sdef.name,
    );
    step.output = result.text.trim();
    step.warnings = result.warnings;
    act(step.id, `调用助手 · ${agent.name}`, 'done', `${step.output.length} 字`);
  }

  async function runReportStep(step: WorkflowRunStep, sdef: WorkflowStepDef, r: WorkflowRun) {
    const p = projects.current!;
    const kind = sdef.report as ReportKind;
    const report = projects.reports.find((x) => x.kind === kind);
    if (!report) {
      step.status = 'failed';
      step.error = `项目里没有「${kind}」这份报告`;
      return;
    }

    if (!sdef.agentId) {
      step.status = 'skipped';
      return;
    }
    const agent = await getAgentById(sdef.agentId);
    if (!agent) {
      step.status = 'failed';
      step.error = `找不到 Agent「${sdef.agentId}」`;
      return;
    }

    const isWriter = !!agent.permission.writeReport;
    const ctx = runtimeContext(report);
    const gaps = gapsFor(kind, { project: p, records: projects.records, sources: projects.sources, datasets: projects.datasets }, app.settings.gapMode);
    const blocking = gaps.filter((g) => g.level === 'block');
    if (isWriter && blocking.length) {
      step.status = 'failed';
      step.error = `还不能写：${blocking.map((g) => g.text).join('；')}`;
      return;
    }

    const runtime = await makeRuntime();

    // 审核类：只读，一次调用
    if (!isWriter) {
      const body = report.sections
        .filter((x) => x.body.trim())
        .map((x) => `## ${x.heading}\n${x.body.trim().slice(0, 1200)}`)
        .join('\n\n');
      if (!body.trim()) {
        step.status = 'skipped';
        step.output = '报告还没有正文，先写作再审核。';
        return;
      }
      const result = await withTimeout(
        runtime.run(
          sdef.agentId,
          agent,
          runtimeContext(report),
          [
            `请审核《${report.title}》的现有正文。只输出问题清单，不改写正文。`,
            '',
            '【正文】',
            body.slice(0, 9000),
            '',
            recordsBrief(),
          ].join('\n'),
          {
            maxCalls: Math.min(STEP_MAX_CALLS, Math.max(1, r.maxCalls - r.calls)),
            maxLoops: 1,
            signal: abort?.signal,
          },
        ),
        sdef.timeoutMs ?? agent.timeoutMs,
        sdef.name,
      );
      step.output = result.text.trim();
      step.warnings = result.warnings;
      return;
    }

    // 写作类：逐节填，只填空章节
    const targets = report.sections.filter((x) => {
      if (NON_AI_SECTIONS.includes(x.heading)) return false;
      if (!sdef.overwrite && x.body.trim()) return false;
      return true;
    });
    if (!targets.length) {
      step.status = 'done';
      step.output = `《${report.title}》各章节都已有正文，这一步没有改写。要重写请在推进设置里打开「覆盖已有正文」。`;
      return;
    }

    const ctxText = contextText({ project: p, records: projects.records, sources: projects.sources, datasets: projects.datasets });
    const written: string[] = [];
    let spent = 0;
    for (const section of targets) {
      if (cancelled) break;
      if (r.calls + spent >= r.maxCalls) break;
      if (spent >= STEP_MAX_CALLS) break;

      const spec = templateFor(kind).sections.find((s) => s.heading === section.heading);
      if (!spec) continue;

      const before = (await db.usage.orderBy('id').last())?.id ?? 0;
      try {
        const result = await withTimeout(
          runtime.run(
            sdef.agentId,
            agent,
            { ...ctx, section },
            sectionPrompt({
              kind,
              heading: section.heading,
              hint: spec.hint,
              words: spec.words,
              ctxText,
              gaps,
              existing: sdef.overwrite ? section.body : '',
              mode: app.settings.gapMode,
            }),
            {
              maxCalls: Math.min(4, Math.max(1, r.maxCalls - r.calls - spent)),
              maxLoops: 1,
              signal: abort?.signal,
            },
          ),
          sdef.timeoutMs ?? agent.timeoutMs,
          `${sdef.name} · ${section.heading}`,
        );
        const text = result.text.trim();
        if (text) {
          section.body = text;
          section.origin = 'ai';
          if (/（AI 模拟示例）|模拟数据/.test(text)) section.containsSimulated = true;
          written.push(section.heading);
          act(step.id, `整理答案 · ${section.heading}`, 'done', `${text.length} 字`);
          if (result.warnings.length) step.warnings = [...(step.warnings ?? []), ...result.warnings];
        }
      } catch (e) {
        step.warnings = [...(step.warnings ?? []), `${section.heading}：${e instanceof Error ? e.message : String(e)}`];
      } finally {
        spent += (await usageSince(before)).calls;
      }
      await projects.saveReport(report);
    }

    step.output = written.length
      ? `已写 ${written.length} 节：${written.join('、')}`
      : '没有写入任何章节';
    if (report.status === 'not-started' && report.sections.some((x) => x.body.trim())) {
      report.status = 'draft';
      await projects.saveReport(report);
    }
  }

  async function runSearchStep(step: WorkflowRunStep, sdef: WorkflowStepDef) {
    const p = projects.current!;
    const query = [p.topic, p.requirementText.slice(0, 60)].filter(Boolean).join(' ').trim() || p.topic;
    if (!query) {
      step.status = 'failed';
      step.error = '课题名称还没填，没法检索';
      return;
    }

    const providers = await Promise.all(
      app.settings.searchProviders.map(async (sp) => ({
        ...sp,
        apiKey: sp.apiKey ?? (sp.apiKeySealed ? await open_(sp.apiKeySealed).catch(() => '') : ''),
      })),
    );

    const mode = providers.some((x) => x.enabled && x.capabilities.includes('academic')) ? 'academic' : 'web';
    const outcome = await runCombinedSearch(providers, { query, mode, limit: 8 });
    act(step.id, '检索资料', 'done', `命中 ${outcome.hits.length} 条`);

    const lines = outcome.hits
      .slice(0, 8)
      .map(
        (h, i) =>
          `[${i + 1}] ${h.title}｜${h.authors || h.institution || '作者未填'}｜${h.date || '日期未填'}｜${
            h.doi ? `DOI:${h.doi}` : h.url || '无链接'
          }｜${h.provider}`,
      );

    if (!lines.length) {
      step.output = [
        `检索词：${query}`,
        outcome.outcomes[0]?.message ?? '没有检索到结果。',
        '可以到「设置 → 检索服务」检查启用的服务与密钥，或直接手动录入来源。',
      ].join('\n');
      step.hits = 0;
      step.status = 'done';
      return;
    }

    // 用 source-researcher 排一次相关度，仍不编造：只允许从给出的条目里挑
    const agent = sdef.agentId ? await getAgentById(sdef.agentId) : undefined;
    step.hits = outcome.hits.length;
    if (!agent) {
      step.output = [`检索词：${query}`, ...lines].join('\n');
      return;
    }
    const runtime = await makeRuntime();
    const result = await withTimeout(
      runtime.run(
        agent.id,
        agent,
        runtimeContext(),
        [
          `检索词：${query}`,
          '以下是从公开接口拿到的真实元数据条目。请挑出 5–8 条最相关的，按「这条能支撑哪个部分」说明理由。',
          '只能从下列条目里选，不得新增、不得补全缺失字段、不得编造 DOI。',
          '',
          ...lines,
        ].join('\n'),
        { maxCalls: 1, maxLoops: 1, signal: abort?.signal },
      ),
      sdef.timeoutMs ?? agent.timeoutMs,
      sdef.name,
    );
    step.output = result.text.trim();
    step.warnings = result.warnings;
  }

  /* ------------------------------ 导出 ------------------------------ */

  async function exportFinal() {
    const p = projects.current;
    if (!p) return;
    const { exportOne } = await import('../export/bundle');
    await app.withBusy('正在生成文档…', async () => {
      await exportOne('final', {
        project: p,
        reports: projects.reports,
        records: projects.records,
        sources: projects.sources,
      });
    });
    if (run.value) {
      const step = run.value.steps.find((s) => s.id === 'export');
      if (step && step.status === 'awaiting') await confirmStep(step.id);
    }
  }

  /** 打开项目时加载：上次没跑完的标成已暂停 */
  async function restore(projectId: string) {
    await loadDef();
    await loadHistory(projectId);
    // 内存里正在跑的同项目运行不能被数据库快照覆盖：
    // 否则确认后 loop 拿着旧对象继续，界面却显示新对象，看起来就是「第三步一直等待」。
    if (
      run.value &&
      run.value.projectId === projectId &&
      ['running', 'awaiting', 'paused'].includes(run.value.status)
    ) {
      return;
    }
    const last = history.value[0];
    if (last && ['running', 'awaiting'].includes(last.status)) {
      last.status = 'paused';
      last.message = '上次运行被中断，点「继续」接着跑';
      run.value = last;
    }
  }

  return {
    def,
    run,
    history,
    busy,
    currentStep,
    progress,
    isActive,
    loadDef,
    saveDef,
    resetDef,
    loadHistory,
    restore,
    start,
    pause,
    resume,
    cancel,
    retry,
    confirmStep,
    regenerateStep,
    editStepOutput,
    exportFinal,
    reset,
  };
});

/* ------------------------------ 工具 ------------------------------ */

function instructionFor(sdef: WorkflowStepDef, recordsText: string): string {
  switch (sdef.id) {
    case 'analyze':
      return [
        '请基于当前项目状态给出研究计划。',
        '1. 现状：已有的真实记录、来源、成员与分工，缺什么',
        '2. 阶段划分：3–5 个阶段，每阶段写目标、任务、产出、时间范围',
        '3. 最大的风险（时间、样本、可行性）与应对',
        '',
        '只做计划。不得写任何「已完成」的研究活动。',
        '',
        recordsText,
      ].join('\n');
    case 'design':
      return [
        '根据课题与教师要求，给出可直接执行的研究设计。',
        '包括：方法组合与理由、研究对象与样本量、工具（问卷题目 / 访谈提纲 / 实验步骤 / 观察记录表）、时间安排、注意事项与安全要求。',
        '不要编造已有数据，不要假设学生已经做过调查。',
        '',
        recordsText,
      ].join('\n');
    case 'assign':
      return [
        '根据成员名单与当前阶段，给出分工建议。',
        '每人一条：负责什么、产出什么、什么时候交。组长额外负责统筹与对外联系。',
        '只做建议，不代替成员承诺；成员没填分工时明确提示需要本人确认。',
        '',
        recordsText,
      ].join('\n');
    default:
      return `${sdef.desc}\n\n${recordsText}`;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 超过 ${Math.round(ms / 1000)} 秒未返回，已跳过`)), ms),
    ),
  ]);
}
