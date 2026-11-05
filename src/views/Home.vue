<script setup lang="ts">
/**
 * 首页：对话式入口
 *
 * 每次进来都是一段新对话；旧对话在左侧抽屉里选（chat store 负责）。
 * 没配模型时不装可用：直接给「怎么填 Key、哪里能白嫖额度」的说明。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import { useChatStore } from '../stores/chat';
import { fmtDate } from '../core/id';
import { db, type ProviderRow } from '../core/db';
import { MODE_ENTRY, getAgent } from '../agents/definitions';
import { AgentRuntime } from '../agents/runtime';
import MarkdownText from '../components/MarkdownText.vue';
import TypingMarkdown from '../components/TypingMarkdown.vue';
import { describeImage, toDataUrl } from '../ai/vision';
import { chatWithBudgetConfirm } from '../ai/budget';
import type { StreamDelta } from '../ai/types';
import { stripInlineThink } from '../ai/think';
import { askConfirm, beginTask, endTask } from '../core/task-guard';

const app = useAppStore();
const store = useProjectStore();
const chat = useChatStore();
const router = useRouter();
const route = useRoute();

/** 这段对话绑定的项目：从项目页点进来时带上，回答就基于它 */
const boundProject = computed(() => {
  const id = chat.current.projectId;
  if (!id) return store.list[0];
  return store.list.find((p) => p.id === id) ?? store.list[0];
});

const draft = ref('');
const sending = ref(false);
/** 首页项目卡先渲染一小批，项目多了点「显示更多」再展开，避免一次铺满整屏 */
const projectLimit = ref(12);
const visibleProjects = computed(() => store.list.slice(0, projectLimit.value));
const moreProjects = computed(() => Math.max(0, store.list.length - projectLimit.value));
/** 待发送的文本附件；图片由看图模型转述成文字，vision 标记用来提醒自行核对 */
const pending = ref<{ name: string; text: string; vision?: boolean }[]>([]);
/** 已等待秒数：让用户看得出是「在跑」还是「卡死」 */
const elapsed = ref(0);
/** 流式刚开始时还没有任何字：这时候显示三点，不然气泡会是空的 */
const streamHasContent = computed(() => {
  const m = chat.currentMsgs.find((x) => x.id === streamingId.value);
  return Boolean(m && ((m.text ?? '').trim() || (m.reasoning ?? '').trim()));
});
/** 正在转述的图片文件名 */
const transcribing = ref<string | null>(null);
/** 正在打字的那条消息：先吐思考过程，再吐正文 */
const typingMsg = ref<{ id: string; stage: 'think' | 'text' } | null>(null);
/** 正在真流式接收的消息 id（用来在气泡末尾画光标） */
const streamingId = ref<string | null>(null);
/** 展开中的思考过程（按消息 id） */
const openThink = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);

/** 文件走文件管理器；图片走相册（安卓 WebView 对 image/* 会调相册/相机选择器） */
function pickFiles() {
  fileInput.value?.click();
}
function pickImages() {
  imageInput.value?.click();
}

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  for (const f of files) {
    if (/^image\//.test(f.type)) {
      await transcribeImage(f);
      continue;
    }
    if (f.size > 1024 * 1024) {
      app.toast(`「${f.name}」超过 1MB，先截取需要的部分再上传`, 'warn', 4200);
      continue;
    }
    try {
      const text = (await f.text()).slice(0, 20000);
      if (pending.value.length >= 3) {
        app.toast('一次最多带 3 个文件', 'warn');
        break;
      }
      pending.value.push({ name: f.name, text });
    } catch {
      app.toast(`「${f.name}」读不出来，换纯文本再试`, 'warn', 3600);
    }
  }
}

/** 图片：先用转述模型讲成文字，再混进提示词 */
async function transcribeImage(f: File) {
  if (f.size > 8 * 1024 * 1024) {
    app.toast(`「${f.name}」超过 8MB，先压缩或裁剪再上传`, 'warn', 4200);
    return;
  }
  const cfg = app.settings.visionModel;
  let row: ProviderRow | undefined;
  let model = cfg?.model ?? '';
  if (cfg) {
    row = await db.providers.get(cfg.providerId);
  } else {
    // 没指定就用第一个已启用、且有模型被标了「看图」的服务商
    const rows = (await db.providers.toArray()).filter((p) => p.enabled !== false);
    for (const p of rows) {
      const hit = p.models.find((m) => m.cap?.vision);
      if (hit) {
        row = p;
        model = hit.name;
        break;
      }
    }
  }
  if (!row || !model) {
    app.toast('没有可用的图片转述模型：到「模型服务 → 分配与成本」选一个支持看图的模型', 'warn', 6000);
    return;
  }
  transcribing.value = f.name;
  try {
    const dataUrl = await toDataUrl(f);
    const desc = await describeImage(row, model, dataUrl, { question: draft.value.trim() || undefined });
    pending.value.push({ name: `${f.name}（图片转述）`, text: desc, vision: true });
    app.toast('图片已转述成文字，确认无误再发送；图片本身不保存', 'ok', 4200);
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '图片转述失败', 'error', 6000);
  } finally {
    transcribing.value = null;
  }
}

function dropFile(i: number) {
  pending.value.splice(i, 1);
}
const scroller = ref<HTMLElement | null>(null);
/** 只有用户还在底部时才跟着新内容走；往上翻看前面时不要把人拽回来 */
const stick = ref(true);
function onThreadScroll() {
  const el = scroller.value;
  if (!el) return;
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}
/** 打字流速度：设置里可切快速 / 适中 / 较慢，适中按人类阅读速度 */
const typingSpeed = computed(() => app.settings.typingSpeed ?? 'normal');

/** 是否已配置可用的模型服务——未配置时 AI 入口必须明说不可用，不能装作能用 */
const aiReady = ref(false);
const aiChecked = ref(false);

async function checkAi() {
  try {
    const providers = await db.providers.toArray();
    aiReady.value = providers.some((p) => p.models.length > 0 && p.apiKeyLen > 0 && p.enabled !== false);
  } catch {
    aiReady.value = false;
  } finally {
    aiChecked.value = true;
  }
}

onMounted(async () => {
  await store.loadList();
  await checkAi();
  if (chat.currentMsgs.length) scrollToEnd();

  /**
   * 从项目页点进来：/ ?project=<id>&entry=<入口>
   * 进入后绑好项目、把入口那句话发出去，过程直接在会话里展开。
   */
  const pid = typeof route.query.project === 'string' ? route.query.project : '';
  const entryKey = typeof route.query.entry === 'string' ? route.query.entry : '';
  if (!pid && !entryKey) return;

  if (pid) {
    // 换了项目就另起一段，避免上一段项目的上下文串进来
    if (chat.currentMsgs.length && chat.current.projectId !== pid) chat.startNew();
    chat.setProject(pid);
  }
  if (entryKey && entryKey in MODE_ENTRY) {
    const e = MODE_ENTRY[entryKey as keyof typeof MODE_ENTRY];
    await nextTick();
    void send(`【${e.label}】${e.desc}`, entryKey as keyof typeof MODE_ENTRY);
  }
  // 清掉 query：刷新不会重复执行
  void router.replace({ path: '/' });
});

/** 服务商增删 / 保存 Key / 拉取模型后立刻重算，不用重启 */
watch(() => app.modelVersion, checkAi);

/**
 * 跟着新内容往下走，但只在用户本来就在底部时。
 * 用直接赋值 scrollTop 而不是 smooth：流式每 120ms 一次，平滑滚动会排成一长串。
 */
async function scrollToEnd(force = false) {
  await nextTick();
  const el = scroller.value;
  if (!el) return;
  if (!force && !stick.value) return;
  el.scrollTop = el.scrollHeight;
}

async function backToLatest() {
  stick.value = true;
  await scrollToEnd(true);
}

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 19) return '下午好';
  return '晚上好';
});

const activeCount = computed(() => store.list.filter((p) => p.status === 'active').length);
const totalRecords = computed(() => store.list.reduce((s, p) => s + p.recordPlan.total, 0));

/** 最近项目的上下文摘要，交给模型时用一句话概括，不塞整份数据 */
const projectBrief = computed(() => {
  const p = store.list[0];
  if (!p) return '用户还没有任何项目。';
  const done = store
    .statusesOf(p.id)
    .map((s) => `${s.label}：${s.statusLabel}`)
    .join('；');
  return `最近项目「${p.topic || '未命名'}」（${p.school || '学校未填'} ${p.className || ''}，指导 ${p.teacher || '未填'}）。四份材料状态：${done}。`;
});

const prompts = [
  { label: '这是我的第一个课题，从哪开始？', icon: 'spark' },
  { label: '开题报告里「研究背景」该怎么写？', icon: 'doc' },
  { label: '研究记录一篇要写哪些内容？', icon: 'list' },
  { label: '中期报告还差什么才能交？', icon: 'check' },
];

/** 概览里五个交付物的小标签，按流程顺序排 */
const SHORT_KIND: Record<string, string> = {
  proposal: '开题',
  'records-t1': '记录上',
  midterm: '中期',
  'records-t2': '记录下',
  final: '结题',
  progress: '记录',
};

const iconSet: Record<string, string> = {
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 11 10.1 9z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.6h7l5 5V20H6z"/><path d="M13 3.6V9h5"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg>',
};

/**
 * 没配模型时的回复。
 * 用户看不到后台，所以要写清楚「点哪里、填什么、去哪拿免费的」，而不是只说一句不可用。
 */
const NO_AI_REPLY = [
  '我还没有可用的模型服务，所以这一轮只能给你操作说明，不能真的生成内容。',
  '',
  '### 三步接上模型',
  '',
  '1. 打开 **设置 → 模型服务**（这里也能直接进入 **API 管理中心**）。',
  '2. 选一个服务商预设，粘贴它的 API Key，点 **拉取模型**——拉到列表后勾选要用的模型。',
  '3. 回到本页，右上角的胶囊会显示模型名，说明接通了。',
  '',
  '### Key 从哪里来',
  '',
  '- **DeepSeek 开放平台** `platform.deepseek.com`：注册后在「API keys」里建一个，充多少用多少，单价低，适合学生。',
  '- **硅基流动 SiliconFlow** `cloud.siliconflow.cn`：注册常送额度，里面有一部分小模型可以免费用。',
  '- **智谱开放平台** `open.bigmodel.cn`：GLM 系列有免费档模型。',
  '- **OpenRouter** `openrouter.ai`：聚合站，标了 `:free` 的模型可以免费用，但需要能访问国外网络。',
  '- **Ollama（本地）**：自己电脑上跑，完全免费、不联网，缺点是吃内存。装好后在设置里选「本地 / Ollama」，地址填 `http://127.0.0.1:11434`。',
  '',
  '> 各家的免费额度和计费规则随时会变，以官网当期说明为准。Key 相当于密码，别发群里、别贴截图；本机是以加密形式存的，但公用电脑上不建议保存。',
].join('\n');

async function send(text?: string, entryKey?: keyof typeof MODE_ENTRY) {
  const q = (text ?? draft.value).trim();
  if (!q || sending.value) return;

  const attach = pending.value.slice();
  chat.push({ role: 'user', text: q, files: attach.length ? attach.map((a) => a.name) : undefined });
  const attachBlock = attach.length
    ? '\n\n【用户上传的附件内容（仅供参考，不得当作已核实的资料）】\n' +
      attach
        .map(
          (a) =>
            `--- ${a.name} ---` +
            (a.vision ? '\n（由看图模型转述，可能与原图有出入，请自己核对）' : '') +
            `\n${a.text}`,
        )
        .join('\n\n')
    : '';
  draft.value = '';
  pending.value = [];
  // 刚发出消息一定跟到底部：这是用户自己触发的，不算「拽回来」
  stick.value = true;
  await scrollToEnd(true);

  // 未成年人模式：AI 生成受限，直接说明，不偷偷放行
  if (app.settings.minor.enabled && app.settings.minor.limitAi) {
    chat.push({
      role: 'ai',
      text:
        '未成年人模式下 AI 生成是关闭的，这一段只能给你说明。\n\n' +
        '需要开放的话，请监护人一起到「设置 → 账号与安全 → 未成年人模式」里关闭（要输监护人密码）。\n\n' +
        '软件本身不联网管理、也没有家长端：这条限制只对这台设备生效。',
    });
    await scrollToEnd();
    return;
  }

  if (!aiReady.value) {
    chat.push({ role: 'ai', text: NO_AI_REPLY });
    await scrollToEnd();
    return;
  }

  sending.value = true;
  beginTask('home-chat', '正在生成回答');
  elapsed.value = 0;
  const timer = window.setInterval(() => (elapsed.value += 1), 1000);

  // 看门狗按「多久没有新内容」算：真流式下总时长可能超过 90 秒，不能一刀切
  const ac = new AbortController();
  let watchdog = window.setTimeout(() => ac.abort(), 90_000);
  const bumpWatchdog = () => {
    window.clearTimeout(watchdog);
    watchdog = window.setTimeout(() => ac.abort(), 90_000);
  };

  // 先占一条空消息，之后由 delta 往里填字——不会出现「转圈半天再一次性蹦出来」
  const msgId = `a${Date.now()}`;
  chat.push({ id: msgId, role: 'ai', text: '' });
  const holder = chat.current.msgs[chat.current.msgs.length - 1];
  streamingId.value = msgId;
  let gotAnything = false;
  let firstDeltaAt = 0;
  let lastScroll = 0;

  // 原始增量先落在缓冲里，按 60ms 刷一次：每个 token 都重渲染 Markdown 会卡
  let bufText = '';
  let bufReason = '';
  let flushTimer: number | undefined;
  const flush = () => {
    flushTimer = undefined;
    holder.text = bufText;
    holder.reasoning = bufReason || undefined;
  };
  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = window.setTimeout(flush, 60);
  };

  const onDelta = (d: StreamDelta) => {
    bumpWatchdog();
    if (!firstDeltaAt) firstDeltaAt = Date.now();
    if (d.reasoning) {
      bufReason += d.reasoning;
      gotAnything = true;
      if (openThink.value !== msgId) openThink.value = msgId;
    }
    if (d.text) {
      bufText += d.text;
      gotAnything = true;
      const now = performance.now();
      if (now - lastScroll > 120) {
        lastScroll = now;
        void scrollToEnd();
      }
    }
    scheduleFlush();
  };

  /** 收尾：没流到字，或「字是一口气到的」时，用打字机把全文播一遍 */
  const settle = (finalText?: string, finalReasoning?: string) => {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (finalText && finalText.trim().length > bufText.trim().length) bufText = finalText;
    if (!bufReason && finalReasoning) bufReason = finalReasoning;
    // 万一网关把 <think> 拼在流里，收尾时把这段挪回思考区，绝不留作正文
    const split = stripInlineThink(bufText);
    if (split.reasoning) {
      bufReason = [bufReason, split.reasoning].filter(Boolean).join('\n\n');
      bufText = split.text;
    }
    holder.text = bufText;
    holder.reasoning = bufReason || undefined;

    /**
     * 安卓走 CapacitorHttp（原生网络栈，绕开 CORS）时拿不到流：
     * 所有增量会在几十毫秒内一次到齐。这种情况退回打字机播放，
     * 体感仍然是「一点点写出来」，而不是啪地出现一大段。
     */
    const burst = gotAnything && bufText.length > 120 && Date.now() - firstDeltaAt < 400;
    if ((!gotAnything || burst) && holder.text) {
      typingMsg.value = { id: msgId, stage: holder.reasoning ? 'think' : 'text' };
      if (holder.reasoning) openThink.value = msgId;
    }
    if (!holder.text.trim() && !holder.reasoning) {
      holder.text = '（模型没有返回内容，换个说法再试一次）';
      holder.error = true;
    }
    streamingId.value = null;
    chat.commitCurrent();
  };

  try {
    // 纯聊天：不加任何系统提示，也不塞项目事实，就是普通对话
    if (chat.current.mode === 'chat') {
      const res = await chatWithBudgetConfirm(app.gateway, {
        messages: [{ role: 'user', content: `${q}${attachBlock}` }],
        agentId: 'chat',
        tier: 'balanced',
        temperature: 0.7,
        maxTokens: 2000,
        signal: ac.signal,
        streaming: true,
        onDelta,
      });
      settle(res.text, res.reasoning);
      return;
    }

    const runtime = new AgentRuntime(app.gateway);
    const proj = boundProject.value;
    // 真正把该项目的记录与来源带上：不然「基于项目」只是口头说说
    const [recs, srcs, dss] = proj
      ? await Promise.all([
          db.records.where('projectId').equals(proj.id).toArray(),
          db.sources.where('projectId').equals(proj.id).toArray(),
          db.datasets.where('projectId').equals(proj.id).toArray(),
        ])
      : [[], [], []];
    const ctx = {
      project: proj,
      records: recs,
      activities: [],
      datasets: dss,
      sources: srcs,
      minorMode: app.settings.minor.enabled,
    };

    // 入口（项目页七个按钮）可能串多个助手：先把整条链路摆出来，再逐步点亮
    const entry = entryKey ? MODE_ENTRY[entryKey] : null;
    const wanted = entry ? entry.agents : MODE_ENTRY.assistant.agents;
    const onAgents = app.settings.enabledAgents ?? [];
    const plan = wanted.filter((id) => !onAgents.length || onAgents.includes(id));
    if (!plan.length) {
      holder.text = '这一步要用的助手都被关掉了。到「设置 → 其他设置 → 技能与助手」里重新打开。';
      holder.error = true;
      streamingId.value = null;
      chat.commitCurrent();
      return;
    }
    holder.steps = plan.map((id) => ({ label: getAgent(id)?.name ?? id, status: 'pending' }));

    let collected = '';
    let lastText = '';
    let lastReasoning: string | undefined;
    for (let i = 0; i < plan.length; i++) {
      const id = plan[i];
      const agent = getAgent(id);
      const st = holder.steps[i];
      if (!agent) {
        st.status = 'failed';
        st.note = '找不到这个助手';
        continue;
      }
      st.status = 'running';
      try {
        const result = await runtime.run(
          id,
          agent,
          ctx,
          entry
            ? `${q}

请基于当前项目的真实状态，完成「${entry.label}」这件事，并给出可直接执行的结论。
输出 Markdown：先给结论，再列依据与下一步。没有证据的内容写「待补充」，不要编造。`
            : `${q}${attachBlock}

（用户在首页对话。${projectBrief.value}
请直接回答，给可执行的下一步。回答用 Markdown：小标题、列表、必要时用表格。
不要编造真实数据、文献或访谈；不确定的地方说清楚需要用户自己去核实。）`,
          { signal: ac.signal, onDelta },
        );
        st.status = 'done';
        lastText = result.text;
        lastReasoning = result.reasoning;
        st.note = result.warnings.length ? `${result.warnings.length} 条提醒` : '完成';
        st.detail = result.warnings.slice(0, 2).join('；') || undefined;
        collected +=
          (plan.length > 1 ? `\n\n**第 ${i + 1} 步 · ${st.label}**\n\n` : '\n\n') + (result.text ?? '');
      } catch (e) {
        st.status = 'failed';
        st.note = e instanceof Error ? e.message.slice(0, 40) : '失败';
        throw e;
      }
    }

    // 多步时把各步结果拼成一条完整回答
    if (plan.length > 1 && collected.trim()) {
      bufText = collected.trim();
      holder.text = bufText;
    }
    // 单步：用真实返回值兜底（缓存命中时不会有增量）；多步：正文已拼接好
    settle(plan.length > 1 ? undefined : lastText, plan.length > 1 ? undefined : lastReasoning);
  } catch (e) {
    // 先把缓冲落一次：出错时也要保住已经收到的字
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (bufText || bufReason) {
      holder.text = bufText;
      holder.reasoning = bufReason || undefined;
    }
    const msg = e instanceof Error ? e.message : String(e);
    const aborted = ac.signal.aborted || /取消|abort/i.test(msg);
    const reason = aborted
      ? '90 秒没有新内容，这次请求已取消。\n\n排查顺序：① 服务商地址是否能打开；② Key 是否还有额度；③ 换个模型试试（有的模型响应很慢）。'
      : `没能完成：${msg}`;
    streamingId.value = null;
    // 已经流出来的部分保留，另起一条说明为什么断了
    if (holder.text.trim() || holder.reasoning) {
      chat.push({ role: 'ai', text: `（回复中断）${reason}`, error: true });
    } else {
      holder.text = reason;
      holder.error = true;
      chat.commitCurrent();
    }
  } finally {
    window.clearInterval(timer);
    window.clearTimeout(watchdog);
    streamingId.value = null;
    sending.value = false;
    endTask('home-chat');
    await scrollToEnd();
  }
}

async function clearThread() {
  if (!chat.currentMsgs.length) return;
  const ok = await askConfirm({
    title: '清空这段对话',
    message: '只清对话记录，项目和数据不受影响。',
    confirmText: '清空',
    cancelText: '先不清',
    tone: 'warn',
  });
  if (!ok) return;
  chat.clearCurrent();
}

function newChat() {
  chat.startNew();
  draft.value = '';
}

async function removeProject(id: string, name: string) {
  const ok = await askConfirm({
    title: `删除「${name}」`,
    message: '本地记录会一起删除，删掉后无法恢复。建议先在数据与备份里导出一份。',
    confirmText: '仍然删除',
    cancelText: '先不删',
    tone: 'warn',
  });
  if (!ok) return;
  await store.deleteProject(id);
  app.toast('已删除', 'ok');
}
</script>

<template>
  <div class="home">
    <div ref="scroller" class="thread" @scroll.passive="onThreadScroll">
      <div class="inner">
        <!-- ===== 空状态：问候 + 快捷提问 + 最近项目 ===== -->
        <template v-if="!chat.currentMsgs.length">
          <section class="hero">
            <img class="mark" src="/icon.svg" alt="研学帮" />
            <h1 class="hello">{{ greeting }}，{{ app.displayName }}</h1>
            <p class="sub">研究性学习上的事，直接问。想开工就说「帮我建个课题」，我会带你一步步来。</p>
            <div class="stats only-desktop">
              <span><b>{{ activeCount }}</b> 进行中</span>
              <span class="sep" />
              <span><b>{{ totalRecords }}</b> 篇记录计划</span>
            </div>
          </section>

          <div v-if="!chat.current.mode" class="mode-pick">
            <button class="mp-card" type="button" @click="chat.setMode('chat')">
              <b>纯聊天</b>
              <span>不带任何系统提示，像普通聊天一样问。适合闲聊、找思路。</span>
            </button>
            <button class="mp-card" type="button" @click="chat.setMode('guide')">
              <b>项目指导</b>
              <span>会带上研究规范与项目进度，回答围绕你的课题展开。</span>
            </button>
          </div>

          <div v-if="chat.current.mode" class="prompts">
            <button v-for="p in prompts" :key="p.label" class="prompt" type="button" @click="send(p.label)">
              <span class="pi" v-html="iconSet[p.icon]" />
              <span>{{ p.label }}</span>
            </button>
          </div>

          <div v-if="!store.list.length" class="cta-row">
            <router-link to="/new" class="btn btn-primary">新建第一个项目</router-link>
            <span class="muted small">先建项目，之后的记录和报告都挂在它下面。</span>
          </div>

          <section v-if="store.list.length" class="recent">
            <div class="recent-head">
              <h2>最近项目</h2>
              <router-link to="/new" class="link">新建 →</router-link>
            </div>
            <article
              v-for="(p, i) in visibleProjects"
              :key="p.id"
              class="card card-tap project rise"
              :style="{ '--i': i }"
              @click="router.push(`/project/${p.id}`)"
            >
              <div class="p-main">
                <div class="p-top">
                  <h3 class="p-title">{{ p.topic || '未命名课题' }}</h3>
                  <span class="chip" :class="p.status === 'done' ? 'chip-ok' : 'chip-accent'">
                    {{ p.status === 'done' ? '已完成' : '进行中' }}
                  </span>
                </div>
                <p class="p-meta">
                  <span>{{ p.groupName || '未填小组' }}</span>
                  <span>{{ p.teacher ? `指导 ${p.teacher}` : '未填指导教师' }}</span>
                  <span class="p-date">{{ fmtDate(p.updatedAt) }}</span>
                </p>
                <ul class="rpt-row" :aria-label="`${p.topic} 的四份报告状态`">
                  <li
                    v-for="r in store.statusesOf(p.id)"
                    :key="r.kind"
                    class="rpt"
                    :class="`s-${r.status}`"
                    :title="`${r.label}：${r.statusLabel}`"
                  >
                    <i class="rpt-dot" />
                    <span class="rpt-name">{{ SHORT_KIND[r.kind] ?? r.label }}</span>
                  </li>
                </ul>
              </div>
              <button class="p-del" aria-label="删除" @click.stop="removeProject(p.id, p.topic)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </article>
            <button
              v-if="moreProjects"
              class="btn btn-sm btn-block more-projects"
              type="button"
              @click="projectLimit += 12"
            >
              显示更多项目（还有 {{ moreProjects }} 个）
            </button>
          </section>

          <p class="foot-note">第三方开源工具，与学校及其管理部门无隶属或合作关系。</p>
        </template>

        <!-- ===== 对话 ===== -->
        <template v-else>
          <div class="thread-head">
            <span class="muted small">
              <span class="mode-chip">{{ chat.current.mode === 'chat' ? '纯聊天' : '项目指导' }}</span>
              {{ chat.current.title }}
            </span>
            <div class="head-acts">
              <button class="link" type="button" @click="newChat">新对话</button>
              <span class="dot-sep">·</span>
              <button class="link" type="button" @click="clearThread">清空</button>
            </div>
          </div>

          <div v-for="m in chat.currentMsgs" :key="m.id" class="msg" :class="m.role">
            <div class="bubble" :class="{ failed: m.error }">
              <template v-if="m.role === 'ai'">
                <!-- 执行过程：像 WorkBuddy 那样一行一步，看得见走到哪了 -->
                <ol v-if="m.steps?.length" class="msg-steps">
                  <li v-for="(st, i) in m.steps" :key="i" :class="st.status">
                    <span class="ms-dot" />
                    <span class="ms-body">
                      <span class="ms-label">{{ i + 1 }}. {{ st.label }}</span>
                      <span v-if="st.detail" class="ms-detail">{{ st.detail }}</span>
                    </span>
                    <span class="ms-note">
                      {{ st.status === 'running' ? '进行中…' : st.status === 'done' ? (st.note || '完成') : st.status === 'failed' ? (st.note || '中断') : '等待' }}
                    </span>
                  </li>
                </ol>

                <div v-if="m.reasoning" class="think" :class="{ open: openThink === m.id }">
                  <button class="think-head" type="button" @click="openThink = openThink === m.id ? null : m.id">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 11 10.1 9z" /></svg>
                    <span>思考过程</span>
                    <span class="think-meta">
                      {{ streamingId === m.id ? '思考中…' : '思考完成' }} · {{ m.reasoning.length }} 字
                    </span>
                    <svg class="think-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  <div class="think-body">
                    <div class="think-inner">
                      <TypingMarkdown
                        v-if="typingMsg?.id === m.id && typingMsg.stage === 'think'"
                        :text="m.reasoning"
                        :speed="typingSpeed"
                        @done="typingMsg.stage = 'text'"
                      />
                      <MarkdownText v-else :text="m.reasoning" />
                    </div>
                  </div>
                </div>
                <!-- 一条回复只用一个气泡：思考、等待、正文都在里面 -->
                <div v-if="streamingId === m.id && !streamHasContent" class="inline-typing">
                  <i /><i /><i />
                  <span class="typing-time">{{ elapsed }}s</span>
                </div>
                <template v-else>
                  <TypingMarkdown
                    v-if="typingMsg?.id === m.id && typingMsg.stage === 'text'"
                    :text="m.text"
                    :speed="typingSpeed"
                    @done="typingMsg = null"
                  />
                  <div v-else class="md-stream">
                    <MarkdownText :text="m.text" />
                    <span v-if="streamingId === m.id" class="caret" aria-hidden="true" />
                    <span v-if="streamingId === m.id" class="stream-time">{{ elapsed }}s</span>
                  </div>
                </template>
              </template>
              <template v-else>
                <span v-if="m.files?.length" class="bubble-files">
                  <span v-for="f in m.files" :key="f" class="bubble-file">{{ f }}</span>
                </span>
                {{ m.text }}
              </template>
            </div>
          </div>

          <div v-if="aiChecked && !aiReady" class="ai-off">
            <p>还没有可用的模型，上面的回答只是操作说明。</p>
            <router-link to="/settings/model" class="btn btn-sm btn-primary">去配置模型</router-link>
          </div>
        </template>
      </div>
    </div>

    <!-- 用户往上翻时不要拽回去，想看最新内容自己点 -->
    <button v-if="!stick" class="to-latest" type="button" @click="backToLatest">回到最新 ↓</button>

    <!-- ===== 输入区 ===== -->
    <div class="composer-wrap">
      <div class="inner">
        <p v-if="transcribing" class="transcribing">正在把「{{ transcribing }}」转述成文字…</p>

        <!-- 一个框：快捷入口在框内顶部，输入在下面 -->
        <div class="composer-shell">
          <div class="pills">
            <button class="pill" type="button" @click="app.drawer = true">
              <span class="pill-ico" v-html="iconSet.list" />历史对话
            </button>
            <button class="pill" type="button" @click="newChat">新对话</button>
            <button class="pill" type="button" @click="router.push('/new')">
              <span class="pill-ico" v-html="iconSet.spark" />新建项目
            </button>
            <button class="pill" type="button" @click="send('我现在应该先做哪一步？')">先做哪一步</button>
          </div>

          <div v-if="pending.length" class="attach-row">
            <span v-for="(f, i) in pending" :key="f.name" class="attach">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5z"/><path d="M14 3.5V8.5h5"/></svg>
              <span class="attach-name">{{ f.name }}</span>
              <span class="attach-size">{{ f.text.length }} 字</span>
              <button class="attach-x" type="button" aria-label="移除附件" @click="dropFile(i)">×</button>
            </span>
          </div>

          <div class="composer">
          <button class="attach-btn" type="button" aria-label="添加图片" title="图片（相册）" @click="pickImages">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2.4"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 4.8-4.4 3.4 3 2.6-2.2 4.2 3.6"/></svg>
          </button>
          <button class="attach-btn" type="button" aria-label="添加文件" title="文本文件（文件管理器）" @click="pickFiles">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5V7a4 4 0 0 1 8 0v9a5.5 5.5 0 0 1-11 0V8"/></svg>
          </button>
          <input ref="imageInput" type="file" class="hidden-file" accept="image/*" multiple @change="onFiles" />
          <input ref="fileInput" type="file" class="hidden-file" multiple accept=".txt,.md,.csv,.json,text/*" @change="onFiles" />
          <textarea
            v-model="draft"
            class="composer-input"
            rows="1"
            placeholder="问点什么，或说说你想做什么研究…"
            @keydown.enter.exact.prevent="send()"
          />
          <button class="send" :disabled="sending || !draft.trim()" aria-label="发送" @click="send()">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" /></svg>
          </button>
          </div>
        </div>

        <p class="composer-note">AI 内容仅供辅助，需自行核实</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; }

.to-latest {
  position: absolute; left: 50%; bottom: 96px; z-index: 6;
  transform: translateX(-50%);
  padding: 7px 14px; border: none; border-radius: var(--r-full);
  background: var(--surface); color: var(--text-2);
  font: inherit; font-size: 12px; cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  transition: color var(--dur-2) var(--ease-out);
}
.to-latest:hover { color: var(--text); }
html[data-theme='dark'] .to-latest { background: var(--surface-3); }

.thread {
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto; overscroll-behavior: contain;
}
.inner { max-width: 760px; margin: 0 auto; width: 100%; padding: 0 var(--sp-4); }

/* ---------- 空状态 ---------- */
.hero {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: max(36px, 7vh) var(--sp-2) var(--sp-4);
}
.mark { width: 56px; height: 56px; border-radius: 14px; display: block; margin-bottom: var(--sp-4); }
.hello {
  font-size: 22px; line-height: 1.5; font-weight: var(--fw-strong);
  letter-spacing: -0.01em; margin: 0; color: var(--text);
}
.sub {
  margin: var(--sp-3) 0 0; max-width: 26em;
  font-size: 13.5px; line-height: 1.75; color: var(--text-3);
}
.stats {
  display: inline-flex; align-items: center; gap: var(--sp-3);
  margin-top: var(--sp-4); font-size: var(--fs-1); color: var(--text-3);
}
.stats b { color: var(--text); font-size: var(--fs-3); margin-right: 3px; }
.stats .sep { width: 1px; height: 12px; background: var(--line-strong); }

.mode-pick {
  display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2);
  margin: 0 0 var(--sp-5);
}
.mp-card {
  display: flex; flex-direction: column; gap: 6px;
  padding: 14px 16px; text-align: left;
  border: none; border-radius: var(--r-3);
  background: var(--surface); color: var(--text-2);
  font: inherit; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.mp-card:hover { background: var(--surface-2); }
.mp-card:active { transform: scale(0.99); }
.mp-card b { font-size: 14px; color: var(--text); }
.mp-card span { font-size: 12px; line-height: 1.65; color: var(--text-3); }
.mode-chip {
  display: inline-block; margin-right: 6px; padding: 1px 7px;
  border-radius: var(--r-full); background: var(--surface-3);
  font-size: 10.5px; color: var(--text-3);
}
@media (max-width: 860px) {
  .mode-pick { grid-template-columns: 1fr; }
}

.prompts {
  display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2);
  margin: 0 0 var(--sp-6);
}
.prompt {
  display: flex; align-items: flex-start; gap: 9px;
  padding: 13px 14px; text-align: left;
  border-radius: var(--r-2);
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text-2);
  font-size: 13px; line-height: 1.55;
  cursor: pointer;
  transition: border-color var(--dur-2) var(--ease-out), background var(--dur-2) var(--ease-out);
}
.prompt:hover { border-color: var(--line-strong); background: var(--surface-2); color: var(--text); }
.pi { flex: 0 0 18px; width: 18px; height: 18px; color: var(--text-3); margin-top: 1px; }
.pi :deep(svg) { width: 100%; height: 100%; display: block; }

.recent { margin-bottom: var(--sp-4); }
.recent-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: var(--sp-3); }

.cta-row {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin: 0 0 var(--sp-6);
  padding: 14px 16px;
  border-radius: var(--r-2);
  background: var(--surface-2);
  border: 1px solid var(--line);
}
.cta-row .small { flex: 1 1 12em; margin: 0; }
.recent-head h2 { font-size: var(--fs-3); }
.link {
  border: none; background: none; padding: 0;
  color: var(--text-3); font-size: 12.5px; cursor: pointer;
}
.link:hover { color: var(--primary); }

/* ---------- 项目卡 ---------- */
.project { display: flex; align-items: flex-start; gap: var(--sp-3); padding: var(--sp-4); margin-bottom: var(--sp-2); }
.p-main { flex: 1; min-width: 0; }
.p-top { display: flex; align-items: center; gap: var(--sp-2); }
.p-title {
  font-size: var(--fs-3); font-weight: var(--fw-medium); flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.p-meta {
  display: flex; gap: var(--sp-3); flex-wrap: wrap;
  margin: var(--sp-2) 0 0; font-size: var(--fs-1); color: var(--text-3);
}
.p-date { margin-left: auto; }
.rpt-row {
  display: flex; align-items: center; gap: var(--sp-3);
  list-style: none; margin: var(--sp-3) 0 0; padding: 0; flex-wrap: wrap;
}
.rpt { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text-3); }
.rpt-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 6px; background: var(--line-strong); }
.rpt.s-draft .rpt-dot { background: var(--warn); }
.rpt.s-review .rpt-dot { background: var(--primary); }
.rpt.s-confirmed .rpt-dot { background: var(--ok); }
.rpt.s-draft, .rpt.s-review { color: var(--text-2); }
.rpt.s-confirmed { color: var(--ok); }
.p-del {
  width: 26px; height: 26px; flex: 0 0 26px;
  display: grid; place-items: center;
  border: 1px solid transparent; border-radius: var(--r-1);
  background: transparent; color: var(--text-3); cursor: pointer;
}
.p-del:hover { border-color: var(--line); color: var(--danger); }
.more-projects { margin: 4px 0 0; font-variant-numeric: tabular-nums; }
.foot-note { margin: var(--sp-4) 0 var(--sp-3); font-size: 11px; color: var(--text-3); text-align: center; }

/* ---------- 对话 ---------- */
.thread-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: var(--sp-3) 0 var(--sp-2);
}
.thread-head .muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head-acts { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.dot-sep { color: var(--line-strong); }
.msg { display: flex; margin-bottom: var(--sp-3); }
.msg.user { justify-content: flex-end; }
.bubble {
  max-width: 88%;
  padding: 11px 15px;
  border-radius: var(--r-3);
  font-size: 14px; line-height: 1.8;
  white-space: pre-wrap; word-break: break-word;
}
.msg.ai .bubble { background: var(--surface-2); color: var(--text); border-bottom-left-radius: var(--r-1); }
.msg.user .bubble { background: var(--primary); color: var(--on-primary); border-bottom-right-radius: var(--r-1); }
.bubble.failed { color: var(--danger); }
/* 等待中的三点放在同一条气泡里，不再另起一个气泡 */
.inline-typing { display: inline-flex; gap: 4px; align-items: center; min-height: 22px; }
.inline-typing i { width: 5px; height: 5px; border-radius: 50%; background: var(--text-3); animation: blink 1.1s infinite ease-in-out; }
.inline-typing i:nth-child(2) { animation-delay: 0.15s; }
.inline-typing i:nth-child(3) { animation-delay: 0.3s; }
.typing-time {
  margin-left: 6px; font-size: 11px; color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

/* 思考过程：同一个气泡里的一段，用细线隔开，不再像第二个框 */
.think { margin: 0 0 8px; padding-bottom: 8px; border-bottom: 1px solid var(--line); background: transparent; }
.think-head {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 2px 0; border: none;
  background: transparent; color: var(--text-3);
  font: inherit; font-size: 11.5px; cursor: pointer;
}
.think-head:hover { color: var(--text-2); }
.think-meta { margin-left: auto; opacity: 0.7; font-variant-numeric: tabular-nums; }
.think-chev { transition: transform 260ms var(--ease-out); }
.think.open .think-chev { transform: rotate(180deg); }
.think-body {
  display: grid; grid-template-rows: 0fr;
  transition: grid-template-rows 280ms var(--ease-out);
}
.think.open .think-body { grid-template-rows: 1fr; }
.think-inner {
  overflow: hidden; min-height: 0;
  padding: 0 10px;
  font-size: 12.5px; color: var(--text-3);
}
/* 思考过程可能很长：展开后限高滚动，不把正文顶到屏幕外 */
.think.open .think-inner { max-height: 320px; overflow-y: auto; }

/* 执行过程：一行一步，窄屏也不挤 */
.msg-steps {
  list-style: none; margin: 0 0 10px; padding: 8px 10px;
  border-radius: var(--r-2); background: var(--surface-3);
  display: flex; flex-direction: column; gap: 6px;
  font-size: 12px;
}
.msg-steps li { display: flex; align-items: flex-start; gap: 8px; color: var(--text-3); }
.ms-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--line-strong); flex: 0 0 7px; margin-top: 6px;
}
.msg-steps li.running { color: var(--text); }
.msg-steps li.running .ms-dot { background: var(--primary); animation: pulse 1s infinite ease-in-out; }
.msg-steps li.done .ms-dot { background: var(--ok); }
.msg-steps li.failed .ms-dot { background: var(--danger); }
.ms-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ms-label { line-height: 1.5; }
.ms-detail { font-size: 11px; color: var(--text-3); line-height: 1.6; }
.ms-note {
  flex: 0 0 auto; font-size: 11px; opacity: 0.85;
  font-variant-numeric: tabular-nums; padding-top: 1px;
}

/* 流式光标的节奏：贴住最后一段文字，呼吸式闪烁 */
.md-stream { position: relative; }
.caret {
  display: inline-block;
  width: 2px; height: 1.05em;
  margin-left: 2px;
  vertical-align: -0.16em;
  background: var(--text-2);
  animation: caret-blink 1.05s steps(2, start) infinite;
}
@keyframes caret-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
html[data-motion='off'] .caret { animation: none; }
/* 流式全程都能看到已等待秒数，不只是首字到来之前 */
.stream-time {
  margin-left: 8px; font-size: 11px; color: var(--text-3);
  white-space: nowrap; font-variant-numeric: tabular-nums;
}
.think.open .think-inner { padding: 0 10px 10px; }
@keyframes blink { 0%, 100% { opacity: 0.25; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-2px); } }

.ai-off {
  margin: var(--sp-3) 0 var(--sp-6);
  padding: 12px 14px; border-radius: var(--r-2);
  background: var(--surface-2); border: 1px solid var(--line);
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.ai-off p { margin: 0; flex: 1 1 12em; font-size: 12.5px; color: var(--text-2); }

/* ---------- 输入区 ---------- */
.composer-wrap {
  flex: 0 0 auto;
  border-top: 1px solid var(--line);
  background: var(--bg);
  padding-bottom: var(--safe-bottom, env(safe-area-inset-bottom, 0px));
}
.composer-wrap .inner { padding-top: var(--sp-2); }

/* 整个输入区只留一个框：快捷入口、附件、输入、发送都在里面 */
.composer-shell {
  border-radius: var(--r-3);
  background: var(--surface-2);
  border: 1px solid var(--line);
  padding: 6px 8px 8px;
  transition: border-color var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out);
}
.composer-shell:focus-within {
  border-color: var(--line-strong);
  box-shadow: 0 0 0 3px var(--surface-3);
}

.pills {
  display: flex; gap: 4px; overflow-x: auto; padding: 0 0 4px;
  scrollbar-width: none;
}
.pills::-webkit-scrollbar { display: none; }
.pill {
  flex: 0 0 auto; height: 26px; padding: 0 9px;
  border-radius: var(--r-full);
  border: none; background: transparent;
  color: var(--text-3); font-size: 11.5px;
  display: inline-flex; align-items: center; gap: 5px;
  cursor: pointer; white-space: nowrap;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.pill:hover { background: var(--surface-3); color: var(--text); }
.pill-ico { display: inline-flex; width: 15px; height: 15px; color: var(--text-3); }
.pill-ico :deep(svg) { width: 100%; height: 100%; display: block; }

.transcribing {
  margin: 0 0 var(--sp-2); font-size: 11.5px; color: var(--text-3);
}

.attach-row {
  display: flex; gap: 6px; flex-wrap: wrap; padding: 0 0 var(--sp-2);
}
.attach {
  display: inline-flex; align-items: center; gap: 6px;
  max-width: 100%; padding: 5px 8px;
  border-radius: var(--r-1); background: var(--surface-2);
  color: var(--text-2); font-size: 11.5px;
}
.attach-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 15em; }
.attach-size { flex: 0 0 auto; font-size: 10.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.attach-x { border: none; background: none; color: var(--text-3); font-size: 14px; line-height: 1; cursor: pointer; padding: 0 0 0 2px; }
.attach-btn {
  flex: 0 0 32px; width: 32px; height: 34px;
  border: none; background: transparent; color: var(--text-3);
  display: grid; place-items: center; cursor: pointer; border-radius: var(--r-1);
}
.attach-btn:hover { color: var(--text); background: var(--surface-3); }
.hidden-file { display: none; }
.bubble-files { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
.bubble-file {
  align-self: flex-start; padding: 2px 7px; border-radius: var(--r-1);
  background: rgba(255, 255, 255, 0.16); font-size: 11px;
}

.composer {
  display: flex; align-items: flex-end; gap: var(--sp-2);
  padding: 0;
  background: transparent;
  border: none;
}
/* 聚焦不加描边：靠一圈加深的内阴影咬合，避免移动端那圈蓝框 */
.composer:focus-within {
  border-color: var(--line);
  box-shadow: inset 0 0 0 1px var(--surface-3), inset 0 0 0 2px var(--surface-2);
}
.composer-input {
  flex: 1; min-width: 0;
  border: none; background: transparent; resize: none;
  outline: none; box-shadow: none; -webkit-tap-highlight-color: transparent;
  max-height: 132px; min-height: 26px;
  font-size: 15px; line-height: 26px;
  color: var(--text);
  padding: 0;
}
.composer-input:focus, .composer-input:focus-visible { outline: none; box-shadow: none; border: none; }
.composer-input::placeholder { color: var(--text-3); }
.send {
  width: 38px; height: 38px; flex: 0 0 38px;
  border: none; border-radius: 50%;
  background: var(--primary); color: var(--on-primary);
  display: grid; place-items: center; cursor: pointer;
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.send:disabled { opacity: 0.4; cursor: default; }
.send:not(:disabled):active { transform: scale(0.94); }
.composer-note {
  margin: 7px 0 6px; text-align: center;
  font-size: 11px; color: var(--text-3); opacity: 0.8;
}

/* ---------- 桌面 ---------- */
@media (min-width: 861px) {
  .inner { padding: 0 var(--sp-6); }
  .hero { align-items: flex-start; text-align: left; padding: var(--sp-8) 0 var(--sp-5); }
  .mark { width: 48px; height: 48px; border-radius: 12px; }
  .hello { font-size: var(--fs-4); }
  .prompts { grid-template-columns: repeat(4, 1fr); }
  .composer-wrap .inner { padding-left: var(--sp-6); padding-right: var(--sp-6); }
  .bubble { font-size: 13.5px; }
}
@media (max-width: 860px) {
  .p-date { display: none; }
  .foot-note { display: none; }
  .prompts { grid-template-columns: 1fr; }
}
</style>
