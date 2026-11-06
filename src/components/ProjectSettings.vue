<script setup lang="ts">
/**
 * 项目设置：改基本信息、调整记录篇数、切换研究方式、删除项目。
 * 这里不碰报告内容——已确认的报告不会被这个表单改写。
 */
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import type { ResearchMode } from '../core/types';
import { askConfirm } from '../core/task-guard';

const app = useAppStore();
const store = useProjectStore();
const router = useRouter();

const p = computed(() => store.current);

const form = reactive({
  topic: '',
  teacher: '',
  school: '',
  grade: '',
  className: '',
  groupName: '',
  startDate: '',
  endDate: '',
  requirementText: '',
  mainCourse: '',
  relatedCourse: '',
  modes: [] as ResearchMode[],
  aiMode: 'assist' as 'assist' | 'lead',
  recordTotal: 15,
  firstTerm: 8,
});

const dirty = ref(false);
const busy = ref(false);

function sync() {
  const cur = p.value;
  if (!cur) return;
  form.topic = cur.topic;
  form.teacher = cur.teacher;
  form.school = cur.school;
  form.grade = cur.grade;
  form.className = cur.className;
  form.groupName = cur.groupName;
  form.startDate = cur.startDate;
  form.endDate = cur.endDate;
  form.requirementText = cur.requirementText;
  form.mainCourse = cur.mainCourse ?? '';
  form.relatedCourse = cur.relatedCourse ?? '';
  form.modes = cur.modes.slice();
  form.aiMode = cur.aiMode;
  form.recordTotal = cur.recordPlan.total;
  form.firstTerm = cur.recordPlan.firstTerm;
  dirty.value = false;
}

watch(p, sync, { immediate: true });

const secondTerm = computed(() => Math.max(0, form.recordTotal - form.firstTerm));

const modes: { key: ResearchMode; label: string }[] = [
  { key: 'theory', label: '纯理论研究' },
  { key: 'practice', label: '实践研究' },
  { key: 'simulated', label: 'AI 模拟实践' },
];

function toggleMode(k: ResearchMode) {
  if (form.modes.includes(k)) form.modes = form.modes.filter((m) => m !== k);
  else form.modes.push(k);
  dirty.value = true;
}

async function save() {
  if (!p.value) return;
  if (!form.topic.trim() || !form.teacher.trim()) {
    app.toast('研究主题和指导教师姓名不能空', 'warn');
    return;
  }
  if (!form.modes.length) {
    app.toast('至少保留一种研究方式', 'warn');
    return;
  }
  busy.value = true;
  try {
    await store.updateProject({
      topic: form.topic.trim(),
      teacher: form.teacher.trim(),
      school: form.school.trim(),
      grade: form.grade.trim(),
      className: form.className.trim(),
      groupName: form.groupName.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      requirementText: form.requirementText,
      mainCourse: form.mainCourse.trim(),
      relatedCourse: form.relatedCourse.trim(),
      modes: form.modes,
      aiMode: form.aiMode,
    });
    const planChanged =
      form.recordTotal !== p.value.recordPlan.total || form.firstTerm !== p.value.recordPlan.firstTerm;
    if (planChanged) {
      const filled = store.records.filter((r) => r.goal.trim() || r.work.trim()).length;
      if (form.recordTotal < store.records.length) {
        const ok = await askConfirm({
          title: '减少记录篇数',
          message: `篇数会从 ${store.records.length} 减到 ${form.recordTotal}，超出的记录会被删除（含已填的 ${filled} 篇中的一部分）。继续？`,
          confirmText: '仍然继续',
          tone: 'warn',
        });
        if (!ok) {
          busy.value = false;
          return;
        }
      }
      await store.applyRecordPlan({
        total: form.recordTotal,
        firstTerm: form.firstTerm,
        secondTerm: secondTerm.value,
      });
    }
    dirty.value = false;
    app.toast('已保存', 'ok', 1800);
  } finally {
    busy.value = false;
  }
}

const deleting = ref(false);

async function removeProject() {
  if (!p.value) return;
  const name = p.value.topic || '未命名课题';
  if (!deleting.value) {
    deleting.value = true;
    app.toast('再点一次「确认删除」才会真的删除', 'warn', 4000);
    setTimeout(() => (deleting.value = false), 5000);
    return;
  }
  await store.deleteProject(p.value.id);
  app.toast('项目已删除', 'ok');
  router.replace('/');
}
</script>

<template>
  <section v-if="p" class="pane">
    <div class="panel-head">
      <div>
        <h2 class="panel-title">项目设置</h2>
        <p class="muted small">改这里不会动已写的正文，但报告里的成员、时间需要你回头自行同步。</p>
      </div>
      <button class="btn btn-sm btn-primary" :disabled="!dirty || busy" @click="save">
        {{ busy ? '保存中…' : dirty ? '保存修改' : '已保存' }}
      </button>
    </div>

    <div class="card card-pad">
      <div class="block-title">基本信息</div>
      <label class="field">
        <span class="field-label">研究主题 <span class="req">*</span></span>
        <input v-model="form.topic" class="input" @input="dirty = true" />
      </label>
      <div class="grid2">
        <label class="field">
          <span class="field-label">指导教师姓名 <span class="req">*</span></span>
          <input v-model="form.teacher" class="input" @input="dirty = true" />
        </label>
        <label class="field">
          <span class="field-label">小组名称</span>
          <input v-model="form.groupName" class="input" @input="dirty = true" />
        </label>
        <label class="field">
          <span class="field-label">学校</span>
          <input v-model="form.school" class="input" @input="dirty = true" />
        </label>
        <label class="field">
          <span class="field-label">年级</span>
          <input v-model="form.grade" class="input" @input="dirty = true" />
        </label>
        <label class="field">
          <span class="field-label">班级</span>
          <input v-model="form.className" class="input" @input="dirty = true" />
        </label>
        <label class="field">
          <span class="field-label">开始时间</span>
          <input v-model="form.startDate" type="date" class="input" @input="dirty = true" />
        </label>
        <label class="field">
          <span class="field-label">结束时间</span>
          <input v-model="form.endDate" type="date" class="input" @input="dirty = true" />
        </label>
        <label class="field">
          <span class="field-label">主导课程</span>
          <input v-model="form.mainCourse" class="input" placeholder="开题表「主导课程」栏，如 化学" @input="dirty = true" />
        </label>
        <label class="field">
          <span class="field-label">相关课程</span>
          <input v-model="form.relatedCourse" class="input" placeholder="如 生物、数学" @input="dirty = true" />
        </label>
      </div>
    </div>

    <div class="card card-pad">
      <div class="block-title">教师要求原文</div>
      <textarea v-model="form.requirementText" class="textarea" style="min-height: 120px" @input="dirty = true" />
    </div>

    <div class="card card-pad">
      <div class="block-title">研究方式与 AI 模式</div>
      <div class="mode-row">
        <button
          v-for="m in modes"
          :key="m.key"
          class="mode-chip"
          :class="{ on: form.modes.includes(m.key) }"
          @click="toggleMode(m.key)"
        >
          {{ m.label }}
        </button>
      </div>
      <div class="seg" style="margin-top: 14px">
        <button class="seg-item" :class="{ on: form.aiMode === 'assist' }" @click="form.aiMode = 'assist'; dirty = true">
          AI 辅助
        </button>
        <button class="seg-item" :class="{ on: form.aiMode === 'lead' }" @click="form.aiMode = 'lead'; dirty = true">
          AI 主导辅助
        </button>
      </div>
    </div>

    <div class="card card-pad">
      <div class="block-title">研究记录篇数</div>
      <div class="row wrap">
        <label class="inline-field">
          <span>总篇数</span>
          <input v-model.number="form.recordTotal" type="number" min="1" max="60" class="input" style="width: 88px" @input="dirty = true" />
        </label>
        <label class="inline-field">
          <span>上学期</span>
          <input v-model.number="form.firstTerm" type="number" min="0" :max="form.recordTotal" class="input" style="width: 88px" @input="dirty = true" />
        </label>
        <div class="inline-field"><span>下学期</span><b>{{ secondTerm }}</b></div>
      </div>
      <p class="muted small" style="margin: 10px 0 0">
        现在有 {{ store.records.length }} 篇。改多会补空白记录，改少会删掉多出来的。
      </p>
    </div>

    <div class="card card-pad danger-zone">
      <div class="block-title">删除项目</div>
      <p class="muted small" style="margin: 0 0 12px">
        这个项目下的 {{ store.reports.length }} 份报告、{{ store.records.length }} 篇记录、{{ store.sources.length }} 条来源都会一起删除，无法恢复。
      </p>
      <button class="btn btn-sm btn-danger" @click="removeProject">
        {{ deleting ? '确认删除（不可撤销）' : '删除这个项目' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.panel-head { display: flex; align-items: flex-start; gap: var(--sp-4); margin-bottom: var(--sp-4); }
.panel-title { font-size: var(--fs-4); letter-spacing: -0.02em; }
.block-title { font-size: var(--fs-1); font-weight: var(--fw-strong); color: var(--text-3); margin-bottom: var(--sp-3); letter-spacing: 0.02em; }
.card + .card { margin-top: var(--sp-3); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--sp-4); }
.mode-row { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
.mode-chip {
  height: 36px; padding: 0 var(--sp-4);
  border-radius: var(--r-full);
  border: 1px solid var(--line);
  background: var(--surface); color: var(--text-2);
  font-size: var(--fs-2); cursor: pointer;
  transition: all var(--dur-2) var(--ease-out);
}
.mode-chip.on { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); font-weight: var(--fw-strong); }
.seg { display: flex; gap: 5px; padding: 4px; background: var(--surface-2); border-radius: var(--r-full); }
.seg-item {
  flex: 1; height: 36px; border: none; background: transparent; border-radius: var(--r-full);
  color: var(--text-2); font-size: var(--fs-2); cursor: pointer;
}
.seg-item.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-1); font-weight: var(--fw-strong); }
.inline-field { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-2); color: var(--text-2); }
.danger-zone { border-color: color-mix(in srgb, var(--danger) 28%, var(--line)); }
.btn-danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 34%, var(--line)); background: transparent; }
.btn-danger:hover { background: color-mix(in srgb, var(--danger) 8%, transparent); }

@media (max-width: 700px) {
  .grid2 { grid-template-columns: 1fr; }
}
</style>
