<script setup lang="ts">
/**
 * 答辩 PPT 工作台
 *
 * 三步过程逐条点亮（排页 / 写文案 / 终检），每页都能改，改完自动存本机。
 * 导出的是真正的 PPTX，不是图片，也不是一段让人自己粘的 Markdown。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import { db } from '../core/db';
import { uid } from '../core/id';
import { AgentRuntime } from '../agents/runtime';
import { listSkills } from '../skills/registry';
import { BUILTIN_AGENTS } from '../agents/definitions';
import { BUILTIN_SKILLS } from '../skills/definitions';
import { generateDeck, type DeckStep } from '../ppt/generate';
import {
  auditDeck,
  LAYOUT_LABEL,
  LAYOUTS,
  templateDeck,
  type DeckFacts,
} from '../ppt/model';
import { exportDeckNotes, exportDeckPptx } from '../export/pptx';
import { askConfirm, beginTask, endTask } from '../core/task-guard';
import type { Deck, SlideLayout } from '../core/types';

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const store = useProjectStore();

const loaded = ref(false);
const deck = ref<Deck | null>(null);
const steps = ref<DeckStep[]>([]);
const warnings = ref<string[]>([]);
const generating = ref(false);
const expanded = ref<string | null>(null);
const saved = ref<'saved' | 'saving'>('saved');

const projectId = String(route.params.id ?? '');

const facts = computed<DeckFacts>(() => ({
  project: store.current!,
  reports: store.reports,
  records: store.records,
  datasets: store.datasets,
  sources: store.sources,
}));

const issues = computed(() => deck.value?.issues ?? []);
const issuesFor = (page: number) => issues.value.filter((x) => x.page === page);
const agentName = (id: string) => BUILTIN_AGENTS.find((a) => a.id === id)?.name ?? id;
const deckSkills = ['deck-outline', 'slide-copy', 'slide-visual', 'deck-audit']
  .map((id) => BUILTIN_SKILLS.find((s) => s.id === id)?.name)
  .filter(Boolean)
  .join(' · ');
const deckAgents = ['deck-architect', 'slide-writer', 'deck-reviewer']
  .map((id) => BUILTIN_AGENTS.find((a) => a.id === id)?.name)
  .filter(Boolean)
  .join(' → ');

onMounted(async () => {
  try {
    await store.open(projectId);
    if (!store.current) throw new Error('找不到这个项目');
    const row = await db.decks.get(projectId);
    if (row) deck.value = row;
    loaded.value = true;
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '项目打不开', 'error', 5000);
    router.replace('/');
  }
});

/** 存本机：Vue 的响应式对象要先转成纯对象，否则 IndexedDB 会拒绝 */
async function persist() {
  if (!deck.value) return;
  await db.decks.put(JSON.parse(JSON.stringify(deck.value)) as Deck);
  saved.value = 'saved';
}

let saveTimer: number | undefined;
function touch() {
  if (!deck.value) return;
  deck.value.updatedAt = Date.now();
  deck.value.version += 1;
  deck.value.issues = auditDeck(deck.value, facts.value);
  saved.value = 'saving';
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void persist(), 600);
}

async function useTemplate() {
  deck.value = templateDeck(facts.value);
  steps.value = [];
  warnings.value = [];
  await persist();
  app.toast('已按项目里的内容排好一版，缺的地方写着「待补充」', 'ok');
}

async function generate() {
  if (generating.value) return;
  if (app.settings.minor.enabled && app.settings.minor.limitAi) {
    app.toast('未成年人模式已限制 AI 生成，可以点「先用模板」', 'warn', 4600);
    return;
  }
  generating.value = true;
  beginTask('ppt-generate', '正在生成答辩演示稿');
  warnings.value = [];
  try {
    const runtime = new AgentRuntime(app.gateway, await listSkills());
    const enabled = app.settings.enabledAgents ?? [];
    if (enabled.length && !enabled.includes('slide-writer')) {
      app.toast('演示助手在设置里被关掉了，这次会用模板；到「设置 → 其他设置 → 开发者选项」打开后可用 AI', 'info', 5200);
    }
    const base = deck.value ? (JSON.parse(JSON.stringify(deck.value)) as Deck) : undefined;
    const res = await generateDeck({
      facts: facts.value,
      runtime,
      enabledAgents: enabled,
      base,
      onSteps: (s) => (steps.value = s),
    });
    deck.value = res.deck;
    warnings.value = res.warnings;
    await persist();
    app.toast(
      res.usedTemplate ? '已生成模板稿，可以直接编辑和导出' : `演示稿写好了，共 ${res.deck.slides.length} 页`,
      'ok',
    );
  } catch (e) {
    app.toast(e instanceof Error ? e.message : String(e), 'error', 6000);
  } finally {
    generating.value = false;
    endTask('ppt-generate');
  }
}

async function doExport() {
  if (!deck.value) return;
  const high = (deck.value.issues ?? []).filter((i) => i.level === 'high');
  if (high.length) {
    const ok = await askConfirm({
      title: `还有 ${high.length} 个高优先级问题`,
      message: high
        .slice(0, 4)
        .map((i) => `· 第 ${i.page} 页：${i.text}`)
        .join('\n'),
      confirmText: '仍然导出',
      cancelText: '先改一遍',
      tone: 'warn',
    });
    if (!ok) return;
  }
  await persist();
  await app.withBusy('正在生成演示文稿…', async () => {
    await exportDeckPptx(deck.value!, facts.value.project, facts.value.datasets);
  });
  app.toast('PPTX 已导出，模拟内容页保留了标识', 'ok');
}

function doNotes() {
  if (!deck.value) return;
  exportDeckNotes(deck.value, facts.value);
  app.toast('讲稿已导出，口播词可以自己再改', 'ok');
}

function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id;
}

function move(i: number, delta: number) {
  if (!deck.value) return;
  const j = i + delta;
  if (j < 0 || j >= deck.value.slides.length) return;
  const arr = deck.value.slides;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  touch();
}

function removeSlide(i: number) {
  if (!deck.value) return;
  if (deck.value.slides.length <= 3) {
    app.toast('至少留三页：封面、内容、结尾', 'warn');
    return;
  }
  deck.value.slides.splice(i, 1);
  if (expanded.value && !deck.value.slides.some((s) => s.id === expanded.value)) expanded.value = null;
  touch();
}

function addSlide() {
  if (!deck.value) return;
  const at = Math.max(1, deck.value.slides.length - 1);
  deck.value.slides.splice(at, 0, {
    id: uid('sl'),
    layout: 'points',
    title: '新的一页',
    bullets: ['待补充'],
    source: '待补充',
  });
  touch();
}

function setBullet(slideIndex: number, bulletIndex: number, value: string) {
  if (!deck.value) return;
  deck.value.slides[slideIndex].bullets[bulletIndex] = value;
  touch();
}

function addBullet(slideIndex: number) {
  if (!deck.value) return;
  const b = deck.value.slides[slideIndex].bullets;
  if (b.length >= 4) {
    app.toast('一页最多 4 条，多了投影上看不清', 'warn');
    return;
  }
  b.push('待补充');
  touch();
}

function removeBullet(slideIndex: number, bulletIndex: number) {
  if (!deck.value) return;
  deck.value.slides[slideIndex].bullets.splice(bulletIndex, 1);
  touch();
}

function setLayout(slideIndex: number, value: SlideLayout) {
  if (!deck.value) return;
  deck.value.slides[slideIndex].layout = value;
  touch();
}
</script>

<template>
  <div class="page deck-page">
    <header class="deck-head">
      <button class="back" aria-label="返回" @click="router.back()">←</button>
      <div class="grow">
        <h1>答辩 PPT</h1>
        <p class="deck-sub">{{ store.current?.topic || '研究性学习' }} · 逐页可改，导出真正的 PPTX</p>
      </div>
      <div class="row wrap head-btns">
        <button class="btn btn-sm" :disabled="!deck" @click="doNotes">导出讲稿</button>
        <button class="btn btn-sm btn-primary" :disabled="!deck" @click="doExport">导出 PPTX</button>
      </div>
    </header>

    <div v-if="!loaded" class="loading-page"><div class="skeleton" style="height: 160px" /></div>

    <div v-else class="deck-layout">
      <!-- 左：生成与检查 -->
      <aside class="deck-side">
        <section class="card card-pad">
          <div class="card-label">生成演示稿</div>
          <p class="muted small deck-note">
            只用项目里已经写下的报告、记录和数据。没做的写「待补充」，模拟内容带标识，不替你编数字。
          </p>
          <div class="row wrap">
            <button class="btn btn-sm btn-primary" :disabled="generating" @click="generate">
              {{ generating ? '正在生成…' : deck ? '重新生成' : '生成演示稿' }}
            </button>
            <button class="btn btn-sm" :disabled="generating" @click="useTemplate">先用模板</button>
          </div>
          <p class="muted small deck-note" style="margin-top: 12px">
            没有配模型也能用「先用模板」：按项目内容排好页，自己填完再导出。
          </p>
        </section>

        <section v-if="steps.length" class="card card-pad">
          <div class="card-label">生成过程</div>
          <ol class="steps">
            <li v-for="s in steps" :key="s.key" :class="s.status">
              <span class="step-dot" />
              <div class="step-body">
                <b>{{ s.label }}</b>
                <span class="step-note">{{ s.note || agentName(s.agentId) }}</span>
                <small v-if="s.ms !== undefined">
                  {{ (s.ms / 1000).toFixed(1) }} 秒 · {{ s.calls ?? 0 }} 次调用 · {{ agentName(s.agentId) }}
                </small>
              </div>
            </li>
          </ol>
          <div v-if="warnings.length" class="warn-box">
            <div v-for="(w, i) in warnings" :key="i">{{ w }}</div>
          </div>
        </section>

        <section v-if="issues.length" class="card card-pad">
          <div class="card-label">导出前核对（{{ issues.length }}）</div>
          <div v-for="(x, i) in issues.slice(0, 12)" :key="i" class="issue" :class="x.level">
            <b>第 {{ x.page }} 页</b><span>{{ x.text }}</span>
          </div>
          <p class="muted small" style="margin: 10px 0 0">这些只是提醒，不会替你改内容。</p>
        </section>

        <section class="card card-pad">
          <div class="card-label">用到的技能与助手</div>
          <p class="muted small"><b>助手</b>：{{ deckAgents }}</p>
          <p class="muted small"><b>技能</b>：{{ deckSkills }}</p>
          <p class="muted small" style="margin-bottom: 0">
            开发者中心里可以查看、修改它们的提示词；引导页可以选择全部启用或只开基础。
          </p>
        </section>
      </aside>

      <!-- 右：逐页编辑 -->
      <main class="deck-main">
        <div v-if="!deck" class="card card-pad empty-state">
          <div class="empty-icon">PPT</div>
          <h2>还没有演示稿</h2>
          <p class="muted">
            点左边「生成演示稿」，会按答辩的顺序排页、写短句和口播词；也可以先用模板，逐页自己填。
          </p>
          <p class="muted small">
            封面 → 为什么做 → 怎么做 → 过程与发现 → 局限与下一步 → 结尾，每页只讲一件事。
          </p>
        </div>

        <template v-else>
          <div class="deck-meta card card-pad">
            <label class="field" style="margin: 0">
              <span class="field-label">演示标题</span>
              <input v-model="deck.title" class="input" @change="touch" />
            </label>
            <div class="meta-tags">
              <span class="chip">{{ deck.slides.length }} 页</span>
              <span class="chip" :class="deck.origin === 'template' ? '' : 'chip-accent'">
                {{ deck.origin === 'template' ? '模板稿' : deck.origin === 'mixed' ? '模板 + AI' : 'AI 辅助整理' }}
              </span>
              <span class="chip" :class="saved === 'saved' ? 'chip-ok' : ''">
                {{ saved === 'saved' ? '已存本机' : '正在保存' }}
              </span>
            </div>
          </div>

          <div v-for="(s, i) in deck.slides" :key="s.id" class="slide-card" :class="{ open: expanded === s.id }">
            <div class="slide-summary" @click="toggle(s.id)">
              <span class="slide-num">{{ String(i + 1).padStart(2, '0') }}</span>
              <div class="grow slide-info">
                <div class="slide-title">
                  <span class="layout-tag">{{ LAYOUT_LABEL[s.layout] }}</span>
                  <b>{{ s.title }}</b>
                  <span v-if="s.simulated" class="chip chip-warn">模拟示例</span>
                </div>
                <div class="slide-lead">{{ s.lead || (s.bullets[0] ?? '') }}</div>
              </div>
              <span class="chev" :class="{ on: expanded === s.id }">›</span>
            </div>

            <!-- 折叠用 Grid 0fr→1fr，不写 JS 量高 -->
            <div class="slide-editor-wrap" :class="{ open: expanded === s.id }">
              <div class="slide-editor-inner">
                <div class="issue-row" v-if="issuesFor(i + 1).length">
                  <span v-for="(x, k) in issuesFor(i + 1)" :key="k" class="issue" :class="x.level">{{ x.text }}</span>
                </div>

                <div class="form-grid">
                  <label class="field">
                    <span class="field-label">版式</span>
                    <select class="select" :value="s.layout" @change="setLayout(i, ($event.target as HTMLSelectElement).value as SlideLayout)">
                      <option v-for="l in LAYOUTS" :key="l" :value="l">{{ LAYOUT_LABEL[l] }}</option>
                    </select>
                  </label>
                  <label class="field">
                    <span class="field-label">顶部小标</span>
                    <input v-model="s.kicker" class="input" placeholder="如：01 · 为什么做" @change="touch" />
                  </label>
                  <label class="field form-wide">
                    <span class="field-label">页标题（一句结论，≤ 18 字）</span>
                    <input v-model="s.title" class="input" @change="touch" />
                  </label>
                  <label class="field form-wide">
                    <span class="field-label">一句话结论</span>
                    <input v-model="s.lead" class="input" placeholder="这页唯一要观众记住的话" @change="touch" />
                  </label>
                </div>

                <div class="field">
                  <span class="field-label">上屏要点（最多 4 条）</span>
                  <div v-for="(b, k) in s.bullets" :key="k" class="bullet-row">
                    <input
                      class="input"
                      :value="b"
                      @input="setBullet(i, k, ($event.target as HTMLInputElement).value)"
                      @change="touch"
                    />
                    <button class="mini-x" aria-label="删除这一条" @click="removeBullet(i, k)">×</button>
                  </div>
                  <button class="btn btn-sm btn-ghost" @click="addBullet(i)">＋ 加一条</button>
                </div>

                <div class="form-grid">
                  <label class="field">
                    <span class="field-label">依据（写清在哪份材料里）</span>
                    <input v-model="s.source" class="input" @change="touch" />
                  </label>
                  <label class="field">
                    <span class="field-label">数据页用哪个数据集</span>
                    <select v-model="s.datasetId" class="select" @change="touch">
                      <option :value="undefined">不画图</option>
                      <option v-for="d in facts.datasets" :key="d.id" :value="d.id">
                        {{ d.title }}（{{ d.sourceType === 'simulated' ? '模拟' : '项目数据' }}）
                      </option>
                    </select>
                  </label>
                  <label class="field form-wide">
                    <span class="field-label">口播词（导出为演讲备注）</span>
                    <textarea v-model="s.note" class="textarea" rows="2" @change="touch" />
                  </label>
                </div>

                <label class="check-row">
                  <input v-model="s.simulated" type="checkbox" @change="touch" />
                  <span>这一页含 AI 模拟示例，导出时保留标识</span>
                </label>

                <div class="row wrap slide-actions">
                  <button class="btn btn-sm" :disabled="i === 0" @click="move(i, -1)">上移</button>
                  <button class="btn btn-sm" :disabled="i === deck.slides.length - 1" @click="move(i, 1)">下移</button>
                  <button class="btn btn-sm btn-danger" @click="removeSlide(i)">删除这页</button>
                </div>
              </div>
            </div>
          </div>

          <button class="btn btn-block" style="margin-top: 12px" @click="addSlide">＋ 在结尾前加一页</button>

          <div class="banner banner-warn" style="margin-top: 16px">
            导出的是 Office 演示文稿，文字都能在 PowerPoint / WPS 里继续改。提交前请按学校要求再核一遍；
            「指导教师意见」等栏目本软件不代写。
          </div>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 0 0 40px; }
.grow { flex: 1; min-width: 0; }
.loading-page { padding: var(--sp-4) var(--sp-5); }
.deck-head {
  display: flex; align-items: flex-start; gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5) var(--sp-3);
}
.deck-head h1 { font-size: var(--fs-4); }
.deck-sub { margin: 4px 0 0; font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); }
.back {
  width: 36px; height: 36px; flex: 0 0 36px;
  border-radius: 50%; border: none;
  background: var(--surface-2); color: var(--text); cursor: pointer;
}
.back:hover { background: var(--surface-3); }
.head-btns { flex: 0 0 auto; }

.deck-layout {
  display: grid; grid-template-columns: 320px minmax(0, 1fr);
  gap: var(--sp-3); padding: 0 var(--sp-5) var(--sp-10);
  align-items: start;
}
.deck-side { display: flex; flex-direction: column; gap: var(--sp-3); position: sticky; top: 8px; }
.deck-main { min-width: 0; }
.card-label { font-size: var(--fs-1); color: var(--text-3); font-weight: var(--fw-strong); margin-bottom: var(--sp-3); }
.deck-note { line-height: 1.75; margin: 0 0 12px; }
.deck-note b { color: var(--text-2); }

/* 三步过程：状态用颜色，不靠文字堆叠 */
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.steps li { display: flex; gap: 10px; align-items: flex-start; color: var(--text-3); }
.step-dot {
  width: 8px; height: 8px; flex: 0 0 8px; border-radius: 50%;
  background: var(--line-strong); margin-top: 6px;
}
.steps li.running .step-dot { background: var(--primary); animation: pulse 1s infinite ease-in-out; }
.steps li.done .step-dot { background: var(--ok); }
.steps li.failed .step-dot { background: var(--danger); }
.steps li.skipped .step-dot { background: var(--warn); }
@keyframes pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
.step-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.steps li.running b, .steps li.done b { color: var(--text); }
.step-body b { font-size: var(--fs-2); font-weight: var(--fw-medium); }
.step-note { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); line-height: 1.55; }
.step-body small { font-size: calc(10.5px * var(--font-scale)); opacity: 0.75; }
.warn-box {
  margin-top: 12px; padding: 10px 12px; border-radius: var(--r-2);
  background: var(--surface-2); color: var(--text-2);
  font-size: calc(11.5px * var(--font-scale)); line-height: 1.7; display: flex; flex-direction: column; gap: 6px;
}

.issue {
  display: flex; gap: 8px; align-items: baseline;
  padding: 7px 10px; margin-bottom: 6px;
  border-radius: var(--r-1); background: var(--surface-2);
  font-size: calc(11.5px * var(--font-scale)); color: var(--text-2);
}
.issue b { flex: 0 0 auto; color: var(--text-3); font-weight: var(--fw-medium); }
.issue.high { background: rgba(169, 80, 47, 0.1); color: var(--danger); }
.issue.mid { background: rgba(138, 90, 0, 0.09); }
.issue-row { margin-bottom: 12px; }
.issue-row .issue { display: inline-flex; margin-right: 6px; }

/* 空状态 */
.empty-state { text-align: center; padding: var(--sp-8) var(--sp-6); }
.empty-state h2 { font-size: var(--fs-3); margin-bottom: 8px; }
.empty-state p { line-height: 1.75; }
.empty-icon {
  width: 56px; height: 56px; margin: 0 auto 14px;
  display: grid; place-items: center; border-radius: var(--r-2);
  background: var(--primary-soft); color: var(--primary);
  font-size: calc(15px * var(--font-scale)); font-weight: var(--fw-strong); letter-spacing: 0.04em;
}

.deck-meta { display: flex; align-items: flex-end; gap: var(--sp-4); margin-bottom: 12px; }
.deck-meta .field { flex: 1; }
.meta-tags { display: flex; gap: 6px; flex-wrap: wrap; padding-bottom: 4px; }

/* 逐页卡片 */
.slide-card { background: var(--surface-2); border-radius: var(--r-3); margin-bottom: 10px; overflow: hidden; }
.slide-card.open { background: var(--surface); box-shadow: var(--shadow-1); }
.slide-summary { display: flex; align-items: center; gap: var(--sp-3); padding: 12px 14px; cursor: pointer; }
.slide-summary:hover .slide-title b { color: var(--primary); }
.slide-num {
  flex: 0 0 34px; width: 34px; height: 34px; border-radius: var(--r-1);
  display: grid; place-items: center; background: var(--surface-3);
  font-size: calc(12px * var(--font-scale)); color: var(--text-2);
}
.slide-info { min-width: 0; }
.slide-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.slide-title b { font-size: var(--fs-2); font-weight: var(--fw-strong); transition: color var(--dur-2) var(--ease-out); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.layout-tag { flex: 0 0 auto; font-size: calc(10.5px * var(--font-scale)); color: var(--primary); background: var(--primary-soft); padding: 2px 8px; border-radius: var(--r-full); }
.slide-lead { margin-top: 3px; font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chev { font-size: calc(20px * var(--font-scale)); color: var(--text-3); transition: transform var(--dur-2) var(--ease-out); }
.chev.on { transform: rotate(90deg); }

.slide-editor-wrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 320ms var(--ease-out); }
.slide-editor-wrap.open { grid-template-rows: 1fr; }
.slide-editor-inner { overflow: hidden; min-height: 0; }
.slide-card.open .slide-editor-inner { padding: 4px 14px 16px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--sp-3); }
.form-wide { grid-column: 1 / -1; }
.field-label { font-size: calc(11px * var(--font-scale)); color: var(--text-3); }
.bullet-row { display: flex; gap: 6px; margin-bottom: 6px; }
.bullet-row .input { flex: 1; }
.mini-x {
  width: 32px; flex: 0 0 32px; border: none; border-radius: var(--r-1);
  background: var(--surface-2); color: var(--text-3); cursor: pointer; font-size: calc(17px * var(--font-scale));
}
.mini-x:hover { color: var(--danger); }
.check-row { display: flex; align-items: center; gap: 8px; font-size: var(--fs-1); color: var(--text-2); margin: 4px 0 12px; }
.check-row input { accent-color: var(--primary); }
.slide-actions { gap: 8px; }

@media (max-width: 1000px) {
  .deck-layout { grid-template-columns: 1fr; }
  .deck-side { position: static; }
}
@media (max-width: 860px) {
  .deck-head { padding: var(--sp-3) var(--sp-4) var(--sp-2); flex-wrap: wrap; }
  .head-btns { width: 100%; }
  .deck-layout { padding: 0 var(--sp-4) 88px; }
  .deck-meta { flex-direction: column; align-items: stretch; }
  .form-grid { grid-template-columns: 1fr; }
  .form-wide { grid-column: auto; }
}
</style>
