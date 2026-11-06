<script setup lang="ts">
/**
 * 研究记录（列表）
 *
 * 主路径：一张卡一篇。点卡片进独立页面写、确认、导出；
 * 空卡片上直接给「没灵感？让 AI 生成初稿」，不用先进页面。
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import type { StudyRecord } from '../core/types';
import { NO_FABRICATION_RULE, recordLine } from '../reports/context';
import { getAgent } from '../agents/definitions';
import { AgentRuntime } from '../agents/runtime';
import { exportRecordDocx, shareRecordDocx } from '../export/record';
import { isNativePlatform } from '../export/save';

const app = useAppStore();
const store = useProjectStore();
const router = useRouter();

const busyIndex = ref<number | null>(null);
/** 系统分享只有安卓原生壳有，网页版不显示这个按钮 */
const canShare = isNativePlatform();

const grouped = computed(() => {
  const first = store.records.filter((r) => r.term === 1);
  const second = store.records.filter((r) => r.term === 2);
  return [
    { term: 1 as const, label: '上学期', items: first },
    { term: 2 as const, label: '下学期', items: second },
  ].filter((g) => g.items.length > 0);
});

function statusOf(r: StudyRecord) {
  if (r.confirmed) return { text: '已确认', cls: 'chip-ok' };
  if (r.work.trim()) return { text: '已填', cls: 'chip-accent' };
  return { text: '空', cls: '' };
}

function isBlank(r: StudyRecord) {
  return !r.activityName.trim() && !r.work.trim() && !r.goal.trim() && !r.summary.trim();
}

function openRecord(r: StudyRecord) {
  if (!store.current) return;
  router.push(`/project/${store.current.id}/records/${r.index}`);
}

/**
 * 空卡片上的一键起草：只给这一篇，上下文取排在它前面、已有内容的记录。
 * 生成完直接落库（未确认），用户再进页面改。
 */
async function draftOne(r: StudyRecord) {
  if (!store.current || busyIndex.value !== null) return;
  busyIndex.value = r.index;
  try {
    const agent = getAgent('report-writer')!;
    const runtime = new AgentRuntime(app.gateway);
    const prev = store.records
      .filter((x) => x.index < r.index && (x.work.trim() || x.summary.trim()))
      .sort((a, b) => a.index - b.index)
      .map((x) => recordLine(x))
      .join('\n');

    const result = await runtime.run(
      'report-writer',
      agent,
      {
        project: store.current,
        records: store.records.filter((x) => x.index <= r.index),
        activities: [],
        datasets: [],
        sources: store.sources,
      },
      `为「研究记录 第 ${r.index} 篇（${r.term === 1 ? '上学期' : '下学期'}）」补全内容。
${prev ? `前面已经写完的记录（只用于承接，不要重复）：\n${prev}\n` : '这是第一篇，前面没有记录。'}
用户已经填写的信息（这些是事实，只能用这些）：
- 活动名称：${r.activityName || '（未填）'}
- 时间：${r.startDate || '未填'} 至 ${r.endDate || '未填'}
- 阶段名称：${r.stageName || '（未填）'}
- 参与成员：${r.participants.join('、') || '（未填）'}

这是学校《课题阶段性工作小结记录表》，请只输出 JSON（不要代码块）：
{"activityName":"","stageName":"","goal":"","work":"","outputs":"","summary":"","nextPlan":""}

${NO_FABRICATION_RULE}
- 不得写具体数字（份数、人数、百分比）与访谈原话；拿不准的成果写「待补充」。
- 语言朴素，中学生口吻。`,
    );

    const json = extractJson(result.text);
    if (!json) throw new Error('模型返回格式无法解析，重试或自己填');
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const next: StudyRecord = { ...r, updatedAt: Date.now() };
    for (const k of ['activityName', 'stageName', 'goal', 'work', 'outputs', 'summary', 'nextPlan'] as const) {
      const v = str(json[k]);
      if (v) (next as unknown as Record<string, unknown>)[k] = v;
    }
    if (!next.activityName) next.activityName = next.work.slice(0, 18) || `第 ${r.index} 阶段`;
    await store.saveRecord(next);
    app.toast('初稿已生成，点开逐项核对', 'ok', 2600);
  } catch (e) {
    app.toast(e instanceof Error ? e.message : String(e), 'error', 6000);
  } finally {
    busyIndex.value = null;
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

async function exportOne(r: StudyRecord, pick: boolean) {
  if (!store.current) return;
  busyIndex.value = r.index;
  try {
    const res = await exportRecordDocx(store.current, r, store.sources, { pick });
    app.toast(res.note, res.how === 'cancelled' ? 'info' : 'ok', 3200);
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '导出失败', 'error', 5000);
  } finally {
    busyIndex.value = null;
  }
}

async function shareOne(r: StudyRecord) {
  if (!store.current) return;
  busyIndex.value = r.index;
  try {
    const res = await shareRecordDocx(store.current, r, store.sources);
    app.toast(res.note, 'ok', 3200);
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '分享失败', 'error', 5000);
  } finally {
    busyIndex.value = null;
  }
}
</script>

<template>
  <div class="wrap-records">
    <div class="head-row">
      <div>
        <h2 style="font-size: var(--fs-3)">研究记录</h2>
        <p class="muted small" style="margin: 4px 0 0">
          共 {{ store.records.length }} 篇 · 已填 {{ store.progressStats.filled }} · 已确认 {{ store.progressStats.confirmed }}
        </p>
      </div>
      <div class="bar-wrap">
        <div class="bar"><div class="bar-fill" :style="{ width: store.progressStats.percent + '%' }" /></div>
        <span class="small muted">{{ store.progressStats.percent }}%</span>
      </div>
    </div>

    <p class="muted small tip">
      点一张卡进去写：改完点「保存」，核对过真实细节再点「保存并确认真实」。每篇都能单独导出 DOCX。
    </p>

    <section v-for="g in grouped" :key="g.term" class="group">
      <div class="group-head">
        <span class="g-label">{{ g.label }}</span>
        <span class="muted small">{{ g.items.length }} 篇</span>
      </div>
      <div class="cards">
        <article v-for="r in g.items" :key="r.id" class="rec card" :class="{ confirmed: r.confirmed }">
          <button class="rec-main" type="button" @click="openRecord(r)">
            <div class="rec-top">
              <span class="idx">{{ String(r.index).padStart(2, '0') }}</span>
              <span class="chip" :class="statusOf(r).cls">{{ statusOf(r).text }}</span>
            </div>
            <b class="rec-title">{{ r.activityName || r.stageName || `第 ${r.index} 阶段` }}</b>
            <p class="rec-desc">
              {{ (r.work || r.goal || '还没有内容').slice(0, 80) }}
            </p>
            <span class="rec-date">{{ r.startDate || '—' }} ~ {{ r.endDate || '—' }}</span>
          </button>

          <div class="rec-acts">
            <button
              v-if="isBlank(r)"
              class="btn btn-sm btn-primary"
              type="button"
              :disabled="busyIndex === r.index"
              @click="draftOne(r)"
            >
              {{ busyIndex === r.index ? '起草中…' : '没灵感？让 AI 生成初稿' }}
            </button>
            <template v-else>
              <button class="btn btn-sm" type="button" :disabled="busyIndex === r.index" @click="exportOne(r, false)">
                导出 DOCX
              </button>
              <button class="btn btn-sm" type="button" :disabled="busyIndex === r.index" @click="exportOne(r, true)">
                另存为
              </button>
              <button
                v-if="canShare"
                class="btn btn-sm"
                type="button"
                :disabled="busyIndex === r.index"
                @click="shareOne(r)"
              >
                分享
              </button>
            </template>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wrap-records { padding: 0 0 var(--sp-6); }
.head-row { display: flex; align-items: flex-start; gap: var(--sp-4); }
.head-row .bar-wrap { display: flex; align-items: center; gap: 8px; min-width: 140px; }
.bar { flex: 1; height: 6px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.bar-fill { height: 100%; background: var(--primary); border-radius: 999px; transition: width var(--dur-3) var(--ease-out); }
.tip { margin: 10px 0 14px; line-height: 1.7; }
.group { margin-bottom: var(--sp-5); }
.group-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
.g-label { font-size: var(--fs-2); font-weight: var(--fw-strong); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--sp-3); }
.rec { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
.rec.confirmed { background: var(--surface-2); }
.rec-main {
  display: flex; flex-direction: column; gap: 6px;
  padding: var(--sp-3) var(--sp-4) 10px;
  text-align: left; background: none; border: none; cursor: pointer; width: 100%;
}
.rec-main:hover { background: var(--surface-2); }
.rec-top { display: flex; align-items: center; justify-content: space-between; }
.idx { font-size: var(--fs-1); color: var(--text-3); font-variant-numeric: tabular-nums; }
.rec-title { font-size: var(--fs-2); font-weight: var(--fw-strong); line-height: 1.5; }
.rec-desc {
  margin: 0; font-size: var(--fs-1); color: var(--text-2); line-height: 1.65;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.rec-date { font-size: var(--fs-1); color: var(--text-3); font-variant-numeric: tabular-nums; }
.rec-acts {
  display: flex; gap: 6px; flex-wrap: wrap;
  padding: 8px var(--sp-4) 10px;
  border-top: 1px solid var(--line);
}
@media (max-width: 640px) {
  .cards { grid-template-columns: 1fr; }
  .head-row { flex-direction: column; }
  .head-row .bar-wrap { width: 100%; }
}
</style>
