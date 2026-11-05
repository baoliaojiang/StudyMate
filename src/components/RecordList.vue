<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import type { Attachment, StudyRecord } from '../core/types';
import { RECORD_FIELDS } from '../reports/templates';
import { NO_FABRICATION_RULE, recordLine } from '../reports/context';
import { resizeImage } from '../core/image';
import { getAgent } from '../agents/definitions';
import { AgentRuntime } from '../agents/runtime';

const app = useAppStore();
const store = useProjectStore();

const editing = ref<StudyRecord | null>(null);
const draft = ref<StudyRecord | null>(null);
const generating = ref(false);
const warnings = ref<string[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

/** 参与成员用逗号分隔输入，落库存数组 */
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

const grouped = computed(() => {
  const first = store.records.filter((r) => r.term === 1);
  const second = store.records.filter((r) => r.term === 2);
  return [
    { term: 1 as const, label: '上学期', items: first },
    { term: 2 as const, label: '下学期', items: second },
  ].filter((g) => g.items.length > 0);
});

function open(rec: StudyRecord) {
  editing.value = rec;
  draft.value = JSON.parse(JSON.stringify(rec));
  warnings.value = [];
}

function close() {
  editing.value = null;
  draft.value = null;
}

function statusOf(r: StudyRecord) {
  if (r.confirmed) return { text: '已确认', cls: 'chip-ok' };
  if (r.work.trim()) return { text: '已填', cls: 'chip-accent' };
  return { text: '空', cls: '' };
}

async function save() {
  if (!draft.value) return;
  if (draft.value.sourceType === 'simulated' && !draft.value.work.includes('（AI 模拟示例）')) {
    draft.value.work = `（AI 模拟示例）\n${draft.value.work}`;
  }
  await store.saveRecord(draft.value);
  app.toast('记录已保存', 'ok', 1500);
  close();
}

async function generate() {
  if (!draft.value || !store.current) return;
  generating.value = true;
  try {
    const agent = getAgent('report-writer')!;
    const runtime = new AgentRuntime(app.gateway);
    const prev = store.records
      .filter((r) => r.index < draft.value!.index && r.work.trim())
      .slice(-3)
      .map((r) => recordLine(r))
      .join('\n');

    const result = await runtime.run(
      'report-writer',
      agent,
      {
        project: store.current,
        records: store.records,
        activities: [],
        datasets: [],
        sources: store.sources,
      },
      `为「研究记录 第 ${draft.value.index} 篇（${draft.value.term === 1 ? '上学期' : '下学期'}）」补全内容。
${prev ? `前面几篇已写的内容：\n${prev}\n` : ''}
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
请输出 JSON（不要代码块），键必须与格子对应：
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

async function confirmRecord() {
  if (!draft.value) return;
  if (!draft.value.work.trim()) {
    app.toast('「本阶段主要研究工作」为空，不能确认为已完成', 'warn');
    return;
  }
  draft.value.confirmed = true;
  await store.saveRecord(draft.value);
  app.toast('已确认为真实记录', 'ok');
  close();
}
</script>

<template>
  <div class="wrap-records">
    <div class="head-row">
      <div>
        <h2 style="font-size: 17px">研究记录</h2>
        <p class="muted small" style="margin: 4px 0 0">
          共 {{ store.records.length }} 篇 · 已填 {{ store.progressStats.filled }} · 已确认 {{ store.progressStats.confirmed }}
        </p>
      </div>
      <div class="bar-wrap">
        <div class="bar"><div class="bar-fill" :style="{ width: store.progressStats.percent + '%' }" /></div>
        <span class="small muted">{{ store.progressStats.percent }}%</span>
      </div>
    </div>

    <section v-for="g in grouped" :key="g.term" class="group">
      <div class="group-head">
        <span class="g-label">{{ g.label }}</span>
        <span class="muted small">{{ g.items.length }} 篇</span>
      </div>
      <div class="cards">
        <article
          v-for="r in g.items"
          :key="r.id"
          class="rec card card-tap"
          @click="open(r)"
        >
          <div class="rec-top">
            <span class="rec-no">{{ String(r.index).padStart(2, '0') }}</span>
            <span class="chip" :class="statusOf(r).cls" style="height: 21px; font-size: 10.5px">{{ statusOf(r).text }}</span>
            <span v-if="r.sourceType === 'simulated'" class="chip chip-sim" style="height: 21px; font-size: 10.5px">模拟</span>
          </div>
          <div class="rec-name">{{ r.activityName || r.stageName || `第 ${r.index} 阶段` }}</div>
          <div class="rec-work">{{ r.work ? r.work.slice(0, 46) + (r.work.length > 46 ? '…' : '') : '还没有内容' }}</div>
          <div class="rec-date">
            {{ r.startDate || '—' }} ~ {{ r.endDate || '—' }}<template v-if="r.attachments.length"> · {{ r.attachments.length }} 个附件</template>
          </div>
        </article>
      </div>
    </section>

    <!-- 编辑抽屉 -->
    <div v-if="editing && draft" class="drawer-scrim" @click.self="close">
      <div class="drawer">
        <div class="drawer-head">
          <div class="grow">
            <div class="muted small">第 {{ draft.index }} 篇 · {{ draft.term === 1 ? '上学期' : '下学期' }}</div>
            <h2 style="font-size: 17px; margin-top: 2px">{{ draft.stageName || `第 ${draft.index} 阶段` }}</h2>
          </div>
          <button class="x" @click="close">×</button>
        </div>

        <div class="drawer-body">
          <div class="field-head">这次做了什么</div>
          <!-- 一、表格里就有的六行，顺序与学校记录表一致 -->
          <div class="field-head">记录表六行</div>
          <div class="grid2">
            <label class="field">
              <span class="field-label">起迄时间 · 开始</span>
              <input v-model="draft.startDate" type="date" class="input" />
            </label>
            <label class="field">
              <span class="field-label">起迄时间 · 结束</span>
              <input v-model="draft.endDate" type="date" class="input" />
            </label>
          </div>

          <label v-for="f in RECORD_FIELDS" :key="f.key" class="field">
            <span class="field-label">{{ f.label }}</span>
            <textarea
              v-model="(draft as any)[f.key]"
              class="textarea"
              :class="{ compact: f.key === 'goal' }"
              :placeholder="f.hint"
            />
          </label>

          <div class="grid2">
            <label class="field">
              <span class="field-label">记录人</span>
              <input v-model="draft.recorder" class="input" :placeholder="store.current?.members[0]?.name || '填姓名'" />
            </label>
            <label class="field">
              <span class="field-label">记录时间</span>
              <input v-model="draft.recordedAt" type="date" class="input" />
            </label>
          </div>

          <!-- 二、表格里没有、只在本软件存档的附加信息 -->
          <div class="field-head">附加信息（记录表里没有这些栏，只在软件内保存）</div>
          <div class="grid2">
            <label class="field">
              <span class="field-label">活动名称</span>
              <input v-model="draft.activityName" class="input" placeholder="如 第一次问卷预调查" />
            </label>
            <label class="field">
              <span class="field-label">阶段名称</span>
              <input v-model="draft.stageName" class="input" placeholder="如 问卷设计与预调查" />
            </label>
            <label class="field">
              <span class="field-label">地点</span>
              <input v-model="draft.place" class="input" placeholder="如 高一（3）班教室" />
            </label>
            <label class="field">
              <span class="field-label">参与成员</span>
              <input v-model="participantsText" class="input" placeholder="用顿号或逗号分隔" />
            </label>
          </div>
          <label class="field">
            <span class="field-label">使用材料</span>
            <textarea v-model="draft.materials" class="textarea compact" placeholder="问卷 30 份、录音笔 1 支…" />
          </label>

          <div class="field-head">附件</div>
          <div class="atts">
            <div v-for="a in draft.attachments" :key="a.id" class="att">
              <img v-if="a.kind === 'image' && a.dataUrl" :src="a.dataUrl" alt="" />
              <span v-else class="att-file">{{ a.name.split('.').pop()?.toUpperCase() || '文件' }}</span>
              <span class="att-name">{{ a.name }}</span>
              <button class="att-x" type="button" aria-label="移除" @click="removeAttachment(a.id)">×</button>
            </div>
            <button class="att-add" type="button" @click="fileInput?.click()">+ 添加附件</button>
            <input ref="fileInput" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" hidden @change="addAttachments" />
          </div>

          <div class="row wrap" style="margin-bottom: 10px">
            <label class="field" style="margin: 0">
              <span class="field-label">来源类型</span>
              <select v-model="draft.sourceType" class="select" style="width: 160px">
                <option value="real">真实记录</option>
                <option value="provided">用户提供</option>
                <option value="simulated">AI 模拟示例</option>
              </select>
            </label>
            <div class="grow" />
            <button class="btn btn-sm" :disabled="generating" @click="generate">
              {{ generating ? '生成中…' : 'AI 起草本篇' }}
            </button>
          </div>

          <div v-for="w in warnings" :key="w" class="banner banner-warn" style="font-size: 12px; margin-bottom: 8px">
            {{ w }}
          </div>
          <div v-if="draft.sourceType === 'simulated'" class="banner banner-sim" style="font-size: 12px">
            已选「AI 模拟示例」。保存与导出时会自动加标识，不会被当成真实数据。
          </div>
        </div>

        <div class="drawer-foot">
          <button class="btn btn-sm" @click="close">取消</button>
          <div class="grow" />
          <button class="btn btn-sm" @click="confirmRecord">确认真实</button>
          <button class="btn btn-sm btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap-records { padding: 18px 20px 40px; }
.head-row { display: flex; align-items: flex-start; gap: 16px; justify-content: space-between; margin-bottom: 18px; }
.bar-wrap { display: flex; align-items: center; gap: 8px; min-width: 160px; }
.bar { flex: 1; height: 5px; background: var(--surface-3); border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; background: var(--grad); transition: width 320ms var(--ease); }

.group { margin-bottom: 22px; }
.group-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.g-label { font-size: 13px; font-weight: 640; color: var(--text-2); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.rec { padding: 13px 14px; }
.rec-top { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.rec-no { font-size: 11px; font-weight: var(--fw-strong); color: var(--text-3); letter-spacing: 0.06em; }
.rec-name { font-size: 13.5px; font-weight: var(--fw-strong); margin-bottom: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rec-work {
  font-size: 11.5px; color: var(--text-3); line-height: 1.55; height: 36px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.rec-date { font-size: 10.5px; color: var(--text-3); margin-top: 8px; opacity: 0.8; }

.drawer-scrim {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 60;
  display: flex; justify-content: flex-end; padding: 8px;
}
.drawer {
  width: min(680px, 100%); background: var(--bg); height: 100%;
  display: flex; flex-direction: column; border: 1px solid var(--line);
  border-radius: var(--r-4);
  box-shadow: var(--shadow-3);
  animation: slide 220ms var(--ease);
}
@keyframes slide { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
.drawer-head {
  display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px;
  border-bottom: 1px solid var(--line);
}
.x { background: none; border: none; color: var(--text-3); font-size: 22px; cursor: pointer; line-height: 1; }
.drawer-body { flex: 1; overflow-y: auto; padding: 16px 18px; }
.drawer-foot {
  display: flex; gap: 8px; align-items: center; padding: 12px 18px;
  border-top: 1px solid var(--line); background: var(--surface);
}
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.field-head {
  margin: 18px 0 10px; padding-bottom: 6px;
  font-size: 12px; font-weight: var(--fw-medium); color: var(--text-3);
  border-bottom: 1px solid var(--line);
}
.field-head:first-child { margin-top: 0; }
.textarea.compact { min-height: 64px; }
.atts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.att {
  position: relative; display: flex; align-items: center; gap: 8px;
  padding: 6px 26px 6px 6px; max-width: 220px;
  border: 1px solid var(--line); border-radius: var(--r-1); background: var(--surface-2);
}
.att img { width: 34px; height: 34px; object-fit: cover; border-radius: 6px; display: block; }
.att-file {
  width: 34px; height: 34px; display: grid; place-items: center;
  border-radius: 6px; background: var(--surface-3); font-size: 9.5px; color: var(--text-3);
}
.att-name { font-size: 11.5px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.att-x {
  position: absolute; top: 2px; right: 3px; width: 18px; height: 18px;
  border: none; background: transparent; color: var(--text-3); cursor: pointer; font-size: 14px; line-height: 1;
}
.att-add {
  height: 48px; padding: 0 14px;
  border: 1px dashed var(--line-strong); border-radius: var(--r-1);
  background: transparent; color: var(--text-3); font: inherit; font-size: 12px; cursor: pointer;
}
.att-add:hover { border-color: var(--primary); color: var(--primary); }

@media (max-width: 600px) {
  .wrap-records { padding: 12px 14px 60px; }
  .cards { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .head-row { flex-direction: column; gap: 10px; }
  .bar-wrap { width: 100%; }
  .grid2 { grid-template-columns: 1fr; }
  .drawer { width: 100%; }
}
</style>
