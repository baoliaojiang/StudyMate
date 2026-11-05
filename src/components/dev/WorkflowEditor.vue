<script setup lang="ts">
/**
 * 可视化工作流编辑器
 *
 * 泳道按阶段分组，步骤可以上下移动、停用、改超时/循环/预算。
 * 门（gate）与守卫（guard）不可删除——它们是用来拦住「没真实记录就写已完成」的。
 */
import { computed, onMounted, ref } from 'vue';
import type { WorkflowDef, WorkflowStepDef } from '../../core/types';
import { PHASE_LABEL, PHASE_ORDER, defaultWorkflow } from '../../workflow/graph';
import { useWorkflowStore } from '../../workflow/runner';
import { useAppStore } from '../../stores/app';
import { fmtTime } from '../../core/id';

const app = useAppStore();
const wf = useWorkflowStore();
const draft = ref<WorkflowDef>(defaultWorkflow());
const dirty = ref(false);
const saving = ref(false);

onMounted(async () => {
  await wf.loadDef();
  draft.value = JSON.parse(JSON.stringify(wf.def)) as WorkflowDef;
  dirty.value = false;
});

const byPhase = computed(() =>
  PHASE_ORDER.map((p) => ({
    phase: p,
    label: PHASE_LABEL[p],
    steps: draft.value.steps.filter((s) => s.phase === p),
  })).filter((g) => g.steps.length),
);

const agentCount = computed(() => draft.value.steps.filter((s) => s.kind === 'agent').length);
const gateCount = computed(() => draft.value.steps.filter((s) => s.kind === 'gate').length);
const enabledCount = computed(() => draft.value.steps.filter((s) => s.enabled).length);

function idxOf(s: WorkflowStepDef) {
  return draft.value.steps.findIndex((x) => x.id === s.id);
}

function move(s: WorkflowStepDef, delta: number) {
  const i = idxOf(s);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= draft.value.steps.length) return;
  const arr = draft.value.steps;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  dirty.value = true;
}

function toggle(s: WorkflowStepDef, v: boolean) {
  s.enabled = v;
  dirty.value = true;
}

function patch(s: WorkflowStepDef, key: 'timeoutMs' | 'maxLoops' | 'budgetYuan', raw: string) {
  const n = Number(raw);
  if (key === 'timeoutMs') s.timeoutMs = Math.max(10, Math.min(600, Math.round(n))) * 1000;
  else if (key === 'maxLoops') s.maxLoops = Math.max(1, Math.min(8, Math.round(n)));
  else s.budgetYuan = Math.max(0, Math.round(n * 100) / 100);
  dirty.value = true;
}

const KIND_LABEL: Record<WorkflowStepDef['kind'], string> = {
  agent: '模型',
  gate: '确认',
  guard: '守卫',
  manual: '手动',
};

async function save() {
  saving.value = true;
  try {
    await wf.saveDef(draft.value);
    dirty.value = false;
    app.toast('流程已保存，下次推进按新顺序执行', 'ok');
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '保存失败', 'error', 5000);
  } finally {
    saving.value = false;
  }
}

async function restore() {
  if (!confirm('丢弃本地改动，恢复内置流程？')) return;
  const d = await wf.resetDef();
  draft.value = JSON.parse(JSON.stringify(d)) as WorkflowDef;
  dirty.value = false;
  app.toast('已恢复内置流程', 'ok');
}
</script>

<template>
  <section>
    <div class="bar">
      <p class="lead">
        每一步按顺序执行。<b>确认（gate）</b>会停下来等人点；<b>守卫（guard）</b>条件不满足就停止推进——
        「没有真实活动记录不得生成已完成过程」就是靠它拦的，不能删。
      </p>
      <div class="acts">
        <span class="stat">{{ enabledCount }}/{{ draft.steps.length }} 步启用</span>
        <span class="stat">{{ agentCount }} 次模型 · {{ gateCount }} 道确认</span>
        <button class="btn btn-sm" type="button" @click="restore">恢复内置</button>
        <button class="btn btn-sm btn-primary" type="button" :disabled="saving || !dirty" @click="save">
          {{ dirty ? '保存改动' : '已是最新' }}
        </button>
      </div>
    </div>

    <div class="flow">
      <div v-for="g in byPhase" :key="g.phase" class="lane">
        <div class="lane-head">
          <span class="lane-name">{{ g.label }}</span>
          <span class="lane-line" />
        </div>
        <div class="nodes">
          <article
            v-for="s in g.steps"
            :key="s.id"
            class="node"
            :class="[`k-${s.kind}`, { off: !s.enabled }]"
          >
            <div class="node-head">
              <span class="kind">{{ KIND_LABEL[s.kind] }}</span>
              <b>{{ s.name }}</b>
              <span class="grow" />
              <button class="mini" type="button" :disabled="idxOf(s) === 0" @click="move(s, -1)">↑</button>
              <button
                class="mini"
                type="button"
                :disabled="idxOf(s) === draft.steps.length - 1"
                @click="move(s, 1)"
              >
                ↓
              </button>
            </div>
            <p class="desc">{{ s.desc }}</p>
            <p v-if="s.requires" class="req">{{ s.requires }}</p>

            <div class="node-foot">
              <label v-if="s.kind !== 'gate'" class="sw">
                <input
                  type="checkbox"
                  :checked="s.enabled"
                  @change="toggle(s, ($event.target as HTMLInputElement).checked)"
                />
                <span>启用</span>
              </label>
              <span class="grow" />
              <template v-if="s.kind === 'agent'">
                <label class="num">
                  超时
                  <input
                    class="n"
                    type="number"
                    min="10"
                    max="600"
                    :value="Math.round((s.timeoutMs ?? 120000) / 1000)"
                    @input="patch(s, 'timeoutMs', ($event.target as HTMLInputElement).value)"
                  />
                  s
                </label>
                <label class="num">
                  循环
                  <input
                    class="n"
                    type="number"
                    min="1"
                    max="8"
                    :value="s.maxLoops ?? 3"
                    @input="patch(s, 'maxLoops', ($event.target as HTMLInputElement).value)"
                  />
                </label>
                <label class="num">
                  预算
                  <input
                    class="n"
                    type="number"
                    min="0"
                    step="0.1"
                    :value="s.budgetYuan ?? 0"
                    @input="patch(s, 'budgetYuan', ($event.target as HTMLInputElement).value)"
                  />
                  元
                </label>
              </template>
            </div>
            <div class="node-meta">
              <span class="mono">{{ s.id }}</span>
              <span v-if="s.agentId">Agent：{{ s.agentId }}</span>
              <span v-if="s.report">报告：{{ s.report }}</span>
            </div>
          </article>
        </div>
      </div>
    </div>

    <p class="tail muted small">
      <template v-if="wf.def.updatedAt">
        已保存版本：{{ fmtTime(wf.def.updatedAt) }}
      </template>
      <template v-else>当前为内置流程，还没有本地改动</template>
    </p>
  </section>
</template>

<style scoped>
.bar { display: flex; gap: var(--sp-3); align-items: flex-start; flex-wrap: wrap; margin-bottom: var(--sp-3); }
.lead { flex: 1; min-width: 260px; margin: 0; font-size: var(--fs-1); color: var(--text-3); line-height: 1.7; }
.acts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.stat { font-size: 10.5px; color: var(--text-3); padding: 3px 8px; border-radius: var(--r-full); background: var(--surface-2); }
.flow { display: flex; flex-direction: column; gap: var(--sp-4); }
.lane-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.lane-name { font-size: 11px; font-weight: var(--fw-strong); color: var(--text-3); letter-spacing: 0.04em; white-space: nowrap; }
.lane-line { flex: 1; height: 1px; background: var(--line); }
.nodes { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }

.node {
  padding: 10px 12px; border-radius: var(--r-2); border: 1px solid var(--line);
  background: var(--surface); display: flex; flex-direction: column; gap: 5px;
}
.node.off { opacity: 0.5; }
.node.k-gate { border-left: 3px solid var(--primary); }
.node.k-guard { border-left: 3px solid var(--warn, #b26a00); }
.node.k-manual { border-left: 3px dashed var(--text-3); }
.node-head { display: flex; align-items: center; gap: 7px; }
.kind {
  font-size: 9.5px; padding: 1px 6px; border-radius: var(--r-full);
  background: var(--surface-2); color: var(--text-3); white-space: nowrap;
}
.node-head b { font-size: var(--fs-2); }
.grow { flex: 1; }
.mini {
  width: 22px; height: 22px; border-radius: var(--r-1); border: 1px solid var(--line);
  background: var(--surface-2); color: var(--text-2); font-size: 11px; cursor: pointer; line-height: 1;
}
.mini:disabled { opacity: 0.35; cursor: default; }
.desc { margin: 0; font-size: 11.5px; color: var(--text-2); line-height: 1.6; }
.req { margin: 0; font-size: 10.5px; color: var(--text-3); line-height: 1.6; }
.node-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 2px; }
.sw { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-2); cursor: pointer; }
.num { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; color: var(--text-3); }
.n {
  width: 52px; height: 24px; padding: 0 5px; border-radius: var(--r-1);
  border: 1px solid var(--line); background: var(--surface-2); color: var(--text);
  font-size: 11px; font-family: var(--font-mono);
}
.node-meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 9.5px; color: var(--text-3); }
.tail { margin: var(--sp-3) 0 0; }
</style>
