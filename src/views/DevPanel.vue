<script setup lang="ts">
/**
 * 开发者中心
 *
 * 普通模式只有七个按钮；要改 Agent、Skill、流程顺序、提示词与预算，都在这里。
 * 全部能力都是声明式的：没有任意代码执行，外部 Skill 导入前先摆出来源与权限。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { db } from '../core/db';
import type { AgentDefinition, SkillDefinition, UsageRecord, WorkflowRun } from '../core/types';
import { fmtTime } from '../core/id';
import { backOr } from '../core/nav';
import { blankAgent, deleteAgent, getAgentById, listAgents, resetAgent } from '../agents/registry';
import { listSkills } from '../skills/registry';
import { AgentRuntime } from '../agents/runtime';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import AgentEditor from '../components/dev/AgentEditor.vue';
import SkillManager from '../components/dev/SkillManager.vue';
import WorkflowEditor from '../components/dev/WorkflowEditor.vue';

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const projects = useProjectStore();

type Tab = 'agents' | 'skills' | 'flow' | 'prompt' | 'logs';
const TABS: { k: Tab; l: string }[] = [
  { k: 'agents', l: 'Agent' },
  { k: 'skills', l: 'Skills' },
  { k: 'flow', l: '工作流' },
  { k: 'prompt', l: '提示词' },
  { k: 'logs', l: '日志与用量' },
];
const tab = ref<Tab>('agents');

const agents = ref<AgentDefinition[]>([]);
const agentOverrides = ref<Set<string>>(new Set());
const skills = ref<SkillDefinition[]>([]);
const editing = ref<AgentDefinition | null>(null);
const isNewAgent = ref(false);

const logs = ref<UsageRecord[]>([]);
const runs = ref<WorkflowRun[]>([]);
const openRun = ref<string | null>(null);
const stats = ref<Awaited<ReturnType<typeof app.gateway.usageSummary>> | null>(null);

/* ------------------------------ 提示词调试 ------------------------------ */
const promptAgent = ref('');
const testInput = ref('');
const testOut = ref('');
const testing = ref(false);

const promptAgentDef = computed(() => agents.value.find((x) => x.id === promptAgent.value));

/** 只预览系统提示词部分（项目事实在实际调用时另拼，不在这里展示） */
const promptText = computed(() => {
  const a = promptAgentDef.value;
  if (!a) return '';
  const rt = new AgentRuntime(app.gateway, skills.value);
  const mode = projects.current?.aiMode ?? 'assist';
  return rt.buildSystemPrompt(a, { project: { aiMode: mode } as never });
});

const skillNames = computed(() => new Map(skills.value.map((s) => [s.id, s.name])));

async function runTest() {
  const a = promptAgentDef.value;
  if (!a) return;
  if (!testInput.value.trim()) {
    app.toast('先写一句要交给 Agent 的任务', 'warn');
    return;
  }
  testing.value = true;
  testOut.value = '';
  try {
    const runtime = new AgentRuntime(app.gateway, skills.value);
    const project = projects.current;
    if (!project) {
      app.toast('当前没有打开的项目，试跑只会带上 Agent 提示词本身', 'warn', 4200);
    }
    const r = await runtime.run(
      a.id,
      a,
      { project: project ?? ({ aiMode: 'assist' } as never) },
      testInput.value,
      { maxCalls: 2 },
    );
    testOut.value = [
      r.text || '（没有文本输出）',
      '',
      `—— 调用 ${r.calls} 次 · 循环 ${r.loops} 轮`,
      r.warnings.length ? `⚠ ${r.warnings.join('\n⚠ ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  } catch (e) {
    testOut.value = `失败：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    testing.value = false;
  }
}

/* ------------------------------ 加载 ------------------------------ */

async function refreshAgents() {
  agents.value = await listAgents({ includeDisabled: true });
  agentOverrides.value = new Set((await db.customAgents.toArray()).map((r) => r.id));
  if (!promptAgent.value && agents.value.length) promptAgent.value = agents.value[0].id;
}

async function refreshLogs() {
  logs.value = await db.usage.orderBy('at').reverse().limit(120).toArray();
  stats.value = await app.gateway.usageSummary();
  const all = await db.workflowRuns.toArray();
  runs.value = all.sort((a, b) => b.startedAt - a.startedAt).slice(0, 20);
}

onMounted(async () => {
  const t = String(route.query.tab ?? '');
  if (TABS.some((x) => x.k === t)) tab.value = t as Tab;
  await refreshAgents();
  skills.value = await listSkills();
  await refreshLogs();
});

watch(tab, async (v) => {
  if (v === 'logs') await refreshLogs();
  if (v === 'agents' || v === 'prompt') await refreshAgents();
});

/* ------------------------------ Agent 操作 ------------------------------ */

const ordered = computed(() => [...agents.value].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)));

async function move(a: AgentDefinition, delta: number) {
  const list = ordered.value;
  const i = list.findIndex((x) => x.id === a.id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  const other = list[j];
  const oi = a.order ?? i + 1;
  const oj = other.order ?? j + 1;
  a.order = oj;
  other.order = oi;
  await Promise.all([
    db.customAgents.put({ ...a, updatedAt: Date.now() } as AgentDefinition),
    db.customAgents.put({ ...other, updatedAt: Date.now() } as AgentDefinition),
  ]);
  await refreshAgents();
}

async function toggleAgent(a: AgentDefinition, v: boolean) {
  await db.customAgents.put({ ...a, enabled: v, updatedAt: Date.now() } as AgentDefinition);
  await refreshAgents();
}

function createAgent() {
  editing.value = blankAgent();
  isNewAgent.value = true;
}

async function editAgent(id: string) {
  const a = await getAgentById(id);
  if (!a) return;
  editing.value = JSON.parse(JSON.stringify(a)) as AgentDefinition;
  isNewAgent.value = !a.builtin;
}

async function removeAgent(a: AgentDefinition) {
  if (!confirm(`删除「${a.name}」？引用它的工作流步骤会被跳过。`)) return;
  try {
    await deleteAgent(a.id);
    app.toast('已删除', 'ok');
    await refreshAgents();
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '删除失败', 'error', 5000);
  }
}

async function restoreAgent(a: AgentDefinition) {
  if (!confirm(`撤销「${a.name}」的本地修改，恢复内置默认？`)) return;
  await resetAgent(a.id);
  app.toast('已恢复默认', 'ok');
  await refreshAgents();
}

function modelOf(a: AgentDefinition) {
  const m = app.settings.agentModels[a.id];
  return m ? m.model : '自动分配';
}

function kindOf(a: AgentDefinition) {
  if (!a.builtin) return '自定义';
  return agentOverrides.value.has(a.id) ? '已修改' : '内置';
}

const RUN_STATUS_LABEL: Record<WorkflowRun['status'], string> = {
  idle: '未开始',
  running: '执行中',
  paused: '已暂停',
  awaiting: '等待确认',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(promptText.value);
    app.toast('已复制', 'ok');
  } catch {
    app.toast('复制失败，请手动选择文本', 'warn');
  }
}
</script>

<template>
  <div class="dev">
    <header class="top">
      <button class="backbtn" type="button" @click="backOr(router, '/settings')">‹ 返回</button>
      <h1>开发者中心</h1>
    </header>

    <nav class="tabs">
      <button
        v-for="t in TABS"
        :key="t.k"
        type="button"
        class="tab"
        :class="{ on: tab === t.k }"
        @click="tab = t.k"
      >
        {{ t.l }}
      </button>
    </nav>

    <main class="body">
      <!-- ============================ Agent ============================ -->
      <section v-if="tab === 'agents'">
        <div class="row-head">
          <p class="muted small">
            执行顺序就是普通模式里的协作顺序；关掉的 Agent 不会被工作流调用。
          </p>
          <button class="btn" type="button" @click="createAgent">+ 自定义 Agent</button>
        </div>

        <div v-for="(a, i) in ordered" :key="a.id" class="agent-row">
          <div class="agent-main">
            <div class="agent-title">
              <b>{{ a.name }}</b>
              <span class="badge" :class="{ dim: a.builtin && !agentOverrides.has(a.id) }">{{ kindOf(a) }}</span>
              <span v-if="!a.enabled" class="badge warn">已停用</span>
            </div>
            <p class="small muted">{{ a.description }}</p>
            <p class="small muted">
              模型：{{ modelOf(a) }} · 循环 ≤{{ a.maxLoops }} · 超时 {{ Math.round(a.timeoutMs / 1000) }}s ·
              Skills：{{ a.skills.map((s) => skillNames.get(s) ?? s).join('、') || '无' }}
            </p>
          </div>
          <div class="agent-ops">
            <label class="switch">
              <input
                type="checkbox"
                :checked="a.enabled"
                @change="toggleAgent(a, ($event.target as HTMLInputElement).checked)"
              />
              <i />
            </label>
            <button class="mini" type="button" :disabled="i === 0" @click="move(a, -1)">↑</button>
            <button class="mini" type="button" :disabled="i === ordered.length - 1" @click="move(a, 1)">↓</button>
            <button class="mini" type="button" @click="editAgent(a.id)">编辑</button>
            <button v-if="a.builtin && agentOverrides.has(a.id)" class="mini" type="button" @click="restoreAgent(a)">
              恢复默认
            </button>
            <button v-if="!a.builtin" class="mini danger" type="button" @click="removeAgent(a)">删除</button>
          </div>
        </div>

        <div v-if="editing" class="drawer-scrim" @click.self="editing = null">
          <div class="drawer">
            <AgentEditor
              :agent="editing"
              :skills="skills"
              :is-new="isNewAgent"
              @close="editing = null"
              @saved="((editing = null), refreshAgents())"
            />
          </div>
        </div>
      </section>

      <!-- ============================ Skills ============================ -->
      <section v-else-if="tab === 'skills'" class="plain">
        <SkillManager />
      </section>

      <!-- ============================ 工作流 ============================ -->
      <section v-else-if="tab === 'flow'" class="plain">
        <WorkflowEditor />
      </section>

      <!-- ============================ 提示词 ============================ -->
      <section v-else-if="tab === 'prompt'">
        <div class="field">
          <label>选一个 Agent 查看提示词</label>
          <select v-model="promptAgent">
            <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>

        <div class="field">
          <label>
            系统提示词
            <button v-if="promptText" class="mini" type="button" @click="copyPrompt">复制</button>
          </label>
          <pre class="prompt">{{ promptText || '（空）' }}</pre>
          <p class="small muted">
            实际调用时还会拼上项目事实、研究记录、来源与当前章节要求；相同输入会命中缓存，不重复计费。
          </p>
        </div>

        <div class="field">
          <label>试跑（最多 2 次调用，会计入用量）</label>
          <textarea v-model="testInput" rows="3" placeholder="例如：看看当前项目下一步该做什么" />
          <button class="btn" type="button" :disabled="testing" @click="runTest">
            {{ testing ? '运行中…' : '运行' }}
          </button>
          <pre v-if="testOut" class="prompt">{{ testOut }}</pre>
        </div>

        <div v-if="stats" class="stat-grid">
          <div class="stat"><b>{{ stats.calls }}</b><span>调用</span></div>
          <div class="stat"><b>{{ stats.cacheHits }}</b><span>缓存命中</span></div>
          <div class="stat"><b>¥{{ stats.cost.toFixed(3) }}</b><span>估算费用</span></div>
          <div class="stat"><b>{{ (stats.tokens / 1000).toFixed(1) }}k</b><span>Token</span></div>
        </div>
        <button
          v-if="stats && stats.cacheHits"
          class="mini"
          type="button"
          @click="app.gateway.clearCache(); app.toast('提示词缓存已清空', 'ok')"
        >
          清空提示词缓存
        </button>
      </section>

      <!-- ============================ 日志与用量 ============================ -->
      <section v-else>
        <div v-if="stats" class="stat-grid">
          <div class="stat"><b>{{ stats.calls }}</b><span>调用</span></div>
          <div class="stat"><b>{{ stats.failed }}</b><span>失败</span></div>
          <div class="stat"><b>¥{{ stats.cost.toFixed(3) }}</b><span>费用</span></div>
          <div class="stat">
            <b>{{ stats.avgDuration ? `${stats.avgDuration.toFixed(1)}s` : '—' }}</b><span>平均耗时</span>
          </div>
        </div>

        <h3 class="sub-h">工作流执行记录</h3>
        <p v-if="!runs.length" class="muted small">还没有工作流执行记录。</p>
        <div v-for="r in runs" :key="r.id" class="run">
          <button class="run-head" type="button" @click="openRun = openRun === r.id ? null : r.id">
            <span class="badge">{{ RUN_STATUS_LABEL[r.status] }}</span>
            <b>{{ r.title }}</b>
            <span class="small muted">
              {{ fmtTime(r.startedAt) }} · {{ r.calls }} 次调用 · ¥{{ r.cost.toFixed(3) }}
            </span>
          </button>
          <ol v-if="openRun === r.id" class="run-steps">
            <li v-for="s in r.steps" :key="s.id" :class="`st-${s.status}`">
              <b>{{ s.name }}</b>
              <span class="small muted">
                {{ s.calls }} 次调用
                <template v-if="s.error"> · {{ s.error }}</template>
              </span>
              <pre v-if="s.output" class="prompt small-pre">{{ s.output }}</pre>
            </li>
          </ol>
        </div>

        <h3 class="sub-h">最近调用</h3>
        <table v-if="logs.length" class="log-table">
          <thead>
            <tr><th>时间</th><th>Agent</th><th>模型</th><th>Token</th><th>费用</th><th>结果</th></tr>
          </thead>
          <tbody>
            <tr v-for="l in logs" :key="l.id">
              <td>{{ fmtTime(l.at) }}</td>
              <td>{{ l.agentId || '—' }}</td>
              <td>{{ l.model }}</td>
              <td>{{ (l.promptTokens ?? 0) + (l.completionTokens ?? 0) }}</td>
              <td>¥{{ (l.cost ?? 0).toFixed(4) }}</td>
              <td :class="l.ok ? 'ok-t' : 'bad-t'">{{ l.ok ? '成功' : '失败' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted small">还没有调用记录。</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.dev { max-width: 860px; margin: 0 auto; padding: 0 var(--sp-4) 48px; }
.top { display: flex; align-items: center; gap: 10px; padding: 14px 0 10px; }
.top h1 { font-size: 17px; margin: 0; }
.backbtn { background: none; border: none; color: var(--text-2); font-size: 14px; cursor: pointer; padding: 4px 8px; }
.backbtn:hover { color: var(--text-1); }

.tabs { display: flex; gap: 6px; margin-bottom: var(--sp-4); overflow-x: auto; }
.tab {
  border: 1px solid var(--line); background: var(--surface-2); color: var(--text-2);
  border-radius: 999px; padding: 6px 14px; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.tab.on { background: var(--primary); border-color: var(--primary); color: #fff; }

.body > section { display: flex; flex-direction: column; gap: var(--sp-3); }
.body > section.plain { display: block; }
.row-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.row-head p { margin: 0; }

.btn {
  border: 1px solid var(--primary); background: var(--primary); color: #fff;
  border-radius: var(--r-2); padding: 7px 14px; font-size: 13px; cursor: pointer;
}
.btn:disabled { opacity: 0.5; cursor: default; }
.mini {
  border: 1px solid var(--line); background: var(--surface-2); color: var(--text-2);
  border-radius: var(--r-1); padding: 4px 10px; font-size: 12px; cursor: pointer;
}
.mini:hover:not(:disabled) { border-color: var(--text-3); }
.mini:disabled { opacity: 0.4; cursor: default; }
.mini.danger { color: var(--danger, #c0392b); border-color: currentColor; }

.agent-row {
  display: flex; gap: 12px; align-items: flex-start; justify-content: space-between;
  border: 1px solid var(--line); border-radius: var(--r-3); padding: 12px 14px; background: var(--surface-1);
}
.agent-main { min-width: 0; }
.agent-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.agent-main p { margin: 4px 0 0; }
.agent-ops { display: flex; gap: 6px; align-items: center; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

.badge {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  background: var(--primary-soft, var(--surface-3)); color: var(--primary);
}
.badge.dim { background: var(--surface-3); color: var(--text-3); }
.badge.warn { background: transparent; border: 1px solid var(--warn, #b7791f); color: var(--warn, #b7791f); }

.switch { position: relative; display: inline-block; width: 36px; height: 20px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch i {
  position: absolute; inset: 0; border-radius: 999px; background: var(--surface-3);
  transition: background var(--dur-2) var(--ease-out); cursor: pointer;
}
.switch i::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform var(--dur-2) var(--ease-out);
}
.switch input:checked + i { background: var(--primary); }
.switch input:checked + i::after { transform: translateX(16px); }

.drawer-scrim {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 60;
  display: flex; justify-content: flex-end; padding: 8px;
}
.drawer {
  width: min(560px, 100%); height: 100%; background: var(--bg);
  border: 1px solid var(--line); border-radius: var(--r-4);
  box-shadow: var(--shadow-3); overflow: hidden; display: flex; flex-direction: column;
}

.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; }
.field select, .field textarea {
  border: 1px solid var(--line); border-radius: var(--r-2); padding: 8px 10px;
  background: var(--surface-1); color: var(--text-1); font: inherit; width: 100%;
}
.field .btn { align-self: flex-start; }
.prompt {
  background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-2);
  padding: 10px 12px; font-size: 12px; line-height: 1.6; white-space: pre-wrap;
  word-break: break-word; margin: 0; max-height: 340px; overflow-y: auto;
}
.small-pre { max-height: 160px; }

.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.stat {
  border: 1px solid var(--line); border-radius: var(--r-2); padding: 10px;
  display: flex; flex-direction: column; gap: 2px; background: var(--surface-1);
}
.stat b { font-size: 16px; font-variant-numeric: tabular-nums; }
.stat span { font-size: 11px; color: var(--text-3); }

.sub-h { font-size: 14px; margin: var(--sp-3) 0 0; }
.run { border: 1px solid var(--line); border-radius: var(--r-2); overflow: hidden; }
.run-head {
  width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: var(--surface-1); border: none; cursor: pointer; text-align: left; flex-wrap: wrap;
}
.run-steps { margin: 0; padding: 8px 12px 12px 28px; display: flex; flex-direction: column; gap: 8px; }
.run-steps li { list-style: none; position: relative; padding-left: 14px; }
.run-steps li::before {
  content: ''; position: absolute; left: 0; top: 7px; width: 7px; height: 7px; border-radius: 50%;
  background: var(--surface-3);
}
.run-steps li.st-done::before { background: var(--ok, #2e7d32); }
.run-steps li.st-failed::before { background: var(--danger, #c0392b); }
.run-steps li.st-running::before { background: var(--primary); }
.run-steps li.st-awaiting::before { background: var(--warn, #b7791f); }

.log-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.log-table th, .log-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
.log-table th { color: var(--text-3); font-weight: 500; font-size: 11.5px; }
.ok-t { color: var(--ok, #2e7d32); }
.bad-t { color: var(--danger, #c0392b); }

.muted { color: var(--text-3); }
.small { font-size: 12.5px; }

@media (max-width: 620px) {
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
  .agent-row { flex-direction: column; }
  .agent-ops { justify-content: flex-start; }
}
</style>
