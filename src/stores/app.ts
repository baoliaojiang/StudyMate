import { defineStore } from 'pinia';
import { setGlobalExtraSkills } from '../agents/runtime';
import { computed, markRaw, ref } from 'vue';
import { db } from '../core/db';
import { DEFAULT_SETTINGS } from '../core/settings';
import { SITE } from '../config/site';
import type { AppSettings } from '../core/types';
import { AiGateway } from '../ai/gateway';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'warn' | 'error';
}

let toastSeq = 0;
/** toast id -> 定时器，重发同一条时重置计时 */
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

export const useAppStore = defineStore('app', () => {
  const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS });
  const ready = ref(false);
  const toasts = ref<Toast[]>([]);
  const busy = ref<string | null>(null);
  /** 移动端抽屉：放在 store 里，对话页的「历史」按钮也能直接拉开 */
  const drawer = ref(false);
  /**
   * 模型配置版本号。
   * 服务商增删、钥匙保存、模型拉取后 +1，顶栏胶囊与首页据此重新读库，
   * 否则配置完还得重启才认。之前「配好了还显示未配置」就是缺这一下。
   */
  const modelVersion = ref(0);
  function touchModels() {
    modelVersion.value++;
  }
  const systemDark = ref(
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true,
  );

  const gateway = markRaw(new AiGateway(db, () => settings.value));

  const effectiveTheme = computed<'light' | 'dark'>(() => {
    if (settings.value.theme === 'system') return systemDark.value ? 'dark' : 'light';
    return settings.value.theme;
  });

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', effectiveTheme.value);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', effectiveTheme.value === 'dark' ? '#0b0b0f' : '#f5f6fa');
  }

  /** 动效开关：挂在 html 上，CSS 统一降级，组件不用各自判断 */
  function applyMotion() {
    document.documentElement.setAttribute('data-motion', settings.value.motion ?? 'on');
  }

  /** 字体：内置 HarmonyOS Sans 或系统字体，同样由 html 属性驱动 */
  function applyFont() {
    document.documentElement.setAttribute('data-font', settings.value.font ?? 'harmony');
  }

  /**
   * 状态栏留白 = 实测安全区 + 用户手动补的像素。
   * 有些机型（尤其 targetSdk 36 的安卓 WebView）env() 直接给 0，
   * 顶栏就会压在状态栏下面，这时候用户能在外观里自己往上加。
   */
  function applySafeArea() {
    const pad = Math.max(0, Math.min(64, Number(settings.value.safeTopPad) || 0));
    document.documentElement.style.setProperty('--safe-top', `calc(var(--sa-top, 0px) + ${pad}px)`);
  }

  async function init() {
    if (ready.value) return;
    const row = await db.settings.get('app');
    settings.value = row
      ? {
          ...DEFAULT_SETTINGS,
          ...row,
          motion: row.motion ?? 'on',
          font: row.font ?? 'harmony',
          agreements: { ...DEFAULT_SETTINGS.agreements, ...(row.agreements ?? {}) },
          budget: { ...DEFAULT_SETTINGS.budget, ...row.budget },
          routing: { ...DEFAULT_SETTINGS.routing, ...(row.routing ?? {}) },
          profile: { ...DEFAULT_SETTINGS.profile, ...(row.profile ?? {}) },
          minor: { ...DEFAULT_SETTINGS.minor, ...(row.minor ?? {}) },
          notifications: { ...DEFAULT_SETTINGS.notifications, ...(row.notifications ?? {}) },
          features: { ...DEFAULT_SETTINGS.features, ...(row.features ?? {}) },
          voice: { ...DEFAULT_SETTINGS.voice, ...(row.voice ?? {}) },
          update: { ...DEFAULT_SETTINGS.update, ...(row.update ?? {}) },
          phrases: Array.isArray(row.phrases) ? row.phrases : [...DEFAULT_SETTINGS.phrases],
        }
      : { ...DEFAULT_SETTINGS };

    /**
     * 老版本把「作者主页」误当仓库地址存了下来（github.com/用户名 这种只有用户名、
     * 没有仓库名的路径），或者仓库还没发布时留了空值。现在仓库已经建好，
     * 这两种情况都补成官方地址；用户自己改过的地址保留。
     */
    const repo = settings.value.update?.githubRepo ?? '';
    if (!repo || /^https?:\/\/github\.com\/[^/]+\/?$/.test(repo)) {
      settings.value.update = {
        ...settings.value.update,
        githubRepo: SITE.github,
        mirrors: settings.value.update?.mirrors ?? [],
      };
    }
    if (typeof window !== 'undefined') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', (e) => {
        systemDark.value = e.matches;
        if (settings.value.theme === 'system') applyTheme();
      });
    }
    applyTheme();
    applyMotion();
    applyFont();
    applySafeArea();
    // 通用技能（如「Markdown 杀手」）对所有 Agent 生效：这里同步一次
    setGlobalExtraSkills(settings.value.enabledSkills ?? []);
    ready.value = true;
  }

  async function saveSettings(patch: Partial<AppSettings> = {}) {
    settings.value = { ...settings.value, ...patch, id: 'app' };
    await db.settings.put(JSON.parse(JSON.stringify(settings.value)));
    applyTheme();
    applyMotion();
    applyFont();
    applySafeArea();
    setGlobalExtraSkills(settings.value.enabledSkills ?? []);
  }

  async function setTheme(theme: AppSettings['theme']) {
    await saveSettings({ theme });
  }

  async function setMotion(motion: AppSettings['motion']) {
    await saveSettings({ motion });
  }

  async function setFont(font: AppSettings['font']) {
    await saveSettings({ font });
  }

  async function setCurrentModel(model: AppSettings['currentModel']) {
    await saveSettings({ currentModel: model });
  }

  /** 首页称呼：没设过名字就用「同学」 */
  const displayName = computed(() => (settings.value.profile?.name ?? '').trim() || '同学');

  async function setProfile(patch: Partial<AppSettings['profile']>) {
    await saveSettings({ profile: { ...settings.value.profile, ...patch } });
  }

  async function setMinor(patch: Partial<AppSettings['minor']>) {
    await saveSettings({ minor: { ...settings.value.minor, ...patch } });
  }

  async function setNotifications(patch: Partial<AppSettings['notifications']>) {
    await saveSettings({ notifications: { ...settings.value.notifications, ...patch } });
  }

  async function setFeatures(patch: Partial<AppSettings['features']>) {
    await saveSettings({ features: { ...settings.value.features, ...patch } });
  }

  async function setVoice(patch: Partial<AppSettings['voice']>) {
    await saveSettings({ voice: { ...settings.value.voice, ...patch } });
  }

  async function setSearchProviders(list: AppSettings['searchProviders']) {
    await saveSettings({ searchProviders: list });
  }

  async function setCatalog(patch: Partial<AppSettings['catalog']>) {
    await saveSettings({ catalog: { ...settings.value.catalog, ...patch } });
  }

  async function setPhrases(list: string[]) {
    await saveSettings({ phrases: list.filter((s) => s.trim()).slice(0, 30) });
  }

  /** 监护人密码只存摘要，本机不上传、不落明文 */
  async function digestSecret(plain: string): Promise<string> {
    const data = new TextEncoder().encode(`studymate:guardian:${plain}`);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /** 开启/关闭未成年人模式；第一次设置时要求输入两遍监护人密码 */
  async function setGuardianCode(plain: string) {
    await setMinor({ guardianDigest: await digestSecret(plain) });
  }

  async function verifyGuardianCode(plain: string): Promise<boolean> {
    const digest = settings.value.minor.guardianDigest;
    if (!digest) return true;
    return digest === (await digestSecret(plain));
  }

  function toast(text: string, kind: Toast['kind'] = 'info', ms = 3200) {
    // 同样的提示不重复堆叠：已存在就重置计时，避免连点刷出一墙 toast
    const same = toasts.value.find((t) => t.text === text && t.kind === kind);
    if (same) {
      clearTimeout(toastTimers.get(same.id));
      const id = same.id;
      const timer = setTimeout(() => {
        toasts.value = toasts.value.filter((t) => t.id !== id);
        toastTimers.delete(id);
      }, ms);
      toastTimers.set(id, timer);
      return;
    }
    const id = ++toastSeq;
    toasts.value.push({ id, text, kind });
    // 最多同时 3 条，超出先挤掉最旧的
    while (toasts.value.length > 3) {
      const dropped = toasts.value.shift()!;
      clearTimeout(toastTimers.get(dropped.id));
      toastTimers.delete(dropped.id);
    }
    const timer = setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
      toastTimers.delete(id);
    }, ms);
    toastTimers.set(id, timer);
  }

  async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    busy.value = label;
    try {
      return await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error', 6000);
      return null;
    } finally {
      busy.value = null;
    }
  }

  return {
    settings,
    ready,
    toasts,
    busy,
    drawer,
    modelVersion,
    touchModels,
    gateway,
    effectiveTheme,
    systemDark,
    init,
    saveSettings,
    setTheme,
    setMotion,
    setFont,
    setCurrentModel,
    displayName,
    setProfile,
    setMinor,
    setNotifications,
    setFeatures,
    setVoice,
    setSearchProviders,
    setCatalog,
    setPhrases,
    setGuardianCode,
    verifyGuardianCode,
    toast,
    withBusy,
    applyTheme,
    applyMotion,
    applyFont,
    applySafeArea,
  };
});
