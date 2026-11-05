<script setup lang="ts">
/**
 * 项目推进面板
 *
 * 普通用户只看三件事：现在在哪一步、下一步做什么、要不要我确认。
 * 「实时过程」按步骤分组：进行中一条条点亮，跑完的收进「已完成 N 个步骤」。
 * 步骤细节（模型、调用次数、费用、警告）折叠在后面，不挡路。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useWorkflowStore } from '../../workflow/runner';
import { useProjectStore } from '../../stores/projects';
import { useAppStore } from '../../stores/app';
import { SCOPES } from './scopes';
import type { WorkflowActivity, WorkflowScope, WorkflowStepStatus } from '../../core/types';
import MarkdownText from '../MarkdownText.vue';
import { askConfirm } from '../../core/task-guard';

const props = defineProps<{ initialScope?: WorkflowScope }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'goto', tab: 'sources' | 'records' | 'members'): void }>();

const wf = useWorkflowStore();
const store = useProjectStore();
const app = useAppStore();

const scope = ref<WorkflowScope>(props.initialScope ?? 'project');
const expanded = ref<string | null>(null);

onMounted(async () => {
  if (store.current) await wf.restore(store.current.id);
});

watch(
  () => store.current?.id,
  async (id) => {
    if (id) await wf.restore(id);
  },
);

const run = computed(() => wf.run);
const active = computed(() => !!run.value && ['running', 'paused', 'awaiting'].includes(run.value.status));

const STATUS_LABEL: Record<WorkflowStepStatus, string> = {
  pending: '等待',
  running: '进行中',
  awaiting: '等你确认',
  done: '完成',
  skipped: '已跳过',
  failed: '失败',
};

function canRun(s: { status: WorkflowStepStatus }) {
  return s.status === 'pending' || s.status === 'failed';
}

/** 这一步花了多久：只显示有意义的位数 */
function dur(s: { startedAt?: number; endedAt?: number }): string {
  if (!s.startedAt || !s.endedAt) return '';
  const ms = s.endedAt - s.startedAt;
  if (ms < 1000) return '<1s';
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

function dotClass(s: { status: WorkflowStepStatus }) {
  return `dot-${s.status}`;
}

const awaitingStep = computed(() => run.value?.steps.find((s) => s.status === 'awaiting'));
const currentStep = computed(() => {
  const r = run.value;
  return r ? r.steps[r.current] : undefined;
});

/* --------------------------- 实时过程 --------------------------- */

/** 一秒一跳：让「当前这一步已用多久」真的在走 */
const now = ref(Date.now());
let tick: number | undefined;
onMounted(() => {
  tick = window.setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => window.clearInterval(tick));

const currentElapsed = computed(() => {
  const s = currentStep.value;
  return s?.startedAt && !s.endedAt ? Math.max(0, Math.round((now.value - s.startedAt) / 1000)) : 0;
});

interface LiveGroup {
  key: string;
  title: string;
  note: string;
  current: boolean;
  items: WorkflowActivity[];
}

/** 按步骤分组：当前步骤叫「进行中」，跑过的叫「已完成 N 个步骤」 */
const liveGroups = computed<LiveGroup[]>(() => {
  const r = run.value;
  if (!r) return [];
  const acts = r.activities ?? [];
  const buckets = new Map<string, WorkflowActivity[]>();
  for (const a of acts) {
    const list = buckets.get(a.stepId) ?? [];
    list.push(a);
    buckets.set(a.stepId, list);
  }
  const curId = currentStep.value?.id;
  const stillRunning = ['running', 'awaiting', 'paused'].includes(r.status);
  const nameOf = (id: string) => r.steps.find((x) => x.id === id)?.name ?? '过程';
  return [...buckets.entries()].map(([key, items]) => {
    const current = stillRunning && key === curId;
    // 同一标签重复出现（重试、回退后重跑）只留最后一条，避免堆成一串同名行
    const lastAt = new Map<string, number>();
    items.forEach((a, i) => lastAt.set(`${a.label}|${a.status}`, i));
    const dedup = items.filter((a, i) => lastAt.get(`${a.label}|${a.status}`) === i);
    const done = dedup.filter((a) => a.status === 'done').length;
    const all = dedup.length;
    return {
      key,
      items: dedup,
      current,
      title: `${current ? '进行中 · ' : ''}${nameOf(key)}`,
      note: all > done ? `${done}/${all} 条完成` : `${all} 条过程`,
    };
  });
});

const collapsed = ref<Record<string, boolean>>({});
function toggleGroup(key: string) {
  collapsed.value = { ...collapsed.value, [key]: !collapsed.value[key] };
}

/** 底部状态行：把「AI 现在在做什么」说成人话 */
const nowText = computed(() => {
  const r = run.value;
  if (!r) return '';
  if (r.status === 'awaiting') return '等你确认后再往下走';
  if (r.status === 'paused') return '已暂停，点「继续」接着跑';
  if (r.status === 'done') return '全部完成，提交前请再读一遍';
  if (r.status === 'failed') return '已停止，可以看失败原因';
  if (r.status === 'cancelled') return '已取消';
  const s = currentStep.value;
  if (!s) return '正在整理答案';
  if (s.id === 'search') return '正在检索并筛选资料';
  if (s.report) return `正在逐节整理答案 · ${s.name}`;
  return `正在整理答案 · ${s.name}`;
});

/* --------------------------- 确认门 --------------------------- */

async function startRun() {
  await wf.start(scope.value);
}

/** 回退：删掉这一步及之后所有步骤的产物，说清删什么再动手 */
async function rollbackTo(i: number) {
  const r = run.value;
  const s = r?.steps[i];
  if (!r || !s) return;
  const later = r.steps.length - i;
  const kinds = new Set(
    r.steps
      .slice(i)
      .map((x) => x.report)
      .filter(Boolean) as string[],
  );
  const terms = new Set(
    r.steps
      .slice(i)
      .filter((x) => x.id.startsWith('records-draft'))
      .map((x) => (x.id.endsWith('t2') ? '下学期' : '上学期')),
  );
  const what = [
    kinds.size ? `${[...kinds].map((k) => ({ proposal: '开题', midterm: '中期', final: '结题' }[k] ?? k)).join('、')}报告的正文` : '',
    terms.size ? `${[...terms].join('、')}的过程记录草稿` : '',
  ].filter(Boolean);

  const ok = await askConfirm({
    title: `回退到第 ${i + 1} 步「${s.name}」`,
    message:
      `第 ${i + 1} 步到第 ${r.steps.length} 步（共 ${later} 步）都会回到「等待」，` +
      (what.length ? `同时删除${what.join('和')}。` : '这一步没有可删的文件产物。') +
      '\n删除不可恢复；已确认的报告也会退回「未开始」，需要重新生成或自己补写。',
    confirmText: '删除产物并回退',
    cancelText: '不回退',
    tone: 'warn',
  });
  if (!ok) return;
  await wf.rollback(i);
}

async function confirmCurrent() {
  const s = awaitingStep.value;
  if (!s) return;
  if (s.kind === 'manual' && s.id === 'export') {
    await wf.exportFinal();
    return;
  }
  await wf.confirmStep(s.id);
  // 确认来源后直接把人送到来源页，省得自己找
  if (s.id === 'confirm-sources') emit('goto', 'sources');
}

/** 上一步的产出：重新生成与改写都针对它 */
const editTarget = computed(() => {
  const r = run.value;
  if (!r) return undefined;
  const i = r.steps.findIndex((s) => s.status === 'awaiting');
  if (i < 1) return undefined;
  return r.steps
    .slice(0, i)
    .reverse()
    .find((s) => s.output && ['done', 'skipped'].includes(s.status));
});

const regenerating = ref(false);
async function regenerate() {
  if (regenerating.value) return;
  regenerating.value = true;
  try {
    await wf.regenerateStep();
  } finally {
    regenerating.value = false;
  }
}

const editing = ref(false);
const editText = ref('');
/** 默认只读预览上一步产出（Markdown），点「修改内容」才进编辑 */
const previewText = computed(() => editTarget.value?.output?.trim() ?? '');
function openEditor() {
  const t = editTarget.value;
  if (!t) {
    app.toast('前面还没有可以修改的内容', 'warn');
    return;
  }
  editText.value = t.output ?? '';
  editing.value = true;
}
async function saveAndConfirm() {
  const t = editTarget.value;
  if (!t) return;
  await wf.editStepOutput(t.id, editText.value);
  editing.value = false;
  await confirmCurrent();
}

const costText = computed(() => {
  const r = run.value;
  if (!r) return '';
  const limit = r.maxCost > 0 ? ` / ¥${r.maxCost}` : '';
  return `¥${r.cost.toFixed(3)}${limit}`;
});

const pct = computed(() => wf.progress);
</script>

<template>
  <div class="wf">
    <header class="head">
      <div class="grow">
        <div class="eyebrow">项目推进</div>
        <h2>从分析课题到导出 DOCX</h2>
        <p class="sub">每一步都先给结论再动手。要你确认的地方会停下来，不会自己往下走。</p>
      </div>
      <button class="x" aria-label="关闭" @click="emit('close')">×</button>
    </header>

    <div class="body">
      <!-- 没开始：选范围 -->
      <section v-if="!run" class="scopes">
        <button
          v-for="s in SCOPES"
          :key="s.key"
          class="scope"
          :class="{ on: scope === s.key }"
          type="button"
          @click="scope = s.key"
        >
          <b>{{ s.label }}</b>
          <span>{{ s.note }}</span>
        </button>
        <button class="btn btn-primary start" type="button" @click="startRun">开始推进</button>
        <p class="hint">
          推进过程中调用模型会产生费用。本次最多调用
          <b>{{ app.settings.budget.maxCallsPerTask || 12 }}</b> 次，超出即停，不会偷偷继续。
          预算上限在 设置 → 模型与检索 里改。
        </p>
      </section>

      <!-- 有运行记录 -->
      <template v-else>
        <div class="summary card">
          <div class="sum-top">
            <div class="grow">
              <div class="sum-title">
                {{ SCOPES.find((s) => s.key === run!.scope)?.label }}
                <span class="state" :class="`state-${run!.status}`">{{ {
                  idle: '未开始', running: '进行中', paused: '已暂停', awaiting: '等你确认',
                  done: '已完成', failed: '已停止', cancelled: '已取消',
                }[run!.status] }}</span>
              </div>
              <div class="sum-meta">
                {{ run!.steps.filter((s) => s.status === 'done').length }}/{{ run!.steps.length }} 步 ·
                调用 {{ run!.calls }}/{{ run!.maxCalls }} 次 · {{ costText }}
              </div>
              <!-- 当前这一步叫什么、已经跑了多久：不再只给一个百分比 -->
              <div v-if="currentStep && active" class="sum-now">
                <span class="now-dot" />
                第 {{ run!.current + 1 }} 步 · {{ currentStep.name }} · {{ nowText }}
                <span v-if="currentElapsed" class="mono">已用 {{ currentElapsed }}s</span>
              </div>
            </div>
            <div class="sum-pct">{{ pct }}%</div>
          </div>
          <div class="bar"><i :style="{ width: `${pct}%` }" /></div>
          <p v-if="run!.message" class="msg" :class="{ err: run!.status === 'failed' }">{{ run!.message }}</p>

          <div class="actions">
            <button v-if="run!.status === 'running'" class="btn btn-sm" type="button" @click="wf.pause()">暂停</button>
            <button v-if="run!.status === 'paused'" class="btn btn-sm btn-primary" type="button" @click="wf.resume()">继续</button>
            <button v-if="run!.status === 'failed'" class="btn btn-sm btn-primary" type="button" @click="wf.retry()">重试失败步骤</button>
            <button v-if="active" class="btn btn-sm" type="button" @click="wf.cancel()">取消</button>
            <button v-if="!active" class="btn btn-sm" type="button" @click="wf.reset()">重新开始</button>
          </div>
        </div>

        <!-- 实时过程：跑一步亮一行，跑完收进分组 -->
        <section v-if="liveGroups.length" class="live">
          <div v-for="g in liveGroups" :key="g.key" class="live-group" :class="{ cur: g.current }">
            <button class="live-head" type="button" @click="toggleGroup(g.key)">
              <span class="live-spark" :class="{ spinning: g.current }">✳</span>
              <b>{{ g.title }}</b>
              <span class="live-note">{{ g.note }}</span>
              <span class="live-chev" :class="{ shut: collapsed[g.key] }">⌄</span>
            </button>
            <div class="live-fold" :class="{ open: !collapsed[g.key] }">
              <div class="live-inner">
                <div v-for="a in g.items" :key="a.id" class="live-row" :class="a.status">
                  <span class="lr-mark">{{ a.status === 'done' ? '✓' : a.status === 'failed' ? '!' : '•' }}</span>
                  <span class="lr-label">{{ a.label }}</span>
                  <span v-if="a.detail" class="lr-detail">{{ a.detail }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="live-now"><span class="now-dot" />{{ nowText }}</div>
        </section>

        <!-- 待确认条：重新生成 / 改写 / 确认，三条路都给 -->
        <div v-if="awaitingStep" class="await card">
          <div class="grow">
            <div class="await-t">需要你确认：{{ awaitingStep.name }}</div>
            <p class="await-d">
              {{ awaitingStep.kind === 'manual' ? '这一步要你自己动手' : '看完上面的结果再决定，不确认不会继续' }}
            </p>
          </div>
          <div class="await-actions">
            <button v-if="awaitingStep.id === 'confirm-sources'" class="btn btn-sm" type="button" @click="emit('goto', 'sources')">
              去来源页
            </button>
            <template v-if="awaitingStep.id !== 'export' && editTarget">
              <button class="btn btn-sm" type="button" :disabled="regenerating" @click="regenerate">
                {{ regenerating ? '重新生成中…' : '重新生成' }}
              </button>
              <button class="btn btn-sm" type="button" @click="openEditor">修改内容</button>
            </template>
            <button class="btn btn-sm btn-primary" type="button" @click="confirmCurrent()">
              {{ awaitingStep.id === 'export' ? '导出 DOCX' : '确认并继续' }}
            </button>
          </div>

          <!-- 默认把上一步产出读出来：只有点「修改内容」才进入编辑 -->
          <div v-if="!editing && previewText" class="await-preview">
            <div class="await-preview-head">
              <span>上一步产出 · {{ editTarget?.name }}</span>
              <span class="muted small">只读，点「修改内容」才能改</span>
            </div>
            <div class="await-preview-body">
              <MarkdownText :text="previewText" />
            </div>
          </div>

          <div v-if="editing" class="edit-area">
            <p class="edit-hint">
              改的是「{{ editTarget?.name }}」的产出。保存后按你的版本继续，AI 不会替你核实改动。
            </p>
            <textarea v-model="editText" class="textarea" rows="8" />
            <div v-if="editText.trim()" class="edit-preview">
              <div class="edit-preview-label">预览</div>
              <MarkdownText :text="editText" />
            </div>
            <div class="edit-actions">
              <button class="btn btn-sm" type="button" @click="editing = false">取消</button>
              <button class="btn btn-sm btn-primary" type="button" @click="saveAndConfirm">改完并确认</button>
            </div>
          </div>
        </div>

        <!-- 时间线 -->
        <ol class="steps">
          <li
            v-for="(s, i) in run!.steps"
            :key="s.id"
            class="step"
            :class="[dotClass(s), { cur: i === run!.current, open: expanded === s.id }]"
          >
            <button class="step-head" type="button" @click="expanded = expanded === s.id ? null : s.id">
              <span class="idx">{{ i + 1 }}</span>
              <span class="grow">
                <span class="name">{{ s.name }}</span>
                <span class="tag">{{ STATUS_LABEL[s.status] }}</span>
                <span v-if="s.calls" class="tag mono">{{ s.calls }} 次调用</span>
                <span v-if="s.edited" class="tag">你改过</span>
              </span>
              <span class="chev">›</span>
            </button>
            <div v-if="expanded === s.id" class="step-body">
              <div class="meta-line">
                <span v-if="dur(s)">耗时 {{ dur(s) }}</span>
                <span v-if="s.calls">调用 {{ s.calls }} 次</span>
                <span v-if="s.hits">命中 {{ s.hits }} 条</span>
                <span v-if="s.cost">约 ¥{{ s.cost.toFixed(3) }}</span>
                <span v-if="s.kind === 'gate'">需要你确认</span>
              </div>

              <div v-if="s.output" class="out-md">
                <MarkdownText :text="s.output" />
              </div>
              <p v-else-if="s.status === 'running'" class="muted small">正在处理…</p>
              <p v-else-if="s.status === 'pending'" class="muted small">还没开始。前面的步骤完成后才会轮到它。</p>
              <p v-else-if="s.kind === 'gate'" class="muted small">这一步是确认门，不产出文字：你点了确认才会往下走。</p>

              <p v-if="s.error" class="err-line">{{ s.error }}</p>
              <ul v-if="s.warnings?.length" class="warns">
                <li v-for="(w, k) in s.warnings" :key="k">{{ w }}</li>
              </ul>
              <div class="step-actions">
                <button v-if="canRun(s) && !active" class="btn btn-sm" type="button" @click="wf.retry(i)">只重跑这一步</button>
                <button
                  v-if="s.status !== 'pending' && !active"
                  class="btn btn-sm"
                  type="button"
                  @click="rollbackTo(i)"
                >
                  回退到这一步
                </button>
                <button v-if="s.id === 'confirm-sources'" class="btn btn-sm" type="button" @click="emit('goto', 'sources')">去来源页确认</button>
                <button v-if="s.id === 'records-guard'" class="btn btn-sm" type="button" @click="emit('goto', 'records')">去写研究记录</button>
                <button v-if="s.id === 'assign'" class="btn btn-sm" type="button" @click="emit('goto', 'members')">去分工</button>
              </div>
            </div>
          </li>
        </ol>

        <p class="note">
          工作流只负责顺序与边界，不替你做决定：确认门要你点，真实记录要你填，导出前要你自己读一遍。
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wf { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.head { display: flex; gap: var(--sp-3); align-items: flex-start; padding: var(--sp-5) var(--sp-5) var(--sp-3); }
.head h2 { font-size: var(--fs-4); letter-spacing: -0.02em; margin: 2px 0 4px; }
.eyebrow { font-size: 11px; color: var(--text-3); letter-spacing: 0.08em; text-transform: uppercase; }
.sub { font-size: var(--fs-2); color: var(--text-2); line-height: 1.7; max-width: 60ch; }
.x { width: 32px; height: 32px; border-radius: 50%; border: none; background: var(--surface-2); color: var(--text-2); font-size: 20px; cursor: pointer; flex: 0 0 32px; }
.x:hover { background: var(--surface-3); color: var(--text); }

.body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 var(--sp-5) var(--sp-8); }

.scopes { display: flex; flex-direction: column; gap: var(--sp-2); margin-top: var(--sp-2); }
.scope {
  display: flex; flex-direction: column; gap: 4px; text-align: left;
  padding: var(--sp-3) var(--sp-4); border-radius: var(--r-3);
  border: 1px solid var(--line); background: var(--surface); cursor: pointer;
  transition: border-color var(--dur-2) var(--ease-out), background var(--dur-2) var(--ease-out);
}
.scope b { font-size: var(--fs-2); font-weight: var(--fw-strong); }
.scope span { font-size: 11.5px; color: var(--text-3); line-height: 1.6; }
.scope:hover { border-color: var(--line-strong); }
.scope.on { border-color: var(--primary); background: var(--primary-soft); }
.start { margin-top: var(--sp-3); align-self: flex-start; }
.hint { margin: var(--sp-3) 0 0; font-size: 11.5px; color: var(--text-3); line-height: 1.7; }
.hint b { color: var(--text-2); }

.summary { padding: var(--sp-4); margin-bottom: var(--sp-3); }
.sum-top { display: flex; align-items: flex-start; gap: var(--sp-3); }
.sum-title { font-size: var(--fs-2); font-weight: var(--fw-strong); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sum-meta { margin-top: 4px; font-size: 11.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.sum-now {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-top: 8px; font-size: 11.5px; color: var(--text-2);
}
.sum-now .mono { color: var(--text-3); font-variant-numeric: tabular-nums; }
.now-dot {
  width: 6px; height: 6px; border-radius: 50%; flex: 0 0 6px;
  background: var(--primary); animation: pulse 1.2s infinite ease-in-out;
}
.sum-pct { font-size: var(--fs-4); font-weight: var(--fw-strong); font-variant-numeric: tabular-nums; }
.state { font-size: 10.5px; padding: 2px 8px; border-radius: var(--r-full); background: var(--surface-2); color: var(--text-2); font-weight: var(--fw-medium); }
.state-running { background: var(--primary-soft); color: var(--primary); }
.state-awaiting { background: var(--warn-soft, rgba(214, 158, 46, 0.14)); color: var(--warn); }
.state-done { background: var(--ok-soft, rgba(46, 125, 50, 0.14)); color: var(--ok); }
.state-failed { background: var(--danger-soft, rgba(198, 40, 40, 0.12)); color: var(--danger); }
.bar { height: 4px; border-radius: 2px; background: var(--surface-2); overflow: hidden; margin: var(--sp-3) 0 0; }
.bar i { display: block; height: 100%; background: var(--primary); transition: width var(--dur-3) var(--ease-out); }
.msg { margin: var(--sp-3) 0 0; font-size: 11.5px; color: var(--text-2); line-height: 1.7; }
.msg.err { color: var(--danger); }
.actions { display: flex; gap: var(--sp-2); margin-top: var(--sp-3); flex-wrap: wrap; }

/* 实时过程：分组标题 + 一行一个动作，折叠用 Grid 0fr→1fr */
.live { margin-bottom: var(--sp-3); display: flex; flex-direction: column; gap: 6px; }
.live-group { border-radius: var(--r-2); background: var(--surface); }
.live-group.cur { background: var(--surface-2); }
.live-head {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 9px 12px; border: none; background: none; color: var(--text-2);
  font: inherit; font-size: 12px; cursor: pointer; text-align: left;
}
.live-head b { font-weight: var(--fw-medium); }
.live-spark { color: var(--text-3); font-size: 13px; line-height: 1; }
.live-spark.spinning { color: var(--primary); animation: spin 3.2s linear infinite; }
.live-note { font-size: 11px; color: var(--text-3); margin-left: 6px; font-variant-numeric: tabular-nums; }
.live-chev { margin-left: auto; color: var(--text-3); transition: transform 240ms var(--ease-out); }
.live-chev.shut { transform: rotate(-90deg); }
.live-fold { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 260ms var(--ease-out); }
.live-fold.open { grid-template-rows: 1fr; }
.live-inner { overflow: hidden; min-height: 0; padding: 0 12px; }
.live-fold.open .live-inner { padding-bottom: 10px; }
.live-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; margin-top: 4px;
  border-radius: var(--r-2); background: var(--surface-2);
  font-size: 11.5px; color: var(--text-2);
}
.live-group.cur .live-row { background: var(--surface); }
.lr-mark {
  width: 16px; height: 16px; flex: 0 0 16px; border-radius: 50%;
  display: grid; place-items: center; font-size: 10px;
  background: var(--surface-3); color: var(--text-3);
}
.live-row.done .lr-mark { background: var(--ok); color: #fff; }
.live-row.failed .lr-mark { background: var(--danger); color: #fff; }
.live-row.running .lr-mark { background: var(--primary-soft); color: var(--primary); }
.lr-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lr-detail { margin-left: auto; flex: 0 0 auto; font-size: 10.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.live-now {
  display: flex; align-items: center; gap: 7px;
  padding: 2px 4px; font-size: 11.5px; color: var(--text-3);
}
@keyframes spin { to { transform: rotate(360deg); } }

.await { display: flex; gap: var(--sp-3); align-items: center; padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-3); border-color: var(--primary); flex-wrap: wrap; }
.await-t { font-size: var(--fs-2); font-weight: var(--fw-strong); }
.await-d { font-size: 11.5px; color: var(--text-3); margin-top: 2px; }
.await-actions { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
.await-preview { width: 100%; margin-top: var(--sp-2); }
.await-preview-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  margin-bottom: 6px; font-size: 11.5px; color: var(--text-3);
}
.await-preview-body {
  padding: 10px 12px; border-radius: var(--r-2);
  background: var(--surface-2);
  font-size: 12.5px; line-height: 1.8;
  max-height: 300px; overflow-y: auto;
}
.edit-area { width: 100%; margin-top: var(--sp-2); }
.edit-preview {
  margin-top: 10px; padding: 10px 12px;
  border-radius: var(--r-2); background: var(--surface-2);
  font-size: 12.5px; line-height: 1.8;
  max-height: 260px; overflow-y: auto;
}
.edit-preview-label {
  margin-bottom: 6px; font-size: 10.5px; color: var(--text-3);
  letter-spacing: 0.04em;
}
.edit-hint { margin: 0 0 8px; font-size: 11.5px; line-height: 1.7; color: var(--text-3); }
.edit-area .textarea { width: 100%; min-height: 160px; resize: vertical; box-sizing: border-box; }
.edit-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }

.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.step { border-radius: var(--r-2); }
.step.cur { background: var(--surface-2); }
.step-head { display: flex; align-items: center; gap: var(--sp-3); width: 100%; padding: 10px var(--sp-3); border: none; background: none; cursor: pointer; text-align: left; border-radius: var(--r-2); }
.step-head:hover { background: var(--surface-2); }
.idx {
  width: 22px; height: 22px; flex: 0 0 22px; border-radius: 50%;
  display: grid; place-items: center; font-size: 10.5px; font-variant-numeric: tabular-nums;
  background: var(--surface-3); color: var(--text-2);
}
.dot-done .idx { background: var(--ok); color: #fff; }
.dot-running .idx { background: var(--primary); color: #fff; }
.dot-awaiting .idx { background: var(--warn); color: #fff; }
.dot-failed .idx { background: var(--danger); color: #fff; }
.name { font-size: var(--fs-2); font-weight: var(--fw-medium); }
.tag { font-size: 10.5px; color: var(--text-3); margin-left: 8px; }
.tag.mono { font-variant-numeric: tabular-nums; }
.chev { color: var(--text-3); font-size: 16px; }
.step.open .chev { transform: rotate(90deg); }
.step-body { padding: 0 var(--sp-3) var(--sp-3) 44px; }
.meta-line {
  display: flex; flex-wrap: wrap; gap: 10px;
  margin-bottom: 8px;
  font-size: 11px; color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.out-md {
  padding: 10px 12px;
  border-radius: var(--r-2);
  background: var(--surface-2);
  font-size: 12.5px; line-height: 1.8;
  max-height: 340px; overflow-y: auto;
}
.err-line { margin: 8px 0 0; font-size: 11.5px; color: var(--danger); line-height: 1.7; }
.warns { margin: 8px 0 0; padding-left: 18px; font-size: 11.5px; color: var(--warn); line-height: 1.7; }
.step-actions { display: flex; gap: var(--sp-2); margin-top: var(--sp-2); flex-wrap: wrap; }
.note { margin: var(--sp-4) 0 0; font-size: 11.5px; color: var(--text-3); line-height: 1.7; }

@keyframes pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
html[data-motion='off'] .live-spark.spinning,
html[data-motion='off'] .now-dot { animation: none; }

@media (max-width: 720px) {
  .head { padding: var(--sp-4) var(--sp-4) var(--sp-2); }
  .body { padding: 0 var(--sp-4) var(--sp-6); }
  .step-body { padding-left: var(--sp-3); }
}
</style>
