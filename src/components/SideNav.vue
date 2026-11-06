<script setup lang="ts">
/**
 * 侧栏 / 抽屉导航 —— 只有这一份实现
 *
 * 之前电脑和手机各写一套，结果手机多了「发现 / 研究记录 / 资料库」，
 * 电脑上根本没有入口。现在两边渲染同一个组件、同一份 NAV_ITEMS，
 * 差别只剩字号与排布密度。
 */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NAV_ICONS, NAV_ITEMS } from '../nav';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import { useChatStore } from '../stores/chat';
import { SITE } from '../config/site';
import { fmtDate } from '../core/id';
import AppAvatar from './AppAvatar.vue';

const props = defineProps<{ variant: 'desktop' | 'drawer' }>();
const emit = defineEmits<{ (e: 'navigate'): void }>();

const app = useAppStore();
const store = useProjectStore();
const chat = useChatStore();
const route = useRoute();
const router = useRouter();

const recent = computed(() => store.list.slice(0, props.variant === 'drawer' ? 6 : 5));

/** 抽屉里最多列 8 段旧对话，再多就靠「全部」进设置看 */
const chats = computed(() => chat.history.slice(0, props.variant === 'drawer' ? 8 : 6));

function openChat(id: string) {
  chat.open(id);
  emit('navigate');
  router.push('/');
}

function newChat() {
  chat.startNew();
  emit('navigate');
  router.push('/');
}

const themeLabel = computed(
  () => ({ system: '跟随系统', light: '浅色', dark: '深色' })[app.settings.theme],
);

function active(to: string) {
  if (to === '/') return route.path === '/';
  return route.path.startsWith(to);
}

function go(to: string) {
  emit('navigate');
  router.push(to);
}

function cycleTheme() {
  const order = ['system', 'light', 'dark'] as const;
  const i = order.indexOf(app.settings.theme);
  app.setTheme(order[(i + 1) % order.length]);
  app.toast(themeLabel.value, 'info', 1200);
}
</script>

<template>
  <div class="nav-root" :class="variant">
    <!-- 顶部身份 -->
    <div v-if="variant === 'desktop'" class="brand">
      <img class="logo" src="/icon.svg" alt="研学帮" />
      <div class="brand-text">
        <b>研学帮</b>
        <span>StudyMate v{{ SITE.version }}</span>
      </div>
      <button class="pill" type="button" @click="go('/new')">新建</button>
    </div>

    <div v-else class="me-head">
      <button class="me-avatar" type="button" aria-label="账号" @click="go('/settings/account')">
        <AppAvatar :name="app.displayName" :src="app.settings.profile.avatar" :size="44" />
      </button>
      <span class="me-name">{{ app.displayName }}</span>
      <button class="circle" type="button" aria-label="新建项目" @click="go('/new')">
        <span v-html="NAV_ICONS.plus" />
      </button>
    </div>

    <!-- 主导航 -->
    <nav class="nav" aria-label="主导航">
      <router-link
        v-for="item in NAV_ITEMS"
        :key="item.key"
        :to="item.to"
        class="nav-item"
        :class="{ active: active(item.to) }"
        @click="emit('navigate')"
      >
        <span class="ico" v-html="NAV_ICONS[item.icon]" />
        <span class="label">{{ item.label }}</span>
        <span v-if="item.key === 'new' && variant === 'desktop'" class="hint">⌘N</span>
      </router-link>
      <router-link
        v-if="app.settings.devMode"
        to="/dev"
        class="nav-item"
        :class="{ active: active('/dev') }"
        @click="emit('navigate')"
      >
        <span class="ico" v-html="NAV_ICONS.code" />
        <span class="label">开发者</span>
      </router-link>
    </nav>

    <!-- 对话：默认进来是新对话，旧对话从这里继续 -->
    <section class="sec">
      <div class="sec-head">
        <span>对话</span>
        <button class="mini" type="button" @click="newChat">新对话</button>
      </div>
      <div class="chats">
        <button
          v-for="c in chats"
          :key="c.id"
          class="chat-row"
          :class="{ on: c.id === chat.current.id }"
          type="button"
          @click="openChat(c.id)"
        >
          <span class="ctitle">{{ c.title }}</span>
          <span class="ctime">{{ fmtDate(c.updatedAt) }}</span>
        </button>
        <p v-if="!chats.length" class="empty">还没有历史对话</p>
      </div>
    </section>

    <!-- 项目 -->
    <section class="sec">
      <div class="sec-head">
        <span>项目</span>
        <span class="count">{{ store.list.length }}</span>
      </div>

      <div v-if="variant === 'drawer'" class="cards">
        <router-link
          v-for="p in recent"
          :key="p.id"
          :to="`/project/${p.id}`"
          class="pcard"
          @click="emit('navigate')"
        >
          <span class="pthumb">{{ (p.topic || '研').slice(0, 1) }}</span>
          <span class="ptitle">{{ p.topic || '未命名课题' }}</span>
        </router-link>
        <p v-if="!recent.length" class="empty">还没有项目</p>
      </div>

      <div v-else class="rows">
        <router-link
          v-for="p in recent"
          :key="p.id"
          :to="`/project/${p.id}`"
          class="prow"
          :class="{ active: route.params.id === p.id }"
          @click="emit('navigate')"
        >
          <i class="dot" />
          <span>{{ p.topic || '未命名课题' }}</span>
        </router-link>
        <p v-if="!recent.length" class="empty">还没有项目</p>
      </div>
    </section>

    <!-- 账户与支持：两边都有 -->
    <section class="sec">
      <div class="sec-head"><span>账户与支持</span></div>
      <div class="tiles">
        <button class="tile" type="button" @click="cycleTheme">
          <b>{{ themeLabel }}</b><span>外观</span>
        </button>
        <button class="tile" type="button" @click="go('/settings/subscription')">
          <b>用量</b><span>预算与调用</span>
        </button>
        <button class="tile" type="button" @click="go('/settings/about')">
          <b>开源</b><span>源码与许可</span>
        </button>
      </div>
    </section>

    <!-- 底部 -->
    <div class="bottom">
      <button class="search" type="button" @click="go('/discover')">
        <span v-html="NAV_ICONS.search" />
        <span class="ph">搜索课题</span>
      </button>
      <button class="circle" type="button" aria-label="通知" @click="app.toast('暂无通知', 'info')">
        <span v-html="NAV_ICONS.bell" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.nav-root { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.nav-root.desktop { gap: 12px; }

/* ---------- 顶部 ---------- */
.brand { display: flex; align-items: center; gap: 8px; padding: 2px 6px 2px; }
.logo { width: 30px; height: 30px; flex: 0 0 30px; border-radius: 8px; display: block; }
.brand-text { flex: 1; min-width: 0; }
.brand-text b { display: block; font-size: calc(13.5px * var(--font-scale)); font-weight: var(--fw-strong); line-height: 1.3; }
.brand-text span { font-size: calc(10.5px * var(--font-scale)); color: var(--text-3); }
.pill {
  height: 24px; padding: 0 10px; border-radius: var(--r-full);
  border: 1px solid var(--line-strong); background: transparent;
  color: var(--text-2); font-size: calc(11.5px * var(--font-scale)); cursor: pointer;
  transition: background var(--dur-2), color var(--dur-2);
}
.pill:hover { background: var(--surface); color: var(--text); }

.me-head { display: flex; align-items: center; gap: 12px; padding: 4px 0 20px; }
.me-avatar { width: 44px; height: 44px; padding: 0; border: none; background: transparent; border-radius: 50%; cursor: pointer; }
.me-name { flex: 1; font-size: calc(19px * var(--font-scale)); font-weight: var(--fw-strong); letter-spacing: -0.01em; }

/* ---------- 导航 ---------- */
.nav { display: flex; flex-direction: column; gap: 1px; }
.nav-root.drawer .nav { gap: 0; }
.nav-item {
  display: flex; align-items: center;
  height: 34px; padding: 0 8px;
  border-radius: var(--r-1);
  color: var(--text-2);
  font-size: calc(13px * var(--font-scale));
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.nav-root.drawer .nav-item {
  height: 50px; padding: 0;
  font-size: calc(16.5px * var(--font-scale)); letter-spacing: -0.01em;
  color: var(--text);
  border-radius: var(--r-1);
}
.nav-item:hover { background: var(--surface); color: var(--text); }
.nav-root.drawer .nav-item:active { background: var(--surface-2); }
.nav-item.active { background: var(--surface-2); color: var(--text); font-weight: var(--fw-medium); }
.nav-root.drawer .nav-item.active { background: var(--surface-2); font-weight: var(--fw-strong); }
.ico { width: 20px; height: 20px; flex: 0 0 20px; display: inline-flex; align-items: center; justify-content: center; margin-right: 10px; color: currentColor; }
.nav-root.drawer .ico { margin-right: 14px; color: var(--text-2); }
.label { flex: 1; min-width: 0; }
.hint { font-size: calc(10.5px * var(--font-scale)); color: var(--text-3); opacity: 0; transition: opacity var(--dur-2); }
.nav-item:hover .hint { opacity: 1; }

/* ---------- 项目 ---------- */
.sec { display: flex; flex-direction: column; }
.nav-root.drawer .sec { margin-top: 24px; }
.sec-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 8px 6px;
  font-size: calc(11px * var(--font-scale)); color: var(--text-3); letter-spacing: 0.02em;
}
.nav-root.drawer .sec-head { padding: 0 0 12px; font-size: calc(15px * var(--font-scale)); }
.count { font-variant-numeric: tabular-nums; opacity: 0.7; }

.rows { display: flex; flex-direction: column; gap: 1px; }
.prow {
  display: flex; align-items: center; gap: 8px;
  height: 30px; padding: 0 8px; border-radius: var(--r-1);
  color: var(--text-2); font-size: calc(12.5px * var(--font-scale));
}
.prow span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prow:hover { background: var(--surface); color: var(--text); }
.prow.active { background: var(--surface-2); color: var(--text); }
.dot { width: 4px; height: 4px; flex: 0 0 4px; border-radius: 50%; background: var(--text-3); }
.prow.active .dot { background: var(--primary); }

.cards { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
.cards::-webkit-scrollbar { display: none; }
.pcard { flex: 0 0 92px; display: flex; flex-direction: column; gap: 8px; }
.pthumb {
  height: 76px; border-radius: var(--r-2);
  background: var(--surface-2); border: 1px solid var(--line);
  display: grid; place-items: center;
  color: var(--text-3); font-size: calc(22px * var(--font-scale)); font-weight: var(--fw-strong);
}
.ptitle { font-size: calc(12.5px * var(--font-scale)); color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { margin: 0; padding: 2px 8px; font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); }

/* ---------- 对话历史 ---------- */
.mini {
  border: none; background: none; padding: 0;
  font-size: calc(11px * var(--font-scale)); color: var(--text-3); cursor: pointer;
}
.mini:hover { color: var(--primary); }
.nav-root.drawer .mini { font-size: calc(13px * var(--font-scale)); }
.chats { display: flex; flex-direction: column; gap: 1px; }
.chat-row {
  display: flex; align-items: baseline; gap: 8px;
  width: 100%; padding: 7px 8px;
  border: none; border-radius: var(--r-1);
  background: transparent; color: var(--text-2);
  font: inherit; font-size: calc(12.5px * var(--font-scale)); text-align: left; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.chat-row:hover { background: var(--surface); color: var(--text); }
.chat-row.on { background: var(--surface-2); color: var(--text); }
.nav-root.drawer .chat-row { padding: 11px 0; font-size: calc(14px * var(--font-scale)); border-radius: 0; }
.ctitle {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ctime {
  flex: 0 0 auto;
  font-size: calc(10.5px * var(--font-scale)); color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

/* ---------- 支持磁贴 ---------- */
.tiles { display: flex; gap: 6px; padding: 0 2px; }
.tile {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; align-items: flex-start; justify-content: center;
  gap: 2px; padding: 8px 9px;
  border: 1px solid var(--line); border-radius: var(--r-1);
  background: var(--surface-2); color: var(--text);
  text-align: left; cursor: pointer; font: inherit;
  transition: border-color var(--dur-2), transform var(--dur-2);
}
.tile:hover { border-color: var(--line-strong); }
.tile:active { transform: scale(0.98); }
.tile b { font-size: calc(11.5px * var(--font-scale)); font-weight: var(--fw-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.tile span { font-size: calc(10px * var(--font-scale)); color: var(--text-3); }

.nav-root.drawer .tiles { gap: 10px; }
.nav-root.drawer .tile { height: 68px; padding: 0 12px; border-radius: var(--r-2); gap: 3px; }
.nav-root.drawer .tile b { font-size: calc(14px * var(--font-scale)); }
.nav-root.drawer .tile span { font-size: calc(11.5px * var(--font-scale)); }

/* ---------- 底部 ---------- */
.bottom { margin-top: auto; display: flex; align-items: center; gap: 10px; padding-top: 14px; }
.search {
  flex: 1; height: 36px;
  display: flex; align-items: center; gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--line); border-radius: var(--r-full);
  background: var(--surface-2); color: var(--text-3);
  font: inherit; font-size: calc(12.5px * var(--font-scale)); cursor: pointer;
  transition: border-color var(--dur-2), background var(--dur-2);
}
.search:hover { border-color: var(--line-strong); background: var(--surface); }
.ph { flex: 1; text-align: left; }
.nav-root.drawer .search { height: 44px; font-size: calc(15px * var(--font-scale)); padding: 0 18px; gap: 10px; }
.circle {
  width: 36px; height: 36px; flex: 0 0 36px;
  display: grid; place-items: center;
  border: none; border-radius: 50%;
  background: var(--surface-2); color: var(--text-2);
  cursor: pointer;
  transition: background var(--dur-2);
}
.circle:hover { background: var(--surface-3); }
.nav-root.drawer .circle { width: 38px; height: 38px; flex-basis: 38px; }
.nav-root.drawer .bottom { padding-top: 20px; }
</style>
