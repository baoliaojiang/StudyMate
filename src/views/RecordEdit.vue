<script setup lang="ts">
/**
 * 单篇研究记录（独立页面）
 *
 * 为什么不做抽屉：记录是要反复改的东西，抽屉里只看得见半屏，
 * 底部按钮还会被手势条压住。这里改成整页，进得去、出得来、能单独导出。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import type { Attachment, StudyRecord } from '../core/types';
import { RECORD_FIELDS } from '../reports/templates';
import { NO_FABRICATION_RULE, recordLine } from '../reports/context';
import { resizeImage } from '../core/image';
import { getAgent } from '../agents/definitions';
import { AgentRuntime } from '../agents/runtime';
import { exportRecordDocx, shareRecordDocx } from '../export/record';
import { isNativePlatform } from '../export/save';

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const store = useProjectStore();

const draft = ref<StudyRecord | null>(null);
const generating = ref(false);
const warnings = ref<string[]>([]);
const saving = ref(false);
const exporting = ref(false);
const canShare = isNativePlatform();

const index = computed(() => Number(route.params.index ?? 0));

onMounted(async () => {
  try {
    if (!store.current || store.current.id !== String(route.params.id)) {
      await store.open(String(route.params.id));
    }
    const found = store.records.find((r) => r.index === index.value);
    if (!found) {
      app.toast('找不到这一篇记录', 'error');
      router.replace(`/project/${route.params.id}?tab=records`);
      return;
    }
    draft.value = JSON.parse(JSON.stringify(found));
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '打不开这一篇', 'error', 5000);
    router.replace(`/project/${route.params.id}?tab=records`);
  }
});

const termText = computed(() => (draft.value?.term === 1 ? '上学期' : '下学期'));

/** 参与成员用顿号串输入 */
const participantsText = computed({
  get: () => (draft.value?.participants ?? []).join('、'),
  set: (v: string) => {
    if (!draft.value) return;
    draft.value.participants = v
      .split(/[、,，;；\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  },
});

function back() {
  router.replace(`/project/${route.params.id}?tab=records`);
}

async function save(alsoConfirm = false) {
  if (!draft.value) return;
  if (alsoConfirm && !draft.value.work.trim()) {
    app.toast('「本阶段主要研究工作」为空，不能确认为真实记录', 'warn');
    return;
  }
  saving.value = true;
  try {
    if (draft.value.sourceType === 'simulated' && !draft.value.work.includes('（AI 模拟示例）')) {
      draft.value.work = `（AI 模拟示例）\n${draft.value.work}`;
    }
    if (alsoConfirm) draft.value.confirmed = true;
    await store.saveRecord(draft.value);
    app.toast(alsoConfirm ? '已保存并确认为真实记录' : '已保存', 'ok', 1600);
    if (alsoConfirm) back();
  } finally {
    saving.value = false;
  }
}

/**
 * 让 AI 起草。
 *
 * 上下文按「这一篇能看见什么」给：只给排在它前面、且已经有内容的记录（第 3 篇看第 1-2 篇），
 * 后面还没发生的不能拿来做依据，否则会前后矛盾。
 * 只把正文写回六个格子，思考过程不落进正文。
 */
async function generate() {
  if (!draft.value || !store.current) return;
  generating.value = true;
  warnings.value = [];
  try {
    const agent = getAgent('report-writer')!;
    const runtime = new AgentRuntime(app.gateway);
    const prev = store.records
      .filter((r) => r.index < draft.value!.index && (r.work.trim() || r.summary.trim()))
      .sort((a, b) => a.index - b.index)
      .map((r) => recordLine(r))
      .join('\n');

    const result = await runtime.run(
      'report-writer',
      agent,
      {
        project: store.current,
        records: store.records.filter((r) => r.index <= draft.value!.index),
        activities: [],
        datasets: [],
        sources: store.sources,
      },
      `为「研究记录 第 ${draft.value.index} 篇（${termText.value}）」补全内容。
${prev ? `前面已经写完的记录（只用于承接，不要重复它们的活动）：\n${prev}\n` : '这是第一篇，前面没有记录。'}
用户已经填写的信息（这些是事实，只能用这些）：
- 活动名称：${draft.value.activityName || '（未填）'}
- 时间：${draft.value.startDate || '未填'} 至 ${draft.value.endDate || '未填'}
- 地点：${draft.value.place || '（未填）'}
- 参与成员：${draft.value.participants.join('、') || '（未填）'}
- 阶段名称：${draft.value.stageName || '（未填）'}
- 本阶段主要研究目标：${draft.value.goal || '（空）'}
- 本阶段主要研究工作：${draft.value.work || '（空）'}
- 材料（表格里没有这一栏，仅存档）：${draft.value.materials || '（空）'}
- 阶段性成果：${draft.value.outputs || '（空）'}

这是学校《课题阶段性工作小结记录表》，只有六个格子：「起迄时间 / 本阶段主要研究目标 / 本阶段主要研究工作 / 阶段性成果 / 工作小结 / 下阶段研究工作安排」。
请输出 JSON（不要代码块、不要解释），键必须与格子对应：
{"goal":"","work":"","outputs":"","summary":"","nextPlan":""}

${NO_FABRICATION_RULE}
- 用户没写活动名称与内容时，"work" 只能写「本阶段尚未开展具体研究活动（待补充真实记录）」。
- 不得写具体数字（份数、人数、百分比）与访谈原话，除非用户已提供。
- 语言朴素，中学生的口吻，不要写成公文。`,
    );

    const json = extractJson(result.text);
    if (!json) throw new Error('模型返回格式无法解析，请手动填写或重试');
    for (const f of RECORD_FIELDS) {
      const v = json[f.key];
      if (typeof v === 'string' && v.trim()) (draft.value as any)[f.key] = v.trim();
    }
    warnings.value = result.warnings;
    app.toast('草稿已填入，请逐项核对', 'ok');
  } catch (e) {
    app.toast(e instanceof Error ? e.message : String(e), 'error', 6000);
  } finally {
    generating.value = false;
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return null;
  }
}

async function addAttachments(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!draft.value) return;
  for (const file of files) {
    if (draft.value.attachments.length >= 8) {
      app.toast('一篇记录最多 8 个附件', 'warn');
      break;
    }
    const isImage = file.type.startsWith('image/');
    if (file.size > 12 * 1024 * 1024) {
      app.toast(`${file.name} 超过 12MB，已跳过`, 'warn', 3000);
      continue;
    }
    const item: Attachment = {
      id: `att-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      name: file.name,
      size: file.size,
      kind: isImage ? 'image' : 'file',
    };
    if (isImage) {
      try {
        item.dataUrl = await resizeImage(file, 1200);
      } catch {
        app.toast(`${file.name} 读取失败`, 'warn');
        continue;
      }
    }
    draft.value.attachments.push(item);
  }
  input.value = '';
}

function removeAttachment(id: string) {
  if (!draft.value) return;
  draft.value.attachments = draft.value.attachments.filter((a) => a.id !== id);
}

async function doExport(pick: boolean) {
  if (!draft.value || !store.current) return;
  exporting.value = true;
  try {
    const r = await exportRecordDocx(store.current, draft.value, store.sources, { pick });
    app.toast(r.note, r.how === 'cancelled' ? 'info' : 'ok', 3200);
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '导出失败', 'error', 5000);
  } finally {
    exporting.value = false;
  }
}

async function doShare() {
  if (!draft.value || !store.current) return;
  exporting.value = true;
  try {
    const r = await shareRecordDocx(store.current, draft.value, store.sources);
    app.toast(r.note, 'ok', 3200);
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '分享失败', 'error', 5000);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div class="head">
      <button class="back" type="button" aria-label="返回" @click="back">←</button>
      <div class="grow">
        <div class="eyebrow">第 {{ index }} 篇 · {{ termText }}</div>
        <h1>{{ draft?.stageName || draft?.activityName || '研究记录' }}</h1>
      </div>
      <span class="chip" :class="draft?.confirmed ? 'chip-ok' : draft?.work ? 'chip-accent' : ''">
        {{ draft?.confirmed ? '已确认' : draft?.work ? '已填' : '空' }}
      </span>
    </div>

    <div v-if="!draft" class="loading-page muted small">正在打开…</div>

    <template v-else>
      <div class="pane">
        <div class="board">
          <label class="field">
            <span class="field-label">这次做了什么</span>
            <input v-model="draft.activityName" class="input" placeholder="一句话说明这一篇的活动" />
          </label>

          <label class="field">
            <span class="field-label">阶段名称</span>
            <input v-model="draft.stageName" class="input" placeholder="例如：第一阶段 资料准备" />
          </label>

          <div class="two">
            <label class="field">
              <span class="field-label">起迄时间 · 开始</span>
              <input v-model="draft.startDate" class="input" type="date" />
            </label>
            <label class="field">
              <span class="field-label">起迄时间 · 结束</span>
              <input v-model="draft.endDate" class="input" type="date" />
            </label>
          </div>

          <div class="two">
            <label class="field">
              <span class="field-label">地点</span>
              <input v-model="draft.place" class="input" placeholder="选填" />
            </label>
            <label class="field">
              <span class="field-label">参与成员</span>
              <input v-model="participantsText" class="input" placeholder="用顿号分开：张三、李四" />
            </label>
          </div>

          <label v-for="f in RECORD_FIELDS" :key="f.key" class="field">
            <span class="field-label">{{ f.label }}</span>
            <textarea
              v-model="(draft as any)[f.key]"
              class="textarea"
              :style="{ minHeight: f.key === 'work' || f.key === 'summary' ? '132px' : '84px' }"
              :placeholder="f.hint"
            />
          </label>

          <div v-if="warnings.length" class="banner banner-warn">
            <div v-for="w in warnings" :key="w">{{ w }}</div>
          </div>

          <div class="attach">
            <div class="row-between">
              <b>附件</b>
              <label class="btn btn-sm" style="cursor: pointer">
                加附件
                <input type="file" accept="image/*,.pdf,.docx,.txt" hidden multiple @change="addAttachments" />
              </label>
            </div>
            <ul v-if="draft.attachments.length" class="att-list">
              <li v-for="a in draft.attachments" :key="a.id">
                <span class="grow">{{ a.name }}</span>
                <button class="x" type="button" @click="removeAttachment(a.id)">移除</button>
              </li>
            </ul>
            <p v-else class="muted small">照片、问卷照片可以放这里，导出时不会带出去。</p>
          </div>
        </div>
      </div>

      <div class="foot">
        <button class="btn btn-sm" type="button" :disabled="exporting" @click="doExport(false)">
          {{ exporting ? '导出中…' : '导出 DOCX' }}
        </button>
        <button class="btn btn-sm" type="button" :disabled="exporting" @click="doExport(true)">另存为…</button>
        <button v-if="canShare" class="btn btn-sm" type="button" :disabled="exporting" @click="doShare">分享</button>
        <div class="grow" />
        <button class="btn btn-sm btn-primary" type="button" :disabled="generating" @click="generate">
          {{ generating ? '正在起草…' : 'AI 生成初稿' }}
        </button>
        <button class="btn btn-sm" type="button" :disabled="saving" @click="save(false)">保存</button>
        <button class="btn btn-sm btn-primary" type="button" :disabled="saving" @click="save(true)">保存并确认真实</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page { padding: 0 0 96px; }
.head {
  display: flex; align-items: flex-start; gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5) var(--sp-3);
}
.head .grow { min-width: 0; }
.head h1 { font-size: var(--fs-4); letter-spacing: -0.02em; margin-top: 2px; }
.eyebrow { font-size: var(--fs-1); color: var(--text-3); }
.back {
  width: 36px; height: 36px; flex: 0 0 36px;
  border-radius: 50%; border: none;
  background: var(--surface-2); color: var(--text); cursor: pointer;
}
.back:hover { background: var(--surface-3); }
.loading-page { padding: var(--sp-5); }
.pane { padding: 0 var(--sp-5) var(--sp-6); }
.board {
  display: flex; flex-direction: column; gap: var(--sp-3);
  background: var(--surface); border-radius: var(--r-4); padding: var(--sp-4);
}
.two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: var(--fs-1); color: var(--text-2); }
.attach { border-top: 1px solid var(--line); padding-top: var(--sp-3); }
.att-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.att-list li { display: flex; align-items: center; gap: 8px; font-size: var(--fs-1); }
.x { background: none; border: none; color: var(--danger); cursor: pointer; font-size: var(--fs-1); }
.foot {
  position: sticky; bottom: 0; z-index: 5;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px var(--sp-5) calc(10px + var(--safe-bottom, env(safe-area-inset-bottom, 0px)));
  background: var(--bg);
  border-top: 1px solid var(--line);
}
@media (max-width: 720px) {
  .two { grid-template-columns: 1fr; }
  .head { padding: var(--sp-3) var(--sp-4) var(--sp-2); }
  .pane { padding: 0 var(--sp-4) var(--sp-5); }
  .foot { padding: 10px var(--sp-4) calc(10px + var(--safe-bottom, env(safe-area-inset-bottom, 0px))); }
}
</style>
