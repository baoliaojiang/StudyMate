<script setup lang="ts">
/**
 * Skill 管理：内置列表 + 自定义 + 导入
 *
 * 导入前必须先把「来源 / 能做什么 / 不能做什么」摆出来，确认后才入库。
 * 带可执行字段（code / script / eval …）的一律拒收——本软件不执行任何外部代码。
 */
import { computed, onMounted, ref } from 'vue';
import type { SkillDefinition } from '../../core/types';
import {
  CAPABILITY_LABEL,
  CAPABILITY_NOTE,
  deleteSkill,
  inspectSkillImport,
  listSkills,
  overriddenIds,
  resetSkill,
  saveSkill,
  type SkillImportCheck,
} from '../../skills/registry';
import { useAppStore } from '../../stores/app';
import { askConfirm } from '../../core/task-guard';

const app = useAppStore();
const skills = ref<SkillDefinition[]>([]);
const openId = ref<string | null>(null);
const editing = ref<SkillDefinition | null>(null);
const isNew = ref(false);
const overridden = ref<Set<string>>(new Set());

/* ------------------------------ 导入 ------------------------------ */
const importOpen = ref(false);
const importRaw = ref('');
const check = ref<SkillImportCheck | null>(null);

onMounted(refresh);

async function refresh() {
  skills.value = await listSkills();
  overridden.value = new Set(await overriddenIds());
}

function blank(): SkillDefinition {
  return {
    id: `custom-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    description: '',
    capability: 'prompt',
    rules: '',
    builtin: false,
    origin: '本地新建',
    updatedAt: Date.now(),
  };
}

function create() {
  editing.value = blank();
  isNew.value = true;
}

function edit(s: SkillDefinition) {
  editing.value = JSON.parse(JSON.stringify(s)) as SkillDefinition;
  isNew.value = false;
}

async function save() {
  const d = editing.value;
  if (!d) return;
  if (!d.name.trim()) {
    app.toast('先给 Skill 起个名字', 'warn');
    return;
  }
  if (!d.rules.trim()) {
    app.toast('规则正文不能为空', 'warn');
    return;
  }
  try {
    await saveSkill({ ...d, builtin: false, updatedAt: Date.now() });
    app.toast(isNew.value ? '已新增' : '已保存', 'ok');
    editing.value = null;
    await refresh();
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '保存失败', 'error', 5000);
  }
}

async function remove(s: SkillDefinition) {
  const ok = await askConfirm({
    title: '删除 Skill',
    message: `删除「${s.name}」？已引用它的 Agent 会自动跳过这条规则。`,
    confirmText: '删除',
    tone: 'warn',
  });
  if (!ok) return;
  try {
    await deleteSkill(s.id);
    app.toast('已删除', 'ok');
    await refresh();
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '删除失败', 'error', 5000);
  }
}

async function restore(s: SkillDefinition) {
  const ok = await askConfirm({
    title: '恢复内置版本',
    message: `撤销对「${s.name}」的本地修改，恢复内置版本？`,
    confirmText: '仍然恢复',
    tone: 'warn',
  });
  if (!ok) return;
  await resetSkill(s.id);
  app.toast('已恢复默认', 'ok');
  await refresh();
}

/* ------------------------------ 导入 ------------------------------ */

function inspect() {
  check.value = inspectSkillImport(importRaw.value, '粘贴导入');
}

async function doImport() {
  const c = check.value;
  if (!c?.ok || !c.skill) return;
  try {
    await saveSkill({ ...c.skill, updatedAt: Date.now() });
    app.toast(`已导入「${c.skill.name}」`, 'ok');
    importRaw.value = '';
    check.value = null;
    importOpen.value = false;
    await refresh();
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '导入失败', 'error', 5000);
  }
}

const importCount = computed(() => skills.value.filter((s) => !s.builtin).length);
</script>

<template>
  <section>
    <div class="bar">
      <p class="lead">
        Skill 只是一段规则文本，会追加到 Agent 的系统提示词里。
        <b>不执行代码、不联网、不读文件、不接触 API Key。</b>
        已导入 {{ importCount }} 条自定义规则。
      </p>
      <div class="acts">
        <button class="btn btn-sm" type="button" @click="importOpen = true">导入</button>
        <button class="btn btn-sm btn-primary" type="button" @click="create">新建</button>
      </div>
    </div>

    <div class="list">
      <article v-for="s in skills" :key="s.id" class="card card-pad">
        <div class="row-between">
          <div class="grow">
            <b>{{ s.name }}</b>
            <span class="tag" :class="s.builtin ? '' : 'tag-new'">{{ CAPABILITY_LABEL[s.capability] }}</span>
            <span v-if="!s.builtin" class="tag tag-new">自定义</span>
          </div>
          <div class="acts">
            <button class="mini" type="button" @click="openId = openId === s.id ? null : s.id">
              {{ openId === s.id ? '收起' : '规则' }}
            </button>
            <button class="mini" type="button" @click="edit(s)">编辑</button>
            <button v-if="!s.builtin" class="mini danger" type="button" @click="remove(s)">删除</button>
            <button
              v-else-if="overridden.has(s.id)"
              class="mini"
              type="button"
              @click="restore(s)"
            >
              恢复默认
            </button>
          </div>
        </div>
        <p class="muted small desc">{{ s.description || CAPABILITY_NOTE[s.capability] }}</p>
        <div class="meta">
          <span class="mono">{{ s.id }}</span>
          <span v-if="s.origin">来源：{{ s.origin }}</span>
        </div>
        <pre v-if="openId === s.id" class="rules">{{ s.rules }}</pre>
      </article>
    </div>

    <!-- 导入：先检查再确认 -->
    <div v-if="importOpen" class="scrim" @click.self="importOpen = false">
      <div class="sheet">
        <header class="head">
          <div class="grow">
            <div class="eyebrow">导入 Skill</div>
            <h3>先看清它是什么，再决定要不要</h3>
          </div>
          <button class="x" aria-label="关闭" @click="importOpen = false">×</button>
        </header>
        <div class="body">
          <label class="field">
            <span>粘贴 JSON（单个对象）</span>
            <textarea
              v-model="importRaw"
              class="input area"
              rows="8"
              spellcheck="false"
              placeholder='{ "name": "问卷规范", "capability": "checklist", "rules": "1. 题目不超过 20 道…" }'
            />
            <small class="hint">只接受 name / description / capability / rules / id 字段。带 code、script、eval 等字段的内容会被拒绝。</small>
          </label>

          <button class="btn btn-sm" type="button" @click="inspect">检查这份内容</button>

          <div v-if="check" class="check" :class="check.ok ? 'ok' : 'bad'">
            <div class="check-head">
              <b>{{ check.ok ? '可以导入' : '不能导入' }}</b>
              <span class="muted small">来源：{{ check.source }}</span>
            </div>
            <ul v-if="check.errors.length" class="errs">
              <li v-for="e in check.errors" :key="e">{{ e }}</li>
            </ul>
            <template v-if="check.ok && check.skill">
              <div class="kv"><span>名称</span><b>{{ check.skill.name }}</b></div>
              <div class="kv"><span>能力</span><b>{{ CAPABILITY_LABEL[check.skill.capability] }}</b></div>
              <div class="block-label">导入后会怎样</div>
              <ul class="perms">
                <li v-for="p in check.permissions" :key="p">{{ p }}</li>
              </ul>
              <div class="block-label">规则正文</div>
              <pre class="rules">{{ check.skill.rules }}</pre>
            </template>
          </div>
        </div>
        <footer class="foot">
          <span class="grow" />
          <button class="btn btn-sm" type="button" @click="importOpen = false">取消</button>
          <button class="btn btn-sm btn-primary" type="button" :disabled="!check?.ok" @click="doImport">
            确认导入
          </button>
        </footer>
      </div>
    </div>

    <!-- 编辑 / 新建 -->
    <div v-if="editing" class="scrim" @click.self="editing = null">
      <div class="sheet">
        <header class="head">
          <div class="grow">
            <div class="eyebrow">{{ isNew ? '新建 Skill' : editing.builtin ? '覆盖内置 Skill' : '编辑 Skill' }}</div>
            <h3>{{ editing.name || '未命名' }}</h3>
          </div>
          <button class="x" aria-label="关闭" @click="editing = null">×</button>
        </header>
        <div class="body">
          <div class="grid2">
            <label class="field">
              <span>名称</span>
              <input v-model="editing.name" class="input" maxlength="40" />
            </label>
            <label class="field">
              <span>能力类型</span>
              <select v-model="editing.capability" class="input">
                <option value="prompt">提示词规则</option>
                <option value="checklist">检查清单</option>
                <option value="format">格式规范</option>
              </select>
            </label>
          </div>
          <label class="field">
            <span>一句话说明</span>
            <input v-model="editing.description" class="input" maxlength="160" />
          </label>
          <label class="field">
            <span>规则正文</span>
            <textarea v-model="editing.rules" class="input area" rows="12" spellcheck="false" />
            <small class="hint">{{ CAPABILITY_NOTE[editing.capability] }}。最多 8000 字。</small>
          </label>
          <p v-if="!isNew && editing.builtin" class="banner">
            这是内置 Skill。保存会生成一份本地覆盖版本，随时可以恢复默认。
          </p>
        </div>
        <footer class="foot">
          <span class="grow" />
          <button class="btn btn-sm" type="button" @click="editing = null">取消</button>
          <button class="btn btn-sm btn-primary" type="button" @click="save">保存</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bar { display: flex; gap: var(--sp-3); align-items: flex-start; margin-bottom: var(--sp-3); flex-wrap: wrap; }
.lead { flex: 1; min-width: 240px; margin: 0; font-size: var(--fs-1); color: var(--text-3); line-height: 1.7; }
.acts { display: flex; gap: 6px; flex-wrap: wrap; }
.list { display: flex; flex-direction: column; gap: 8px; }
.row-between { display: flex; align-items: flex-start; gap: var(--sp-3); flex-wrap: wrap; }
.grow { flex: 1; min-width: 180px; }
.desc { margin: 4px 0 0; line-height: 1.6; }
.meta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 6px; font-size: calc(10.5px * var(--font-scale)); color: var(--text-3); }
.tag {
  display: inline-block; height: 19px; line-height: 19px; padding: 0 7px; margin-left: 8px;
  border-radius: var(--r-full); background: var(--surface-2); color: var(--text-3); font-size: calc(10px * var(--font-scale));
}
.tag-new { background: var(--primary-soft); color: var(--primary); }
.mini {
  height: 26px; padding: 0 9px; border-radius: var(--r-1); border: 1px solid var(--line);
  background: var(--surface); color: var(--text-2); font-size: calc(11px * var(--font-scale)); cursor: pointer;
}
.mini.danger { color: var(--danger); }
.rules {
  margin: 8px 0 0; padding: 10px 12px; border-radius: var(--r-1); background: var(--surface-2);
  font-family: var(--font-mono); font-size: calc(11px * var(--font-scale)); line-height: 1.7; color: var(--text-2);
  white-space: pre-wrap; max-height: 240px; overflow-y: auto;
}

.scrim { position: fixed; inset: 0; z-index: 70; background: rgba(12, 13, 16, 0.46); display: flex; justify-content: flex-end; padding: 8px; }
.sheet {
  width: min(620px, 100%); height: 100%; display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-4);
  box-shadow: var(--shadow-3); animation: slide var(--dur-4) var(--ease-out);
}
@keyframes slide { from { transform: translateX(20px); opacity: 0; } to { transform: none; opacity: 1; } }
.head { display: flex; gap: var(--sp-3); align-items: flex-start; padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--line); }
.eyebrow { font-size: calc(10.5px * var(--font-scale)); color: var(--text-3); letter-spacing: 0.06em; }
.head h3 { font-size: var(--fs-3); margin: 2px 0 0; }
.x { width: 30px; height: 30px; border-radius: 50%; border: none; background: var(--surface-2); color: var(--text-2); font-size: calc(18px * var(--font-scale)); cursor: pointer; }
.body { flex: 1; overflow-y: auto; padding: var(--sp-4) var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-4); }
.foot { display: flex; gap: var(--sp-2); align-items: center; padding: var(--sp-3) var(--sp-5); border-top: 1px solid var(--line); }
.field { display: flex; flex-direction: column; gap: 6px; }
.field > span { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); font-weight: var(--fw-strong); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
.input {
  height: 36px; padding: 0 10px; border-radius: var(--r-2); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font-size: var(--fs-2); font-family: inherit;
}
.input:focus { outline: none; border-color: var(--primary); }
.area { height: auto; padding: 10px; line-height: 1.7; resize: vertical; }
.hint { font-size: calc(10.5px * var(--font-scale)); color: var(--text-3); line-height: 1.6; }
.banner { margin: 0; padding: 9px 12px; border-radius: var(--r-2); background: var(--surface-2); font-size: calc(11.5px * var(--font-scale)); color: var(--text-2); line-height: 1.7; }

.check { padding: 12px 14px; border-radius: var(--r-2); border: 1px solid var(--line); background: var(--surface-2); }
.check.ok { border-color: color-mix(in srgb, var(--ok) 40%, var(--line)); }
.check.bad { border-color: color-mix(in srgb, var(--danger) 45%, var(--line)); }
.check-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.errs { margin: 0 0 8px; padding-left: 18px; font-size: calc(11.5px * var(--font-scale)); color: var(--danger); line-height: 1.8; }
.perms { margin: 0; padding-left: 18px; font-size: calc(11.5px * var(--font-scale)); color: var(--text-2); line-height: 1.9; }
.kv { display: flex; gap: 12px; font-size: var(--fs-2); padding: 3px 0; }
.kv span { color: var(--text-3); width: 60px; flex: 0 0 60px; }
.block-label { font-size: calc(11px * var(--font-scale)); color: var(--text-3); font-weight: var(--fw-strong); margin-top: 10px; }
</style>
