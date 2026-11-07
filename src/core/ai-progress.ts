/**
 * AI 起草的「工作步骤 + 耗时」状态
 *
 * 为什么不是转圈：一次生成可能要等十几秒到一两分钟，只有一个「生成中…」
 * 用户会以为卡死。这里把 Agent 实际在做的几个阶段摊开，配合真实计时，
 * 长时间等待时还会换一句说明，让人知道是模型慢、不是软件死了。
 *
 * 安卓壳里流式不可用（一次性返回），所以步骤条自带缓慢推进：
 * 即使一个 token 都还没到，界面也一直在动；真到了关键节点用 to() 跳转。
 */
import { computed, onScopeDispose, ref } from 'vue';

export type AiStepState = 'wait' | 'running' | 'done' | 'failed';
/** 每条 AI 链路一套步骤：记录 / 报告 / 批量 / 选题 / 草案 / 要求解析 / 演示稿 */
export type AiPreset = 'record' | 'report' | 'batch' | 'idea' | 'draft' | 'extract' | 'deck';

export interface AiStep {
  key: string;
  label: string;
  state: AiStepState;
}

interface StepDef {
  key: string;
  label: string;
}

/** 每条链路的阶段顺序；model 之前的步骤可以自动推进，之后必须等真实结果 */
const PRESETS: Record<AiPreset, StepDef[]> = {
  record: [
    { key: 'collect', label: '收集项目信息' },
    { key: 'history', label: '读取前序研究记录' },
    { key: 'scope', label: '确定本篇要承接的下一步' },
    { key: 'model', label: '调用模型起草正文' },
    { key: 'verify', label: '校验内容与占位词' },
    { key: 'write', label: '写入六个格子' },
  ],
  report: [
    { key: 'collect', label: '读取项目资料' },
    { key: 'history', label: '汇总研究记录与来源' },
    { key: 'search', label: '检索相关文献' },
    { key: 'scope', label: '确定本节写作范围' },
    { key: 'model', label: '调用模型起草本节' },
    { key: 'verify', label: '校验正文与事实边界' },
    { key: 'write', label: '写入并保存' },
  ],
  batch: [
    { key: 'plan', label: '整理本学期篇目' },
    { key: 'history', label: '汇总已写好的记录' },
    { key: 'model', label: '调用模型分批起草' },
    { key: 'verify', label: '校验占位词与收尾' },
    { key: 'write', label: '写入记录表' },
  ],
  idea: [
    { key: 'collect', label: '整理你的想法与年级' },
    { key: 'scope', label: '确定能开做的选题范围' },
    { key: 'model', label: '调用模型想候选题目' },
    { key: 'verify', label: '筛掉空话与编造内容' },
    { key: 'write', label: '列出可选方向' },
  ],
  draft: [
    { key: 'collect', label: '读取研究主题与年级' },
    { key: 'scope', label: '确定要求草案的边界' },
    { key: 'model', label: '调用模型起草要求条文' },
    { key: 'verify', label: '校验不编造学校与数据' },
    { key: 'write', label: '填入教师要求框' },
  ],
  extract: [
    { key: 'collect', label: '读取教师要求原文' },
    { key: 'scope', label: '离线规则先识别一遍' },
    { key: 'model', label: '调用模型精修字段' },
    { key: 'verify', label: '合并并标注待核对项' },
    { key: 'write', label: '列出识别结果' },
  ],
  deck: [
    { key: 'collect', label: '读取项目与全部记录' },
    { key: 'plan', label: '排好答辩页顺序' },
    { key: 'model', label: '调用模型逐页写短句' },
    { key: 'verify', label: '校验页数与事实' },
    { key: 'write', label: '写入演示稿' },
  ],
};

/** 自动推进停在哪一步：模型返回之前不假装「校验完了」 */
const AUTO_STOP: Record<AiPreset, string> = {
  record: 'model',
  report: 'model',
  batch: 'model',
  idea: 'model',
  draft: 'model',
  extract: 'model',
  deck: 'model',
};

export function elapsedTextOf(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return m > 0 ? `${m}:${String(rest).padStart(2, '0')}` : `${s}s`;
}

export function waitNoteOf(seconds: number): string {
  if (seconds < 12) return '正在整理这一篇能用到的事实…';
  if (seconds < 30) return '模型还在写，页面没有卡住，稍等一下。';
  if (seconds < 60) return '这次比较久，通常是模型或网络慢；已经填好的内容不会丢。';
  if (seconds < 120) return '已经等了一分钟以上。可以继续等，也可以检查网络后重试。';
  return '等得比较久了。建议检查模型配置与网络；超时会自动停下并保留原内容。';
}

export type AiProgress = ReturnType<typeof useAiProgress>;

export function useAiProgress() {
  const visible = ref(false);
  const active = ref(false);
  const failed = ref(false);
  const title = ref('AI 正在工作');
  const detail = ref('');
  const elapsed = ref(0);
  const steps = ref<AiStep[]>([]);
  const note = ref('');

  let tickTimer = 0;
  let autoTimer = 0;
  let hideTimer = 0;
  let startedAt = 0;
  let autoAt = 0;
  let preset: AiPreset = 'record';

  const elapsedText = computed(() => elapsedTextOf(elapsed.value));
  const currentStep = computed(() => steps.value.find((s) => s.state === 'running')?.label ?? '');

  function clearTimers() {
    if (tickTimer) window.clearInterval(tickTimer);
    if (autoTimer) window.clearInterval(autoTimer);
    if (hideTimer) window.clearTimeout(hideTimer);
    tickTimer = 0;
    autoTimer = 0;
    hideTimer = 0;
  }

  function paintTo(key: string, message = '') {
    const list = steps.value;
    const target = list.findIndex((s) => s.key === key);
    if (target < 0) return;
    autoAt = target;
    steps.value = list.map((s, i) => ({
      ...s,
      state: i < target ? 'done' : i === target ? 'running' : 'wait',
    }));
    if (message) detail.value = message;
  }

  function start(kind: AiPreset = 'record', heading = 'AI 正在工作') {
    clearTimers();
    preset = kind;
    title.value = heading;
    detail.value = '';
    note.value = waitNoteOf(0);
    elapsed.value = 0;
    failed.value = false;
    active.value = true;
    visible.value = true;
    startedAt = Date.now();
    steps.value = PRESETS[kind].map((s, i) => ({ ...s, state: i === 0 ? 'running' : 'wait' }));
    autoAt = 0;

    tickTimer = window.setInterval(() => {
      elapsed.value = Math.floor((Date.now() - startedAt) / 1000);
      note.value = waitNoteOf(elapsed.value);
    }, 1000);

    // 非流式也能动：慢慢把准备阶段走完，到「调用模型」就停住老实等
    autoTimer = window.setInterval(() => {
      const stop = PRESETS[preset].findIndex((s) => s.key === AUTO_STOP[preset]);
      if (autoAt >= stop) return;
      autoAt += 1;
      paintTo(PRESETS[preset][autoAt].key);
    }, 1600);
  }

  /** 到某个阶段：之前全部标完成 */
  function to(key: string, message = '') {
    paintTo(key, message);
  }

  function setDetail(message: string) {
    detail.value = message;
  }

  function fail(message = '这一步没完成') {
    clearTimers();
    elapsed.value = Math.floor((Date.now() - startedAt) / 1000);
    active.value = false;
    failed.value = true;
    note.value = message;
    steps.value = steps.value.map((s) =>
      s.state === 'running' ? { ...s, state: 'failed' } : s,
    );
    hideTimer = window.setTimeout(() => (visible.value = false), 6000);
  }

  function finish(message = '已写好，记得自己核对一遍') {
    clearTimers();
    elapsed.value = Math.floor((Date.now() - startedAt) / 1000);
    active.value = false;
    failed.value = false;
    note.value = message;
    steps.value = steps.value.map((s) => ({ ...s, state: 'done' }));
    hideTimer = window.setTimeout(() => (visible.value = false), 2600);
  }

  function reset() {
    clearTimers();
    visible.value = false;
    active.value = false;
    failed.value = false;
    elapsed.value = 0;
    steps.value = [];
  }

  onScopeDispose(clearTimers);

  return {
    visible,
    active,
    failed,
    title,
    detail,
    elapsed,
    elapsedText,
    steps,
    note,
    currentStep,
    start,
    to,
    setDetail,
    fail,
    finish,
    reset,
  };
}
