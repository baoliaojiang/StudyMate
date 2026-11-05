<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import ReportEditor from '../components/ReportEditor.vue';
import RecordList from '../components/RecordList.vue';
import SourcePanel from '../components/SourcePanel.vue';
import MemberPanel from '../components/MemberPanel.vue';
import ProjectSettings from '../components/ProjectSettings.vue';
import { exportBundle, exportOne, type ExportSelection } from '../export/bundle';
import { countChecks, preflight, type DeliveryCheck } from '../export/preflight';
import { MODE_ENTRY } from '../agents/definitions';
import WorkflowPanel from '../components/workflow/WorkflowPanel.vue';
import type { ReportKind, ReportStatus } from '../core/types';
import { useWorkflowStore } from '../workflow/runner';
import { askConfirm, beginTask, confirmLeave, endTask, pushOverlay } from '../core/task-guard';

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const store = useProjectStore();

type Tab =
  | 'overview'
  | 'proposal'
  | 'records'
  | 'midterm'
  | 'final'
  | 'sources'
  | 'members'
  | 'settings';
const tab = ref<Tab>('overview');

const tabs: { key: Tab; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'proposal', label: '开题' },
  { key: 'records', label: '研究记录' },
  { key: 'midterm', label: '中期' },
  { key: 'final', label: '结题' },
  { key: 'sources', label: '来源' },
  { key: 'members', label: '成员' },
  { key: 'settings', label: '设置' },
];

const workflowOpen = ref(false);
const wfScope = ref<'report' | 'stage' | 'project'>('project');
const wf = useWorkflowStore();

function openWorkflow(scope: 'report' | 'stage' | 'project') {
  wfScope.value = scope;
  workflowOpen.value = true;
}

/** 关面板也算「退出」：任务在跑时先问一句 */
async function closeWorkflow(): Promise<boolean> {
  if (!(await confirmLeave())) return false;
  workflowOpen.value = false;
  return true;
}

async function onGoto(t: 'sources' | 'records' | 'members') {
  if (!(await closeWorkflow())) return;
  tab.value = t;
}

/** 运行中的工作流登记到退出守卫；等确认时是停着的，不算会中断 */
watch(
  () => wf.run?.status,
  (s) => {
    if (s === 'running') beginTask('workflow', '项目自动推进');
    else endTask('workflow');
  },
  { immediate: true },
);

let unregisterSheet: (() => void) | null = null;
watch(workflowOpen, (open) => {
  if (open && !unregisterSheet) unregisterSheet = pushOverlay('workflow-sheet', closeWorkflow);
  else if (!open && unregisterSheet) {
    unregisterSheet();
    unregisterSheet = null;
  }
});
onBeforeUnmount(() => {
  unregisterSheet?.();
  endTask('workflow');
});

onMounted(async () => {
  try {
    await store.open(String(route.params.id));
    // 支持 /project/id?tab=records 这类深链（研究记录总览、资料库都会这样跳）
    const q = String(route.query.tab ?? '');
    if (tabs.some((t) => t.key === q)) tab.value = q as Tab;
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '项目打不开', 'error', 5000);
    router.replace('/');
  }
});

const p = computed(() => store.current);

const reportFor = (kind: ReportKind) => store.reports.find((r) => r.kind === kind);

/** 状态条点击后落到哪个 tab */
const tabOf = (kind: ReportKind): Tab =>
  kind === 'records-t1' || kind === 'records-t2' || kind === 'progress' ? 'records' : (kind as Tab);

const statusClass = (s: ReportStatus) => `s-${s}`;

/** 某个 tab 对应的报告状态（概览/来源/成员/设置没有） */
const statusOf = (key: Tab) =>
  key === 'proposal' || key === 'records' || key === 'midterm' || key === 'final'
    ? store.reportStatuses.find((r) => r.kind === (key === 'records' ? 'records-t1' : key))
    : undefined;

/** 按学期数记录：概览里两条记录各自显示进度 */
function termStat(term: 1 | 2) {
  const list = store.records.filter((r) => r.term === term);
  const filled = list.filter((r) => (r.goal ?? '').trim() || (r.work ?? '').trim()).length;
  return { filled, total: list.length };
}

const doneCount = computed(() => store.reportStatuses.filter((r) => r.status === 'confirmed').length);

/**
 * 七个入口不再弹抽屉，而是跳到首页的对话里做。
 *
 * 这样有会话记录、有历史可翻、也不会和手机状态栏打架；
 * 执行过程（哪几步、每步结果）直接在消息里一条条显示。
 */
function runEntry(key: keyof typeof MODE_ENTRY) {
  if (!p.value) return;
  if (app.settings.minor.enabled && app.settings.minor.limitAi) {
    app.toast('未成年人模式已限制 AI 生成，请监护人在设置里关闭后再用', 'warn', 4600);
    return;
  }
  router.push({ path: '/', query: { project: p.value.id, entry: key } });
}

/** 顶部「问 AI」：进对话，不带具体入口 */
function askAi() {
  if (!p.value) return;
  router.push({ path: '/', query: { project: p.value.id } });
}

/* ---------------------- 交付前核对与批量导出 ---------------------- */

const checkOpen = ref(false);
const checks = ref<DeliveryCheck[]>([]);
const zipOpen = ref(false);
/** 打包范围：默认三份报告全选，记录全学期 */
const zipReports = ref<Record<string, boolean>>({ proposal: true, midterm: true, final: true });
const zipTerm = ref<number>(0);
const zipIncludeMd = ref(true);

const checkStats = computed(() => countChecks(checks.value));

function buildInput() {
  return {
    project: p.value!,
    reports: store.reports,
    records: store.records,
    sources: store.sources,
  };
}

function runCheck() {
  if (!p.value) return;
  checks.value = preflight(buildInput());
  checkOpen.value = true;
}

/** 有阻塞项时先说明白，再由用户决定要不要继续导出 */
async function confirmBlock(): Promise<boolean> {
  if (!p.value) return false;
  const list = preflight(buildInput());
  checks.value = list;
  const block = list.filter((c) => c.level === 'block');
  if (!block.length) return true;
  return askConfirm({
    title: `有 ${block.length} 个问题需要先处理`,
    message: block.map((c) => `· ${c.where}：${c.text}`).join('\n'),
    confirmText: '仍然导出',
    cancelText: '先处理',
    tone: 'warn',
  });
}

async function doExport(kind: 'proposal' | 'progress' | 'midterm' | 'final' | 'md' | 'zip') {
  if (!p.value) return;
  if (!(await confirmBlock())) {
    checkOpen.value = true;
    return;
  }
  await app.withBusy('正在生成文档…', async () => {
    const input = buildInput();
    if (kind === 'zip') await exportBundle(input, zipSelection());
    else await exportOne(kind as any, input);
  });
}

function zipSelection(): ExportSelection {
  const picked = Object.entries(zipReports.value)
    .filter(([, on]) => on)
    .map(([k]) => k as ReportKind);
  return {
    reports: picked,
    records: zipTerm.value ? { term: zipTerm.value as 1 | 2 } : undefined,
    includeMarkdown: zipIncludeMd.value,
  };
}

const recordPlanText = computed(() =>
  p.value
    ? `${p.value.recordPlan.total} 篇（上 ${p.value.recordPlan.firstTerm} / 下 ${p.value.recordPlan.secondTerm}）`
    : '',
);

const modeText = computed(() =>
  (p.value?.modes ?? [])
    .map((m) => ({ theory: '纯理论', practice: '真实实践', simulated: 'AI 模拟' }[m] || m))
    .join(' + '),
);

const hasSim = computed(() => (p.value?.modes ?? []).includes('simulated'));
</script>

<template>
  <div v-if="!p" class="loading-page">
    <div class="skeleton" style="height: 120px" />
    <div class="skeleton" style="height: 220px; margin-top: 12px" />
  </div>

  <div v-else class="page">
    <!-- 头部 -->
    <header class="phead">
      <button class="back" aria-label="返回" @click="router.push('/')">←</button>
      <div class="grow">
        <h1 class="ptitle">{{ p.topic || '（未命名课题）' }}</h1>
        <div class="pmeta">
          <span>{{ p.school || '未填学校' }}</span>
          <i />
          <span>{{ p.grade }} {{ p.className }}</span>
          <i />
          <span>{{ p.groupName || '未填小组' }}</span>
          <i />
          <span>指导教师 {{ p.teacher }}</span>
        </div>
      </div>
      <button class="btn btn-sm btn-primary" @click="askAi">问 AI</button>
    </header>

    <!-- 一栏解决导航与状态：不再重复两套「开题/中期/结题」 -->
    <nav class="tabs">
      <div class="tabs-track">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="tab-btn"
          :class="{ on: tab === t.key }"
          @click="tab = t.key"
        >
          <span v-if="statusOf(t.key)" class="tab-dot" :class="statusClass(statusOf(t.key)!.status)" />
          {{ t.label }}
        </button>
      </div>
      <span class="tabs-count">
        <b class="tnum">{{ doneCount }}</b>/4 已确认
      </span>
    </nav>

    <!-- 概览 -->
    <section v-if="tab === 'overview'" class="pane">
      <div class="grid">
        <div class="card card-pad">
          <div class="card-label">资料与安排</div>
          <div class="kv"><span>研究方式</span><b>{{ modeText }}</b></div>
          <div class="kv"><span>AI 模式</span><b>{{ p.aiMode === 'assist' ? 'AI 辅助' : 'AI 主导辅助' }}</b></div>
          <div class="kv"><span>时间</span><b>{{ p.startDate || '—' }} 至 {{ p.endDate || '—' }}</b></div>
          <div class="kv"><span>记录篇数</span><b>{{ recordPlanText }}</b></div>
          <div class="kv"><span>成员</span><b>{{ p.members.map((m) => m.name + (m.role === 'leader' ? '(组长)' : '')).join('、') || '未填' }}</b></div>
          <div class="kv"><span>来源</span><b>{{ store.sources.length }} 条</b></div>
        </div>

        <div class="card card-pad">
          <div class="card-label">现在该做什么</div>
          <div
            v-for="entry in [
              { k: 'assistant', t: '智能规划', d: '看现在的进度，给出下一步' },
              { k: 'research', t: '资料研究', d: '找文献与网页，补进来源表' },
              { k: 'divide', t: '任务分工', d: '把阶段任务分到人头上' },
              { k: 'generate', t: '报告生成', d: '按学校表格逐节写' },
              { k: 'review', t: '内容审核', d: '查虚构内容与引用风险' },
              { k: 'format', t: '格式检查', d: '查章节、字数、图表编号' },
              { k: 'workflow', t: '项目自动推进', d: '从分析课题一路推到导出' },
            ]"
            :key="entry.k"
            class="todo"
            @click="
              entry.k === 'workflow'
                ? openWorkflow('project')
                : entry.k === 'generate'
                  ? openWorkflow('report')
                  : runEntry(entry.k as any)
            "
          >
            <div class="grow">
              <div class="todo-t">{{ entry.t }}</div>
              <div class="todo-d">{{ entry.d }}</div>
            </div>
            <span class="arrow">›</span>
          </div>
        </div>
      </div>

      <!-- 四大报告 -->
      <div class="card card-pad" style="margin-top: 12px">
        <div class="card-label">交付顺序：开题 → 上学期记录 → 中期 → 下学期记录 → 结题</div>
        <div class="rpt-grid">
          <button
            v-for="r in store.reportStatuses"
            :key="r.kind"
            class="rpt-tile"
            :class="statusClass(r.status)"
            @click="tab = tabOf(r.kind)"
          >
            <span class="rpt-tile-name">{{ r.label }}</span>
            <span class="rpt-tile-val">{{ r.statusLabel }}</span>
            <span class="rpt-tile-meta">
              {{
                r.kind === 'records-t1' || r.kind === 'records-t2'
                  ? `${termStat(r.kind === 'records-t1' ? 1 : 2).filled}/${termStat(r.kind === 'records-t1' ? 1 : 2).total} 篇有内容`
                  : r.kind === 'progress'
                    ? `${store.progressStats.filled}/${store.records.length} 篇有内容`
                    : `${reportFor(r.kind)?.sections.filter((s) => s.body.trim()).length ?? 0}/${
                        reportFor(r.kind)?.sections.length ?? 0
                      } 节有内容`
              }}
            </span>
          </button>
        </div>
      </div>

      <!-- 交付与导出 -->
      <div class="card card-pad" style="margin-top: 12px">
        <div class="card-label">交付与导出</div>
        <div class="exp-grid">
          <button class="exp" @click="doExport('proposal')">
            <b>开题报告</b><span>DOCX · 表格版式</span>
          </button>
          <button class="exp" @click="doExport('progress')">
            <b>过程记录（上 {{ termStat(1).total }} + 下 {{ termStat(2).total }} 篇）</b><span>DOCX · 阶段性记录表</span>
          </button>
          <button class="exp" @click="doExport('midterm')">
            <b>中期报告</b><span>DOCX · 表格版式</span>
          </button>
          <button class="exp" @click="doExport('final')">
            <b>结题报告</b><span>DOCX · 可选封面与目录</span>
          </button>
        </div>
        <div class="row wrap" style="margin-top: 12px">
          <button class="btn btn-sm btn-primary" @click="router.push(`/deck/${p.id}`)">生成答辩 PPT</button>
          <button class="btn btn-sm" type="button" @click="zipOpen = !zipOpen">打包下载（可选范围）</button>
          <button class="btn btn-sm" @click="doExport('md')">导出 Markdown</button>
          <button class="btn btn-sm" type="button" @click="runCheck">
            导出前核对<template v-if="checks.length">（{{ checkStats.block }} 必处理 / {{ checkStats.warn }} 提醒）</template>
          </button>
        </div>

        <!-- 打包范围：折叠用 Grid 0fr→1fr，不写 JS 量高 -->
        <div class="fold" :class="{ open: zipOpen }">
          <div class="fold-in">
            <div class="zip-box">
              <span class="muted small">报告</span>
              <label v-for="r in [{ k: 'proposal', t: '开题' }, { k: 'midterm', t: '中期' }, { k: 'final', t: '结题' }]" :key="r.k" class="zip-pick">
                <input v-model="zipReports[r.k]" type="checkbox" /> {{ r.t }}
              </label>
              <span class="muted small">记录</span>
              <select v-model.number="zipTerm" class="zip-select">
                <option :value="0">全部学期</option>
                <option :value="1">仅上学期</option>
                <option :value="2">仅下学期</option>
              </select>
              <label class="zip-pick"><input v-model="zipIncludeMd" type="checkbox" /> 附 Markdown</label>
              <button class="btn btn-sm btn-primary" type="button" @click="doExport('zip')">按选择打包</button>
            </div>
          </div>
        </div>

        <div class="fold" :class="{ open: checkOpen }">
          <div class="fold-in">
            <ul v-if="checks.length" class="check-list">
              <li v-for="c in checks" :key="c.id" :class="c.level">
                <b>{{ c.level === 'block' ? '必须先处理' : '建议核对' }}</b>
                <span>{{ c.where }}：{{ c.text }}</span>
              </li>
            </ul>
            <p v-else class="muted small" style="margin: 10px 0 0">本机检查没发现问题。交之前仍要自己完整读一遍。</p>
            <p class="muted small" style="margin: 8px 0 0">这份清单也会写进 ZIP（交付前核对.md），方便归档。</p>
          </div>
        </div>
        <p class="muted small" style="margin: 12px 0 0; line-height: 1.7">
          文档导出的是真正的 Office Open XML，含模拟内容时文首自动加提示框，正文保留「（AI 模拟示例）」标识。<br />
          答辩 PPT 按项目内容逐页生成，可自己改文字与顺序，导出 PPTX 和讲稿。
        </p>
      </div>

      <div v-if="p.requirementText" class="card card-pad" style="margin-top: 12px">
        <div class="card-label">教师要求原文</div>
        <pre class="req-text">{{ p.requirementText.slice(0, 1200) }}{{ p.requirementText.length > 1200 ? '\n…' : '' }}</pre>
      </div>

      <div v-if="hasSim" class="banner banner-sim" style="margin-top: 12px">
        本项目启用了 AI 模拟实践。模拟数据与段落都会标记「AI 模拟示例」，导出时保留标识，不得当作真实研究结果提交。
      </div>
    </section>

    <!-- 报告编辑器 -->
    <ReportEditor v-else-if="tab === 'proposal' && reportFor('proposal')" :report="reportFor('proposal')!" />
    <ReportEditor v-else-if="tab === 'midterm' && reportFor('midterm')" :report="reportFor('midterm')!" />
    <ReportEditor v-else-if="tab === 'final' && reportFor('final')" :report="reportFor('final')!" />
    <RecordList v-else-if="tab === 'records'" />
    <SourcePanel v-else-if="tab === 'sources'" />
    <MemberPanel v-else-if="tab === 'members'" />
    <ProjectSettings v-else-if="tab === 'settings'" />

    <!-- 项目推进面板 -->
    <div v-if="workflowOpen" class="drawer-scrim" @click.self="closeWorkflow()">
      <div class="wf-sheet">
        <WorkflowPanel
          :initial-scope="wfScope"
          @close="closeWorkflow()"
          @goto="onGoto"
        />
      </div>
    </div>

  </div>
</template>

<style scoped>
.page { padding: 0 0 40px; }
.loading-page { padding: var(--sp-4); }
.phead { display: flex; align-items: flex-start; gap: var(--sp-3); padding: var(--sp-4) var(--sp-5) var(--sp-3); }
.phead .grow { min-width: 0; }
.back {
  width: 36px; height: 36px; flex: 0 0 36px;
  border-radius: 50%; border: none;
  background: var(--surface-2); color: var(--text); cursor: pointer;
  transition: background var(--dur-2) var(--ease-out);
}
.back:hover { background: var(--surface-3); }
.ptitle { font-size: var(--fs-4); letter-spacing: -0.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pmeta { display: flex; align-items: center; gap: 7px; margin-top: 6px; font-size: 11.5px; color: var(--text-3); flex-wrap: wrap; }
.pmeta i { width: 3px; height: 3px; border-radius: 50%; background: var(--text-3); opacity: 0.5; }

/* 四大报告状态条 */
.status-strip {
  display: flex; align-items: center; gap: var(--sp-2);
  padding: 0 var(--sp-5) var(--sp-3);
  overflow-x: auto;
  scrollbar-width: none;
}
.status-strip::-webkit-scrollbar { display: none; }
.st {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 var(--sp-3);
  border-radius: var(--r-full);
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.st:hover { border-color: var(--line-strong); }
.st.on { border-color: var(--text); color: var(--text); }
.st-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 6px; background: var(--line-strong); }
.st-name { color: inherit; }
.st-val { font-size: 11px; opacity: 0.78; }
.st.s-draft .st-dot { background: var(--warn); }
.st.s-review .st-dot { background: var(--primary); }
.st.s-confirmed .st-dot { background: var(--ok); }
.st.s-confirmed { color: var(--ok); }
.st-count { flex: 0 0 auto; padding-right: 2px; }

/* 导航 + 状态合成一条：胶囊选中，无边框 */
.tabs {
  display: flex; align-items: center; gap: var(--sp-3);
  padding: 0 var(--sp-5) var(--sp-3);
  position: sticky; top: 0; z-index: 3;
  background: var(--bg);
}
.tabs-track {
  display: flex; gap: 2px; flex: 1 1 auto; min-width: 0;
  overflow-x: auto; scrollbar-width: none;
  padding: 3px; border-radius: var(--r-full);
  background: var(--surface-2);
}
.tabs-track::-webkit-scrollbar { display: none; }
.tab-btn {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 13px;
  border: none; border-radius: var(--r-full);
  background: transparent; cursor: pointer;
  color: var(--text-3); font-size: var(--fs-2); font-weight: var(--fw-medium);
  white-space: nowrap;
  transition: color var(--dur-2) var(--ease-out), background var(--dur-2) var(--ease-out);
}
.tab-btn:hover { color: var(--text-2); }
.tab-btn.on {
  color: var(--text);
  background: var(--surface);
  box-shadow: var(--shadow-1);
}
.tab-dot { width: 5px; height: 5px; border-radius: 50%; flex: 0 0 5px; background: var(--line-strong); }
.tab-dot.s-draft { background: var(--warn); }
.tab-dot.s-review { background: var(--primary); }
.tab-dot.s-confirmed { background: var(--ok); }
.tabs-count { flex: 0 0 auto; font-size: 11.5px; color: var(--text-3); }
.tabs-count b { color: var(--text); font-weight: var(--fw-strong); }

.pane { padding: var(--sp-4) var(--sp-5) var(--sp-10); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
.card-label { font-size: var(--fs-1); color: var(--text-3); font-weight: var(--fw-strong); margin-bottom: var(--sp-3); letter-spacing: 0.02em; }
.kv { display: flex; gap: var(--sp-3); padding: 8px 0; border-bottom: 1px solid var(--line); font-size: var(--fs-2); }
.kv:last-child { border-bottom: none; }
.kv span { color: var(--text-3); width: 76px; flex: 0 0 76px; }
.kv b { font-weight: var(--fw-strong); }

.wf-sheet {
  width: min(780px, 100%); align-self: stretch; min-height: 0;
  background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-4);
  box-shadow: var(--shadow-3); overflow: hidden;
  animation: slide var(--dur-4) var(--ease-out);
}
.todo { display: flex; align-items: center; gap: var(--sp-2); padding: 10px 0; border-bottom: 1px solid var(--line); cursor: pointer; }
.todo:last-child { border-bottom: none; }
.todo:hover .todo-t { color: var(--primary); }
.todo-t { font-size: var(--fs-2); font-weight: var(--fw-strong); transition: color var(--dur-2) var(--ease-out); }
.todo-d { font-size: 11.5px; color: var(--text-3); margin-top: 2px; }
.arrow { color: var(--text-3); font-size: 18px; }

/* 四份材料 */
.rpt-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--sp-2); }
.rpt-tile {
  display: flex; flex-direction: column; gap: 3px;
  padding: var(--sp-3); text-align: left;
  border-radius: var(--r-2); border: none;
  background: var(--surface-2); cursor: pointer;
  transition: border-color var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.rpt-tile:hover { background: var(--surface-3); transform: translateY(-1px); }
.rpt-tile-name { font-size: 11.5px; color: var(--text-3); }
.rpt-tile-val { font-size: var(--fs-2); font-weight: var(--fw-strong); }
.rpt-tile-meta { font-size: 10.5px; color: var(--text-3); }
.rpt-tile.s-draft .rpt-tile-val { color: var(--warn); }
.rpt-tile.s-review .rpt-tile-val { color: var(--primary); }
.rpt-tile.s-confirmed .rpt-tile-val { color: var(--ok); }

.req-text {
  font-family: var(--font-mono); font-size: 11.5px; color: var(--text-2);
  white-space: pre-wrap; word-break: break-word; margin: 0;
  line-height: 1.7; max-height: 220px; overflow-y: auto;
}

/* 导出 */
.exp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2); }
.exp {
  text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 4px;
  padding: var(--sp-3); border-radius: var(--r-2); border: none;
  background: var(--surface-2);
  transition: background var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.exp:hover { background: var(--surface-3); transform: translateY(-1px); }
.exp b { font-size: var(--fs-2); }
.exp span { font-size: 11.5px; color: var(--text-3); }

/* 折叠面板：Grid 0fr → 1fr，不写 JS 量高 */
.fold { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--dur-3) var(--ease-out); }
.fold.open { grid-template-rows: 1fr; }
.fold-in { overflow: hidden; min-height: 0; }

.zip-box { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 2px 2px; font-size: 12.5px; }
.zip-pick { display: inline-flex; align-items: center; gap: 5px; color: var(--text-2); cursor: pointer; }
.zip-pick input { accent-color: var(--primary); }
.zip-select {
  border: none; border-radius: var(--r-1);
  background: var(--surface-2); color: var(--text);
  font: inherit; font-size: 12.5px; padding: 5px 8px;
}

.check-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.check-list li { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 1.65; }
.check-list b {
  flex: 0 0 auto; font-size: 10.5px; font-weight: var(--fw-medium);
  padding: 1px 6px; border-radius: var(--r-full);
}
.check-list li.block b { background: rgba(192, 57, 43, 0.12); color: var(--danger, #c0392b); }
.check-list li.warn b { background: var(--surface-3); color: var(--text-3); }
.check-list span { flex: 1; color: var(--text-2); }

/* 抽屉 */
.run-steps {
  list-style: none; margin: 0 0 14px; padding: 10px 12px;
  border-radius: var(--r-2); background: var(--surface-2);
  display: flex; flex-direction: column; gap: 7px; font-size: 12px;
}
.run-steps li { display: flex; align-items: center; gap: 8px; color: var(--text-3); }
.rs-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--line-strong); flex: 0 0 7px; }
.run-steps li.running { color: var(--text); }
.run-steps li.running .rs-dot { background: var(--primary); animation: pulse 1s infinite ease-in-out; }
.run-steps li.done .rs-dot { background: var(--ok); }
.run-steps li.failed .rs-dot { background: var(--danger); }
.rs-label { flex: 1; min-width: 0; }
.rs-note { font-size: 11px; opacity: 0.8; }

.drawer-scrim {
  position: fixed; inset: 0; z-index: 60;
  background: rgba(12, 13, 16, 0.46);
  display: flex; justify-content: flex-end;
  /* 状态栏下不能再盖内容：上下都按实测安全区留白 */
  padding: calc(var(--safe-top, env(safe-area-inset-top, 0px)) + 8px) 8px
    calc(var(--safe-bottom, env(safe-area-inset-bottom, 0px)) + 8px);
  box-sizing: border-box;
  animation: scrim var(--dur-2) var(--ease-out);
}
.drawer {
  width: min(560px, 100%); height: 100%;
  display: flex; flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--line); border-radius: var(--r-4);
  box-shadow: var(--shadow-3);
  animation: slide var(--dur-4) var(--ease-out);
}
@keyframes scrim { from { opacity: 0; } to { opacity: 1; } }
@keyframes slide { from { transform: translateX(20px); opacity: 0; } to { transform: none; opacity: 1; } }
.drawer-head { display: flex; gap: var(--sp-3); align-items: flex-start; padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--line); }
.x { background: none; border: none; color: var(--text-3); font-size: 22px; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; }
.x:hover { background: var(--surface-2); color: var(--text); }
.drawer-body { flex: 1; overflow-y: auto; padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2); }
.empty { color: var(--text-3); font-size: var(--fs-2); }
.msg { display: flex; }
.msg.user { justify-content: flex-end; }
.msg-body {
  padding: 10px 14px; border-radius: var(--r-2); font-size: var(--fs-2); line-height: 1.75;
  background: var(--surface-2); max-width: 88%; white-space: pre-wrap; word-break: break-word;
}
.msg.user .msg-body { background: var(--primary-soft); }
.drawer-foot { display: flex; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4); border-top: 1px solid var(--line); }

@media (max-width: 860px) {
  .phead { padding: var(--sp-3) var(--sp-4) var(--sp-2); }
  .tabs { padding: 0 var(--sp-4) var(--sp-2); }
  .pane { padding: var(--sp-3) var(--sp-4) 88px; }
  .grid { grid-template-columns: 1fr; }
  .rpt-grid { grid-template-columns: 1fr 1fr; }
  .exp-grid { grid-template-columns: 1fr; }
  .phead .btn { flex: 0 0 auto; }
}
</style>
