<script setup lang="ts">
/** 研究记录总览：跨项目看填写进度，点进去直接落到记录页 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { db } from '../core/db';
import { useAppStore } from '../stores/app';
import type { Project, StudyRecord } from '../core/types';

const router = useRouter();
const app = useAppStore();

const projects = ref<Project[]>([]);
const records = ref<StudyRecord[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    projects.value = await db.projects.orderBy('updatedAt').reverse().toArray();
    records.value = await db.records.toArray();
  } finally {
    loading.value = false;
  }
});

interface Group {
  project: Project;
  list: StudyRecord[];
  filled: number;
  total: number;
  confirmed: number;
  latest?: StudyRecord;
}

const groups = computed<Group[]>(() =>
  projects.value.map((project) => {
    const list = records.value
      .filter((r) => r.projectId === project.id)
      .sort((a, b) => a.index - b.index);
    const filled = list.filter((r) => r.work.trim() || r.activityName.trim()).length;
    const confirmed = list.filter((r) => r.confirmed).length;
    return {
      project,
      list,
      filled,
      confirmed,
      total: project.recordPlan.total || list.length,
      latest: [...list].reverse().find((r) => r.activityName || r.work),
    };
  }),
);

const overall = computed(() => {
  const filled = groups.value.reduce((s, g) => s + g.filled, 0);
  const total = groups.value.reduce((s, g) => s + g.total, 0);
  return { filled, total, percent: total ? Math.round((filled / total) * 100) : 0 };
});

function open(g: Group) {
  router.push(`/project/${g.project.id}?tab=records`);
}

function openLibrary() {
  router.push('/library');
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1>过程记录</h1>
        <p>按项目汇总。真正的研究从一条条活动记录开始，报告只是它们的汇总。</p>
      </div>
      <button class="btn btn-sm" type="button" @click="openLibrary">资料库</button>
    </header>

    <div class="summary">
      <div class="sum-num">
        <b>{{ overall.filled }}</b><span>/ {{ overall.total }} 篇已填写</span>
      </div>
      <div class="sum-bar"><i :style="{ width: overall.percent + '%' }" /></div>
      <div class="sum-pct">{{ overall.percent }}%</div>
    </div>

    <div v-if="loading" class="skeleton" style="height: 120px" />

    <div v-else-if="!groups.length" class="empty card">
      <p>还没有项目。</p>
      <button class="btn btn-sm btn-primary" type="button" @click="router.push('/new')">新建第一个项目</button>
    </div>

    <div v-else class="groups">
      <article
        v-for="(g, i) in groups"
        :key="g.project.id"
        class="g card rise"
        :style="{ '--i': i }"
        @click="open(g)"
      >
        <div class="g-head">
          <h2>{{ g.project.topic || '未命名课题' }}</h2>
          <span class="chip" :class="g.filled === g.total ? 'chip-ok' : ''">
            {{ g.filled }}/{{ g.total }}
          </span>
        </div>

        <div class="dots">
          <span
            v-for="n in g.total"
            :key="n"
            class="dot"
            :class="{
              filled: (g.list[n - 1]?.work.trim() || g.list[n - 1]?.activityName.trim()),
              ok: g.list[n - 1]?.confirmed,
            }"
            :title="g.list[n - 1]?.activityName || `第 ${n} 篇`"
          />
        </div>

        <p v-if="g.latest" class="latest">
          <b>最近：</b>{{ g.latest.activityName || g.latest.stageName || `第 ${g.latest.index} 篇` }}
          <span class="date">{{ g.latest.startDate }}</span>
        </p>
        <p v-else class="latest muted">还没有填写过记录。</p>

        <div class="g-foot">
          <span class="muted small">已确认 {{ g.confirmed }} 篇</span>
          <span class="go">继续填写 →</span>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.page { max-width: 820px; margin: 0 auto; padding: 20px 20px 72px; }
.head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 18px; }
.head h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
.head p { margin: 6px 0 0; font-size: 12.5px; color: var(--text-3); line-height: 1.7; }
.head > div { flex: 1; }

.summary {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; margin-bottom: 18px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-3);
}
.sum-num b { font-size: 20px; font-variant-numeric: tabular-nums; }
.sum-num span { font-size: 11.5px; color: var(--text-3); margin-left: 4px; }
.sum-bar { flex: 1; height: 4px; border-radius: var(--r-full); background: var(--surface-3); overflow: hidden; }
.sum-bar i { display: block; height: 100%; background: var(--primary); transition: width var(--dur-4) var(--ease-out); }
.sum-pct { font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; min-width: 34px; text-align: right; }

.groups { display: flex; flex-direction: column; gap: 10px; }
.g { padding: 16px; cursor: pointer; transition: border-color var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out); }
.g:hover { border-color: var(--line-strong); }
.g:active { transform: scale(0.997); }
.g-head { display: flex; align-items: center; gap: 10px; }
.g-head h2 { flex: 1; margin: 0; font-size: 15px; font-weight: var(--fw-strong); }
.dots { display: flex; flex-wrap: wrap; gap: 4px; margin: 12px 0; }
.dot {
  width: 14px; height: 6px; border-radius: var(--r-full);
  background: var(--surface-3);
  transition: background var(--dur-2) var(--ease-out);
}
.dot.filled { background: var(--primary-soft, rgba(31, 79, 216, 0.35)); }
.dot.ok { background: var(--primary); }
.latest { margin: 0; font-size: 12.5px; color: var(--text-2); }
.latest b { font-weight: var(--fw-strong); color: var(--text-3); }
.latest .date { margin-left: 8px; font-size: 11px; color: var(--text-3); }
.latest.muted { color: var(--text-3); }
.g-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); }
.go { font-size: 12px; color: var(--primary); }

.empty { padding: 28px; display: flex; flex-direction: column; align-items: center; gap: 12px; }

@media (max-width: 860px) {
  .page { padding: 12px 16px 60px; }
  .head h1 { font-size: 24px; }
}
</style>
