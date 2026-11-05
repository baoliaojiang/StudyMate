<script setup lang="ts">
/**
 * 成员与分工
 * 数据直接存在 project.members 里，改动即落库（自动保存），不需要「保存」按钮。
 */
import { computed, ref } from 'vue';
import { useAppStore } from '../stores/app';
import { useProjectStore } from '../stores/projects';
import { uid } from '../core/id';
import type { Member } from '../core/types';

const app = useAppStore();
const store = useProjectStore();

const members = computed(() => store.current?.members ?? []);
const newName = ref('');
const savedAt = ref<number | null>(null);

function flashSaved() {
  savedAt.value = Date.now();
  setTimeout(() => {
    if (savedAt.value && Date.now() - savedAt.value > 1400) savedAt.value = null;
  }, 1500);
}

async function patch(id: string, changes: Partial<Member>) {
  const m = members.value.find((x) => x.id === id);
  if (!m) return;
  await store.upsertMember({ ...m, ...changes });
  flashSaved();
}

async function add() {
  const names = newName.value
    .split(/[\s,，、;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.length) return;
  for (const name of names) {
    if (members.value.some((m) => m.name === name)) {
      app.toast(`「${name}」已经在名单里`, 'warn', 2400);
      continue;
    }
    await store.upsertMember({ id: uid('m'), name, role: members.value.length ? 'member' : 'leader' });
  }
  newName.value = '';
  flashSaved();
}

async function remove(m: Member) {
  if (!confirm(`把「${m.name}」从小组里移除？`)) return;
  await store.removeMember(m.id);
  flashSaved();
}

async function setLeader(m: Member) {
  await store.setMemberLeader(m.id);
  flashSaved();
}

const dutyFilled = computed(() => members.value.filter((m) => (m.duty ?? '').trim()).length);
</script>

<template>
  <section class="pane">
    <div class="panel-head">
      <div>
        <h2 class="panel-title">成员与分工</h2>
        <p class="muted small">分工写清「谁负责哪一块、什么时候交」，后面写开题的活动计划可以直接引用。</p>
      </div>
      <span class="save-hint" :class="{ on: savedAt }">{{ savedAt ? '已自动保存' : '改动即保存' }}</span>
    </div>

    <div class="add-row">
      <input
        v-model="newName"
        class="input grow"
        placeholder="输入姓名，多个用空格或逗号分开"
        @keydown.enter.prevent="add"
      />
      <button class="btn btn-sm" @click="add">添加成员</button>
    </div>

    <div v-if="!members.length" class="card empty">
      还没有成员。至少添加一位，报告里的成员栏才有内容。
    </div>

    <div v-else class="m-list">
      <article v-for="m in members" :key="m.id" class="card m-card">
        <div class="m-top">
          <input
            class="m-name-input"
            :value="m.name"
            aria-label="成员姓名"
            @change="patch(m.id, { name: ($event.target as HTMLInputElement).value.trim() })"
          />
          <span v-if="m.role === 'leader'" class="chip chip-accent">组长</span>
          <button v-else class="mini" @click="setLeader(m)">设为组长</button>
          <button class="mini danger" @click="remove(m)">移除</button>
        </div>
        <textarea
          class="textarea duty"
          :value="m.duty ?? ''"
          :placeholder="`${m.name}负责什么？例如：问卷设计与发放，第 3 周前完成`"
          @change="patch(m.id, { duty: ($event.target as HTMLTextAreaElement).value })"
        />
      </article>
    </div>

    <p class="foot-note">
      已填写分工 {{ dutyFilled }} / {{ members.length }} 人。留空的分工不会在后继报告里被编造。
    </p>
  </section>
</template>

<style scoped>
.panel-head {
  display: flex; align-items: flex-start; gap: var(--sp-4);
  margin-bottom: var(--sp-4);
}
.panel-title { font-size: var(--fs-4); letter-spacing: -0.02em; }
.save-hint {
  flex: 0 0 auto; font-size: 11.5px; color: var(--text-3);
  padding: 4px 10px; border-radius: var(--r-full);
  background: var(--surface-2);
  transition: color var(--dur-2) var(--ease-out), background var(--dur-2) var(--ease-out);
}
.save-hint.on { color: var(--ok); background: var(--surface); border: 1px solid var(--line); }

.add-row { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); }
.empty { padding: var(--sp-8) var(--sp-4); text-align: center; color: var(--text-3); font-size: var(--fs-2); }

.m-list { display: flex; flex-direction: column; gap: var(--sp-2); }
.m-card { padding: var(--sp-4); }
.m-top { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-2); }
.m-name-input {
  flex: 1; min-width: 0;
  border: none; background: transparent; outline: none;
  font-size: var(--fs-3); font-weight: var(--fw-strong);
  color: var(--text);
  padding: 2px 4px; border-radius: var(--r-1);
}
.m-name-input:focus { background: var(--surface-2); }
.mini {
  border: none; background: none; cursor: pointer;
  font-size: 11.5px; color: var(--text-3); padding: 4px 6px; border-radius: var(--r-1);
}
.mini:hover { background: var(--surface-2); color: var(--text); }
.mini.danger { color: var(--danger); }
.duty {
  min-height: 62px; font-size: var(--fs-2); line-height: 1.7;
  border-radius: var(--r-2); background: var(--surface-2);
}
.foot-note { margin: var(--sp-3) 0 0; font-size: 11.5px; color: var(--text-3); }
</style>
