<script setup lang="ts">
/** 个性化：记忆、会话设定、常用语 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { backOr } from '../../core/nav';
import { useAppStore } from '../../stores/app';
import { useProjectStore } from '../../stores/projects';
import SettingGroup from '../../components/settings/SettingGroup.vue';
import SettingRow from '../../components/settings/SettingRow.vue';
import SubPage from '../../components/settings/SubPage.vue';

const props = defineProps<{ kind: 'memory' | 'session' | 'phrases' }>();
const app = useAppStore();
const store = useProjectStore();
const router = useRouter();

/** 返回上一级：有历史原路返回，没有则回设置首页 */
function back() {
  backOr(router, '/settings');
}

const title = computed(
  () => ({ memory: '记忆', session: '会话设定', phrases: '常用语' })[props.kind],
);

const newPhrase = ref('');

/** 「记忆」= 本机数据里 AI 能读到的上下文，不是聊天记录上传 */
const memoryItems = computed(() => [
  { label: '称呼', value: app.displayName },
  { label: '项目主题', value: store.list.map((p) => p.topic).filter(Boolean).slice(0, 4).join('、') || '暂无' },
  { label: '成员与指导教师', value: store.current ? `${store.current.members.map((m) => m.name).join('、')} · ${store.current.teacher}` : '进入项目后才有' },
  { label: '写作偏好', value: app.settings.font === 'harmony' ? '内置 HarmonyOS Sans' : '系统字体' },
]);

async function toggleMemory(on: boolean) {
  await app.setFeatures({ memory: on });
  app.toast(on ? 'AI 会参考项目上下文' : 'AI 不再读取项目上下文', 'info', 2200);
}

/** 打字流速度：适中按人类中文阅读速度，长文自动按比例提速 */
const speedOptions = [
  { key: 'fast' as const, label: '快速', desc: '约 29 字/秒' },
  { key: 'normal' as const, label: '适中', desc: '约 14 字/秒' },
  { key: 'slow' as const, label: '较慢', desc: '约 7 字/秒' },
] as const;

async function setTypingSpeed(v: 'fast' | 'normal' | 'slow') {
  await app.saveSettings({ typingSpeed: v });
}

/** 字体大小：四档，改的是全站 --font-scale */
const fontSizes = [
  { v: 0.9, label: '小' },
  { v: 1, label: '标准' },
  { v: 1.1, label: '大' },
  { v: 1.2, label: '特大' },
] as const;

async function setFontScale(v: number) {
  await app.saveSettings({ fontScale: v });
}

async function setMode(m: 'assist' | 'lead') {
  await app.saveSettings({ aiMode: m });
  app.toast(m === 'assist' ? '改为「AI 辅助」：先给提纲，由你确认' : '改为「AI 主导」：逐节生成，仍需你确认', 'info', 2400);
}

async function addPhrase() {
  const v = newPhrase.value.trim();
  if (!v) return;
  if (app.settings.phrases.includes(v)) {
    app.toast('这条已经存在', 'warn');
    return;
  }
  await app.setPhrases([...app.settings.phrases, v]);
  newPhrase.value = '';
}

async function removePhrase(i: number) {
  const list = [...app.settings.phrases];
  list.splice(i, 1);
  await app.setPhrases(list);
}
</script>

<template>
  <SubPage :title="title" @back="back">
    <!-- 记忆 -->
    <template v-if="props.kind === 'memory'">
      <SettingGroup>
        <SettingRow
          label="让 AI 参考项目记忆"
          note="只读取本机已存在的主题、成员与已写内容，不上传聊天记录"
          :value="app.settings.features.memory ? '开启' : '关闭'"
        >
          <template #right>
            <label class="switch" @click.stop>
              <input type="checkbox" :checked="app.settings.features.memory" @change="toggleMemory(($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </template>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="现在记着什么">
        <div class="mem">
          <div v-for="m in memoryItems" :key="m.label" class="mem-row">
            <span>{{ m.label }}</span>
            <b>{{ m.value }}</b>
          </div>
        </div>
      </SettingGroup>
      <p class="note">
        「记忆」是本机数据的投影，不是另一份副本。删除项目时，相关内容会一起消失，不存在“删了还偷偷留着”。
      </p>
    </template>

    <!-- 会话设定 -->
    <template v-else-if="props.kind === 'session'">
      <SettingGroup title="AI 工作方式">
        <SettingRow
          label="AI 辅助"
          note="先生成提纲与检查清单，正文由你确认后再写"
          :value="app.settings.aiMode === 'assist' ? '已选' : ''"
          chevron
          @click="setMode('assist')"
        />
        <SettingRow
          label="AI 主导"
          note="逐节生成草稿，每一节都需要你点确认，AI 不会自己把报告标成已确认"
          :value="app.settings.aiMode === 'lead' ? '已选' : ''"
          chevron
          @click="setMode('lead')"
        />
      </SettingGroup>

      <SettingGroup title="字体大小">
        <div class="font-row">
          <button
            v-for="f in fontSizes"
            :key="f.v"
            class="font-size"
            :class="{ on: Math.abs((app.settings.fontScale ?? 1) - f.v) < 0.01 }"
            type="button"
            @click="setFontScale(f.v)"
          >
            <b :style="{ fontSize: `${11 + f.v * 3}px` }">字</b>
            <span>{{ f.label }}</span>
          </button>
        </div>
        <p class="note" style="margin: 0 14px 12px">
          全站正文、标题与按钮一起缩放；调大后长页面会更好读，表格内容也会跟着变大。
        </p>
      </SettingGroup>

      <SettingGroup title="打字流速度">
        <div class="speed-row">
          <button
            v-for="o in speedOptions"
            :key="o.key"
            class="speed"
            :class="{ on: (app.settings.typingSpeed ?? 'normal') === o.key }"
            type="button"
            @click="setTypingSpeed(o.key)"
          >
            <b>{{ o.label }}</b>
            <span>{{ o.desc }}</span>
          </button>
        </div>
        <p class="note" style="margin: 0 14px 12px">
          「适中」按人类中文阅读速度；回答很长时按比例提速，不会让人干等。往上翻看前面时页面不会自动往下拽。
        </p>
      </SettingGroup>

      <SettingGroup title="模型分配">
        <SettingRow
          label="自动分配模型"
          note="简单任务用便宜模型，复杂任务才用高性能模型"
          :value="app.settings.autoAssign ? '开启' : '关闭'"
        >
          <template #right>
            <label class="switch" @click.stop>
              <input
                type="checkbox"
                :checked="app.settings.autoAssign"
                @change="app.saveSettings({ autoAssign: ($event.target as HTMLInputElement).checked })"
              />
              <span />
            </label>
          </template>
        </SettingRow>
        <SettingRow label="模型与预算" value="在「模型服务」里调" chevron @click="router.push('/settings/model')" />
      </SettingGroup>

      <p class="note">
        无论哪种方式，AI 都不会谎称研究已经真实开展；缺少真实材料时它会提问或标「待补充」。
      </p>
    </template>

    <!-- 常用语 -->
    <template v-else>
      <SettingGroup title="新增常用语">
        <div class="add">
          <input v-model="newPhrase" class="input" maxlength="80" placeholder="比如：本阶段尚未开展，待补充。" @keyup.enter="addPhrase" />
          <button class="btn btn-sm btn-primary" type="button" @click="addPhrase">添加</button>
        </div>
      </SettingGroup>

      <SettingGroup title="已保存">
        <div v-if="!app.settings.phrases.length" class="empty">还没有常用语。</div>
        <div v-for="(p, i) in app.settings.phrases" :key="p + i" class="phrase">
          <span>{{ p }}</span>
          <button class="del" type="button" aria-label="删除" @click="removePhrase(i)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </SettingGroup>
      <p class="note">常用语可以在研究记录的编辑框里一键插入，省得反复手打同一句说明。</p>
    </template>
  </SubPage>
</template>

<style scoped>
.note { margin: 0 4px; font-size: 11.5px; line-height: 1.75; color: var(--text-3); }
.mem { padding: 6px 14px 8px; }
.mem-row { display: flex; gap: 14px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.mem-row:last-child { border-bottom: none; }
.mem-row span { color: var(--text-3); flex: 0 0 96px; }
.mem-row b { flex: 1; font-weight: var(--fw-medium); word-break: break-word; }
.font-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 14px 14px 8px; }
.font-size {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  min-height: 58px; padding: 8px 4px;
  border: none; border-radius: var(--r-2);
  background: var(--surface-2); color: var(--text-2);
  font: inherit; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.font-size b { font-weight: var(--fw-medium); line-height: 1; }
.font-size span { font-size: 10.5px; color: var(--text-3); }
.font-size.on { background: var(--primary-soft, rgba(31, 79, 216, 0.12)); color: var(--primary); }
.font-size.on span { color: var(--primary); }
.speed-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 14px 14px 8px; }
.speed {
  display: flex; flex-direction: column; gap: 3px;
  padding: 10px 9px; border: none; border-radius: var(--r-2);
  background: var(--surface-2); color: var(--text-2);
  font: inherit; text-align: left; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.speed b { font-size: 13px; font-weight: var(--fw-medium); }
.speed span { font-size: 10.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.speed.on { background: var(--primary-soft, rgba(31, 79, 216, 0.12)); color: var(--text); }
.speed.on b { color: var(--primary); }
.add { display: flex; gap: 8px; padding: 14px; }
.add .input { flex: 1; }
.phrase {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; font-size: 13px; line-height: 1.6;
}
.phrase + .phrase { border-top: 1px solid var(--line); }
.phrase span { flex: 1; }
.del {
  width: 28px; height: 28px; flex: 0 0 28px; display: grid; place-items: center;
  border: none; border-radius: 50%; background: transparent; color: var(--text-3); cursor: pointer;
}
.del:hover { background: var(--surface-2); color: var(--danger, #c0392b); }
.empty { padding: 22px 14px; text-align: center; font-size: 12.5px; color: var(--text-3); }
.switch { position: relative; display: inline-block; width: 44px; height: 26px; flex: 0 0 44px; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch span { position: absolute; inset: 0; background: var(--surface-3); border-radius: var(--r-full); transition: background var(--dur-2); cursor: pointer; }
.switch span::after { content: ''; position: absolute; width: 20px; height: 20px; border-radius: 50%; background: #fff; top: 3px; left: 3px; transition: transform var(--dur-3) var(--ease-out); }
.switch input:checked + span { background: var(--primary); }
.switch input:checked + span::after { transform: translateX(18px); }
</style>
