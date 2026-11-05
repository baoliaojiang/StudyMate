/**
 * 对话会话
 *
 * 规则（按用户要求）：
 * - 每次打开应用都是**一段新对话**，不接着上次往下写；
 * - 旧对话不丢，收进侧边抽屉里，点一下继续；
 * - 全部只存本机 localStorage，不上传。
 *
 * 之所以不用 IndexedDB：对话是纯文本、量小、读写频繁，
 * localStorage 同步读取能让首屏直接拿到历史列表，不闪一下空列表。
 */
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

export interface ChatMsg {
  id: string;
  role: 'user' | 'ai';
  text: string;
  at: number;
  /** 未完成/报错的回复，界面上弱化显示 */
  error?: boolean;
  /** 这条消息带了哪些附件（只留文件名用于展示） */
  files?: string[];
  /** 深度思考的推理过程 */
  reasoning?: string;
  /** 这条回复经历的执行步骤（项目入口用），让过程可见 */
  steps?: ChatStep[];
}

/** 一步执行：名称 + 状态 + 备注；detail 可放该步的简短结论 */
export interface ChatStep {
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  note?: string;
  detail?: string;
}

/** 会话模式：纯聊天不注入任何系统提示；项目指导才带规则与项目事实 */
export type ChatMode = 'chat' | 'guide';

export interface ChatSession {
  id: string;
  title: string;
  /** 未选过则为 undefined，首页会先让用户选 */
  mode?: ChatMode;
  /** 绑定的项目：从项目页进来时带上，回答就围绕这个项目 */
  projectId?: string;
  msgs: ChatMsg[];
  createdAt: number;
  updatedAt: number;
}

const KEY = 'studymate:chat:v2';
const MAX_SESSIONS = 40;
const MAX_MSGS = 80;

function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function load(): ChatSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s) => s && typeof s.id === 'string' && Array.isArray(s.msgs))
      .map((s) => ({
        id: s.id,
        title: String(s.title ?? ''),
        msgs: s.msgs
          .filter((m: ChatMsg) => m && typeof m.text === 'string')
          .map((m: ChatMsg) => ({ ...m, reasoning: m.reasoning }))
          .slice(-MAX_MSGS),
        mode: s.mode === 'chat' || s.mode === 'guide' ? s.mode : undefined,
        projectId: typeof s.projectId === 'string' ? s.projectId : undefined,
        createdAt: Number(s.createdAt) || Date.now(),
        updatedAt: Number(s.updatedAt) || Date.now(),
      }))
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

/** 用第一句用户提问当标题，太长就截断 */
function titleOf(s: ChatSession): string {
  const first = s.msgs.find((m) => m.role === 'user')?.text?.trim() ?? '';
  if (!first) return '新对话';
  return first.replace(/\s+/g, ' ').slice(0, 24) || '新对话';
}

export const useChatStore = defineStore('chat', () => {
  /** 历史对话（按更新时间倒序，不含当前这段新的） */
  const sessions = ref<ChatSession[]>(load());
  const current = ref<ChatSession>(blank());

  function blank(): ChatSession {
    const now = Date.now();
    return { id: newId('c'), title: '新对话', msgs: [], createdAt: now, updatedAt: now };
  }

  /** 历史列表里排除当前这段（还没发过言的空对话也不进列表） */
  const history = computed(() => sessions.value.filter((s) => s.msgs.length > 0));

  const currentMsgs = computed(() => current.value.msgs);

  function persist() {
    try {
      const keep = sessions.value.filter((s) => s.msgs.length > 0).slice(0, MAX_SESSIONS);
      sessions.value = keep;
      localStorage.setItem(KEY, JSON.stringify(keep));
    } catch {
      /* 存不下不影响当前对话 */
    }
  }

  /** 把当前这段并进历史（第一次发出消息时调用） */
  function commitCurrent() {
    if (!current.value.msgs.length) return;
    current.value.updatedAt = Date.now();
    current.value.title = titleOf(current.value);
    const i = sessions.value.findIndex((s) => s.id === current.value.id);
    if (i >= 0) sessions.value[i] = current.value;
    else sessions.value.unshift(current.value);
    sessions.value.sort((a, b) => b.updatedAt - a.updatedAt);
    persist();
  }

  function push(msg: Omit<ChatMsg, 'id' | 'at'> & { id?: string }) {
    current.value.msgs.push({
      id: msg.id ?? newId('m'),
      role: msg.role,
      text: msg.text,
      error: msg.error,
      files: msg.files,
      reasoning: (msg as { reasoning?: string }).reasoning,
      steps: (msg as { steps?: ChatStep[] }).steps,
      at: Date.now(),
    });
    if (current.value.msgs.length > MAX_MSGS) current.value.msgs.splice(0, current.value.msgs.length - MAX_MSGS);
    current.value.updatedAt = Date.now();
    if (msg.role === 'user') commitCurrent();
  }

  /** 用最终文本替换最后一条 AI 消息（流式/重试时用） */
  function patchLastAi(text: string) {
    const last = [...current.value.msgs].reverse().find((m) => m.role === 'ai');
    if (last) {
      last.text = text;
      commitCurrent();
    }
  }

  /** 开一段新对话：旧的那段先入库 */
  function startNew() {
    commitCurrent();
    current.value = blank();
  }

  /** 打开历史里的某一段（当前这段先存起来） */
  function open(id: string) {
    if (id === current.value.id) return;
    commitCurrent();
    const s = sessions.value.find((x) => x.id === id);
    if (!s) return;
    sessions.value = sessions.value.filter((x) => x.id !== id);
    current.value = JSON.parse(JSON.stringify(s)) as ChatSession;
  }

  function remove(id: string) {
    sessions.value = sessions.value.filter((s) => s.id !== id);
    persist();
  }

  function setMode(mode: ChatMode) {
    current.value.mode = mode;
    commitCurrent();
  }

  /** 绑定/切换项目：换项目就换上下文，历史消息保留 */
  function setProject(projectId?: string) {
    current.value.projectId = projectId;
    if (projectId) current.value.mode = 'guide';
    commitCurrent();
  }

  function clearCurrent() {
    current.value = blank();
  }

  /** 标题随消息更新（抽屉里能看出这段聊了什么） */
  watch(
    () => current.value.msgs.length,
    () => {
      if (current.value.msgs.length) current.value.title = titleOf(current.value);
    },
  );

  return {
    sessions,
    history,
    current,
    currentMsgs,
    push,
    patchLastAi,
    startNew,
    open,
    remove,
    setMode,
    setProject,
    clearCurrent,
    commitCurrent,
  };
});
