<script setup lang="ts">
/**
 * Agent 编辑器
 *
 * 能改的都在这：提示词、模型、权限、执行顺序、超时、最大循环、预算。
 * 内置 Agent 的修改以「本地覆盖」形式保存，随时可以恢复默认。
 */
import { computed, ref, watch } from 'vue';
import { db } from '../../core/db';
import type { ProviderRow } from '../../core/db';
import type { AgentDefinition, SkillDefinition } from '../../core/types';
import { saveAgent, resetAgent, deleteAgent, isOverridden } from '../../agents/registry';
import { CAPABILITY_LABEL } from '../../skills/registry';
import { useAppStore } from '../../stores/app';

const props = defineProps<{
  agent: AgentDefinition;
  skills: SkillDefinition[];
  isNew: boolean;
}>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>();

const app = useAppStore();
const draft = ref<AgentDefinition>(JSON.parse(JSON.stringify(props.agent)));
const providers = ref<ProviderRow[]>([]);
const overridden = ref(false);
const saving = ref(false);

watch(
  () => props.agent,
  (a) => {
    draft.value = JSON.parse(JSON.stringify(a));
    void refresh();
  },
  { immediate: true },
);

async function refresh() {
  providers.value = await db.providers.toArray();
  overridden.value = await isOverridden(props.agent.id);
}

const currentModel = computed(() => app.settings.agentModels[draft.value.id]);
const modelKey = computed({
  get: () => (currentModel.value ? `${currentModel.value.providerId}::${currentModel.value.model}` : ''),
  set: (v: string) => {
    const next = { ...app.settings.agentModels };
    if (!v) delete next[draft.value.id];
    else {
      const [providerId, model] = v.split('::');
      next[draft.value.id] = { providerId, model };
    }
    void app.saveSettings({ agentModels: next });
  },
});

const modelOptions = computed(() =>
  providers.value.flatMap((p) =>
    (p.models ?? []).map((m) => ({ key: `${p.id}::${m.name}`, label: `${p.label} · ${m.name}` })),
  ),
);

function toggleSkill(id: string) {
  const list = draft.value.skills ?? [];
  draft.value.skills = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

async function save() {
  if (!draft.value.name.trim()) {
    app.toast('先给 Agent 起个名字', 'warn');
    return;
  }
  if (!draft.value.systemPrompt.trim()) {
    app.toast('系统提示词不能为空', 'warn');
    return;
  }
  saving.value = true;
  try {
    await saveAgent(draft.value);
    app.toast('已保存', 'ok');
    emit('saved');
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '保存失败', 'error', 5000);
  } finally {
    saving.value = false;
  }
}

async function restore() {
  if (!confirm('撤销本地修改，恢复内置默认？')) return;
  await resetAgent(draft.value.id);
  app.toast('已恢复默认', 'ok');
  emit('saved');
}

async function remove() {
  if (!confirm(`删除「${draft.value.name}」？引用它的工作流步骤会跳过。`)) return;
  try {
    await deleteAgent(draft.value.id);
    app.toast('已删除', 'ok');
    emit('saved');
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '删除失败', 'error', 5000);
  }
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="sheet">
      <header class="head">
        <div class="grow">
          <div class="eyebrow">{{ isNew ? '新建 Agent' : draft.builtin ? '内置 Agent' : '自定义 Agent' }}</div>
          <h3>{{ draft.name || '未命名' }}</h3>
          <div class="id mono">{{ draft.id }}</div>
        </div>
        <button class="x" aria-label="关闭" @click="emit('close')">×</button>
      </header>

      <div class="body">
        <section class="grid2">
          <label class="field">
            <span>名称</span>
            <input v-model="draft.name" class="input" maxlength="20" />
          </label>
          <label class="field">
            <span>执行顺序（小的先跑）</span>
            <input v-model.number="draft.order" class="input" type="number" min="1" max="999" />
          </label>
        </section>

        <label class="field">
          <span>一句话说明（普通模式里显示这句）</span>
          <input v-model="draft.description" class="input" maxlength="60" />
        </label>

        <label class="field">
          <span>系统提示词</span>
          <textarea v-model="draft.systemPrompt" class="input area" rows="9" spellcheck="false" />
          <small class="hint">不要在这里写具体项目数据。事实由运行时注入，写死反而会串项目。</small>
        </label>

        <div class="field">
          <span>使用的 Skill</span>
          <div class="chips">
            <button
              v-for="s in skills"
              :key="s.id"
              type="button"
              class="chip-btn"
              :class="{ on: draft.skills.includes(s.id) }"
              @click="toggleSkill(s.id)"
            >
              {{ s.name }}
              <em>{{ CAPABILITY_LABEL[s.capability] }}</em>
            </button>
          </div>
          <small class="hint">选中的 Skill 会把规则追加到提示词后面；导入的 Skill 也会显示在这里。</small>
        </div>

        <section class="grid2">
          <label class="field">
            <span>模型档位</span>
            <select v-model="draft.tier" class="input">
              <option value="cheap">便宜（检查、格式化）</option>
              <option value="balanced">均衡（默认）</option>
              <option value="strong">强（写作、审核）</option>
            </select>
          </label>
          <label class="field">
            <span>指定模型</span>
            <select v-model="modelKey" class="input">
              <option value="">自动分配</option>
              <option v-for="m in modelOptions" :key="m.key" :value="m.key">{{ m.label }}</option>
            </select>
          </label>
        </section>

        <section class="grid3">
          <label class="field">
            <span>超时（秒）</span>
            <input
              :value="Math.round(draft.timeoutMs / 1000)"
              class="input"
              type="number"
              min="10"
              max="600"
              @input="draft.timeoutMs = Number(($event.target as HTMLInputElement).value) * 1000"
            />
          </label>
          <label class="field">
            <span>最大循环</span>
            <input v-model.number="draft.maxLoops" class="input" type="number" min="1" max="8" />
          </label>
          <label class="field">
            <span>单任务预算（元）</span>
            <input
              :value="draft.budgetYuan ?? 0"
              class="input"
              type="number"
              min="0"
              step="0.1"
              @input="draft.budgetYuan = Number(($event.target as HTMLInputElement).value)"
            />
          </label>
        </section>

        <div class="field">
          <span>权限</span>
          <div class="perms">
            <label class="perm">
              <input
                type="checkbox"
                :checked="draft.permission.writeReport"
                @change="draft.permission.writeReport = ($event.target as HTMLInputElement).checked"
              />
              <b>写入报告</b>
              <em>允许把生成内容直接写进报告正文</em>
            </label>
            <label class="perm">
              <input
                type="checkbox"
                :checked="draft.permission.useSearch"
                @change="draft.permission.useSearch = ($event.target as HTMLInputElement).checked"
              />
              <b>调用检索</b>
              <em>允许读取检索服务返回的结果</em>
            </label>
            <label class="perm">
              <input
                type="checkbox"
                :checked="draft.permission.readSources"
                @change="draft.permission.readSources = ($event.target as HTMLInputElement).checked"
              />
              <b>读取项目资料</b>
              <em>允许把项目事实、来源、记录放进提示词</em>
            </label>
          </div>
          <small class="hint">权限是声明式约束：运行时按这里的开关决定给它多少上下文，不会执行任何代码。</small>
        </div>

        <label class="field row">
          <input
            type="checkbox"
            :checked="draft.enabled !== false"
            @change="draft.enabled = ($event.target as HTMLInputElement).checked"
          />
          <span class="inline">参与工作流与普通模式入口</span>
        </label>

        <p v-if="draft.origin" class="origin">来源：{{ draft.origin }}</p>
      </div>

      <footer class="foot">
        <button v-if="draft.builtin && overridden" class="btn btn-sm" type="button" @click="restore">恢复默认</button>
        <button v-if="!draft.builtin" class="btn btn-sm btn-danger" type="button" @click="remove">删除</button>
        <span class="grow" />
        <button class="btn btn-sm" type="button" @click="emit('close')">取消</button>
        <button class="btn btn-sm btn-primary" type="button" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 70; background: rgba(12, 13, 16, 0.46); display: flex; justify-content: flex-end; padding: 8px; }
.sheet {
  width: min(640px, 100%); height: 100%; display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-4);
  box-shadow: var(--shadow-3);
  animation: slide var(--dur-4) var(--ease-out);
}
@keyframes slide { from { transform: translateX(20px); opacity: 0; } to { transform: none; opacity: 1; } }
.head { display: flex; gap: var(--sp-3); align-items: flex-start; padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--line); }
.eyebrow { font-size: 10.5px; color: var(--text-3); letter-spacing: 0.06em; }
.head h3 { font-size: var(--fs-3); margin: 2px 0; }
.id { font-size: 10.5px; color: var(--text-3); }
.x { width: 30px; height: 30px; border-radius: 50%; border: none; background: var(--surface-2); color: var(--text-2); font-size: 18px; cursor: pointer; }
.body { flex: 1; overflow-y: auto; padding: var(--sp-4) var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-4); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-3); }
.field { display: flex; flex-direction: column; gap: 6px; }
.field > span { font-size: 11.5px; color: var(--text-3); font-weight: var(--fw-strong); }
.field.row { flex-direction: row; align-items: center; gap: 8px; }
.inline { font-size: var(--fs-2); color: var(--text-2); }
.input {
  height: 36px; padding: 0 10px; border-radius: var(--r-2);
  border: 1px solid var(--line); background: var(--surface); color: var(--text);
  font-size: var(--fs-2); font-family: inherit;
}
.input:focus { outline: none; border-color: var(--primary); }
.area { height: auto; padding: 10px; line-height: 1.7; resize: vertical; }
.hint { font-size: 10.5px; color: var(--text-3); line-height: 1.6; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px;
  border-radius: var(--r-full); border: 1px solid var(--line); background: var(--surface);
  color: var(--text-2); font-size: 11.5px; cursor: pointer;
}
.chip-btn em { font-style: normal; font-size: 9.5px; color: var(--text-3); }
.chip-btn.on { border-color: var(--primary); background: var(--primary-soft); color: var(--text); }
.perms { display: flex; flex-direction: column; gap: 8px; }
.perm { display: grid; grid-template-columns: 16px auto; gap: 2px 8px; align-items: center; font-size: var(--fs-2); }
.perm em { grid-column: 2; font-style: normal; font-size: 10.5px; color: var(--text-3); }
.origin { font-size: 10.5px; color: var(--text-3); margin: 0; }
.foot { display: flex; gap: var(--sp-2); align-items: center; padding: var(--sp-3) var(--sp-5); border-top: 1px solid var(--line); }
</style>
