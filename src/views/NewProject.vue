<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import { db } from '../core/db';
import type { Member, ResearchMode } from '../core/types';
import { uid } from '../core/id';
import {
  analyzeRequirement,
  mergeAnalysis,
  parseAiExtraction,
  REQUIREMENT_EXTRACT_PROMPT,
  type ExtractedField,
} from '../reports/requirement';
import { SCHOOL_TOPICS, TOPIC_SUBJECTS } from '../reports/topics';
import { chatWithBudgetConfirm } from '../ai/budget';

const app = useAppStore();
const store = useProjectStore();
const router = useRouter();

/* 学校备选选题：从下发的清单里挑，也可以自己写 */
const topicPickerOpen = ref(false);
const topicQuery = ref('');
const topicSubject = ref('');
const filteredTopics = computed(() => {
  const q = topicQuery.value.trim();
  return SCHOOL_TOPICS.filter(
    (t) =>
      (!topicSubject.value || t.subject === topicSubject.value) &&
      (!q || t.topic.includes(q) || t.subject.includes(q)),
  );
});
function pickTopic(t: string) {
  form.topic = t;
  topicPickerOpen.value = false;
}

/** 没写过要求的学生，可以按主题让 AI 先生成一版草案（仍然要自己改） */
const drafting = ref(false);
async function draftRequirement() {
  if (!form.topic.trim()) {
    app.toast('先把研究主题填上', 'warn');
    return;
  }
  if (!aiReady.value) {
    app.toast('还没有可用的模型，先到设置里接一个', 'warn', 3600);
    return;
  }
  drafting.value = true;
  try {
    const res = await chatWithBudgetConfirm(app.gateway, {
      messages: [
        {
          role: 'system',
          content:
            '你在帮中学生起草「研究性学习」的教师要求草案。只写要求条文：研究内容范围、方法、字数、时间节点、提交格式。' +
            '不要编造学校名称、分数、真实数据或调查结果；不确定的地方写「按老师要求」。用简体中文分条列出，不要客套话。',
        },
        {
          role: 'user',
          content: `研究主题：${form.topic}\n年级：${form.grade || '未填'}\n请起草一份研究性学习要求草案。`,
        },
      ],
      agentId: 'project-planner',
      tier: 'cheap',
      temperature: 0.4,
      maxTokens: 900,
      cacheKey: 'requirement-draft',
    });
    form.requirementText = res.text.trim();
    app.toast('已生成草案：请对照老师的实际要求修改后再创建', 'info', 4600);
  } catch (e) {
    app.toast(e instanceof Error ? e.message : String(e), 'error', 5000);
  } finally {
    drafting.value = false;
  }
}

const step = ref(0);
const totalSteps = 4;

const form = reactive({
  topic: '',
  teacher: '',
  school: '福州鼓山中学',
  grade: '',
  className: '',
  groupName: '',
  startDate: '',
  endDate: '',
  requirementText: '',
  requirementSource: '',
  members: [] as Member[],
  modes: ['theory'] as ResearchMode[],
  aiMode: 'assist' as 'assist' | 'lead',
  pureAi: false,
  recordTotal: 15,
  firstTerm: 8,
});

const analyzing = ref(false);
const extracted = ref<ExtractedField[]>([]);
const extractWarnings = ref<string[]>([]);
const applied = ref<Record<string, boolean>>({});
const aiUsed = ref(false);

/** 是否已配置可用模型：未配置时 AI 分析必须显示为不可用，不能悄悄降级成「AI」 */
const aiReady = ref(false);
onMounted(async () => {
  try {
    const providers = await db.providers.toArray();
    aiReady.value = providers.some((p) => p.models.length > 0 && p.apiKeyLen > 0);
  } catch {
    aiReady.value = false;
  }
});

const memberInput = ref('');

const modes: { key: ResearchMode; label: string; desc: string }[] = [
  { key: 'theory', label: '纯理论研究', desc: '文献、资料分析为主，不需要实地数据' },
  { key: 'practice', label: '实践研究', desc: '真实开展调查、访谈、实验、观察，并留下记录' },
  { key: 'simulated', label: 'AI 模拟实践', desc: '演示方法或预演方案，产出标记为「AI 模拟示例」' },
];

const canNext = computed(() => {
  if (step.value === 0) return form.topic.trim().length > 0 && form.requirementText.trim().length > 0;
  if (step.value === 1) return form.teacher.trim().length > 0 && form.members.length > 0;
  if (step.value === 2) return form.modes.length > 0;
  return true;
});

/** 当前步骤缺什么，用于按钮下方的说明（不弹 toast 骚扰） */
const blockReason = computed(() => {
  if (step.value === 0) {
    const miss: string[] = [];
    if (!form.topic.trim()) miss.push('研究主题');
    if (!form.requirementText.trim()) miss.push('教师要求');
    return miss.length ? `还缺：${miss.join('、')}` : '';
  }
  if (step.value === 1) {
    const miss: string[] = [];
    if (!form.teacher.trim()) miss.push('指导教师姓名');
    if (!form.members.length) miss.push('小组成员');
    return miss.length ? `还缺：${miss.join('、')}` : '';
  }
  if (step.value === 2 && !form.modes.length) return '至少选一种研究方式';
  return '';
});

const secondTerm = computed(() => Math.max(0, form.recordTotal - form.firstTerm));

function addMember() {
  const names = memberInput.value
    .split(/[\s,，、;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const n of names) {
    if (!form.members.some((m) => m.name === n)) {
      form.members.push({ id: uid('m'), name: n, role: form.members.length === 0 ? 'leader' : 'member' });
    }
  }
  memberInput.value = '';
}

function removeMember(id: string) {
  const wasLeader = form.members.find((m) => m.id === id)?.role === 'leader';
  form.members = form.members.filter((m) => m.id !== id);
  if (wasLeader && form.members[0]) form.members[0].role = 'leader';
}

function setLeader(id: string) {
  form.members = form.members.map((m) => ({ ...m, role: m.id === id ? 'leader' : 'member' }));
}

async function importFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!/\.(txt|md|csv)$/i.test(file.name)) {
    app.toast('目前只支持 .txt / .md / .csv；.docx 请打开后复制正文粘贴进来', 'warn', 5000);
    return;
  }
  const text = await file.text();
  form.requirementText = text;
  form.requirementSource = file.name;
  app.toast(`已导入 ${file.name}（${text.length} 字）`, 'ok');
}

/** 只用离线规则识别：零成本、不联网，也不是 AI */
function analyzeRules() {
  if (!form.requirementText.trim()) {
    app.toast('先把教师要求粘贴进来，或直接手动填写下面几项', 'warn');
    return;
  }
  const rule = analyzeRequirement(form.requirementText);
  extracted.value = rule.fields;
  extractWarnings.value = [...rule.warnings, '本次为离线规则识别，未调用任何模型。'];
  applied.value = Object.fromEntries(rule.fields.map((f) => [f.key, true]));
  aiUsed.value = false;
  app.toast(
    `按关键词识别到 ${rule.fields.length} 项，请核对后应用`,
    rule.fields.length ? 'ok' : 'warn',
  );
}

async function analyze() {
  if (!form.requirementText.trim()) {
    app.toast('先把教师要求粘贴进来，或直接手动填写下面几项', 'warn');
    return;
  }
  if (!aiReady.value) {
    app.toast('AI 分析不可用：还没有配置模型服务。可以先用「离线规则识别」。', 'warn', 5000);
    return;
  }
  analyzing.value = true;
  const rule = analyzeRequirement(form.requirementText);
  let merged = { fields: rule.fields, warnings: rule.warnings };
  aiUsed.value = false;

  try {
    const res = await chatWithBudgetConfirm(app.gateway, {
      messages: [
        { role: 'system', content: REQUIREMENT_EXTRACT_PROMPT },
        { role: 'user', content: form.requirementText.slice(0, 6000) },
      ],
      agentId: 'project-planner',
      tier: 'cheap',
      temperature: 0,
      maxTokens: 900,
      cacheKey: 'requirement-extract',
    });
    const parsed = parseAiExtraction(res.text);
    if (parsed) {
      merged = mergeAnalysis(rule, parsed);
      aiUsed.value = true;
    } else {
      merged.warnings.push('模型返回的格式无法解析，已只保留规则解析结果。');
    }
  } catch (e) {
    merged.warnings.push(
      `AI 精修未执行（${e instanceof Error ? e.message : String(e)}），以下为离线规则解析结果。`,
    );
  }

  extracted.value = merged.fields;
  extractWarnings.value = merged.warnings;
  applied.value = Object.fromEntries(merged.fields.map((f) => [f.key, true]));
  analyzing.value = false;
  app.toast(
    `识别到 ${merged.fields.length} 项，请逐项核对后再应用`,
    merged.fields.length ? 'ok' : 'warn',
  );
}

function applyExtracted() {
  for (const f of extracted.value) {
    if (!applied.value[f.key]) continue;
    switch (f.key) {
      case 'topic':
        if (!form.topic) form.topic = f.value;
        break;
      case 'teacher':
        if (!form.teacher) form.teacher = f.value;
        break;
      case 'school':
        if (!form.school || f.from === 'rule') form.school = f.value;
        break;
      case 'grade':
        form.grade = f.value;
        break;
      case 'className':
        form.className = f.value;
        break;
      case 'groupName':
        form.groupName = f.value;
        break;
      case 'startDate':
        form.startDate = f.value;
        break;
      case 'endDate':
        form.endDate = f.value;
        break;
      case 'recordTotal': {
        const n = Number(f.value);
        if (n > 0 && n <= 60) {
          form.recordTotal = n;
          form.firstTerm = Math.ceil(n / 2);
        }
        break;
      }
      case 'members':
        for (const name of f.value.split(/[、,，\s]+/).filter(Boolean)) {
          if (!form.members.some((m) => m.name === name)) {
            form.members.push({
              id: uid('m'),
              name,
              role: form.members.length === 0 ? 'leader' : 'member',
            });
          }
        }
        break;
    }
  }
  app.toast('已填入表单，请检查是否有误', 'ok');
}

/* ---------------- 纯 AI 生成（仅理论 / 模拟实践） ---------------- */
const pureAiOpen = ref(false);
const pureChecks = reactive({ a: false, b: false, c: false });
const pureAllChecked = computed(() => pureChecks.a && pureChecks.b && pureChecks.c);
/** 只有「纯理论研究 / AI 模拟实践」才允许开纯 AI */
const canPureAi = computed(
  () => form.modes.length > 0 && form.modes.every((m) => m === 'theory' || m === 'simulated'),
);

function openPureAi() {
  if (!canPureAi.value) {
    app.toast('纯 AI 只能用于「纯理论研究」或「AI 模拟实践」，先按这两个方式之一选', 'warn', 5200);
    return;
  }
  pureChecks.a = pureChecks.b = pureChecks.c = false;
  pureAiOpen.value = true;
}

function confirmPureAi() {
  if (!pureAllChecked.value) return;
  form.pureAi = true;
  pureAiOpen.value = false;
  app.toast('已开启纯 AI 生成：所有内容按模拟示例标注', 'warn', 4600);
}

async function create() {
  if (!form.topic.trim()) {
    app.toast('研究主题不能空', 'warn');
    step.value = 0;
    return;
  }
  if (!form.requirementText.trim()) {
    app.toast('教师要求必填——没有书面要求就写一句「口头布置，无书面要求」', 'warn', 5200);
    step.value = 0;
    return;
  }
  if (!form.teacher.trim()) {
    app.toast('指导教师姓名必须填写——AI 不会替你猜', 'warn');
    step.value = 1;
    return;
  }
  if (!form.members.length) {
    app.toast('至少填一位小组成员', 'warn');
    step.value = 1;
    return;
  }
  const p = await app.withBusy('正在创建项目…', async () =>
    store.createProject({
      meta: {
        topic: form.topic.trim(),
        teacher: form.teacher.trim(),
        school: form.school.trim(),
        grade: form.grade.trim(),
        className: form.className.trim(),
        groupName: form.groupName.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        requirementText: form.requirementText,
        requirementSource: form.requirementSource,
        members: form.members,
        modes: form.modes,
        aiMode: form.aiMode,
        pureAi: form.pureAi,
      },
      recordPlan: { total: form.recordTotal, firstTerm: form.firstTerm, secondTerm: secondTerm.value },
    }),
  );
  if (p) {
    app.toast('项目已创建', 'ok');
    router.replace(`/project/${p.id}`);
  }
}
</script>

<template>
  <div class="page">
    <div class="head">
      <button class="back" @click="step === 0 ? router.back() : step--">←</button>
      <div class="grow">
        <h1>新建研究项目</h1>
        <div class="muted small">第 {{ step + 1 }} / {{ totalSteps }} 步</div>
      </div>
    </div>

    <div class="progress"><div class="bar" :style="{ width: ((step + 1) / totalSteps) * 100 + '%' }" /></div>

    <!-- 步骤 1 -->
    <section v-if="step === 0" class="pane">
      <label class="field">
        <span class="field-label">研究主题 <span class="req">*</span></span>
        <div class="topic-row">
          <input v-model="form.topic" class="input grow" placeholder="例如：中学生校园食品安全认知调查" />
          <button class="btn btn-sm" type="button" @click="topicPickerOpen = true">
            从备选选题选（{{ SCHOOL_TOPICS.length }}）
          </button>
        </div>
        <span class="field-hint">清单来自学校下发的《研究性学习备选课题》，也可以自己定题。</span>
      </label>

      <label class="field">
        <span class="field-label">教师布置的研究性学习要求 <span class="req">*</span></span>
        <textarea
          v-model="form.requirementText"
          class="textarea"
          style="min-height: 150px"
          placeholder="把老师发的通知 / 表格要求 / 字数格式要求整段粘贴进来。"
        />
        <span class="field-hint" v-if="form.requirementSource">来源：{{ form.requirementSource }}</span>
        <span class="field-hint" v-else>没有原文可写「老师口头布置，无书面要求」，不要空着。</span>
        <div class="row wrap" style="margin-top: 10px; gap: 10px">
          <button class="btn btn-sm" style="flex: 0 0 auto" type="button" :disabled="drafting || !form.topic.trim()" @click="draftRequirement">
            {{ drafting ? '正在生成…' : '按主题帮我写要求草案' }}
          </button>
          <span class="muted small">生成的是草案，按老师实际要求改完再用</span>
        </div>
      </label>

      <div class="row wrap" style="margin-bottom: 8px">
        <label class="btn btn-sm" style="cursor: pointer">
          导入文本文件
          <input type="file" accept=".txt,.md,.csv" hidden @change="importFile" />
        </label>
        <button class="btn btn-sm" @click="analyzeRules">离线规则识别</button>
        <button class="btn btn-sm btn-primary" :disabled="analyzing || !aiReady" @click="analyze">
          {{ analyzing ? '分析中…' : '让 AI 帮我分析要求' }}
        </button>
        <span v-if="!aiReady" class="chip chip-warn" style="height: 22px">AI 不可用 · 未配置模型</span>
      </div>
      <p class="ai-note">
        <template v-if="aiReady">AI 分析会把要求原文发给你自己配置的模型服务；识别结果需要你逐项确认。</template>
        <template v-else>
          「离线规则识别」只是按关键词匹配学校和篇数，<b>不是 AI</b>。
          想用 AI 分析，先到
          <router-link to="/settings">设置 → 模型服务</router-link>
          配置一个 API。
        </template>
      </p>

      <div v-if="extracted.length || extractWarnings.length" class="card card-pad result">
        <div class="row-between" style="margin-bottom: 10px">
          <b style="font-size: 14px">识别结果</b>
          <span class="chip" :class="aiUsed ? 'chip-accent' : ''">
            {{ aiUsed ? '规则 + AI 精修' : '离线规则解析' }}
          </span>
        </div>
        <div v-if="!extracted.length" class="muted small">没有识别到可用字段，请手动填写。</div>
        <label v-for="f in extracted" :key="f.key" class="ex-row">
          <input v-model="applied[f.key]" type="checkbox" class="cb" />
          <div class="grow">
            <div class="ex-key">
              {{ f.label }}
              <span class="chip" v-if="f.from === 'ai'" style="height: 20px; font-size: 10.5px">AI 推断</span>
            </div>
            <div class="ex-val">{{ f.value }}</div>
            <div v-if="f.evidence" class="ex-ev">{{ f.evidence }}</div>
          </div>
        </label>
        <div v-for="w in extractWarnings" :key="w" class="banner banner-warn" style="margin-top: 8px; font-size: 12px">
          {{ w }}
        </div>
        <button v-if="extracted.length" class="btn btn-primary btn-sm" style="margin-top: 12px" @click="applyExtracted">
          应用勾选项到表单
        </button>
      </div>
    </section>

    <!-- 步骤 2 -->
    <section v-else-if="step === 1" class="pane">
      <label class="field">
        <span class="field-label">指导教师姓名 <span class="req">*</span></span>
        <input v-model="form.teacher" class="input" placeholder="必须自己填，AI 不会猜" />
        <span class="field-hint">填错或留空，后续报告都会跟着错。</span>
      </label>

      <div class="field">
        <span class="field-label">小组成员 <span class="req">*</span></span>
        <div class="row">
          <input
            v-model="memberInput"
            class="input grow"
            placeholder="输入姓名，多个用空格或逗号分开"
            @keydown.enter.prevent="addMember"
          />
          <button class="btn btn-sm" @click="addMember">添加</button>
        </div>
        <div v-if="form.members.length" class="members">
          <div v-for="m in form.members" :key="m.id" class="member">
            <span class="m-name">{{ m.name }}</span>
            <span v-if="m.role === 'leader'" class="chip chip-accent" style="height: 20px; font-size: 10.5px">组长</span>
            <button v-else class="mini" @click="setLeader(m.id)">设为组长</button>
            <button class="mini danger" @click="removeMember(m.id)">移除</button>
          </div>
        </div>
      </div>

      <div class="grid2">
        <label class="field">
          <span class="field-label">学校</span>
          <input v-model="form.school" class="input" />
        </label>
        <label class="field">
          <span class="field-label">年级</span>
          <input v-model="form.grade" class="input" placeholder="如 高二" />
        </label>
        <label class="field">
          <span class="field-label">班级</span>
          <input v-model="form.className" class="input" placeholder="如 3 班" />
        </label>
        <label class="field">
          <span class="field-label">小组名称</span>
          <input v-model="form.groupName" class="input" placeholder="如 第三研究小组" />
        </label>
        <label class="field">
          <span class="field-label">开始时间</span>
          <input v-model="form.startDate" type="date" class="input" />
        </label>
        <label class="field">
          <span class="field-label">结束时间</span>
          <input v-model="form.endDate" type="date" class="input" />
        </label>
      </div>

      <div class="banner" style="font-size: 12px">
        上表按福州鼓山中学常用表格字段设置。不确定的项先留空，别猜——建好后还能改。
      </div>
    </section>

    <!-- 步骤 3 -->
    <section v-else-if="step === 2" class="pane">
      <div class="field-label">研究方式（可多选）</div>
      <div class="mode-list">
        <label v-for="m in modes" :key="m.key" class="mode" :class="{ on: form.modes.includes(m.key) }">
          <input
            type="checkbox"
            class="cb"
            :checked="form.modes.includes(m.key)"
            @change="
              form.modes.includes(m.key)
                ? (form.modes = form.modes.filter((x) => x !== m.key))
                : form.modes.push(m.key)
            "
          />
          <div>
            <b>{{ m.label }}</b>
            <span>{{ m.desc }}</span>
          </div>
        </label>
      </div>

      <div class="field-label" style="margin-top: 24px">生成方式</div>
      <div class="row wrap" style="gap: 10px; align-items: center">
        <button
          v-if="!form.pureAi"
          class="btn btn-sm"
          :class="{ 'btn-primary': canPureAi }"
          type="button"
          @click="openPureAi"
        >
          开启纯 AI 生成（仅理论 / 模拟）
        </button>
        <template v-else>
          <span class="chip chip-warn">纯 AI 生成：已开启</span>
          <button class="btn btn-sm" type="button" @click="form.pureAi = false">改回真人研究</button>
        </template>
      </div>
      <p class="field-hint" style="margin-top: 6px">
        纯 AI 只适用于「纯理论研究」或「AI 模拟实践」。开启后，报告与记录里的内容都会按「AI 模拟示例」标注，
        不会被当成真实调查、访谈或实验数据。
      </p>

      <div class="field-label" style="margin-top: 24px">AI 工作模式</div>
      <div class="seg">
        <button class="seg-item" :class="{ on: form.aiMode === 'assist' }" @click="form.aiMode = 'assist'">
          AI 辅助
        </button>
        <button class="seg-item" :class="{ on: form.aiMode === 'lead' }" @click="form.aiMode = 'lead'">
          AI 主导辅助
        </button>
      </div>
      <div class="banner" style="margin-top: 10px; font-size: 12px">
        {{
          form.aiMode === 'assist'
            ? '你是主要研究者，AI 只给建议、整理、分析和修改。'
            : 'AI 承担更多规划、整理与初稿，但你必须核实每一条内容，真实研究仍需你亲自做。'
        }}
      </div>

      <div class="field-label" style="margin-top: 24px">研究记录篇数与学期分配</div>
      <div class="row wrap">
        <label class="inline-field">
          <span>总篇数</span>
          <input v-model.number="form.recordTotal" type="number" min="1" max="60" class="input" style="width: 90px" />
        </label>
        <label class="inline-field">
          <span>上学期</span>
          <input v-model.number="form.firstTerm" type="number" min="0" :max="form.recordTotal" class="input" style="width: 90px" />
        </label>
        <div class="inline-field">
          <span>下学期</span>
          <b style="font-size: 15px">{{ secondTerm }}</b>
        </div>
      </div>
      <span class="field-hint">默认 15 篇（8 + 7）。按学校的实际要求调整。</span>
    </section>

    <!-- 步骤 4 -->
    <section v-else class="pane">
      <div class="card card-pad confirm">
        <h2 style="font-size: 17px; margin-bottom: 14px">{{ form.topic || '（未填主题）' }}</h2>
        <div class="kv"><span>指导教师</span><b>{{ form.teacher }}</b></div>
        <div class="kv"><span>成员</span><b>{{ form.members.map((m) => m.name).join('、') }}</b></div>
        <div class="kv"><span>学校 / 年级 / 班级</span><b>{{ form.school }} {{ form.grade }} {{ form.className }}</b></div>
        <div class="kv"><span>小组</span><b>{{ form.groupName || '未填' }}</b></div>
        <div class="kv">
          <span>时间</span>
          <b v-if="form.startDate || form.endDate">{{ form.startDate || '待填' }} 至 {{ form.endDate || '待填' }}</b>
          <b v-else class="kv-muted">未填写（可稍后在项目设置里补）</b>
        </div>
        <div class="kv">
          <span>研究方式</span>
          <b>{{ form.modes.map((m) => modes.find((x) => x.key === m)?.label).join(' + ') }}</b>
        </div>
        <div class="kv">
          <span>交付物</span>
          <b>开题 1 + 研究记录 {{ form.recordTotal }}（{{ form.firstTerm }}+{{ secondTerm }}）+ 中期 1 + 结题 1</b>
        </div>
      </div>
      <div class="banner banner-warn" style="margin-top: 14px; font-size: 12px">
        创建后会先生成空白框架。AI 不会替你写任何「已完成」的研究工作——那需要你的真实记录。
      </div>
    </section>

    <div class="foot">
      <button v-if="step > 0" class="btn" @click="step--">上一步</button>
      <div class="grow" />
      <span v-if="blockReason" class="block-reason">{{ blockReason }}</span>
      <button v-if="step < 3" class="btn btn-primary" :disabled="!canNext" @click="step++">下一步</button>
      <button v-else class="btn btn-primary" @click="create">创建项目</button>
    </div>

    <!-- 纯 AI：三层免责，必须逐条勾选 -->
    <Teleport to="body">
      <div v-if="pureAiOpen" class="picker-scrim" @click.self="pureAiOpen = false">
        <div class="pure-card" role="dialog" aria-label="纯 AI 生成确认">
          <h3>开启纯 AI 生成前，请逐条确认</h3>
          <p class="muted small">
            纯 AI 模式只用于「纯理论研究」与「AI 模拟实践」。它生成的是示例，不是真实研究数据。
          </p>

          <label class="pure-item">
            <input v-model="pureChecks.a" type="checkbox" />
            <span>
              <b>一、我知道这些内容是模拟示例</b>
              <i>报告里的数据、访谈、实验过程都是 AI 编的示例，不代表我真实做过研究。</i>
            </span>
          </label>

          <label class="pure-item">
            <input v-model="pureChecks.b" type="checkbox" />
            <span>
              <b>二、我不会去掉「AI 模拟示例」标识</b>
              <i>正文与导出文档都会带标识；去掉标识后提交，学术诚信后果由我自己承担。</i>
            </span>
          </label>

          <label class="pure-item">
            <input v-model="pureChecks.c" type="checkbox" />
            <span>
              <b>三、我不把它当真实成果提交</b>
              <i>需要真实数据的作业、评比或答辩，我会切回真人研究模式重新做。</i>
            </span>
          </label>

          <div class="row" style="gap: 8px; margin-top: 14px">
            <button class="btn btn-sm btn-primary grow" type="button" :disabled="!pureAllChecked" @click="confirmPureAi">
              三条都确认，开启
            </button>
            <button class="btn btn-sm" type="button" @click="pureAiOpen = false">取消</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 备选选题弹层：之前只有按钮和样式，弹层本体漏了，点了没反应 -->
    <Teleport to="body">
      <div v-if="topicPickerOpen" class="picker-scrim" @click.self="topicPickerOpen = false">
        <div class="picker" role="dialog" aria-label="学校备选选题">
          <div class="picker-head">
            <div class="grow">
              <b>学校备选选题</b>
              <p class="muted small" style="margin: 4px 0 0">
                来自学校下发的《研究性学习备选课题》，共 {{ SCHOOL_TOPICS.length }} 条；也可以关掉自己定题。
              </p>
            </div>
            <button class="btn btn-sm" type="button" @click="topicPickerOpen = false">关闭</button>
          </div>

          <div class="picker-bar">
            <input v-model="topicQuery" class="input" placeholder="搜关键词，例如 食品、交通、社团" />
          </div>

          <div class="chips">
            <button class="chip" :class="{ on: !topicSubject }" type="button" @click="topicSubject = ''">全部</button>
            <button
              v-for="s in TOPIC_SUBJECTS"
              :key="s"
              class="chip"
              :class="{ on: topicSubject === s }"
              type="button"
              @click="topicSubject = topicSubject === s ? '' : s"
            >
              {{ s }}
            </button>
          </div>

          <div class="picker-list">
            <button v-for="t in filteredTopics" :key="t.topic" class="topic-item" type="button" @click="pickTopic(t.topic)">
              <span class="grow">
                <b style="font-size: 13.5px">{{ t.topic }}</b>
                <span class="muted small" style="display: block; margin-top: 2px">{{ t.subject }}</span>
              </span>
              <span class="muted small">选这个</span>
            </button>
            <p v-if="!filteredTopics.length" class="muted small" style="padding: 18px 10px">
              没有匹配的选题，换个关键词，或直接关闭弹层自己写主题。
            </p>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page { max-width: 720px; margin: 0 auto; padding: 20px 20px 60px; }
.head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.head h1 { font-size: 21px; }
.back {
  width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--line);
  background: var(--surface); color: var(--text); cursor: pointer; font-size: 16px;
}
.progress { height: 3px; background: var(--surface-3); border-radius: 2px; margin-bottom: 24px; overflow: hidden; }
.bar { height: 100%; background: var(--grad); transition: width 320ms var(--ease); }

.pane { min-height: 340px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
.members { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.member {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-2);
}
.m-name { font-size: 13.5px; font-weight: var(--fw-strong); }
.mini {
  margin-left: auto; font-size: 11.5px; color: var(--text-3); background: none;
  border: none; cursor: pointer; padding: 2px 4px;
}
.mini.danger { margin-left: 0; color: var(--danger); }

.result { margin-top: 6px; }
.ex-row { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); cursor: pointer; }
.ex-row:last-of-type { border-bottom: none; }
.cb { width: 17px; height: 17px; margin-top: 3px; accent-color: var(--primary); flex: 0 0 17px; }
.ex-key { font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 6px; }
.ex-val { font-size: 13.5px; margin-top: 2px; }
.ex-ev { font-size: 11px; color: var(--text-3); margin-top: 4px; font-family: var(--font-mono); }

.mode-list { display: flex; flex-direction: column; gap: 8px; }
.mode {
  display: flex; gap: 12px; padding: 13px 15px; border-radius: var(--r-3);
  background: var(--surface); border: 1px solid var(--line); cursor: pointer;
}
.mode.on { border-color: var(--primary); background: var(--primary-soft); }
.mode b { display: block; font-size: 13.5px; }
.mode span { font-size: 12px; color: var(--text-3); }

.seg { display: flex; gap: 6px; padding: 5px; background: var(--surface-2); border-radius: var(--r-full); }
.seg-item {
  flex: 1; height: 38px; border: none; background: transparent; border-radius: var(--r-full);
  color: var(--text-2); font-size: 13.5px; font-weight: var(--fw-strong); cursor: pointer;
}
.seg-item.on { background: var(--grad); color: #fff; }

.inline-field { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); }

.confirm .kv { display: flex; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 13.5px; }
.confirm .kv:last-child { border-bottom: none; }
.confirm .kv span { color: var(--text-3); width: 120px; flex: 0 0 120px; }
.confirm .kv b { font-weight: var(--fw-strong); }

.foot { display: flex; gap: 10px; align-items: center; margin-top: 28px; flex-wrap: wrap; }
/* 按钮永远不被文字挤扁 */
.foot .btn { flex: 0 0 auto; white-space: nowrap; }
.block-reason { font-size: 11.5px; color: var(--text-3); margin-right: 4px; }

@media (max-width: 720px) {
  /* 窄屏：提示独占一行，按钮平分，不再挤成半个 */
  .foot .grow { display: none; }
  .foot .btn { flex: 1 1 0; }
  .block-reason { flex: 1 1 100%; margin: 0 0 2px; line-height: 1.6; }
}
.ai-note {
  margin: 0 0 18px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-3);
  max-width: 52em;
}
.ai-note a { color: var(--primary); }

@media (max-width: 600px) {
  .page { padding: 14px 14px 80px; }
  .grid2 { grid-template-columns: 1fr; }
  .confirm .kv { flex-direction: column; gap: 2px; }
  .confirm .kv span { width: auto; flex: none; }
}

/* 纯 AI 免责弹层 */
.pure-card {
  width: min(480px, 100%);
  max-height: min(84vh, 720px); overflow-y: auto;
  background: var(--bg); border-radius: var(--r-4);
  padding: 20px 20px 16px; box-shadow: var(--shadow-3);
}
.pure-card h3 { margin: 0 0 6px; font-size: 16px; }
.pure-item {
  display: flex; gap: 10px; align-items: flex-start;
  margin-top: 12px; padding: 10px 12px;
  border-radius: var(--r-2); background: var(--surface);
  cursor: pointer;
}
.pure-item input { width: 17px; height: 17px; flex: 0 0 17px; margin-top: 2px; accent-color: var(--primary); }
.pure-item span { display: flex; flex-direction: column; gap: 3px; }
.pure-item b { font-size: 13px; }
.pure-item i { font-style: normal; font-size: 11.5px; color: var(--text-3); line-height: 1.6; }

/* 备选选题弹层 */
.topic-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.topic-row .input { min-width: 0; flex: 1 1 180px; }
.topic-row .btn { flex: 0 0 auto; white-space: nowrap; }

@media (max-width: 560px) {
  /* 手机：输入框一行，按钮整行铺满 */
  .topic-row { flex-direction: column; align-items: stretch; }
  .topic-row .btn { width: 100%; }
}
.picker-scrim {
  position: fixed; inset: 0; z-index: 70;
  background: rgba(12, 13, 16, 0.5);
  display: flex; align-items: center; justify-content: center;
  padding: 16px; animation: fade var(--dur-2) var(--ease-out);
}
.picker {
  width: min(560px, 100%); max-height: min(84vh, 720px);
  display: flex; flex-direction: column;
  background: var(--bg); border-radius: var(--r-4);
  box-shadow: var(--shadow-3); overflow: hidden;
  animation: pop var(--dur-3) var(--spring-under);
}
.picker-head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px 10px; }
.picker-bar { padding: 0 18px 8px; display: flex; }
.chips { display: flex; gap: 6px; overflow-x: auto; padding: 0 18px 10px; scrollbar-width: none; }
.chips::-webkit-scrollbar { display: none; }
.chip {
  flex: 0 0 auto; height: 30px; padding: 0 12px;
  border: none; border-radius: var(--r-full);
  background: var(--surface-2); color: var(--text-3);
  font-size: 12.5px; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.chip.on { background: var(--text); color: var(--bg); }
.picker-list { flex: 1 1 auto; overflow-y: auto; padding: 0 10px 14px; }
.topic-item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 10px 8px; border: none; border-radius: var(--r-2);
  background: transparent; text-align: left; cursor: pointer;
  transition: background var(--dur-1) var(--ease-out);
}
.topic-item:hover { background: var(--surface-2); }
.topic-no { font-size: 11.5px; color: var(--text-3); width: 26px; flex: 0 0 26px; }
.topic-name { font-size: var(--fs-2); color: var(--text); }
.topic-sub { font-size: 11.5px; color: var(--text-3); flex: 0 0 auto; }
@keyframes fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(0.98) } to { opacity: 1; transform: none } }
</style>
