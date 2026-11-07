<script setup lang="ts">
/**
 * 设置
 *
 * 常用项直接放在首页改（主题、字体、动效、通知、语音、记忆、预算），
 * 只有真正需要一屏空间的功能才进二级页（账号、API、检索、指引、数据、常用语）。
 * 开发者选项收进「其他设置」，普通用户不会在首页看到。
 */
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import AppAvatar from '../components/AppAvatar.vue';
import { askConfirm } from '../core/task-guard';
import SettingGroup from '../components/settings/SettingGroup.vue';
import SettingRow from '../components/settings/SettingRow.vue';
import AccountPanel from './settings/AccountPanel.vue';
import DataPanel from './settings/DataPanel.vue';
import StoragePanel from './settings/StoragePanel.vue';
import GeneralPanel from './settings/GeneralPanel.vue';
import HelpPanel from './settings/HelpPanel.vue';
import ApiCenter from './settings/ApiCenter.vue';
import SearchCenter from './settings/SearchCenter.vue';
import GuideCenter from './settings/GuideCenter.vue';
import PersonalizationPanel from './settings/PersonalizationPanel.vue';
import SubscriptionPanel from './settings/SubscriptionPanel.vue';
import Changelog from './settings/Changelog.vue';
import AppIcon from '../components/settings/AppIcon.vue';
import { loadVoices, voiceOptions } from '../core/voice';
import { BUILTIN_SKILLS } from '../skills/definitions';
import { BUILTIN_AGENTS } from '../agents/definitions';
import { backOr } from '../core/nav';
import { SITE } from '../config/site';
import { openExternal } from '../core/shell';

const app = useAppStore();
const route = useRoute();
const router = useRouter();

/** 开发者面板按需加载，普通用户不会下载到这段代码 */
const DevPanel = defineAsyncComponent(() => import('./DevPanel.vue'));

const PANELS = [
  'account',
  'notifications',
  'appearance',
  'voice',
  'features',
  'subscription',
  'model',
  'search',
  'catalog',
  'memory',
  'session',
  'phrases',
  'help',
  'feedback',
  'about',
  'update',
  'changelog',
  'data',
  'storage',
  'other',
  'developer',
] as const;
type Panel = (typeof PANELS)[number];

const tab = computed<Panel | null>(() => {
  const t = String(route.params.tab ?? '');
  return (PANELS as readonly string[]).includes(t) ? (t as Panel) : null;
});

/**
 * 这个实例创建时是不是二级页。
 * 关键：卸载时 route 已经换成新地址，读 tab.value 会拿到「下一个页面」；
 * 必须用实例自己的快照，否则永远判断错，位置就存不下来。
 */
const opensAsPanel = tab.value !== null;

/** 二级页进退场方向：前进向右、返回向左 */
const dir = ref<'fwd' | 'back'>('fwd');
watch(tab, (n, o) => {
  if (o === null && n !== null) dir.value = 'fwd';
  else if (o !== null && n === null) dir.value = 'back';
  else dir.value = 'fwd';
});

function go(t: Panel) {
  router.push(`/settings/${t}`);
}

/** 在线版入口：未成年人模式隐藏外链时一并收起 */
function openOnline() {
  if (!showSupport.value) {
    app.toast('未成年人模式已隐藏外部链接', 'info');
    return;
  }
  openExternal(SITE.online);
}

function back() {
  backOr(router, '/settings');
}

const minorOn = computed(() => app.settings.minor.enabled);
const feats = computed(() => app.settings.features);
const s = computed(() => app.settings);

const themeLabel = computed(
  () => ({ system: '跟随系统', light: '浅色', dark: '深色' })[s.value.theme],
);
const voiceLabel = computed(() => (s.value.voice.enabled ? '开启' : '关闭'));
const searchEnabled = computed(() => s.value.searchProviders.filter((p) => p.enabled).length);

/** 未成年人模式下隐藏外链与支持入口 */
const showSupport = computed(() => !(minorOn.value && s.value.minor.hideExternal));

/**
 * 滚动位置：进二级页时记住设置首页停在哪，返回首页时落回原处；
 * 二级页本身从顶部开始。以前一律 scrollTo(0)，一返回就跳回顶端。
 *
 * 注意：App.vue 的 router-view 用 route.path 做 key，/settings 和 /settings/xxx
 * 是两次挂载，组件内的 watch / transition 钩子都不会跨页触发，
 * 所以位置存在模块级变量里（同一份 JS 模块，重建组件不丢）。
 */
let hubScrollTop = 0;
/** 上一次是怎么离开的：'hub' = 离开设置首页，'panel' = 从二级页返回 */
let leftAs: 'hub' | 'panel' | null = null;

function contentEl(): HTMLElement | null {
  return document.querySelector('.content') as HTMLElement | null;
}

/** 先同步落一次（赶在首帧绘制前，避免看到「顶部闪一下再跳」），再连几帧兜底 */
function pinScroll(el: HTMLElement, top: number) {
  el.scrollTop = top;
  if (top === 0) return;
  const deadline = performance.now() + 700;
  const tick = () => {
    el.scrollTop = top;
    if (Math.abs(el.scrollTop - top) < 2 || performance.now() > deadline) return;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

onMounted(() => {
  const el = contentEl();
  if (el) {
    // 只有「二级页 → 首页」才回到原处；从别处进设置、或直接敲地址，都从顶部开始
    const restore = !opensAsPanel && leftAs === 'panel';
    pinScroll(el, restore ? hubScrollTop : 0);
  }
  if (!opensAsPanel && leftAs === 'hub') hubScrollTop = 0;
  leftAs = null;
});

onBeforeUnmount(() => {
  const el = contentEl();
  if (!opensAsPanel) {
    leftAs = 'hub';
    if (el) hubScrollTop = el.scrollTop;
  } else {
    leftAs = 'panel';
  }
});

/* ---------------- 技能与助手：用户自己勾选 ---------------- */
const skillIds = BUILTIN_SKILLS.map((x) => x.id);
const agentIds = BUILTIN_AGENTS.map((x) => x.id);

/** 空数组 = 启用全部「默认开启」的技能；Markdown 杀手这类默认关的不算 */
const defaultSkillIds = BUILTIN_SKILLS.filter((x) => !x.defaultOff).map((x) => x.id);
const onSkills = computed(() => {
  const cur = app.settings.enabledSkills ?? [];
  return cur.length ? cur : defaultSkillIds;
});
const onAgents = computed(() => {
  const cur = app.settings.enabledAgents ?? [];
  return cur.length ? cur : agentIds;
});

async function toggleSkill(id: string, on: boolean) {
  // 从「全开」状态改单个时，先落成显式清单，否则关闭会被误解成「恢复全开」
  const cur = onSkills.value.slice();
  const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
  await app.saveSettings({ enabledSkills: next });
  app.toast(on ? '已启用' : '已关闭', 'ok', 1600);
}

async function toggleAgent(id: string, on: boolean) {
  const cur = onAgents.value.slice();
  const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
  await app.saveSettings({ enabledAgents: next });
  app.toast(on ? '已启用' : '已关闭', 'ok', 1600);
}

/* 首页直接改设置：每个操作立刻落库，不设「保存」按钮 */
async function setTheme(t: 'system' | 'light' | 'dark') {
  await app.setTheme(t);
}
async function setFont(f: 'harmony' | 'system') {
  await app.setFont(f);
}
async function setMotion(on: boolean) {
  await app.setMotion(on ? 'on' : 'off');
}
async function setAiMode(m: 'assist' | 'lead') {
  await app.saveSettings({ aiMode: m });
}
/** 缺材料时：留白待补充（默认）与写满再核对。写满要带免责声明 */
async function setGapMode(m: 'strict' | 'fill') {
  if (m === 'fill' && s.value.gapMode !== 'fill') {
    const ok = await askConfirm({
      title: '改成「写满再核对」？',
      message:
        '关了留白之后，AI 会把缺材料的章节尽量写满：推断处标「需核实」，具体数据仍留横线，结尾附免责声明。提交前必须逐条核对，不能直接交。',
      confirmText: '改成写满',
      cancelText: '保持留白',
      tone: 'warn',
    });
    if (!ok) return;
    app.toast('已切换为写满模式：生成内容需逐条核对后再提交。', 'warn', 4200);
  }
  await app.saveSettings({ gapMode: m });
}
const FONT_STEPS = [
  { v: 0.9, label: '小' },
  { v: 1, label: '标准' },
  { v: 1.1, label: '大' },
  { v: 1.2, label: '特大' },
];
async function setFontScale(v: number) {
  await app.saveSettings({ fontScale: v });
}
async function setTyping(k: 'fast' | 'normal' | 'slow') {
  await app.saveSettings({ typingSpeed: k });
}
async function toggleThinking(on: boolean) {
  await app.saveSettings({ thinking: on });
}
/**
 * 全自动工作流：默认关闭。打开前必须过一段风险确认——
 * 它不是主路径，随时可能下线，所以要把「自己核对、别依赖」说在前面。
 */
async function toggleAdvancedWorkflow(on: boolean) {
  if (!on) {
    await app.saveSettings({ advancedWorkflow: false });
    return;
  }
  const ok = await askConfirm({
    title: '开启全自动工作流？',
    message:
      '这个功能不推荐使用，后续版本可能直接移除。\n\n' +
      '它会顺着 22 步一口气往下跑，中间只停下来问你要不要确认；面板里看到的常常只是摘要，' +
      '正文仍然要回项目页逐份核对。\n\n' +
      '日常更省事的路子是用「研究记录」：每篇单独生成、单独确认、单独导出，写错了只改那一篇。\n\n' +
      '开启后请自行核对每一步的结果，不要指望它一次性交出整套材料。',
    confirmText: '我了解，仍要开启',
    cancelText: '保持关闭',
    tone: 'warn',
  });
  if (!ok) return;
  await app.saveSettings({ advancedWorkflow: true });
}

async function toggleMemory(on: boolean) {
  await app.setFeatures({ memory: on });
}
async function toggleNotice(key: 'deadline' | 'weekly' | 'aiDone' | 'system', on: boolean) {
  await app.setNotifications({ [key]: on });
}
async function toggleVoiceInline(on: boolean) {
  if (!on) {
    await app.setVoice({ enabled: false });
    return;
  }
  const opts = voiceOptions(await loadVoices());
  if (!opts.length) {
    app.toast('本机没有自然音色，不启用语音播报。', 'warn', 4500);
    return;
  }
  if (!s.value.voice.voice || !opts.some((v) => v.name === s.value.voice.voice)) {
    await app.setVoice({ voice: opts[0].name, enabled: true });
  } else {
    await app.setVoice({ enabled: true });
  }
}
async function setBudget(key: 'dailyCalls' | 'dailyCost', e: Event) {
  const v = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
  await app.saveSettings({ budget: { ...s.value.budget, [key]: v } });
}
</script>

<template>
  <div class="settings-page">
    <transition
    mode="out-in"
    :enter-active-class="'sub-enter-active'"
    :leave-active-class="'sub-leave-active'"
    :enter-from-class="dir === 'back' ? 'sub-back-enter-from' : 'sub-fwd-enter-from'"
    :leave-to-class="dir === 'back' ? 'sub-back-leave-to' : 'sub-fwd-leave-to'"
  >
      <!-- ================= 二级页 ================= -->
      <div v-if="tab" :key="tab" class="panel-wrap">
        <AccountPanel v-if="tab === 'account'" />
        <GeneralPanel v-else-if="tab === 'notifications'" kind="notifications" />
        <GeneralPanel v-else-if="tab === 'voice'" kind="voice" />
        <GeneralPanel v-else-if="tab === 'features'" kind="features" />
        <ApiCenter v-else-if="tab === 'model'" />
        <SearchCenter v-else-if="tab === 'search'" />
        <GuideCenter v-else-if="tab === 'catalog'" />
        <DataPanel v-else-if="tab === 'data'" />
        <StoragePanel v-else-if="tab === 'storage'" />
        <SubscriptionPanel v-else-if="tab === 'subscription'" />
        <PersonalizationPanel v-else-if="tab === 'memory'" kind="memory" />
        <PersonalizationPanel v-else-if="tab === 'session'" kind="session" />
        <PersonalizationPanel v-else-if="tab === 'phrases'" kind="phrases" />
        <HelpPanel v-else-if="tab === 'help'" kind="help" />
        <HelpPanel v-else-if="tab === 'feedback'" kind="feedback" />
        <HelpPanel v-else-if="tab === 'about'" kind="about" />
        <HelpPanel v-else-if="tab === 'update'" kind="update" />
        <Changelog v-else-if="tab === 'changelog'" />

        <!-- 其他设置：开发者选项收在这里 -->
        <div v-else-if="tab === 'other'" class="other">
          <header class="sub-head">
            <button class="back" type="button" aria-label="返回" @click="back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6" /></svg>
            </button>
            <h1>其他设置</h1>
          </header>
          <SettingGroup>
            <SettingRow label="关于研学帮" :value="`v${SITE.version}`" chevron @click="go('about')">
              <template #icon><AppIcon name="about" /></template>
            </SettingRow>
            <SettingRow label="更新日志" value="版本记录" chevron @click="go('changelog')">
              <template #icon><AppIcon name="changelog" /></template>
            </SettingRow>
            <SettingRow label="检查更新" :value="`v${SITE.version}`" chevron @click="go('update')">
              <template #icon><AppIcon name="update" /></template>
            </SettingRow>
            <SettingRow v-if="showSupport" label="在线版（免安装）" value="打开即用" chevron @click="openOnline">
              <template #icon><AppIcon name="about" /></template>
            </SettingRow>
            <SettingRow label="重新引导" value="重看设置流程" chevron @click="router.push('/onboarding?replay=1')">
              <template #icon><AppIcon name="restart" /></template>
            </SettingRow>
            <SettingRow label="用户协议" chevron @click="router.push('/legal/terms')">
              <template #icon><AppIcon name="terms" /></template>
            </SettingRow>
            <SettingRow label="隐私政策" chevron @click="router.push('/legal/privacy')">
              <template #icon><AppIcon name="privacy" /></template>
            </SettingRow>
            <SettingRow label="使用许可" value="学习免费" chevron @click="router.push('/legal/license')">
              <template #icon><AppIcon name="license" /></template>
            </SettingRow>
          </SettingGroup>
          <SettingGroup title="技能">
            <p class="note" style="margin: 0 0 8px">
              关掉的技能不会参与生成。想改规则或自己写一个，打开开发者模式。
            </p>
            <label v-for="sk in BUILTIN_SKILLS" :key="sk.id" class="pick">
              <input
                type="checkbox"
                :checked="onSkills.includes(sk.id)"
                @change="toggleSkill(sk.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="pick-text">
                <b>{{ sk.name }}</b>
                <span>{{ sk.description }}</span>
              </span>
            </label>
          </SettingGroup>

          <SettingGroup title="助手">
            <p class="note" style="margin: 0 0 8px">
              项目页的七个按钮会调用这些助手；关掉后对应步骤会跳过。
            </p>
            <label v-for="ag in BUILTIN_AGENTS" :key="ag.id" class="pick">
              <input
                type="checkbox"
                :checked="onAgents.includes(ag.id)"
                @change="toggleAgent(ag.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="pick-text">
                <b>{{ ag.name }}</b>
                <span>{{ ag.description }}</span>
              </span>
            </label>
          </SettingGroup>

          <SettingGroup title="高级功能">
            <SettingRow
              label="全自动工作流"
              :value="s.advancedWorkflow ? '已开启' : '未开启'"
              note="不推荐 · 即将下线。会把整套流程一口气跑完，中间只看摘要；日常请用「研究记录」逐篇生成"
            >
              <template #right>
                <label class="switch" @click.stop>
                  <input
                    type="checkbox"
                    :checked="s.advancedWorkflow === true"
                    @change="toggleAdvancedWorkflow(($event.target as HTMLInputElement).checked)"
                  />
                  <span />
                </label>
              </template>
            </SettingRow>
            <p class="note">
              关掉不会删除已有数据；已经跑出来的报告与记录照旧在项目里。开启前会让你先确认一次风险。
            </p>
          </SettingGroup>

          <SettingGroup title="开发者选项">
            <SettingRow
              label="开发者模式"
              :value="s.devMode ? '已开启' : '关闭'"
              note="开放 Agent、Skills、工作流与执行日志；普通使用不需要打开"
            >
              <template #right>
                <label class="switch" @click.stop>
                  <input
                    type="checkbox"
                    :checked="s.devMode"
                    @change="app.saveSettings({ devMode: ($event.target as HTMLInputElement).checked })"
                  />
                  <span />
                </label>
              </template>
            </SettingRow>
            <SettingRow
              v-if="s.devMode"
              label="开发者面板"
              note="Agent、Skills 与执行日志"
              chevron
              @click="go('developer')"
            >
              <template #icon><AppIcon name="dev" /></template>
            </SettingRow>
          </SettingGroup>
          <p class="note">开发者面板不在设置首页出现，需要先在这里打开开发者模式。</p>
        </div>

        <div v-else-if="tab === 'developer'" class="dev-wrap">
          <button class="btn btn-sm" type="button" style="margin-bottom: 14px" @click="back">← 返回设置</button>
          <DevPanel />
        </div>
      </div>

      <!-- ================= 设置主页 ================= -->
      <div v-else key="hub" class="hub">
        <header class="hub-head">
          <h1>设置</h1>
          <p>本机账号 · 数据只存在这台设备上</p>
        </header>

        <button class="me-card" type="button" @click="go('account')">
          <AppAvatar :name="app.displayName" :src="s.profile.avatar" :size="52" />
          <span class="me-text">
            <b>{{ app.displayName }}</b>
            <span>{{ s.profile.signature || '本机账号 · 未登录' }}</span>
          </span>
          <span v-if="minorOn" class="badge">未成年人模式</span>
          <span class="chev" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
          </span>
        </button>

        <!-- 外观：直接改 -->
        <SettingGroup title="外观">
          <div class="inline">
            <div class="inline-label">主题</div>
            <div class="seg">
              <button
                v-for="t in (['system', 'light', 'dark'] as const)"
                :key="t"
                class="seg-item"
                :class="{ on: s.theme === t }"
                type="button"
                @click="setTheme(t)"
              >
                {{ t === 'system' ? '跟随系统' : t === 'light' ? '浅色' : '深色' }}
              </button>
            </div>
          </div>
          <div class="inline">
            <div class="inline-label">字体</div>
            <div class="seg">
              <button class="seg-item" :class="{ on: s.font === 'harmony' }" type="button" @click="setFont('harmony')">
                HarmonyOS Sans
              </button>
              <button class="seg-item" :class="{ on: s.font === 'system' }" type="button" @click="setFont('system')">
                系统字体
              </button>
            </div>
          </div>
          <div class="inline">
            <div class="inline-label">
              字号
              <span class="inline-hint">全站文字大小</span>
            </div>
            <div class="seg">
              <button
                v-for="f in FONT_STEPS"
                :key="f.v"
                class="seg-item"
                :class="{ on: Math.abs((s.fontScale ?? 1) - f.v) < 0.01 }"
                type="button"
                @click="setFontScale(f.v)"
              >
                {{ f.label }}
              </button>
            </div>
          </div>
          <div class="inline">
            <div class="inline-label">
              界面动效
              <span class="inline-hint">页面与抽屉过渡</span>
            </div>
            <label class="switch">
              <input type="checkbox" :checked="s.motion === 'on'" @change="setMotion(($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </div>
        </SettingGroup>

        <!-- 通知：直接改 -->
        <SettingGroup title="通知" note="全部为本地提醒，不申请推送权限">
          <div class="inline">
            <div class="inline-label">阶段截止提醒</div>
            <label class="switch">
              <input type="checkbox" :checked="s.notifications.deadline" @change="toggleNotice('deadline', ($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </div>
          <div class="inline">
            <div class="inline-label">每周进度小结</div>
            <label class="switch">
              <input type="checkbox" :checked="s.notifications.weekly" @change="toggleNotice('weekly', ($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </div>
          <div class="inline">
            <div class="inline-label">AI 任务完成提示</div>
            <label class="switch">
              <input type="checkbox" :checked="s.notifications.aiDone" @change="toggleNotice('aiDone', ($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </div>
          <div class="inline">
            <div class="inline-label">系统与更新提示</div>
            <label class="switch">
              <input type="checkbox" :checked="s.notifications.system" @change="toggleNotice('system', ($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </div>
        </SettingGroup>

        <!-- 语音：开关直接给，音色进二级页 -->
        <SettingGroup title="语音" note="只使用自然音色；没有自然音色就不朗读">
          <div class="inline">
            <div class="inline-label">
              语音播报
              <span class="inline-hint">{{ voiceLabel }}<template v-if="s.voice.enabled"> · {{ s.voice.voice }}</template></span>
            </div>
            <label class="switch">
              <input type="checkbox" :checked="s.voice.enabled" @change="toggleVoiceInline(($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </div>
          <SettingRow label="音色与试听" value="检测本机音色" chevron @click="go('voice')">
            <template #icon><AppIcon name="voice" /></template>
          </SettingRow>
        </SettingGroup>

        <!-- 模型与检索 -->
        <SettingGroup title="模型与检索">
          <SettingRow label="API 管理中心" :value="s.currentModel?.model || '未接入'" chevron @click="go('model')">
            <template #icon><AppIcon name="chip" /></template>
          </SettingRow>
          <SettingRow label="检索与来源" :value="`${searchEnabled} 个启用`" note="检索服务与学术来源" chevron @click="go('search')">
            <template #icon><AppIcon name="search" /></template>
          </SettingRow>
          <SettingRow label="免费 API 指引" note="官网、额度、取 Key 与配置示例" chevron @click="go('catalog')">
            <template #icon><AppIcon name="book" /></template>
          </SettingRow>
          <div class="inline">
            <div class="inline-label">
              每日预算（元）
              <span class="inline-hint">0 表示不限，仅提醒不扣款</span>
            </div>
            <input
              class="num"
              type="number"
              min="0"
              step="0.5"
              :value="s.budget.dailyCost"
              @change="setBudget('dailyCost', $event)"
            />
          </div>
          <div class="inline">
            <div class="inline-label">每日调用次数上限</div>
            <input
              class="num"
              type="number"
              min="0"
              max="9999"
              :value="s.budget.dailyCalls"
              @change="setBudget('dailyCalls', $event)"
            />
          </div>
        </SettingGroup>

        <!-- 个性化 -->
        <SettingGroup title="个性化">
          <div class="inline">
            <div class="inline-label">
              记忆
              <span class="inline-hint">生成时带上项目主题、成员与已写内容</span>
            </div>
            <label class="switch">
              <input type="checkbox" :checked="feats.memory" @change="toggleMemory(($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </div>
          <div class="inline">
            <div class="inline-label">AI 工作模式</div>
            <div class="seg">
              <button class="seg-item" :class="{ on: s.aiMode === 'assist' }" type="button" @click="setAiMode('assist')">AI 辅助</button>
              <button class="seg-item" :class="{ on: s.aiMode === 'lead' }" type="button" @click="setAiMode('lead')">AI 主导</button>
            </div>
          </div>
          <div class="inline">
            <div class="inline-label">
              缺材料时
              <span class="inline-hint">留白 = 允许「待补充」空着，不编数据；写满的内容会标注需核实</span>
            </div>
            <div class="seg">
              <button class="seg-item" :class="{ on: s.gapMode === 'strict' }" type="button" @click="setGapMode('strict')">
                留白待补充
              </button>
              <button class="seg-item" :class="{ on: s.gapMode === 'fill' }" type="button" @click="setGapMode('fill')">
                写满再核对
              </button>
            </div>
          </div>
          <div class="inline">
            <div class="inline-label">
              起草前先检索
              <span class="inline-hint">写报告前按课题名查一次文献，结果只当线索并标「待核实」，不会自动进来源表</span>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                :checked="s.prefetchBeforeWrite !== false"
                @change="app.saveSettings({ prefetchBeforeWrite: ($event.target as HTMLInputElement).checked })"
              />
              <span />
            </label>
          </div>
          <div class="inline">
            <div class="inline-label">
              打字流速度
              <span class="inline-hint">适中约等于正常阅读速度</span>
            </div>
            <div class="seg">
              <button class="seg-item" :class="{ on: (s.typingSpeed ?? 'normal') === 'fast' }" type="button" @click="setTyping('fast')">快速</button>
              <button class="seg-item" :class="{ on: (s.typingSpeed ?? 'normal') === 'normal' }" type="button" @click="setTyping('normal')">适中</button>
              <button class="seg-item" :class="{ on: (s.typingSpeed ?? 'normal') === 'slow' }" type="button" @click="setTyping('slow')">较慢</button>
            </div>
          </div>
          <div class="inline">
            <div class="inline-label">
              深度思考
              <span class="inline-hint">只对支持思考的模型生效，会展示思考过程</span>
            </div>
            <label class="switch">
              <input type="checkbox" :checked="s.thinking === true" @change="toggleThinking(($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </div>
          <SettingRow label="常用语" :value="`${s.phrases.length} 条`" chevron @click="go('phrases')">
            <template #icon><AppIcon name="phrases" /></template>
          </SettingRow>
        </SettingGroup>

        <!-- 订阅与数据 -->
        <SettingGroup title="订阅与数据">
          <SettingRow label="订阅与用量" value="Free · 无付费墙" note="调用次数、Token、估算费用" chevron @click="go('subscription')">
            <template #icon><AppIcon name="subscription" /></template>
          </SettingRow>
          <SettingRow label="存储与空间" value="占用、缓存、语音文件" chevron @click="go('storage')">
            <template #icon><AppIcon name="storage" /></template>
          </SettingRow>
          <SettingRow label="数据与备份" value="导出 / 恢复 / 清档" chevron @click="go('data')">
            <template #icon><AppIcon name="invoice" /></template>
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="帮助">
          <SettingRow label="帮助中心" chevron @click="go('help')">
            <template #icon><AppIcon name="help" /></template>
          </SettingRow>
          <!-- 未成年人模式也允许反馈与检查更新，只隐藏娱乐/赞助类外链 -->
          <SettingRow label="反馈问题" chevron @click="go('feedback')">
            <template #icon><AppIcon name="feedback" /></template>
          </SettingRow>
          <SettingRow label="其他设置" note="关于、更新、协议、重新引导、开发者选项" chevron @click="go('other')">
            <template #icon><AppIcon name="more" /></template>
          </SettingRow>
        </SettingGroup>

        <p class="ver-line">
          研学帮 StudyMate v{{ SITE.version }} · 使用许可<br />
          个人开发的第三方工具，与学校及其管理部门无隶属、授权、合作或背书关系。
        </p>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.pick {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 9px 4px; cursor: pointer;
}
.pick input { width: 17px; height: 17px; flex: 0 0 17px; margin-top: 2px; accent-color: var(--primary); }
.pick-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pick-text b { font-size: calc(13px * var(--font-scale)); font-weight: var(--fw-medium); }
.pick-text span { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); line-height: 1.6; }
.settings-page { max-width: 720px; margin: 0 auto; padding: 4px 20px 72px; }
.hub-head { padding: 4px 2px 16px; }
.hub-head h1 { margin: 0; font-size: calc(26px * var(--font-scale)); letter-spacing: -0.02em; }
.hub-head p { margin: 6px 0 0; font-size: calc(12px * var(--font-scale)); color: var(--text-3); }

.me-card {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 14px 16px; margin-bottom: 18px;
  background: var(--surface); border: none; border-radius: var(--r-3);
  color: var(--text); font: inherit; text-align: left; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.me-card:hover { background: var(--surface-2); }
.me-card:active { transform: scale(0.995); }
.me-text { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.me-text b { font-size: calc(16px * var(--font-scale)); font-weight: var(--fw-strong); }
.me-text span { font-size: calc(12px * var(--font-scale)); color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge {
  font-size: calc(10.5px * var(--font-scale)); padding: 3px 8px; border-radius: var(--r-full);
  background: var(--primary-soft, rgba(31, 79, 216, 0.1)); color: var(--primary);
  white-space: nowrap;
}
.chev { display: inline-flex; color: var(--text-3); }

/* 首页内联控件：一行放得下就不进二级页 */
.inline {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; min-height: 46px; padding: 8px 14px;
}
.inline + .inline { border-top: 1px solid var(--line); }
.inline-label { font-size: var(--fs-2); color: var(--text); display: flex; flex-direction: column; gap: 2px; }
.inline-hint { font-size: calc(10.5px * var(--font-scale)); color: var(--text-3); }
.seg {
  display: inline-flex; gap: 2px; padding: 2px; flex: 0 0 auto;
  background: var(--surface-2); border-radius: var(--r-2);
}
.seg-item {
  border: none; background: transparent; color: var(--text-3);
  font-size: calc(11.5px * var(--font-scale)); padding: 5px 10px; border-radius: calc(var(--r-2) - 2px);
  cursor: pointer; white-space: nowrap;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.seg-item.on { background: var(--surface); color: var(--text); font-weight: var(--fw-medium); }
.num {
  width: 84px; flex: 0 0 84px; text-align: right;
  border: none; border-radius: var(--r-2); background: var(--surface-2);
  color: var(--text); font-size: calc(12.5px * var(--font-scale)); padding: 6px 8px;
  font-variant-numeric: tabular-nums;
}

.other { padding-top: 4px; }
.sub-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.sub-head h1 { margin: 0; font-size: calc(17px * var(--font-scale)); font-weight: var(--fw-strong); }
.back {
  width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center;
  border: none; border-radius: 50%; background: var(--surface-2);
  color: var(--text-2); cursor: pointer;
}
.back:hover { background: var(--surface-3); }

.ver-line {
  margin: 22px 0 0; text-align: center;
  font-size: calc(10.5px * var(--font-scale)); line-height: 1.8; color: var(--text-3);
}
.panel-wrap { padding: 0; }
.dev-wrap { padding-top: 8px; }
.note { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); line-height: 1.7; margin: 10px 2px 0; }

/* 二级页进退场：轻微横向位移 + 淡入，方向感比纯淡入清楚 */
.sub-enter-active { transition: opacity var(--dur-3) var(--ease-out), transform var(--dur-3) var(--ease-out); }
.sub-leave-active { transition: opacity var(--dur-2) var(--ease-in), transform var(--dur-2) var(--ease-in); }
.sub-fwd-enter-from { opacity: 0; transform: translateX(14px); }
.sub-fwd-leave-to { opacity: 0; transform: translateX(-10px); }
.sub-back-enter-from { opacity: 0; transform: translateX(-14px); }
.sub-back-leave-to { opacity: 0; transform: translateX(10px); }

@media (max-width: 860px) {
  .settings-page { padding: 0 16px 56px; }
  .hub-head { padding: 2px 2px 14px; }
  .hub-head h1 { font-size: calc(24px * var(--font-scale)); }
  .inline { min-height: 50px; padding: 9px 12px; }
  .seg-item { padding: 5px 9px; font-size: calc(11px * var(--font-scale)); }
}
</style>
