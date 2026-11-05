<script setup lang="ts">
/** 外观：主题、字体、动效、语言。改动立即生效，并且跟随设备同步保存。 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { backOr } from '../../core/nav';
import { useAppStore } from '../../stores/app';
import SettingGroup from '../../components/settings/SettingGroup.vue';
import SettingRow from '../../components/settings/SettingRow.vue';
import SubPage from '../../components/settings/SubPage.vue';

const app = useAppStore();
const router = useRouter();

/** 返回上一级：有历史原路返回，没有则回设置首页 */
function back() {
  backOr(router, '/settings');
}

const themeOpen = ref(false);

/** 状态栏留白：给被顶栏压住的机型一个手动出口 */
async function setSafePad(e: Event) {
  const v = Number((e.target as HTMLSelectElement).value) || 0;
  await app.saveSettings({ safeTopPad: v });
  app.toast(v ? `顶部已多留 ${v}px` : '已恢复自动', 'ok', 1600);
}
const fontOpen = ref(false);

const themeLabel = computed(
  () => ({ system: '跟随系统', light: '浅色', dark: '深色' })[app.settings.theme],
);

const options = [
  { value: 'system', label: '跟随系统', desc: '随设备的深色模式自动切换' },
  { value: 'light', label: '浅色', desc: '暖纸底 + 白卡片，白天阅读更稳' },
  { value: 'dark', label: '深色', desc: '近黑底，夜间不刺眼' },
] as const;

async function pickTheme(v: (typeof options)[number]['value']) {
  await app.setTheme(v);
  themeOpen.value = false;
}

async function toggleMotion(on: boolean) {
  await app.setMotion(on ? 'on' : 'off');
  app.toast(on ? '动效已开启' : '动效已关闭，界面立即呈现', 'info', 1600);
}

async function pickFont(v: 'harmony' | 'system') {
  await app.setFont(v);
  fontOpen.value = false;
  app.toast(v === 'harmony' ? '已切到内置 HarmonyOS Sans' : '已切到系统字体', 'ok', 1800);
}
</script>

<template>
  <SubPage title="外观" subtitle="这里的每一项都即时生效，不用重启。" @back="back">
    <SettingGroup>
      <SettingRow label="主题设置" :value="themeLabel" chevron @click="themeOpen = true">
        <template #icon>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="8.2" /><path d="M12 3.8v16.4" /><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" fill="currentColor" fill-opacity="0.18" stroke="none" /></svg>
        </template>
      </SettingRow>

      <SettingRow
        label="界面字体"
        :value="app.settings.font === 'system' ? '系统字体' : 'HarmonyOS Sans'"
        chevron
        @click="fontOpen = true"
      >
        <template #icon>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 19 10 5h1.6l5.5 14" /><path d="M7 14.2h7" /><path d="M17.4 19h2.1" /></svg>
        </template>
      </SettingRow>

      <SettingRow
        label="界面动效"
        :value="app.settings.motion === 'off' ? '关闭' : '开启'"
        note="页面切换、抽屉、列表入场；关闭后所有过渡瞬时完成"
        @click="toggleMotion(app.settings.motion === 'off')"
      >
        <template #icon>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 15.5c3.2 0 4.4-7 8-7s4.8 7 9 7" /></svg>
        </template>
        <template #right>
          <label class="switch" @click.stop>
            <input
              type="checkbox"
              :checked="app.settings.motion !== 'off'"
              @change="toggleMotion(($event.target as HTMLInputElement).checked)"
            />
            <span />
          </label>
        </template>
      </SettingRow>

      <SettingRow
        label="状态栏留白"
        note="顶部内容和手机状态栏重叠时调大这里；电脑上无变化"
      >
        <template #icon>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5.5h17" /><path d="M6.5 12h11" /><path d="M9 18.5h6" /></svg>
        </template>
        <template #right>
          <select class="mini-select" :value="String(app.settings.safeTopPad ?? 0)" @change="setSafePad">
            <option value="0">自动</option>
            <option value="8">+8</option>
            <option value="16">+16</option>
            <option value="24">+24</option>
            <option value="32">+32</option>
          </select>
        </template>
      </SettingRow>

      <SettingRow label="语言" value="简体中文" note="目前只提供简体中文，不做假的切换入口">
        <template #icon>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.2" /><path d="M3.8 12h16.4M12 3.8c2.2 2.3 3.3 5.1 3.3 8.2S14.2 17.9 12 20.2C9.8 17.9 8.7 15.1 8.7 12S9.8 6.1 12 3.8z" /></svg>
        </template>
      </SettingRow>
    </SettingGroup>

    <p class="note">
      字体随应用分发，不读取也不修改系统字体；关掉动效只是把过渡压到 0，不影响功能。
    </p>

    <div v-if="themeOpen" class="scrim" @click.self="themeOpen = false">
      <div class="sheet">
        <h3>主题设置</h3>
        <button
          v-for="o in options"
          :key="o.value"
          class="opt"
          :class="{ on: app.settings.theme === o.value }"
          type="button"
          @click="pickTheme(o.value)"
        >
          <span class="opt-text"><b>{{ o.label }}</b><span>{{ o.desc }}</span></span>
          <span v-if="app.settings.theme === o.value" class="tick">✓</span>
        </button>
        <button class="btn btn-block" type="button" style="margin-top: 14px" @click="themeOpen = false">关闭</button>
      </div>
    </div>

    <div v-if="fontOpen" class="scrim" @click.self="fontOpen = false">
      <div class="sheet">
        <h3>界面字体</h3>
        <button class="opt" :class="{ on: app.settings.font !== 'system' }" type="button" @click="pickFont('harmony')">
          <span class="opt-text"><b>HarmonyOS Sans SC</b><span>随应用分发，三档字重，设备间观感一致（约 2.8MB）</span></span>
          <span v-if="app.settings.font !== 'system'" class="tick">✓</span>
        </button>
        <button class="opt" :class="{ on: app.settings.font === 'system' }" type="button" @click="pickFont('system')">
          <span class="opt-text"><b>系统字体</b><span>体积更小，但不同设备字形与行高会有差异</span></span>
          <span v-if="app.settings.font === 'system'" class="tick">✓</span>
        </button>
        <button class="btn btn-block" type="button" style="margin-top: 14px" @click="fontOpen = false">关闭</button>
      </div>
    </div>
  </SubPage>
</template>

<style scoped>
.mini-select {
  height: 30px; padding: 0 8px;
  border: none; border-radius: var(--r-1);
  background: var(--surface-2); color: var(--text-2);
  font: inherit; font-size: 12px;
  appearance: none; text-align: center;
}
.note { margin: 0 4px; font-size: 11.5px; line-height: 1.75; color: var(--text-3); }
.switch { position: relative; display: inline-block; width: 44px; height: 26px; flex: 0 0 44px; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch span {
  position: absolute; inset: 0; background: var(--surface-3); border-radius: var(--r-full);
  transition: background var(--dur-2) var(--ease-out); cursor: pointer;
}
.switch span::after {
  content: ''; position: absolute; width: 20px; height: 20px; border-radius: 50%;
  background: #fff; top: 3px; left: 3px;
  transition: transform var(--dur-3) var(--ease-out);
}
.switch input:checked + span { background: var(--primary); }
.switch input:checked + span::after { transform: translateX(18px); }

.scrim {
  position: fixed; inset: 0; z-index: 110;
  background: rgba(10, 10, 12, 0.44);
  display: grid; place-items: center; padding: 20px;
  animation: fade var(--dur-2) var(--ease-out);
}
.sheet {
  width: min(400px, 100%);
  background: var(--bg); border: 1px solid var(--line);
  border-radius: var(--r-4); box-shadow: var(--shadow-3);
  padding: 20px;
  animation: pop var(--dur-3) var(--ease-out);
}
@keyframes fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes pop { from { opacity: 0; transform: translateY(10px) scale(0.985) } to { opacity: 1; transform: none } }
.sheet h3 { margin: 0 0 12px; font-size: 16px; }
.opt {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 12px 14px; margin-bottom: 8px;
  border: 1px solid var(--line); border-radius: var(--r-2);
  background: var(--surface); color: var(--text);
  text-align: left; cursor: pointer; font: inherit;
  transition: border-color var(--dur-2), background var(--dur-2);
}
.opt:hover { border-color: var(--line-strong); }
.opt.on { border-color: var(--primary); background: var(--primary-soft, rgba(31, 79, 216, 0.08)); }
.opt-text { display: flex; flex-direction: column; gap: 3px; flex: 1; }
.opt-text b { font-size: 14px; font-weight: var(--fw-strong); }
.opt-text span { font-size: 12px; color: var(--text-3); line-height: 1.55; }
.tick { color: var(--primary); font-weight: var(--fw-strong); }
@media (max-width: 520px) {
  .scrim { align-items: end; padding: 0; }
  .sheet { border-radius: var(--r-4) var(--r-4) 0 0; padding-bottom: calc(20px + var(--safe-bottom, env(safe-area-inset-bottom, 0px))); }
}
</style>
