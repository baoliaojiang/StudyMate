<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from './stores/app';
import { useProjectStore } from './stores/projects';
import { NAV_ICONS } from './nav';
import ModelPicker from './components/ModelPicker.vue';
import SideNav from './components/SideNav.vue';
import GlobalConfirm from './components/GlobalConfirm.vue';
import StartupUpdateModal from './components/StartupUpdateModal.vue';
import { bypassLeaveOnce, closeTopOverlay, confirmLeave, pushOverlay } from './core/task-guard';
import { checkStartupUpdate, markUpdateLater, type StartupUpdate } from './core/startup-update';
import { skipRateLimitWait } from './ai/http';

const app = useAppStore();
const projects = useProjectStore();
const route = useRoute();
const router = useRouter();
const drawer = computed({
  get: () => app.drawer,
  set: (v: boolean) => {
    app.drawer = v;
  },
});
/** 菜单按钮的右移反馈：按下时图标向右滑，抽屉随后右移展开 */
const menuPress = ref(false);
let pressTimer: number | undefined;

/** 开屏：数据就绪后完整展示 3 秒，再淡出 420ms */
const splash = ref(true);
const splashLeaving = ref(false);

function openDrawer() {
  menuPress.value = true;
  window.clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => (menuPress.value = false), 260);
  drawer.value = true;
}

const isOnboarding = computed(() => route.name === 'onboarding');

/**
 * 启动更新弹窗
 * 首次引导还没走完时不弹，等用户离开引导再补上；「下次再说」只在本次会话内生效，
 * 下次打开应用仍会再检查一遍。
 */
const startupUpdate = ref<StartupUpdate | null>(null);
let pendingUpdate: StartupUpdate | null = null;

function presentUpdate(u: StartupUpdate) {
  if (isOnboarding.value) {
    pendingUpdate = u;
    return;
  }
  startupUpdate.value = u;
}

function closeUpdate(kind: 'go' | 'later') {
  if (kind === 'later' && startupUpdate.value) markUpdateLater(startupUpdate.value.version);
  startupUpdate.value = null;
}

watch(isOnboarding, (on) => {
  if (!on && pendingUpdate) {
    startupUpdate.value = pendingUpdate;
    pendingUpdate = null;
  }
});

/**
 * 页面切换方向
 *
 * 用层级差判断：进入下一层从右侧滑入，返回上一层从左侧滑入。
 * 同一层之间（发现 ↔ 资料库）按「向右」处理，避免来回都像后退。
 */
const depth = computed(() => {
  const name = String(route.name ?? '');
  if (name === 'settings') return route.params.tab ? 2 : 1;
  // 项目页的下一层：进入从右、返回从左
  if (name === 'deck') return 2;
  // 单篇记录编辑：项目页里再下一层
  if (name === 'record') return 3;
  if (name === 'home') return 0;
  return 1;
});
const dir = ref<'forward' | 'back'>('forward');
watch(depth, (now, prev) => {
  dir.value = now < prev ? 'back' : 'forward';
});

const pageTitle = computed(() => {
  const map: Record<string, string> = {
    home: '对话',
    discover: '发现',
    records: '过程记录',
    library: '资料库',
    new: '新建项目',
    settings: '设置',
    dev: '开发者',
    record: '研究记录',
    project: projects.current?.topic ?? '项目',
    deck: '答辩 PPT',
    onboarding: '欢迎',
    legal: '条款与政策',
  };
  return map[String(route.name)] ?? '研学帮';
});

/** 设置二级页在顶栏显示「设置 / 子页」而不是只写「设置」 */
const subTab = computed(() => String(route.params.tab ?? ''));
const subLabel = computed(
  () =>
    ({
      account: '账号安全',
      notifications: '通知',
      appearance: '外观',
      voice: '语音播报',
      features: '功能管理',
      model: '模型服务',
      data: '数据与备份',
      subscription: '订阅',
      memory: '记忆',
      session: '会话设定',
      phrases: '常用语',
      help: '帮助中心',
      feedback: '反馈',
      about: '关于',
      update: '检查更新',
      developer: '开发者',
    })[subTab.value] ?? '',
);

/**
 * 限流：默认等满 60 秒自动重试，同时给一个「立即重试」按钮。
 * 有些服务商只是短时抖动，用户不想干等就走手动；自动重试仍然保留。
 */
const rateLimitLeft = ref(0);
let rateLimitTimer: number | undefined;

function stopRateTimer() {
  window.clearInterval(rateLimitTimer);
  rateLimitTimer = undefined;
}

function onRateLimit(e: Event) {
  const ms = Number((e as CustomEvent<{ waitMs?: number }>).detail?.waitMs ?? 60000);
  rateLimitLeft.value = Math.max(1, Math.round(ms / 1000));
  stopRateTimer();
  rateLimitTimer = window.setInterval(() => {
    rateLimitLeft.value = Math.max(0, rateLimitLeft.value - 1);
    if (rateLimitLeft.value <= 0) stopRateTimer();
  }, 1000);
  app.toast('模型服务限流，已自动排队；也可以点顶部提示里的「立即重试」', 'warn', 6000);
}

function retryNow() {
  skipRateLimitWait();
  rateLimitLeft.value = 0;
  stopRateTimer();
  app.toast('已跳过等待，正在立即重试', 'info', 2600);
}

onMounted(() => window.addEventListener('studymate:ratelimit', onRateLimit));
onBeforeUnmount(() => {
  window.removeEventListener('studymate:ratelimit', onRateLimit);
  stopRateTimer();
});

/**
 * 未成年人模式的每日使用提醒
 *
 * 只在本机计数、只提醒一次/天：没有云端，也就没法做「家长端查看」，
 * 所以这里只做得到的事——到点提醒休息。
 */
let minorTimer: number | undefined;
function startMinorTimer() {
  const m = app.settings.minor;
  if (!m.enabled || !m.dailyMinutes) return;
  const key = 'studymate:minor-reminded';
  let spent = 0;
  minorTimer = window.setInterval(() => {
    if (document.hidden) return;
    spent += 1;
    const today = new Date().toISOString().slice(0, 10);
    if (spent >= m.dailyMinutes && localStorage.getItem(key) !== today) {
      localStorage.setItem(key, today);
      app.toast(`今天已经用了 ${spent} 分钟，起来走走、看看远处`, 'warn', 7000);
    }
  }, 60_000);
}

onMounted(async () => {
  await app.init();
  await projects.loadList();
  startMinorTimer();
  // 开屏固定展示 3 秒：不因为数据库快就一闪而过
  window.setTimeout(() => {
    splashLeaving.value = true;
    window.setTimeout(() => (splash.value = false), 420);
  }, 3000);
  installNativeBack();
  // 每次进入应用自动查一次新版本（官方接口 + 镜像可达性）；
  // 等开屏结束再弹，避免被开屏盖住。失败静默，不阻塞启动。
  void checkStartupUpdate().then((found) => {
    if (!found) return;
    window.setTimeout(() => presentUpdate(found), 3400);
  });
});

/**
 * 安卓侧边返回 / 实体返回键
 *
 * 不接管时 Capacitor 会直接把整个应用退到后台，体验很差。
 * 这里的顺序是：关最上层遮罩 → 有任务先问一句 → 退回上一层 → 首页双击退出。
 */
function installNativeBack() {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, any> } }).Capacitor;
  const plugin = cap?.Plugins?.App;
  if (!plugin?.addListener) return;
  let lastBackAt = 0;
  void plugin.addListener('backButton', async () => {
    if (splash.value) return;
    if (await closeTopOverlay()) return;
    if (!(await confirmLeave())) return;
    if (route.name !== 'home' && route.name !== 'onboarding') {
      bypassLeaveOnce();
      if (window.history.length > 1) router.back();
      else router.replace('/');
      return;
    }
    const now = Date.now();
    if (now - lastBackAt < 2000) {
      void plugin.exitApp?.();
      return;
    }
    lastBackAt = now;
    app.toast('再按一次返回键退出', 'info', 2000);
  });
}

/** 抽屉也算一层遮罩：返回键先收起它，而不是直接退应用 */
let unregisterDrawer: (() => void) | null = null;
watch(drawer, (open) => {
  if (open && !unregisterDrawer) {
    unregisterDrawer = pushOverlay('side-drawer', () => {
      drawer.value = false;
      return true;
    });
  } else if (!open && unregisterDrawer) {
    unregisterDrawer();
    unregisterDrawer = null;
  }
});

/** 未确认三份文档，任何路由都进不来（含直接敲 hash 地址） */
watch(
  () => [route.fullPath, app.settings.disclaimerAccepted, app.ready] as const,
  () => {
    if (!app.ready) return;
    if (!app.settings.disclaimerAccepted && route.name !== 'onboarding') {
      router.replace('/onboarding');
    }
  },
  { immediate: true },
);

watch(() => route.fullPath, () => {
  drawer.value = false;
  if (route.name === 'home') projects.loadList();
});

function cycleTheme() {
  const order = ['system', 'light', 'dark'] as const;
  const i = order.indexOf(app.settings.theme);
  app.setTheme(order[(i + 1) % order.length]);
}

const themeLabel = computed(() =>
  app.settings.theme === 'system' ? '跟随系统' : app.settings.theme === 'light' ? '浅色' : '深色',
);
</script>

<template>
  <!-- 系统 confirm 在 WebView 里会被拦掉，统一用应用内弹层 -->
  <GlobalConfirm />
  <StartupUpdateModal v-if="startupUpdate" :update="startupUpdate" @close="closeUpdate" />

  <!-- 开屏：只盖在界面上，不挡数据加载（init 与它并行跑） -->
  <div v-if="splash" class="splash" :class="{ out: splashLeaving }">
    <img class="splash-logo" src="/icon.svg" alt="" />
    <b class="splash-name">研学帮</b>
    <span class="splash-sub">研究性学习，从立项到结题</span>
    <span class="splash-bar" />
  </div>

  <div v-if="isOnboarding" class="onboard-shell"><router-view /></div>

  <div v-else class="shell">
    <!-- 电脑侧栏与手机抽屉：同一个 SideNav 组件 -->
    <aside class="sidebar" :class="{ open: drawer }">
      <SideNav variant="desktop" class="side-desktop" @navigate="drawer = false" />
      <SideNav variant="drawer" class="side-mobile" @navigate="drawer = false" />
    </aside>

    <transition name="scrim">
      <div v-if="drawer" class="scrim" @click="drawer = false" />
    </transition>

    <div class="main">
      <header class="topbar">
        <button
          class="m-menu only-mobile"
          :class="{ press: menuPress }"
          aria-label="菜单"
          @click="openDrawer"
        >
          <span v-html="NAV_ICONS.menu" />
        </button>

        <!-- 选模型常驻：手机与电脑都能随时切换，不用先进设置 -->
        <ModelPicker />

        <div class="nav-arrows only-desktop">
          <button class="icon-btn ghost" aria-label="后退" @click="router.back()"><span v-html="NAV_ICONS.back" /></button>
          <button class="icon-btn ghost" aria-label="前进" @click="router.forward()"><span v-html="NAV_ICONS.fwd" /></button>
        </div>
        <div class="topbar-title only-desktop">
          {{ pageTitle }}<template v-if="subLabel"> <span class="crumb">/ {{ subLabel }}</span></template>
        </div>
        <div class="grow" />
        <button class="icon-btn ghost only-desktop" aria-label="发现" @click="router.push('/discover')"><span v-html="NAV_ICONS.search" /></button>
        <button class="icon-btn ghost only-desktop" aria-label="切换主题" :title="themeLabel" @click="cycleTheme"><span v-html="NAV_ICONS.theme" /></button>
        <button class="icon-btn ghost only-desktop" aria-label="设置" @click="router.push('/settings')"><span v-html="NAV_ICONS.gear" /></button>

        <button class="m-circle only-mobile" aria-label="通知" @click="app.toast('暂无通知', 'info')">
          <span v-html="NAV_ICONS.bell" />
        </button>
      </header>

      <div v-if="rateLimitLeft > 0" class="rate-banner" role="status">
        <span>模型服务限流，约 {{ rateLimitLeft }} 秒后自动重试；当前流程不会中断。</span>
        <button class="btn btn-sm" type="button" @click="retryNow">立即重试</button>
      </div>

      <main class="content">
        <router-view v-slot="{ Component }">
          <transition :name="dir === 'back' ? 'page-back' : 'page-fwd'" mode="out-in">
            <component :is="Component" :key="route.path" />
          </transition>
        </router-view>
      </main>
    </div>

    <transition name="fade">
      <div v-if="app.busy" class="busy"><span class="busy-dot" />{{ app.busy }}</div>
    </transition>

    <div class="toasts">
      <transition-group name="toast">
        <div v-for="t in app.toasts" :key="t.id" class="toast" :class="'toast-' + t.kind">{{ t.text }}</div>
      </transition-group>
    </div>
  </div>
</template>

<style scoped>
.shell { display: flex; height: 100%; min-height: 100%; }
.grow { flex: 1; }

/* ================= 侧栏 ================= */
.sidebar {
  width: 248px;
  flex: 0 0 248px;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  border-right: 1px solid var(--line);
  padding: var(--sp-3) var(--sp-2);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.side-desktop { display: flex; }
.side-mobile { display: none; }

/* ================= 主区 ================= */
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; height: 100%; }
.rate-banner {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 16px;
  background: var(--warn-soft, rgba(214, 158, 46, 0.14));
  color: var(--text);
  font-size: calc(12px * var(--font-scale)); line-height: 1.6;
}
.rate-banner span { flex: 1; min-width: 0; }
.rate-banner .btn { flex: 0 0 auto; }
.topbar {
  height: var(--nav-h);
  flex: 0 0 var(--nav-h);
  display: flex; align-items: center; gap: var(--sp-2);
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--line);
  background: var(--bg);
  position: sticky; top: 0; z-index: 5;
}
.nav-arrows { display: flex; gap: 2px; }
.topbar-title { font-size: calc(13.5px * var(--font-scale)); font-weight: var(--fw-medium); color: var(--text); }
.crumb { color: var(--text-3); font-weight: var(--fw-normal); }
.icon-btn {
  width: 34px; height: 34px;
  display: grid; place-items: center;
  border-radius: var(--r-1);
  border: none; background: transparent;
  color: var(--text-2); cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.icon-btn:hover { background: var(--surface-2); color: var(--text); }
.icon-btn.ghost { color: var(--text-3); }

.content { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }

.busy {
  position: fixed; left: 50%; bottom: var(--sp-6);
  transform: translateX(-50%);
  display: flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--r-full);
  background: var(--surface-3);
  border: 1px solid var(--line-strong);
  box-shadow: var(--shadow-2);
  font-size: calc(12.5px * var(--font-scale)); z-index: 60;
}
.busy-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--primary); animation: pulse 1s infinite ease-in-out; }
@keyframes pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }

.toasts {
  position: fixed; left: 50%;
  /* 叠在状态栏上会被刘海挡住：用实测的安全区兜底变量 */
  top: calc(var(--safe-top, env(safe-area-inset-top, 0px)) + var(--sp-4));
  transform: translateX(-50%);
  display: flex; flex-direction: column; gap: var(--sp-2);
  z-index: 80; pointer-events: none;
  width: min(92vw, 460px);
}
.toast {
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--r-2);
  background: var(--surface-3);
  border: 1px solid var(--line-strong);
  box-shadow: var(--shadow-2);
  font-size: calc(12.5px * var(--font-scale)); line-height: 1.55;
}
.toast-ok { border-color: rgba(47, 107, 87, 0.5); }
.toast-warn { border-color: rgba(138, 90, 0, 0.5); }
.toast-error { border-color: rgba(169, 80, 47, 0.55); }
.toast-enter-active, .toast-leave-active { transition: all var(--dur-3) var(--ease-out); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-6px); }

/* ================= 开屏 ================= */
.splash {
  position: fixed; inset: 0; z-index: 200;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 9px;
  background: var(--bg);
  transition: opacity 420ms var(--ease-out);
}
.splash.out { opacity: 0; pointer-events: none; }
.splash-logo {
  width: 84px; height: 84px; border-radius: 20px; display: block;
  animation: splash-pop 620ms var(--spring-under) both;
}
.splash-name {
  margin-top: 6px;
  font-size: calc(17px * var(--font-scale)); font-weight: var(--fw-strong);
  letter-spacing: 0.14em; color: var(--text);
  animation: splash-up 560ms 120ms var(--ease-out) both;
}
.splash-sub {
  font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); letter-spacing: 0.04em;
  animation: splash-up 560ms 200ms var(--ease-out) both;
}
.splash-bar {
  position: relative; margin-top: 20px;
  width: 92px; height: 2px; border-radius: 2px;
  background: var(--surface-3); overflow: hidden;
  animation: splash-up 500ms 260ms var(--ease-out) both;
}
.splash-bar::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 40%;
  border-radius: 2px; background: var(--primary);
  animation: splash-run 1.05s ease-in-out infinite;
}
@keyframes splash-pop { from { opacity: 0; transform: scale(0.92) translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes splash-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes splash-run { from { transform: translateX(-100%); } to { transform: translateX(260%); } }

/* 关掉动效时：进度条直接满格，不来回跑 */
html[data-motion='off'] .splash-logo,
html[data-motion='off'] .splash-name,
html[data-motion='off'] .splash-sub,
html[data-motion='off'] .splash-bar { animation: none; }
html[data-motion='off'] .splash-bar::after { animation: none; width: 100%; }

.onboard-shell { height: 100%; overflow-y: auto; }
.scrim { display: none; }

/* 移动端圆形按钮：44 触控热区 */
.m-circle {
  width: 40px; height: 40px; flex: 0 0 40px;
  border-radius: 50%;
  border: none;
  background: var(--surface-2);
  color: var(--text-2);
  display: grid; place-items: center;
  cursor: pointer;
}
.m-circle:active { background: var(--surface-3); }

/* scrim 淡入 */
.scrim-enter-active, .scrim-leave-active { transition: opacity var(--dur-3) var(--ease-out); }
.scrim-enter-from, .scrim-leave-to { opacity: 0; }

/* ================= 移动端 ================= */
@media (max-width: 860px) {
  .side-desktop { display: none; }

  .sidebar {
    position: fixed; inset: 0 auto 0 0; z-index: 70;
    width: 90%; max-width: 400px;
    flex-basis: auto;
    padding: calc(var(--safe-top, env(safe-area-inset-top, 0px)) + 18px) 20px calc(var(--safe-bottom, env(safe-area-inset-bottom, 0px)) + 12px);
    border-right: none;
    background: var(--bg);
    transform: translateX(-100%);
    /* 过阻尼曲线：推到位时几乎不回弹，读起来是「向右推出去」而不是「弹出来」 */
    transition: transform 420ms var(--spring-over);
    box-shadow: var(--shadow-3);
    border-radius: 0 var(--r-4) var(--r-4) 0;
    will-change: transform;
    visibility: hidden;
  }
  .sidebar.open { transform: translateX(0); visibility: visible; }
  /* 抽屉里的条目依次向右跟进 18px，强化「向右展开」的方向感 */
  .sidebar.open .side-mobile .nav-item,
  .sidebar.open .side-mobile .pcard,
  .sidebar.open .side-mobile .tile {
    animation: nav-in 380ms var(--spring-over) both;
  }
  .sidebar.open .side-mobile .nav-item:nth-child(1) { animation-delay: 20ms; }
  .sidebar.open .side-mobile .nav-item:nth-child(2) { animation-delay: 45ms; }
  .sidebar.open .side-mobile .nav-item:nth-child(3) { animation-delay: 70ms; }
  .sidebar.open .side-mobile .nav-item:nth-child(4) { animation-delay: 95ms; }
  .sidebar.open .side-mobile .nav-item:nth-child(5) { animation-delay: 120ms; }
  .sidebar.open .side-mobile .nav-item:nth-child(6) { animation-delay: 145ms; }
  @keyframes nav-in {
    from { opacity: 0; transform: translateX(-18px); }
    to { opacity: 1; transform: none; }
  }
  .scrim { display: block; position: fixed; inset: 0; background: var(--scrim); z-index: 65; }
  .side-mobile { display: flex; height: 100%; }

  .topbar {
    /* 高度交给内容 + 安全区决定：固定 60px 时，安全区一大就会把内容挤扁 */
    height: auto;
    flex: 0 0 auto;
    min-height: 56px;
    padding: calc(var(--safe-top, env(safe-area-inset-top, 0px)) + 8px) 16px 8px;
    border-bottom: none;
    background: var(--bg);
    gap: 10px;
  }
  .m-menu {
    position: relative;
    width: 40px; height: 40px; flex: 0 0 40px;
    border: none;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--text-2);
    display: grid; place-items: center;
    cursor: pointer;
    overflow: hidden;
    transition: background var(--dur-2) var(--ease-out);
  }
  .m-menu:active { background: var(--surface-3); }
  /* 点下去的瞬间图标右移，与抽屉的滑动方向一致 */
  .m-menu span {
    display: grid; place-items: center;
    transition: transform 240ms var(--spring-over);
  }
  .m-menu:active span { transform: translateX(2px); }
  .m-menu.press span { transform: translateX(4px); }
  .m-menu.press { background: var(--surface-3); }
  .m-menu i {
    position: absolute; top: 3px; right: 3px;
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--primary);
    box-shadow: 0 0 0 2px var(--bg);
  }
  .content { padding-bottom: var(--safe-bottom, env(safe-area-inset-bottom, 0px)); }
}
</style>
