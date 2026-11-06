/**
 * 退出守卫：任务、遮罩与确认弹层
 *
 * 三件事集中放在这里，避免各页面各写一套 window.confirm：
 *  1. 正在跑的任务（对话流式、项目推进、PPT 生成）登记在册；
 *  2. 打开的遮罩（抽屉、项目推进面板）压成栈，安卓返回键先关最上层；
 *  3. 需要用户确认时用应用内的弹层，不用系统 confirm（WebView 里会被拦掉）。
 */
import { computed, ref } from 'vue';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'warn' | 'info';
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

export const confirmState = ref<Pending | null>(null);

/** 弹一个应用内确认框，返回用户是否点了「确定」 */
export function askConfirm(opts: ConfirmOptions): Promise<boolean> {
  // 上一个还没答复：先当作取消，避免永远等不到 resolve
  if (confirmState.value) confirmState.value.resolve(false);
  return new Promise<boolean>((resolve) => {
    confirmState.value = { ...opts, resolve };
  });
}

export function resolveConfirm(ok: boolean) {
  const p = confirmState.value;
  if (!p) return;
  confirmState.value = null;
  p.resolve(ok);
}

/* --------------------------------- 输入 --------------------------------- */

export interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirmText?: string;
  cancelText?: string;
}

type PromptPending = PromptOptions & { resolve: (value: string | null) => void };

export const promptState = ref<PromptPending | null>(null);

/** 弹一个应用内输入框，返回用户输入的文本；取消返回 null */
export function askPrompt(opts: PromptOptions): Promise<string | null> {
  // 上一个还没答复：先当作取消，避免永远等不到 resolve
  if (promptState.value) promptState.value.resolve(null);
  return new Promise<string | null>((resolve) => {
    promptState.value = { ...opts, resolve };
  });
}

export function resolvePrompt(value: string | null) {
  const p = promptState.value;
  if (!p) return;
  promptState.value = null;
  p.resolve(value);
}

/* --------------------------------- 任务 --------------------------------- */

interface RunningTask {
  id: string;
  label: string;
}

const tasks = ref<RunningTask[]>([]);
export const runningTasks = computed(() => tasks.value);

export function beginTask(id: string, label: string) {
  if (!tasks.value.some((t) => t.id === id)) {
    tasks.value = [...tasks.value, { id, label }];
  }
}

export function endTask(id: string) {
  tasks.value = tasks.value.filter((t) => t.id !== id);
}

export function hasRunningTask(): boolean {
  return tasks.value.length > 0;
}

let bypassUntil = 0;

/** 返回键已经问过一次了，紧接着的路由守卫不要再弹一遍 */
export function bypassLeaveOnce() {
  bypassUntil = Date.now() + 1500;
}

/** 离开前问一句；没有任务时直接放行 */
export async function confirmLeave(): Promise<boolean> {
  if (Date.now() < bypassUntil) {
    bypassUntil = 0;
    return true;
  }
  if (!hasRunningTask()) return true;
  const first = tasks.value[0];
  return askConfirm({
    title: '退出后任务会中断',
    message: `「${first.label}」还在进行。现在离开，这一步不会继续；已经完成的内容会保留。`,
    confirmText: '仍然退出',
    cancelText: '继续等待',
    tone: 'warn',
  });
}

/* --------------------------------- 遮罩 --------------------------------- */

interface Overlay {
  id: string;
  close: () => boolean | Promise<boolean>;
}

const overlays = ref<Overlay[]>([]);

/** 注册一个可用返回键关闭的遮罩；返回注销函数（组件卸载时调用） */
export function pushOverlay(id: string, close: () => boolean | Promise<boolean>): () => void {
  overlays.value = [...overlays.value.filter((o) => o.id !== id), { id, close }];
  return () => {
    overlays.value = overlays.value.filter((o) => o.id !== id);
  };
}

/** 关最上面一层；返回 true 表示这次返回键已被消费 */
export async function closeTopOverlay(): Promise<boolean> {
  const top = overlays.value[overlays.value.length - 1];
  if (!top) return false;
  const ok = await top.close();
  if (ok) overlays.value = overlays.value.filter((o) => o.id !== top.id);
  return true;
}

export function hasOverlay(): boolean {
  return overlays.value.length > 0;
}
