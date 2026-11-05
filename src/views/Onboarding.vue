<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import { LEGAL_DOCS, type LegalDocId } from '../core/legal';
import { KEY_SECURITY_TEXT } from '../core/settings';
import { db, type ProviderRow } from '../core/db';
import { maskKey, seal } from '../core/crypto';
import { uid } from '../core/id';
import { PROVIDER_PRESETS } from '../ai/catalog';
import { BUILTIN_SKILLS } from '../skills/definitions';
import { BUILTIN_AGENTS } from '../agents/definitions';
import { refreshModels } from '../ai/manager';

const app = useAppStore();
const router = useRouter();
const route = useRoute();
/** 从设置里「重新引导」进来：不强制重新勾选，也不覆盖已保存的配置 */
const replay = computed(() => route.query.replay === '1');

/** iOS 激活式：一屏一件事，底部固定主操作 */
const step = ref(0);
const dir = ref<'next' | 'prev'>('next');
const total = 10;
/**
 * 开场 welcome：整屏只说「你好」，没有进度条、没有跳过。
 * 重新引导时不重复看，直接进内容。
 */
const showWelcome = ref(!replay.value);

type AgreeId = 'privacy' | 'terms' | 'statement';
const agree = ref<Record<AgreeId, boolean>>(
  replay.value
    ? { ...app.settings.agreements }
    : { privacy: false, terms: false, statement: false },
);
const simAgreed = ref(replay.value ? app.settings.simulatedNoticeAccepted : false);

const theme = ref<'system' | 'light' | 'dark'>(app.settings.theme);
const motion = ref<'on' | 'off'>(app.settings.motion ?? 'on');
const font = ref<'harmony' | 'system'>(app.settings.font ?? 'harmony');
const aiMode = ref<'assist' | 'lead'>(app.settings.aiMode);
const wantsDev = ref(app.settings.devMode);
const dailyCalls = ref(app.settings.budget.dailyCalls);
const dailyCost = ref(app.settings.budget.dailyCost);

const saving = ref(false);

const docOf = (id: LegalDocId) => LEGAL_DOCS.find((d) => d.id === id)!;
const privacy = docOf('privacy');
const terms = docOf('terms');
const statement = docOf('statement');

const STEP_TITLE = [
  '欢迎',
  '隐私政策',
  '用户协议',
  '声明',
  '外观',
  '使用偏好',
  '接入模型',
  '快速上手',
  '准备就绪',
];

/* 法务全文：必须拉到底，再等 3 秒。勾选只是「同意」，读没读是另一回事 */
const READ_WAIT = 3;
const scrolledToEnd = reactive<Record<number, boolean>>({});
const waitLeft = reactive<Record<number, number>>({});
const timers: Record<number, number> = {};

function isLegalStep(n: number) {
  return n === 1 || n === 2 || n === 3;
}

function readOk(n: number) {
  if (replay.value) return true;
  return scrolledToEnd[n] === true && (waitLeft[n] ?? 0) <= 0;
}

function readHint(n: number) {
  if (replay.value) return '重新引导不重复计时';
  if (!scrolledToEnd[n]) return '把正文拉到最底部才能继续';
  const left = waitLeft[n] ?? 0;
  return left > 0 ? `已读完，请再等 ${left} 秒` : '已读完，可以继续';
}

function startWait(n: number) {
  if (waitLeft[n] !== undefined) return;
  waitLeft[n] = READ_WAIT;
  timers[n] = window.setInterval(() => {
    waitLeft[n] = Math.max(0, (waitLeft[n] ?? 0) - 1);
    if (waitLeft[n] <= 0 && timers[n]) {
      window.clearInterval(timers[n]);
      delete timers[n];
    }
  }, 1000);
}

function markRead(n: number) {
  if (!isLegalStep(n) || scrolledToEnd[n] || replay.value) return;
  scrolledToEnd[n] = true;
  startWait(n);
}

/** 页面滚到底（正文框已随页面展开，滚的就是 stage） */
function onStageScroll(e: Event) {
  const el = e.currentTarget as HTMLElement;
  if (el.scrollHeight - el.scrollTop - el.clientHeight > 12) return;
  markRead(step.value);
}

function onDocScroll(n: number, e: Event) {
  const el = e.currentTarget as HTMLElement;
  if (el.scrollHeight - el.scrollTop - el.clientHeight > 12) return;
  markRead(n);
}

/**
 * 正文短到不需要滚动时，直接视为已读完。
 * 等进场过渡结束再量，否则量到的可能是上一步残留的节点。
 */
watch(step, async (n) => {
  if (!isLegalStep(n) || replay.value) return;
  await nextTick();
  window.setTimeout(() => {
    if (step.value !== n || scrolledToEnd[n]) return;
    const el = document.querySelector('.stage .doc') as HTMLElement | null;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 8) {
      scrolledToEnd[n] = true;
      startWait(n);
    }
  }, 700);
});

onBeforeUnmount(() => {
  for (const t of Object.values(timers)) window.clearInterval(t);
});

const canNext = computed(() => {
  if (replay.value) return true;
  if (step.value === 1) return agree.value.privacy && readOk(1);
  if (step.value === 2) return agree.value.terms && readOk(2);
  if (step.value === 3) return agree.value.statement && simAgreed.value && readOk(3);
  return true;
});

/** 4 外观 / 5 使用偏好 / 6 接入模型 都是可跳过的配置项；协议类不能跳过 */
const canSkip = computed(() => {
  if (step.value >= total - 1) return false;
  return replay.value || step.value >= 4;
});

const blockHint = computed(() => {
  if (replay.value) return '';
  if (isLegalStep(step.value) && !readOk(step.value)) {
    return scrolledToEnd[step.value]
      ? `请再等 ${waitLeft[step.value] ?? 0} 秒`
      : '把正文拉到最底部才能继续';
  }
  if (step.value === 1 && !agree.value.privacy) return '勾选后才能继续';
  if (step.value === 2 && !agree.value.terms) return '勾选后才能继续';
  if (step.value === 3) {
    const miss: string[] = [];
    if (!agree.value.statement) miss.push('声明');
    if (!simAgreed.value) miss.push('模拟内容');
    if (miss.length) return `还需勾选：${miss.join('、')}`;
  }
  return '';
});

/**
 * 换一步就回到顶部。
 * 滚动的是一个固定的 .stage 容器（法务正文也随页面展开，没有内层小框），
 * 不复位的话上一步滚到底，下一步一进来就是半截，看不到标题。
 */
watch(step, async () => {
  await nextTick();
  // .stage 是内容容器，但整页滚动的是 App 的 .onboard-shell（法务步骤尤其明显），两个都要复位
  for (const sel of ['.stage', '.onboard-shell']) {
    const el = document.querySelector(sel) as HTMLElement | null;
    el?.scrollTo({ top: 0 });
  }
});

function go(n: number) {
  dir.value = n > step.value ? 'next' : 'prev';
  step.value = n;
}

function next() {
  if (!canNext.value) {
    app.toast(blockHint.value || '请先勾选', 'warn');
    return;
  }
  go(Math.min(step.value + 1, total - 1));
}

function back() {
  if (step.value > 0) go(step.value - 1);
  else {
    dir.value = 'prev';
    showWelcome.value = true;
  }
}

/** 从 welcome 进入引导主体 */
function enterGuide() {
  showWelcome.value = false;
  dir.value = 'next';
}

/** 跳过当前配置项，不改动已有设置 */
function skip() {
  if (!canSkip.value) return;
  go(Math.min(step.value + 1, total - 1));
}

/* ------------------------- 技能与助手 ------------------------- */
/**
 * 全开最省事；只开基础更省 token、回答更快。
 * 「Markdown 杀手」这类默认关闭的技能不会进全开清单。
 */
const skillMode = ref<'all' | 'basic' | 'custom'>('all');
const ALL_SKILL_IDS = BUILTIN_SKILLS.filter((x) => !x.defaultOff).map((x) => x.id);
const BASIC_SKILL_IDS = ['research-norm', 'four-reports', 'write', 'deai-promax', 'citation-check', 'zh-only'];
const ALL_AGENT_IDS = BUILTIN_AGENTS.map((x) => x.id);
// 自定义清单包含默认关闭的技能：用户可以自己决定要不要打开
const CUSTOM_SKILL_IDS = BUILTIN_SKILLS.map((x) => x.id);
// 「只开基础」也限制助手：保留规划、写作、审核、格式检查这四个最常用的
const BASIC_AGENT_IDS = ['project-planner', 'report-writer', 'content-reviewer', 'format-checker'];

/** 自定义模式：勾选即保存，中途退出引导也不会丢 */
const customSkills = ref<string[]>([...ALL_SKILL_IDS]);
const customAgents = ref<string[]>([...ALL_AGENT_IDS]);

function pickCustom() {
  skillMode.value = 'custom';
  const savedSkills = app.settings.enabledSkills;
  const savedAgents = app.settings.enabledAgents;
  if (savedSkills?.length) customSkills.value = CUSTOM_SKILL_IDS.filter((id) => savedSkills.includes(id));
  if (savedAgents?.length) customAgents.value = ALL_AGENT_IDS.filter((id) => savedAgents.includes(id));
}

function toggleId(list: string[], all: string[], id: string): string[] {
  const set = new Set(list);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return all.filter((x) => set.has(x));
}

function toggleSkill(id: string) {
  customSkills.value = toggleId(customSkills.value, CUSTOM_SKILL_IDS, id);
}
function toggleAgent(id: string) {
  customAgents.value = toggleId(customAgents.value, ALL_AGENT_IDS, id);
}

watch([customSkills, customAgents], async () => {
  if (skillMode.value !== 'custom') return;
  await app.saveSettings({
    enabledSkills: [...customSkills.value],
    enabledAgents: [...customAgents.value],
  });
});

/* ------------------------- 内嵌接入模型 ------------------------- */
const keyable = PROVIDER_PRESETS.filter((p) => !p.needsEdit && !p.beta);
const mKey = ref(PROVIDER_PRESETS.find((p) => p.key === 'deepseek')?.key ?? keyable[0]?.key ?? '');
const mApiKey = ref('');
const mBusy = ref(false);
const mState = ref<'idle' | 'ok' | 'fail'>('idle');
const mMsg = ref('');
const mPreset = computed(() => PROVIDER_PRESETS.find((p) => p.key === mKey.value) ?? keyable[0]);

/** 在引导里直接接上模型：保存服务商 → 拉模型 → 设默认，全程不跳出引导 */
async function saveInlineModel() {
  const preset = mPreset.value;
  if (!preset) return;
  const key = mApiKey.value.trim();
  if (preset.kind !== 'local' && !key) {
    mState.value = 'fail';
    mMsg.value = '先把 API Key 粘进来，或改成「本地模型」';
    return;
  }
  mBusy.value = true;
  mState.value = 'idle';
  mMsg.value = '正在连接服务商、拉取模型列表…';
  try {
    const row: ProviderRow = {
      id: uid('prov'),
      kind: preset.kind,
      label: preset.label,
      baseUrl: preset.baseUrl,
      models: [],
      supportsModelList: preset.modelList,
      timeoutMs: 60000,
      maxRetries: 1,
      createdAt: Date.now(),
      enabled: true,
      isDefault: true,
      apiKeySealed: await seal(key),
      apiKeyPreview: maskKey(key),
      apiKeyLen: key.length,
    };
    const res = await refreshModels(row, { apiKey: key || undefined });
    if (!res.ok || !res.models.length) {
      mState.value = 'fail';
      mMsg.value = res.message || '没拉到模型列表，检查 Key 或网络后重试';
      return;
    }
    row.models = res.models;
    const first = res.models[0]?.name;
    if (first) row.defaultModel = first;
    await db.providers.put(JSON.parse(JSON.stringify(row)));
    if (first) await app.setCurrentModel({ providerId: row.id, model: first, tier: 'fast' });
    app.touchModels();
    mState.value = 'ok';
    mMsg.value = `已接入 ${preset.label}：拉到 ${res.models.length} 个模型，默认用 ${first ?? '第一个'}`;
  } catch (e) {
    mState.value = 'fail';
    mMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    mBusy.value = false;
  }
}

/** 去配置模型：先把引导已选的内容落库，再跳到 API 管理中心 */
async function goModelSetup() {
  await finish('/settings/model');
}

/** 主题与动效即时预览：写进设置，但 disclaimerAccepted 仍为 false，闸门不受影响 */
async function previewTheme(t: 'system' | 'light' | 'dark') {
  theme.value = t;
  await app.setTheme(t);
}

async function previewMotion(v: 'on' | 'off') {
  motion.value = v;
  await app.setMotion(v);
}

async function previewFont(v: 'harmony' | 'system') {
  font.value = v;
  await app.setFont(v);
}

async function finish(to?: string) {
  /** 重新引导是从设置进来的，结束后回到设置；首次激活回到首页 */
  const target = to ?? (replay.value ? '/settings' : '/');
  saving.value = true;
  try {
    await app.saveSettings({
      disclaimerAccepted: true,
      agreements: { ...agree.value },
      simulatedNoticeAccepted: simAgreed.value,
      theme: theme.value,
      motion: motion.value,
      font: font.value,
      aiMode: aiMode.value,
      devMode: wantsDev.value,
      enabledSkills: skillMode.value === 'custom'
        ? [...customSkills.value]
        : skillMode.value === 'all' ? ALL_SKILL_IDS : BASIC_SKILL_IDS,
      enabledAgents: skillMode.value === 'custom'
        ? [...customAgents.value]
        : skillMode.value === 'all' ? ALL_AGENT_IDS : BASIC_AGENT_IDS,
      budget: {
        ...app.settings.budget,
        dailyCalls: Math.max(0, Number(dailyCalls.value) || 0),
        dailyCost: Math.max(0, Number(dailyCost.value) || 0),
      },
    });
    router.replace(target);
  } catch (e) {
    console.error('[onboarding] finish 失败', e);
    app.toast('保存失败，请重试', 'warn', 3200);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="activation">
    <transition name="bar-fade">
    <header v-if="!showWelcome" class="bar">
      <button v-if="step > 0 && step < total - 1" class="bar-back" aria-label="返回" @click="back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6" /></svg>
      </button>
      <div class="track" role="progressbar" :aria-valuenow="step + 1" aria-valuemin="1" :aria-valuemax="total">
        <div class="track-fill" :style="{ width: ((step + 1) / total) * 100 + '%' }" />
      </div>
      <span class="step-no">{{ step + 1 }}/{{ total }}</span>
      <button v-if="canSkip && step !== 6" class="skip" type="button" @click="skip">跳过</button>
    </header>
    </transition>

    <transition :name="'slide-' + dir" mode="out-in">
    <!-- 开场：整屏只有一句「你好」，参考系统激活的第一屏 -->
    <div v-if="showWelcome" key="welcome" class="welcome">
      <div class="welcome-body">
        <img class="welcome-icon" src="/icon.svg" alt="" />
        <h1 class="welcome-hi">你好</h1>
        <p class="welcome-name">欢迎使用研学帮</p>
        <p class="welcome-lede">立项、过程记录、中期与结题，<br />四份材料共用一份资料。</p>
      </div>
      <div class="welcome-foot">
        <button class="btn btn-primary btn-block" type="button" @click="enterGuide">继续</button>
        <p class="welcome-legal">第三方工具 · 非学校官方项目</p>
      </div>
    </div>

    <div v-else key="guide" class="guide">
    <div class="stage" @scroll="onStageScroll($event)">
      <p class="crumb">{{ STEP_TITLE[step] }}</p>

      <transition :name="'slide-' + dir" mode="out-in">
        <!-- 0 欢迎 -->
        <section v-if="step === 0" key="0" class="screen">
          <img class="app-icon" src="/icon.svg" alt="研学帮" />
          <h1 class="display">研学帮</h1>
          <p class="lede">研究性学习，从立项到结题</p>

          <ul class="facts">
            <li><b>1</b><span>开题</span></li>
            <li><b>15</b><span>研究记录</span></li>
            <li><b>1</b><span>中期</span></li>
            <li><b>1</b><span>结题</span></li>
          </ul>

          <p class="note">四份材料共用一份资料，不用重复填写。</p>
          <p class="note">所有内容留在本机，导出为真正的 DOCX。</p>
        </section>

        <!-- 1 隐私政策 -->
        <section v-else-if="step === 1" key="1" class="screen">
          <h2 class="screen-title">{{ privacy.title }}</h2>
          <p class="screen-sub">{{ privacy.summary }}</p>

          <div class="doc" @scroll="onDocScroll(1, $event)">
            <div v-for="s in privacy.sections" :key="s.heading" class="doc-sec">
              <h3>{{ s.heading }}</h3>
              <p>{{ s.body }}</p>
              <!-- 法务 2.0 的清单是表格：引导页也要渲染，否则「3.1」后面像少了正文 -->
              <div v-if="s.table" class="doc-tbl">
                <div v-for="(r, ri) in s.table?.rows ?? []" :key="ri" class="doc-card">
                  <b>{{ r[0] }}</b>
                  <dl>
                    <div v-for="(c, ci) in r.slice(1)" :key="ci">
                      <dt>{{ s.table?.head?.[ci + 1] }}</dt>
                      <dd>{{ c }}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <p class="read-hint" :class="{ ok: readOk(1) }">{{ readHint(1) }}</p>
          <label class="agree-row">
            <span class="check" :class="{ on: agree.privacy }">
              <svg v-if="agree.privacy" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 6 6L20 6" /></svg>
            </span>
            <input v-model="agree.privacy" type="checkbox" class="sr" />
            <span class="agree-text">我已阅读并同意<b>隐私政策</b>（v{{ privacy.version }}）</span>
          </label>
        </section>

        <!-- 2 用户协议 -->
        <section v-else-if="step === 2" key="2" class="screen">
          <h2 class="screen-title">{{ terms.title }}</h2>
          <p class="screen-sub">{{ terms.summary }}</p>

          <div class="doc" @scroll="onDocScroll(2, $event)">
            <div v-for="s in terms.sections" :key="s.heading" class="doc-sec">
              <h3>{{ s.heading }}</h3>
              <p>{{ s.body }}</p>
              <div v-if="s.table" class="doc-tbl">
                <div v-for="(r, ri) in s.table?.rows ?? []" :key="ri" class="doc-card">
                  <b>{{ r[0] }}</b>
                  <dl>
                    <div v-for="(c, ci) in r.slice(1)" :key="ci">
                      <dt>{{ s.table?.head?.[ci + 1] }}</dt>
                      <dd>{{ c }}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <p class="read-hint" :class="{ ok: readOk(2) }">{{ readHint(2) }}</p>
          <label class="agree-row">
            <span class="check" :class="{ on: agree.terms }">
              <svg v-if="agree.terms" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 6 6L20 6" /></svg>
            </span>
            <input v-model="agree.terms" type="checkbox" class="sr" />
            <span class="agree-text">我已阅读并同意<b>用户协议</b>（v{{ terms.version }}）</span>
          </label>
        </section>

        <!-- 3 声明 -->
        <section v-else-if="step === 3" key="3" class="screen">
          <h2 class="screen-title">{{ statement.title }}</h2>
          <p class="screen-sub">{{ statement.summary }}</p>

          <div class="doc" @scroll="onDocScroll(3, $event)">
            <div v-for="s in statement.sections" :key="s.heading" class="doc-sec">
              <h3>{{ s.heading }}</h3>
              <p>{{ s.body }}</p>
              <div v-if="s.table" class="doc-tbl">
                <div v-for="(r, ri) in s.table?.rows ?? []" :key="ri" class="doc-card">
                  <b>{{ r[0] }}</b>
                  <dl>
                    <div v-for="(c, ci) in r.slice(1)" :key="ci">
                      <dt>{{ s.table?.head?.[ci + 1] }}</dt>
                      <dd>{{ c }}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <p class="read-hint" :class="{ ok: readOk(3) }">{{ readHint(3) }}</p>
          <label class="agree-row">
            <span class="check" :class="{ on: agree.statement }">
              <svg v-if="agree.statement" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 6 6L20 6" /></svg>
            </span>
            <input v-model="agree.statement" type="checkbox" class="sr" />
            <span class="agree-text">我已阅读并知悉以上<b>声明</b>（v{{ statement.version }}）</span>
          </label>

          <label class="agree-row">
            <span class="check" :class="{ on: simAgreed }">
              <svg v-if="simAgreed" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 6 6L20 6" /></svg>
            </span>
            <input v-model="simAgreed" type="checkbox" class="sr" />
            <span class="agree-text">我知悉 <b>AI 模拟实践</b>的内容是虚拟示例，不冒充真实调查、实验或访谈。</span>
          </label>
          <p class="note">不用这个功能也建议勾选，它不会自动生成任何内容。</p>
        </section>

        <!-- 4 外观 -->
        <section v-else-if="step === 4" key="4" class="screen">
          <h2 class="screen-title">外观</h2>
          <p class="screen-sub">随时可以在设置里改。</p>

          <div class="seg" role="group" aria-label="主题">
            <button
              v-for="t in (['system', 'light', 'dark'] as const)"
              :key="t"
              class="seg-item"
              :class="{ on: theme === t }"
              @click="previewTheme(t)"
            >
              {{ t === 'system' ? '跟随系统' : t === 'light' ? '浅色' : '深色' }}
            </button>
          </div>

          <div class="group" style="margin-top: var(--sp-6)">
            <div class="row-item static between">
              <span class="row-text">
                <b>界面动效</b>
                <span>页面切换与抽屉过渡。关掉后立即呈现。</span>
              </span>
              <label class="switch">
                <input
                  type="checkbox"
                  :checked="motion === 'on'"
                  @change="previewMotion(($event.target as HTMLInputElement).checked ? 'on' : 'off')"
                />
                <span />
              </label>
            </div>
          </div>

          <div class="label" style="margin-top: var(--sp-6)">界面字体</div>
          <div class="seg">
            <button class="seg-item" :class="{ on: font === 'harmony' }" @click="previewFont('harmony')">
              HarmonyOS Sans
            </button>
            <button class="seg-item" :class="{ on: font === 'system' }" @click="previewFont('system')">
              系统字体
            </button>
          </div>
          <p class="note">
            默认用随应用分发的 HarmonyOS Sans，换设备观感一致；切到系统字体则跟随设备已装字体。
          </p>

          <div class="motion-demo" :class="{ still: motion === 'off' }">
            <span class="demo-track"><span class="dot" /></span>
            <span class="demo-label">{{ motion === 'on' ? '动效已开启' : '动效已关闭' }}</span>
          </div>
        </section>

        <!-- 5 使用偏好 -->
        <section v-else-if="step === 5" key="5" class="screen">
          <h2 class="screen-title">使用偏好</h2>
          <p class="screen-sub">这些也会成为以后新建项目的默认值。</p>

          <div class="label">AI 工作模式</div>
          <div class="seg">
            <button class="seg-item" :class="{ on: aiMode === 'assist' }" @click="aiMode = 'assist'">AI 辅助</button>
            <button class="seg-item" :class="{ on: aiMode === 'lead' }" @click="aiMode = 'lead'">AI 主导辅助</button>
          </div>
          <p class="note">
            {{ aiMode === 'assist' ? '你是主要研究者，AI 只给建议、整理与改写。' : 'AI 承担更多规划与初稿，你必须核实每一条内容。' }}
          </p>

          <div class="label" style="margin-top: var(--sp-6)">预算上限</div>
          <div class="group">
            <div class="row-item static between">
              <span class="row-text"><b>每日调用次数</b><span>0 表示不限</span></span>
              <input v-model.number="dailyCalls" type="number" min="0" max="9999" class="num" />
            </div>
            <div class="row-item static between">
              <span class="row-text"><b>每日预算（元）</b><span>按你填的单价估算，仅提醒不扣款</span></span>
              <input v-model.number="dailyCost" type="number" min="0" max="9999" step="0.5" class="num" />
            </div>
          </div>

          <div class="group" style="margin-top: var(--sp-6)">
            <div class="row-item static between">
              <span class="row-text">
                <b>开发者模式</b>
                <span>开放 Agent、Skills、工作流与执行日志</span>
              </span>
              <label class="switch">
                <input v-model="wantsDev" type="checkbox" />
                <span />
              </label>
            </div>
          </div>

          <p class="note" style="margin-top: var(--sp-4)">{{ KEY_SECURITY_TEXT }}</p>
        </section>

        <!-- 6 接入模型（可跳过） -->
        <section v-else-if="step === 6" key="6" class="screen">
          <h2 class="screen-title">接入模型</h2>
          <p class="screen-sub">这一步可以跳过。不配模型也能写内容、填记录、导出 DOCX，只是 AI 生成与检索用不了。</p>

          <div class="group">
            <div class="row-item static">
              <span class="row-text">
                <b>用自己的 API Key</b>
                <span>支持 DeepSeek、Kimi、智谱、OpenAI、Anthropic、Gemini 等；Key 加密后只存本机。</span>
              </span>
            </div>
            <div class="row-item static">
              <span class="row-text">
                <b>本地模型（Beta）</b>
                <span>Ollama / LM Studio 在本机跑，不联网也不产生费用，受设备性能限制。</span>
              </span>
            </div>
          </div>

          <div class="inline-model">
            <select v-model="mKey" class="select" aria-label="选择服务商">
              <option v-for="p in keyable" :key="p.key" :value="p.key">{{ p.label }}</option>
            </select>
            <input
              v-model="mApiKey"
              class="input"
              type="password"
              autocomplete="off"
              :placeholder="mPreset?.kind === 'local' ? '本地模型一般不需要 Key，可直接拉取' : '粘贴 API Key，只存本机'"
            />
            <button class="btn btn-primary btn-block" type="button" :disabled="mBusy" @click="saveInlineModel">
              {{ mBusy ? '连接中…' : '保存并拉取模型' }}
            </button>
            <p v-if="mMsg" class="inline-msg" :class="mState">{{ mMsg }}</p>
          </div>

          <p class="note">
            不想现在配也可以，点下面的「继续」跳过：除 AI 生成与检索外，写内容、填记录、导出 DOCX 都照常可用。
            免费额度与注册入口见「设置 → 免费 API 指引」，额度以服务商官方页面为准。
          </p>
        </section>

        <!-- 7 快速上手 -->
        <section v-else-if="step === 7" key="7" class="screen">
          <h2 class="screen-title">四步走完一个课题</h2>
          <p class="screen-sub">不用一开始就搞懂全部功能，按顺序做就行。</p>

          <ol class="how">
            <li>
              <span class="how-no">1</span>
              <div>
                <b>立项</b>
                <p>填研究主题、指导教师和小组成员，把老师给的要求整段粘进来。系统会按学期排好 15 篇记录。</p>
              </div>
            </li>
            <li>
              <span class="how-no">2</span>
              <div>
                <b>边做边记</b>
                <p>每做一次调查、访谈或实验，就在对应那篇记录里写清「做了什么、得到什么」。没做的就留空。</p>
              </div>
            </li>
            <li>
              <span class="how-no">3</span>
              <div>
                <b>出四份材料</b>
                <p>开题 → 中期 → 结题，每份都有「未开始 / 草稿 / 待审核 / 已确认」四态，由你自己推进。</p>
              </div>
            </li>
            <li>
              <span class="how-no">4</span>
              <div>
                <b>导出交付</b>
                <p>单份或整包导出 DOCX。含模拟内容时会自动加提示框，标识不会被悄悄去掉。</p>
              </div>
            </li>
          </ol>

          <div class="tip">
            <b>两条底线</b>
            <p>没有真实记录时，软件不会替你写「已完成的研究工作」；「指导教师意见」也不代写。</p>
          </div>
        </section>

        <!-- 8 技能与助手 -->
        <section v-else-if="step === 8" key="8" class="screen">
          <h2 class="screen-title">用哪些技能和助手</h2>
          <p class="screen-sub">技能是写作规范，助手是不同分工。以后在「设置 → 其他设置」里随时能改。</p>

          <div class="mode-pick">
            <button class="mode-card" :class="{ on: skillMode === 'all' }" type="button" @click="skillMode = 'all'">
              <b>全部启用</b>
              <span>所有写作规范与助手都能用，最省心。回答可能稍慢，也更费 token。</span>
            </button>
            <button class="mode-card" :class="{ on: skillMode === 'basic' }" type="button" @click="skillMode = 'basic'">
              <b>只开基础</b>
              <span>只留研究规范、四大报告、文字风格这些；选题打磨、答辩等进阶项先关掉。</span>
            </button>
            <button class="mode-card" :class="{ on: skillMode === 'custom' }" type="button" @click="pickCustom">
              <b>自定义</b>
              <span>自己挑要用的技能与助手，勾选后立即保存。</span>
            </button>
          </div>

          <div v-if="skillMode === 'custom'" class="cust-box">
            <div class="cust-head">
              <b>技能</b>
              <span>已选 {{ customSkills.length }} / {{ BUILTIN_SKILLS.length }}</span>
              <button class="cust-link" type="button" @click="customSkills = [...CUSTOM_SKILL_IDS]">全选</button>
            </div>
            <label v-for="s in BUILTIN_SKILLS" :key="s.id" class="cust-row">
              <input type="checkbox" :checked="customSkills.includes(s.id)" @change="toggleSkill(s.id)" />
              <span class="cust-text"><b>{{ s.name }}</b><span>{{ s.description }}</span></span>
            </label>

            <div class="cust-head">
              <b>助手</b>
              <span>已选 {{ customAgents.length }} / {{ BUILTIN_AGENTS.length }}</span>
              <button class="cust-link" type="button" @click="customAgents = [...ALL_AGENT_IDS]">全选</button>
            </div>
            <label v-for="a in BUILTIN_AGENTS" :key="a.id" class="cust-row">
              <input type="checkbox" :checked="customAgents.includes(a.id)" @change="toggleAgent(a.id)" />
              <span class="cust-text"><b>{{ a.name }}</b><span>{{ a.description }}</span></span>
            </label>
            <p class="note">关掉某个助手后，用到它的入口会提示先去设置里打开。</p>
          </div>

          <p class="note">
            两个技能要单独说：「始终说中文」默认生效，回答不会串成英文；
            「Markdown 杀手」默认关闭，需要把结果直接粘进 Word 或表格时，去设置里打开。
          </p>
        </section>

        <!-- 9 完成 -->
        <section v-else key="9" class="screen done">
          <div class="done-mark">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 5 5L19 7" /></svg>
          </div>
          <h2 class="screen-title">准备就绪</h2>
          <p class="screen-sub">这些设置都还能在「设置」里改。</p>

          <div class="group">
            <div class="row-item static between">
              <span class="row-text"><span>主题</span></span>
              <b class="val">{{ theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色' }}</b>
            </div>
            <div class="row-item static between">
              <span class="row-text"><span>动效</span></span>
              <b class="val">{{ motion === 'on' ? '开启' : '关闭' }}</b>
            </div>
            <div class="row-item static between">
              <span class="row-text"><span>字体</span></span>
              <b class="val">{{ font === 'harmony' ? 'HarmonyOS Sans' : '系统字体' }}</b>
            </div>
            <div class="row-item static between">
              <span class="row-text"><span>AI 模式</span></span>
              <b class="val">{{ aiMode === 'assist' ? 'AI 辅助' : 'AI 主导辅助' }}</b>
            </div>
            <div class="row-item static between">
              <span class="row-text"><span>模式</span></span>
              <b class="val">{{ wantsDev ? '开发者' : '普通' }}</b>
            </div>
            <div class="row-item static between">
              <span class="row-text"><span>技能与助手</span></span>
              <b class="val">{{ skillMode === 'all' ? '全部启用' : skillMode === 'basic' ? '只开基础' : `自定义 ${customSkills.length} / ${customAgents.length}` }}</b>
            </div>
            <div class="row-item static between">
              <span class="row-text"><span>每日预算</span></span>
              <b class="val">{{ dailyCost ? `¥${dailyCost}` : '不限' }}</b>
            </div>
          </div>

          <div class="group" style="margin-top: var(--sp-4)">
            <div class="row-item static">
              <span class="row-text">
                <b>建议下一步</b>
                <span>新建项目，把教师要求粘贴进来</span>
              </span>
            </div>
            <div class="row-item static">
              <span class="row-text">
                <b>需要 AI 时</b>
                <span>设置 → API 管理中心，填入你自己的密钥或接本地模型</span>
              </span>
            </div>
          </div>
        </section>
      </transition>
    </div>

    <footer class="actions">
      <p v-if="blockHint" class="block-hint">{{ blockHint }}</p>
      <button v-if="step < total - 1" class="btn btn-primary btn-block" :disabled="!canNext" @click="next">
        继续
      </button>
      <button v-else class="btn btn-primary btn-block" :disabled="saving || !canNext" @click="finish()">
        {{ saving ? '保存中…' : replay ? '完成' : '开始使用' }}
      </button>
      <button v-if="replay && step < total - 1" class="ghost-skip" type="button" @click="finish()">
        退出引导
      </button>
      <p class="legal">第三方工具 · 非学校官方项目</p>
    </footer>
    </div>
    </transition>
  </div>
</template>

<style scoped>
.activation {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--glow), var(--bg);
}

/* 开场 Welcome：整屏一句「你好」，信息按呼吸感排布，底部只留一个继续 */
.welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 460px;
  margin: 0 auto;
  padding: calc(var(--sp-6) + var(--safe-top, env(safe-area-inset-top, 0px))) var(--sp-6)
    calc(var(--sp-6) + var(--safe-bottom, env(safe-area-inset-bottom, 0px)));
}
.welcome-body { margin: auto 0; }
.welcome-icon {
  width: 58px; height: 58px; border-radius: 15px;
  display: block;
  margin-bottom: clamp(28px, 7vh, 56px);
  animation: w-scale var(--dur-4) var(--ease-out) both;
}
.welcome-hi {
  margin: 0;
  font-size: clamp(54px, 13vw, 86px);
  line-height: 1;
  font-weight: 600;
  letter-spacing: -0.045em;
  animation: w-rise var(--dur-4) var(--ease-out) both;
}
.welcome-name {
  margin: clamp(14px, 2.4vh, 22px) 0 0;
  font-size: clamp(19px, 4.4vw, 24px);
  font-weight: var(--fw-medium);
  letter-spacing: -0.02em;
  animation: w-rise var(--dur-4) var(--ease-out) 80ms both;
}
.welcome-lede {
  margin: 10px 0 0;
  font-size: 13.5px;
  line-height: 1.85;
  color: var(--text-3);
  animation: w-rise var(--dur-4) var(--ease-out) 150ms both;
}
.welcome-foot { margin-top: auto; padding-top: var(--sp-6); }
.welcome-legal {
  margin: 12px 0 0;
  text-align: center;
  font-size: 10.5px;
  color: var(--text-3);
}
@keyframes w-rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
@keyframes w-scale {
  from { opacity: 0; transform: scale(0.94); }
  to { opacity: 1; transform: none; }
}

.bar {
  display: flex;  align-items: center;
  gap: var(--sp-3);
  padding: calc(var(--sp-4) + var(--safe-top, env(safe-area-inset-top, 0px))) var(--sp-4) 0;
  height: calc(var(--nav-h) + var(--safe-top, env(safe-area-inset-top, 0px)));
}
.bar-back {
  width: 32px; height: 32px;
  display: grid; place-items: center;
  border: none; background: transparent;
  color: var(--text-2); border-radius: var(--r-1); cursor: pointer;
  transition: background var(--dur-2) var(--ease-out);
}
.bar-back:hover { background: var(--surface-2); color: var(--text); }
.track { flex: 1; height: 3px; border-radius: var(--r-full); background: var(--surface-3); overflow: hidden; }
.track-fill {
  height: 100%; background: var(--primary); border-radius: var(--r-full);
  transition: width var(--dur-4) var(--ease-out);
}
.step-no { font-size: 11.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.skip {
  border: none; background: none; padding: 4px 2px 4px 10px;
  font-size: 12.5px; color: var(--text-3); cursor: pointer;
  transition: color var(--dur-2) var(--ease-out);
}
.skip:hover { color: var(--text); }
.inline-model {
  display: flex; flex-direction: column; gap: 8px;
  margin: var(--sp-5) 0 0;
  padding: var(--sp-3);
  border-radius: var(--r-3);
  background: var(--surface);
}
.inline-msg {
  margin: 0; font-size: 11.5px; line-height: 1.65; color: var(--text-3);
}
.inline-msg.ok { color: var(--ok); }
.inline-msg.fail { color: var(--danger); }

.mode-pick { display: flex; flex-direction: column; gap: 10px; margin-top: var(--sp-4); }
.mode-card {
  display: flex; flex-direction: column; gap: 5px;
  padding: 14px 16px; text-align: left;
  border: none; border-radius: var(--r-3);
  background: var(--surface); color: var(--text-2);
  font: inherit; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out);
}
.mode-card.on { background: var(--surface-2); box-shadow: 0 0 0 1.5px var(--line-strong); }
.mode-card b { font-size: 14px; color: var(--text); }
.mode-card span { font-size: 12px; line-height: 1.7; color: var(--text-3); }

/* 自定义：逐项勾选，实底分层，不用第二个浮层 */
.cust-box { margin-top: 12px; display: flex; flex-direction: column; }
.cust-head { display: flex; align-items: center; gap: 8px; margin: 14px 0 6px; font-size: var(--fs-1); }
.cust-head b { color: var(--text); font-weight: var(--fw-strong); }
.cust-head span { color: var(--text-3); font-variant-numeric: tabular-nums; }
.cust-link { margin-left: auto; border: none; background: none; color: var(--primary); font-size: var(--fs-1); cursor: pointer; }
.cust-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 9px 12px; margin-bottom: 4px;
  border-radius: var(--r-2); background: var(--surface); cursor: pointer;
}
.cust-row input { margin-top: 3px; width: 16px; height: 16px; flex: 0 0 16px; accent-color: var(--primary); }
.cust-row input:focus-visible { outline: none; border-radius: 4px; box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--primary-soft); }
.cust-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cust-text b { font-size: var(--fs-1); font-weight: var(--fw-medium); color: var(--text); }
.cust-text span { font-size: 10.5px; line-height: 1.6; color: var(--text-3); }

.ghost-skip {
  width: 100%; margin-top: 8px; border: none; background: none;
  font-size: 12px; color: var(--text-3); cursor: pointer; padding: 6px;
}
.ghost-skip:hover { color: var(--text-2); }

.stage {
  flex: 1; width: 100%; max-width: 460px; margin: 0 auto;
  padding: var(--sp-5) var(--sp-6) var(--sp-4);
  display: flex; flex-direction: column; overflow-y: auto;
}
.crumb {
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-3); margin: 0 0 var(--sp-4);
}
.screen { display: flex; flex-direction: column; }

.app-icon {
  width: 88px; height: 88px; border-radius: 22px;
  display: block; margin: var(--sp-6) auto var(--sp-5);
}
.display { font-size: var(--fs-6); text-align: center; letter-spacing: -0.03em; line-height: 1.3; }
.lede {
  text-align: center; color: var(--text-2);
  font-size: var(--fs-2); margin: var(--sp-2) 0 var(--sp-8);
}

.facts {
  list-style: none; display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 1px; padding: 0; margin: 0 0 var(--sp-6);
  background: var(--line); border: 1px solid var(--line);
  border-radius: var(--r-2); overflow: hidden;
}
.facts li {
  background: var(--surface); padding: var(--sp-4) var(--sp-1);
  text-align: center; display: flex; flex-direction: column; gap: 2px;
}
.facts b { font-size: var(--fs-4); line-height: 1.2; letter-spacing: -0.02em; }
.facts span { font-size: 11.5px; color: var(--text-3); }

.note { font-size: var(--fs-1); color: var(--text-3); line-height: 1.72; margin: var(--sp-2) 0 0; }

.screen-title { font-size: var(--fs-4); letter-spacing: -0.02em; margin-bottom: var(--sp-2); }
.screen-sub { font-size: var(--fs-1); color: var(--text-2); line-height: 1.7; margin: 0 0 var(--sp-4); }
.label { font-size: var(--fs-1); color: var(--text-3); font-weight: var(--fw-strong); margin-bottom: var(--sp-2); }

/* 法务全文 */
.doc {
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: var(--surface);
  padding: var(--sp-4);
}
.doc-sec + .doc-sec { margin-top: var(--sp-4); }
.doc-sec h3 {
  font-size: var(--fs-2); font-weight: var(--fw-strong);
  color: var(--text); margin: 0 0 6px;
}
.doc-sec p {
  font-size: var(--fs-1); color: var(--text-2);
  line-height: 1.8; margin: 0; white-space: pre-wrap;
}
/* 法务表格在窄屏折成卡片，正文随页面滚动，不塞进固定高度的小框 */
.doc-tbl { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.doc-card { padding: 10px 12px; border-radius: var(--r-2); background: var(--surface-2); }
.doc-card b { display: block; font-size: var(--fs-1); color: var(--text); margin-bottom: 6px; }
.doc-card dl { margin: 0; display: flex; flex-direction: column; gap: 5px; }
.doc-card dl > div { display: flex; flex-direction: column; gap: 1px; }
.doc-card dt { font-size: 10.5px; color: var(--text-3); }
.doc-card dd { margin: 0; font-size: 11.5px; line-height: 1.7; color: var(--text-2); }

.read-hint {
  margin: var(--sp-3) 0 0;
  font-size: 11.5px;
  color: var(--text-3);
  display: flex; align-items: center; gap: 6px;
}
.read-hint::before {
  content: '';
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--text-3);
}
.read-hint.ok { color: var(--ok, #2e7d32); }
.read-hint.ok::before { background: currentColor; }

.agree-row {
  display: flex; align-items: flex-start; gap: var(--sp-3);
  margin-top: var(--sp-4); padding: var(--sp-3) var(--sp-4);
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-2); cursor: pointer;
  transition: border-color var(--dur-2) var(--ease-out);
}
.agree-row:hover { border-color: var(--line-strong); }
.agree-text { font-size: var(--fs-1); color: var(--text-2); line-height: 1.6; }
.agree-text b { color: var(--text); font-weight: var(--fw-strong); }

.check {
  width: 21px; height: 21px; flex: 0 0 21px;
  border-radius: 50%; border: 1.5px solid var(--line-strong);
  display: grid; place-items: center; margin-top: 1px;
  color: var(--on-primary);
  transition: background var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out);
}
.check.on { background: var(--primary); border-color: var(--primary); }
.sr { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }

.group {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-2); overflow: hidden;
}
.row-item {
  display: flex; gap: var(--sp-3); align-items: flex-start;
  padding: var(--sp-3) var(--sp-4);
  border: none; border-bottom: 1px solid var(--line);
  background: transparent; color: var(--text);
  width: 100%; text-align: left;
}
.row-item:last-child { border-bottom: none; }
.row-item.static { cursor: default; }
.row-item.between { align-items: center; justify-content: space-between; }
.row-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.row-text b { font-size: var(--fs-2); font-weight: var(--fw-medium); }
.row-text span { font-size: var(--fs-1); color: var(--text-2); line-height: 1.65; }
.val { font-size: var(--fs-2); font-weight: var(--fw-strong); }
.num {
  width: 84px; text-align: right;
  border: 1px solid var(--line); border-radius: var(--r-1);
  background: var(--surface-2); color: var(--text);
  padding: 7px 10px; font-size: var(--fs-2);
  font-variant-numeric: tabular-nums;
}
.num:focus { outline: 2px solid var(--primary-soft); border-color: var(--primary); }

.seg { display: flex; gap: 2px; padding: 3px; background: var(--surface-3); border-radius: var(--r-full); }
.seg-item {
  flex: 1; min-height: 34px; border: none; background: transparent;
  border-radius: var(--r-full); color: var(--text-2);
  font-size: var(--fs-1); font-weight: var(--fw-medium); cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.seg-item.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-1); }

.switch { position: relative; width: 46px; height: 28px; flex: 0 0 46px; cursor: pointer; }
.switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.switch span {
  position: absolute; inset: 0; border-radius: var(--r-full);
  background: var(--surface-3); transition: background var(--dur-3) var(--ease-out);
}
.switch span::after {
  content: ''; position: absolute; top: 3px; left: 3px;
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--surface); box-shadow: var(--shadow-1);
  transition: transform var(--dur-3) var(--ease-out);
}
.switch input:checked + span { background: var(--primary); }
.switch input:checked + span::after { transform: translateX(18px); }

/* 预览点只在自己的轨道里跑，状态文字固定在右边，不再压到说明文字上 */
.motion-demo {
  display: flex; align-items: center; justify-content: flex-end; gap: var(--sp-3);
  margin: var(--sp-5) 0 var(--sp-4) auto;
  padding: 10px 14px; width: fit-content; max-width: 100%;
  border-radius: var(--r-full); border: 1px dashed var(--line-strong);
}
.demo-track { position: relative; flex: 0 0 96px; height: 10px; border-radius: var(--r-full); background: var(--surface-2); }
.motion-demo .dot {
  position: absolute; top: 0; left: 0;
  width: 10px; height: 10px; border-radius: 50%; background: var(--primary);
  animation: travel 1600ms var(--ease-out) infinite alternate;
}
.motion-demo.still .dot { animation: none; left: 86px; }
.demo-label { font-size: var(--fs-1); color: var(--text-3); white-space: nowrap; }
@keyframes travel { from { left: 0; } to { left: 86px; } }

/* 教学 */
.how { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.how li {
  display: flex; gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-2);
}
.how-no {
  width: 22px; height: 22px; flex: 0 0 22px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--primary-soft); color: var(--primary);
  font-size: 11.5px; font-weight: var(--fw-strong); margin-top: 1px;
}
.how b { font-size: var(--fs-2); font-weight: var(--fw-strong); }
.how p { font-size: var(--fs-1); color: var(--text-2); line-height: 1.7; margin: 4px 0 0; }
.tip {
  margin-top: var(--sp-4); padding: var(--sp-4);
  border-radius: var(--r-2);
  background: var(--surface-2); border-left: 2px solid var(--warn);
}
.tip b { font-size: var(--fs-2); }
.tip p { font-size: var(--fs-1); color: var(--text-2); line-height: 1.7; margin: 5px 0 0; }

.done-mark {
  width: 64px; height: 64px; border-radius: 50%;
  margin: var(--sp-6) auto var(--sp-5);
  display: grid; place-items: center;
  background: var(--primary-soft); color: var(--primary);
  animation: pop var(--dur-4) var(--ease-out);
}
@keyframes pop { from { transform: scale(0.7); opacity: 0; } to { transform: none; opacity: 1; } }
.done .screen-title { text-align: center; }
.done .screen-sub { text-align: center; }

.actions {
  width: 100%; max-width: 460px; margin: 0 auto;
  padding: var(--sp-3) var(--sp-6) calc(var(--sp-4) + var(--safe-bottom, env(safe-area-inset-bottom, 0px)));
  display: flex; flex-direction: column; gap: var(--sp-2);
  background: var(--bg); border-top: 1px solid var(--line);
}
.actions .btn { min-height: 48px; }
.block-hint { margin: 0; text-align: center; font-size: 11.5px; color: var(--warn); }
.legal { margin: 0; text-align: center; font-size: 10.5px; color: var(--text-3); letter-spacing: 0.02em; }

.slide-next-enter-active,
.slide-next-leave-active,
.slide-prev-enter-active,
.slide-prev-leave-active {
  transition: opacity var(--dur-4) var(--ease-out), transform var(--dur-4) var(--ease-out);
}
.slide-next-enter-from { opacity: 0; transform: translateX(26px); }
.slide-next-leave-to { opacity: 0; transform: translateX(-26px); }
.slide-prev-enter-from { opacity: 0; transform: translateX(-26px); }
.slide-prev-leave-to { opacity: 0; transform: translateX(26px); }

/* 引导主体整体：flex 撑满，让 stage 滚动、footer 固定 */
.guide { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.bar-fade-enter-active, .bar-fade-leave-active { transition: opacity var(--dur-3) var(--ease-out); }
.bar-fade-enter-from, .bar-fade-leave-to { opacity: 0; }

@media (max-width: 480px) {
  .stage { padding: var(--sp-4) var(--sp-4) var(--sp-3); }
  .actions { padding: var(--sp-3) var(--sp-4) calc(var(--sp-3) + var(--safe-bottom, env(safe-area-inset-bottom, 0px))); }
  .display { font-size: 30px; }
}
</style>
