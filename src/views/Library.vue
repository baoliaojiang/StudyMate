<script setup lang="ts">
/** 资料库：跨项目的来源与数据集，按来源类型标注，未核实的明确标「待核实」 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { db } from '../core/db';
import { SOURCE_TYPE_LABEL, type Dataset, type Project, type Source } from '../core/types';

const router = useRouter();

const projects = ref<Project[]>([]);
const sources = ref<Source[]>([]);
const datasets = ref<Dataset[]>([]);
const tab = ref<'sources' | 'datasets'>('sources');
const kw = ref('');
const loading = ref(true);

onMounted(async () => {
  try {
    projects.value = await db.projects.toArray();
    sources.value = await db.sources.toArray();
    datasets.value = await db.datasets.toArray();
  } finally {
    loading.value = false;
  }
});

const nameOf = (id: string) => projects.value.find((p) => p.id === id)?.topic || '未命名课题';

const filteredSources = computed(() => {
  const q = kw.value.trim().toLowerCase();
  return sources.value.filter(
    (s) => !q || s.title.toLowerCase().includes(q) || s.authors.toLowerCase().includes(q),
  );
});

const filteredDatasets = computed(() => {
  const q = kw.value.trim().toLowerCase();
  return datasets.value.filter((d) => !q || d.title.toLowerCase().includes(q));
});

const verifiedCount = computed(() => sources.value.filter((s) => s.verifyStatus === 'verified').length);

function openProject(id: string, tabName: 'sources' | 'records') {
  router.push(`/project/${id}?tab=${tabName}`);
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1>资料库</h1>
      <p>所有项目的来源与数据集都在这里。未核实的内容不会因为写进报告就变成真的。</p>
    </header>

    <div class="stats">
      <div><b>{{ sources.length }}</b><span>条来源</span></div>
      <div><b>{{ verifiedCount }}</b><span>已核实</span></div>
      <div><b>{{ datasets.length }}</b><span>个数据集</span></div>
      <div><b>{{ projects.length }}</b><span>个项目</span></div>
    </div>

    <div class="bar">
      <div class="seg">
        <button class="seg-btn" :class="{ on: tab === 'sources' }" type="button" @click="tab = 'sources'">来源</button>
        <button class="seg-btn" :class="{ on: tab === 'datasets' }" type="button" @click="tab = 'datasets'">数据集</button>
      </div>
      <input v-model="kw" class="input search" placeholder="搜索标题或作者" />
    </div>

    <div v-if="loading" class="skeleton" style="height: 140px" />

    <template v-else-if="tab === 'sources'">
      <div v-if="!filteredSources.length" class="empty card">
        还没有来源。在项目详情的「来源」页添加文献、网页或自采材料。
      </div>
      <div v-else class="list">
        <article v-for="(s, i) in filteredSources" :key="s.id" class="item card rise" :style="{ '--i': i }">
          <div class="item-head">
            <h2>{{ s.title || '无标题来源' }}</h2>
            <span class="chip" :class="s.verifyStatus === 'verified' ? 'chip-ok' : 'chip-warn'">
              {{ s.verifyStatus === 'verified' ? '已核实' : '待核实' }}
            </span>
          </div>
          <p class="meta">
            <span>{{ s.authors || '作者未填' }}</span>
            <span>{{ s.date || '日期未填' }}</span>
            <span class="src-type">{{ SOURCE_TYPE_LABEL[s.sourceType] }}</span>
          </p>
          <div class="item-foot">
            <button class="link" type="button" @click="openProject(s.projectId, 'sources')">{{ nameOf(s.projectId) }}</button>
            <a v-if="s.url" class="link" :href="s.url" target="_blank" rel="noreferrer noopener">打开链接 ↗</a>
          </div>
        </article>
      </div>
    </template>

    <template v-else>
      <div v-if="!filteredDatasets.length" class="empty card">
        还没有数据集。研究记录里整理出的问卷、计数、测量结果可以在这里汇总。
      </div>
      <div v-else class="list">
        <article v-for="(d, i) in filteredDatasets" :key="d.id" class="item card rise" :style="{ '--i': i }">
          <div class="item-head">
            <h2>{{ d.title }}</h2>
            <span class="chip">{{ SOURCE_TYPE_LABEL[d.sourceType] }}</span>
          </div>
          <p class="meta">
            <span>{{ d.points.length }} 个数据点</span>
            <span v-if="d.unit">单位：{{ d.unit }}</span>
            <span>{{ d.sourceNote || '来源说明未填' }}</span>
          </p>
          <div class="item-foot">
            <button class="link" type="button" @click="openProject(d.projectId, 'records')">{{ nameOf(d.projectId) }}</button>
          </div>
        </article>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page { max-width: 820px; margin: 0 auto; padding: 20px 20px 72px; }
.head h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
.head p { margin: 6px 0 18px; font-size: 12.5px; color: var(--text-3); line-height: 1.7; }

.stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
  padding: 14px; margin-bottom: 16px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-3);
}
.stats div { display: flex; flex-direction: column; gap: 3px; }
.stats b { font-size: 18px; font-variant-numeric: tabular-nums; }
.stats span { font-size: 11px; color: var(--text-3); }

.bar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
.seg { display: flex; gap: 2px; padding: 3px; background: var(--surface-2); border-radius: var(--r-full); }
.seg-btn {
  height: 30px; padding: 0 14px; border: none; background: transparent;
  border-radius: var(--r-full); color: var(--text-3); font-size: 12.5px; cursor: pointer;
  transition: background var(--dur-2), color var(--dur-2);
}
.seg-btn.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-1); }
.search { flex: 1; }

.list { display: flex; flex-direction: column; gap: 10px; }
.item { padding: 14px 16px; }
.item-head { display: flex; align-items: flex-start; gap: 10px; }
.item-head h2 { flex: 1; margin: 0; font-size: 14px; font-weight: var(--fw-strong); line-height: 1.5; }
.meta { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0 0; font-size: 11.5px; color: var(--text-3); }
.item-foot { display: flex; gap: 14px; margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--line); }
.link {
  border: none; background: transparent; padding: 0;
  font: inherit; font-size: 11.5px; color: var(--primary); cursor: pointer; text-decoration: none;
}
.empty { padding: 30px 20px; text-align: center; font-size: 12.5px; color: var(--text-3); line-height: 1.7; }

@media (max-width: 860px) {
  .page { padding: 12px 16px 60px; }
  .stats { grid-template-columns: repeat(2, 1fr); }
  .bar { flex-direction: column; align-items: stretch; }
}
</style>
