<script setup lang="ts">
/**
 * 一键清档（三次确认 + 本地验证码）
 *
 * 为什么这么麻烦：清档不可撤销，没有云端副本、没有回收站。
 * 第一屏讲清后果，第二屏要求手打「永久删除」，第三屏要求抄写本机随机验证码，
 * 并且倒计时结束才能按下最后一个按钮 —— 每一步都无法靠连点蒙过去。
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { db } from '../../core/db';
import { useAppStore } from '../../stores/app';

const emit = defineEmits<{ (e: 'close'): void }>();
const app = useAppStore();

const step = ref<1 | 2 | 3>(1);
const counts = ref({ projects: 0, reports: 0, records: 0, sources: 0, providers: 0 });
const typed = ref('');
const acknowledged = ref(false);
const code = ref('');
const codeInput = ref('');
const countdown = ref(8);
const working = ref(false);
const error = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
}

async function start() {
  step.value = 1;
  typed.value = '';
  acknowledged.value = false;
  error.value = '';
  codeInput.value = '';
  counts.value = {
    projects: await db.projects.count(),
    reports: await db.reports.count(),
    records: await db.records.count(),
    sources: await db.sources.count(),
    providers: await db.providers.count(),
  };
}
void start();

function goStep2() {
  step.value = 2;
  typed.value = '';
  acknowledged.value = false;
}

function goStep3() {
  if (typed.value.trim() !== '永久删除') {
    error.value = '请输入「永久删除」四个字，一个字都不能差。';
    return;
  }
  if (!acknowledged.value) {
    error.value = '需要先勾选「我知道无法恢复」。';
    return;
  }
  error.value = '';
  step.value = 3;
  code.value = makeCode();
  codeInput.value = '';
  countdown.value = 8;
  timer = setInterval(() => {
    countdown.value = Math.max(0, countdown.value - 1);
    if (countdown.value === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 1000);
}

const codeOk = computed(() => codeInput.value.trim().toUpperCase() === code.value);

async function wipe() {
  if (!codeOk.value || countdown.value > 0) return;
  working.value = true;
  try {
    await db.delete();
    // 清档后不再保留任何“上次状态”，直接回到引导页重新开始
    location.hash = '#/';
    location.reload();
  } catch (e) {
    working.value = false;
    error.value = `清档失败：${e instanceof Error ? e.message : String(e)}。可尝试刷新后重试。`;
  }
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="wipe-title">
      <div class="steps">
        <i v-for="n in 3" :key="n" :class="{ on: step >= n }" />
      </div>

      <!-- 第一步：讲清后果 -->
      <template v-if="step === 1">
        <h2 id="wipe-title">这会删掉本机上的全部数据</h2>
        <p class="lead">
          没有云端副本，也没有回收站。删除后无法恢复，我们也没有任何后门能帮你找回。
        </p>
        <ul class="facts">
          <li><b>{{ counts.projects }}</b> 个项目</li>
          <li><b>{{ counts.reports }}</b> 份报告</li>
          <li><b>{{ counts.records }}</b> 篇研究记录</li>
          <li><b>{{ counts.sources }}</b> 条来源</li>
          <li><b>{{ counts.providers }}</b> 个模型服务配置（含 API Key）</li>
        </ul>
        <p class="hint">如果只是想重装或换设备，建议先去「数据备份与恢复」导出一份加密备份。</p>
        <div class="actions">
          <button class="btn" type="button" @click="emit('close')">取消</button>
          <button class="btn btn-danger" type="button" @click="goStep2">我了解，继续</button>
        </div>
      </template>

      <!-- 第二步：手打确认词 -->
      <template v-else-if="step === 2">
        <h2 id="wipe-title">第二次确认</h2>
        <p class="lead">请在下面输入「<b>永久删除</b>」四个字。粘贴按钮救不了你，输入框只接受完全一致的四个字。</p>
        <label class="field">
          <span class="field-label">确认词</span>
          <input v-model="typed" class="input" placeholder="永久删除" autocomplete="off" />
        </label>
        <label class="check">
          <input v-model="acknowledged" type="checkbox" />
          <span>我知道清档后项目、报告、记录、附件与 API Key 都会消失，且无法恢复。</span>
        </label>
        <p v-if="error" class="err">{{ error }}</p>
        <div class="actions">
          <button class="btn" type="button" @click="step = 1">上一步</button>
          <button class="btn btn-danger" type="button" @click="goStep3">下一步</button>
        </div>
      </template>

      <!-- 第三步：本地验证码 + 倒计时 -->
      <template v-else>
        <h2 id="wipe-title">最后一次确认</h2>
        <p class="lead">把下面这串验证码抄进来。它只在本机生成，不联网、不发短信。</p>
        <div class="code-box" aria-label="本机验证码">
          <span v-for="(ch, i) in code.split('')" :key="i" class="code-char">{{ ch }}</span>
        </div>
        <label class="field">
          <span class="field-label">输入验证码（不区分大小写）</span>
          <input
            v-model="codeInput"
            class="input mono"
            placeholder="六位字符"
            autocomplete="off"
            spellcheck="false"
            @paste.prevent
          />
        </label>
        <p v-if="error" class="err">{{ error }}</p>
        <p class="hint" v-if="countdown > 0">按钮将在 {{ countdown }} 秒后可用 —— 给自己留点反悔时间。</p>
        <div class="actions">
          <button class="btn" type="button" @click="step = 2">上一步</button>
          <button
            class="btn btn-danger"
            type="button"
            :disabled="!codeOk || countdown > 0 || working"
            @click="wipe"
          >
            {{ working ? '清理中…' : countdown > 0 ? `等待 ${countdown}s` : '永久删除全部数据' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed; inset: 0; z-index: 120;
  background: rgba(10, 10, 12, 0.46);
  display: grid; place-items: center;
  padding: 20px;
  animation: fade var(--dur-2) var(--ease-out);
}
.sheet {
  width: min(460px, 100%);
  max-height: min(84dvh, 640px);
  overflow-y: auto;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-4);
  box-shadow: var(--shadow-3);
  padding: 22px 22px 18px;
  animation: pop var(--dur-3) var(--ease-out);
}
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop { from { opacity: 0; transform: translateY(10px) scale(0.985); } to { opacity: 1; transform: none; } }

.steps { display: flex; gap: 5px; margin-bottom: 16px; }
.steps i { height: 3px; flex: 1; border-radius: var(--r-full); background: var(--surface-3); transition: background var(--dur-3); }
.steps i.on { background: var(--danger, #c0392b); }

h2 { margin: 0 0 8px; font-size: calc(18px * var(--font-scale)); letter-spacing: -0.01em; }
.lead { margin: 0 0 14px; font-size: calc(13px * var(--font-scale)); line-height: 1.75; color: var(--text-2); }
.facts {
  margin: 0 0 12px; padding: 12px 14px; list-style: none;
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-2);
  font-size: calc(12.5px * var(--font-scale)); color: var(--text-2);
}
.facts b { font-size: calc(15px * var(--font-scale)); color: var(--text); font-variant-numeric: tabular-nums; margin-right: 4px; }
.hint { margin: 8px 0 0; font-size: calc(12px * var(--font-scale)); color: var(--text-3); line-height: 1.7; }
.err { margin: 10px 0 0; font-size: calc(12.5px * var(--font-scale)); color: var(--danger, #c0392b); }
.field { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.field-label { font-size: calc(12px * var(--font-scale)); color: var(--text-3); }
.input {
  height: 42px; padding: 0 12px;
  border: 1px solid var(--line-strong); border-radius: var(--r-1);
  background: var(--surface); color: var(--text); font: inherit; font-size: calc(14px * var(--font-scale));
}
.input:focus { outline: 2px solid var(--primary); outline-offset: 1px; }
.mono { font-family: var(--font-mono); letter-spacing: 0.12em; }
.check { display: flex; gap: 9px; margin-top: 14px; font-size: calc(12.5px * var(--font-scale)); line-height: 1.65; color: var(--text-2); cursor: pointer; }
.check input { margin-top: 2px; accent-color: var(--danger, #c0392b); }
.code-box {
  display: flex; gap: 8px; justify-content: center;
  padding: 14px; margin: 6px 0 4px;
  background: var(--surface-2); border-radius: var(--r-2);
  user-select: none;
}
.code-char {
  width: 38px; height: 48px;
  display: grid; place-items: center;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  font-family: var(--font-mono);
  font-size: calc(22px * var(--font-scale)); font-weight: var(--fw-strong);
  color: var(--text);
  transform: rotate(-1.5deg);
}
.code-char:nth-child(2n) { transform: rotate(1.5deg) translateY(-2px); }
.code-char:nth-child(3n) { transform: rotate(-2deg) translateY(1px); }
.actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }
.actions .btn { min-width: 96px; }
@media (max-width: 520px) {
  .facts { grid-template-columns: 1fr; }
  .actions { flex-direction: column-reverse; }
  .actions .btn { width: 100%; }
}
</style>
