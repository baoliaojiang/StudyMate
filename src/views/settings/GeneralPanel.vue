<script setup lang="ts">
/** 通知 / 语音播报 / 功能管理 三个二级页共用一套开关行，避免重复写三份 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { backOr } from '../../core/nav';
import { useAppStore } from '../../stores/app';
import { loadVoices, speakNatural, voiceOptions, type VoiceOption } from '../../core/voice';
import { azureSpeak } from '../../core/azure-tts';
import { open_, seal } from '../../core/crypto';
import SettingGroup from '../../components/settings/SettingGroup.vue';
import SettingRow from '../../components/settings/SettingRow.vue';
import SubPage from '../../components/settings/SubPage.vue';

const props = defineProps<{ kind: 'notifications' | 'voice' | 'features' }>();
const app = useAppStore();
const router = useRouter();

const titles = {
  notifications: '通知',
  voice: '语音播报',
  features: '功能管理',
} as const;

const subtitles = {
  notifications: '全部为本地提醒，不申请推送权限，也不会在后台弹消息。',
  voice: '只使用自然音色。机械音不做朗读——宁可没有，也不放一段像导航仪的合成音。',
  features: '关掉的功能会从界面移除，而不是留一个点不动的按钮。',
} as const;

function back() {
  backOr(router, '/settings');
}

const n = computed(() => app.settings.notifications);
const v = computed(() => app.settings.voice);
const f = computed(() => app.settings.features);

/** 只列自然音色；机械音不放进选项，避免选完发现像导航仪 */
const naturalVoices = ref<VoiceOption[]>([]);
const voiceState = ref<'loading' | 'ok' | 'none'>('loading');

async function scanVoices() {
  voiceState.value = 'loading';
  const all = await loadVoices();
  naturalVoices.value = voiceOptions(all);
  voiceState.value = naturalVoices.value.length ? 'ok' : 'none';
  // 已选音色不在本机列表里时，回落到第一个可用音色
  if (naturalVoices.value.length && !naturalVoices.value.some((x) => x.name === v.value.voice)) {
    await app.setVoice({ voice: naturalVoices.value[0].name });
  }
  if (!naturalVoices.value.length && v.value.enabled) {
    await app.setVoice({ enabled: false });
  }
}

onMounted(scanVoices);
const rateLabel = computed(() => `${v.value.rate.toFixed(1)}×`);

function setRate(e: Event) {
  const val = Number((e.target as HTMLInputElement).value);
  app.setVoice({ rate: Math.min(2, Math.max(0.5, val)) });
}

async function toggleVoice(on: boolean) {
  if (on && !naturalVoices.value.length) {
    app.toast('本机没有自然音色，无法开启。机械音不做朗读。', 'warn', 4200);
    await app.setVoice({ enabled: false });
    return;
  }
  await app.setVoice({ enabled: on });
  if (on) await speak('语音播报已开启');
}

/* ---------------- 微软语音（可选） ---------------- */
const azureRegion = ref(app.settings.voice.azure?.region ?? 'eastasia');
const azureVoiceName = ref(app.settings.voice.azure?.voiceName ?? 'zh-CN-XiaoxiaoNeural');
const azureKey = ref('');
const azureSaving = ref(false);
const AZURE_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声（自然）' },
  { id: 'zh-CN-YunxiNeural', label: '云希 · 男声（年轻）' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 男声（播报）' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女声（活泼）' },
];
const azureReady = computed(() => Boolean(app.settings.voice.azure?.keySealed));

async function saveAzure() {
  const key = azureKey.value.trim();
  if (!key && !app.settings.voice.azure) {
    app.toast('先填微软语音的 Key（Azure 门户 → 语音服务 → 密钥）', 'warn', 4600);
    return;
  }
  azureSaving.value = true;
  try {
    const sealed = key ? JSON.stringify(await seal(key)) : app.settings.voice.azure!.keySealed;
    await app.setVoice({
      azure: { keySealed: sealed, region: azureRegion.value.trim(), voiceName: azureVoiceName.value },
    });
    azureKey.value = '';
    app.toast('已保存，之后朗读优先用微软语音', 'ok', 3200);
  } catch (e) {
    app.toast(e instanceof Error ? e.message : '保存失败', 'error', 4000);
  } finally {
    azureSaving.value = false;
  }
}

async function clearAzure() {
  await app.setVoice({ azure: undefined });
  app.toast('已清除，改回本机语音', 'info', 2600);
}

async function speak(text: string) {
  // 配了微软语音就先用它；失败再回退本机，不让用户因为一次 401 就没声
  const az = app.settings.voice.azure;
  if (az) {
    const key = await open_(JSON.parse(az.keySealed) as Parameters<typeof open_>[0]);
    const r = await azureSpeak(text, {
      key,
      region: az.region,
      voiceName: az.voiceName,
      rate: v.value.rate,
    });
    if (r.ok) return;
    app.toast(`${r.reason ?? '微软语音失败'}，已改用本机语音`, 'warn', 4600);
  }
  const res = await speakNatural(text, { voiceName: v.value.voice, rate: v.value.rate });
  if (!res.ok) {
    app.toast(res.reason ?? '朗读失败', 'warn', 4200);
    if (!naturalVoices.value.length) await app.setVoice({ enabled: false });
  }
}

async function toggleFeature(key: keyof typeof f.value, on: boolean) {
  await app.setFeatures({ [key]: on });
  if (key === 'devTools' && !on && app.settings.devMode) await app.saveSettings({ devMode: false });
  app.toast(on ? '已开启' : '已关闭，入口已隐藏', 'info', 1600);
}
</script>

<template>
  <SubPage :title="titles[props.kind]" :subtitle="subtitles[props.kind]" @back="back">
    <!-- 通知 -->
    <template v-if="props.kind === 'notifications'">
      <SettingGroup>
        <SettingRow label="阶段截止提醒" note="研究记录或报告临近计划结束日时，在首页提示" :value="n.deadline ? '开启' : '关闭'">
          <template #right>
            <label class="switch" @click.stop>
              <input type="checkbox" :checked="n.deadline" @change="app.setNotifications({ deadline: ($event.target as HTMLInputElement).checked })" />
              <span />
            </label>
          </template>
        </SettingRow>
        <SettingRow label="每周进度小结" note="每周一生成一份上周填写情况，只看本机数据">
          <template #right>
            <label class="switch" @click.stop>
              <input type="checkbox" :checked="n.weekly" @change="app.setNotifications({ weekly: ($event.target as HTMLInputElement).checked })" />
              <span />
            </label>
          </template>
        </SettingRow>
        <SettingRow label="AI 任务完成提示" note="生成任务结束时提醒，不推送通知栏">
          <template #right>
            <label class="switch" @click.stop>
              <input type="checkbox" :checked="n.aiDone" @change="app.setNotifications({ aiDone: ($event.target as HTMLInputElement).checked })" />
              <span />
            </label>
          </template>
        </SettingRow>
        <SettingRow label="系统与更新提示" note="仅在本机界面内提示，不联网推送">
          <template #right>
            <label class="switch" @click.stop>
              <input type="checkbox" :checked="n.system" @change="app.setNotifications({ system: ($event.target as HTMLInputElement).checked })" />
              <span />
            </label>
          </template>
        </SettingRow>
      </SettingGroup>
      <p class="note">没有申请浏览器通知权限：应用关掉之后不会再打扰你。</p>
    </template>

    <!-- 语音播报 -->
    <template v-else-if="props.kind === 'voice'">
      <SettingGroup>
        <SettingRow label="语音播报" :value="v.enabled ? '开启' : '关闭'" note="朗读报告要点与检查清单">
          <template #right>
            <label class="switch" @click.stop>
              <input type="checkbox" :checked="v.enabled" @change="toggleVoice(($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </template>
        </SettingRow>
        <SettingRow
          label="音色"
          :value="voiceState === 'none' ? '无可用自然音色' : v.voice"
          note="只列自然音色（Neural / Natural / Enhanced）"
        >
          <template #right>
            <select
              class="sel"
              :value="v.voice"
              :disabled="voiceState !== 'ok'"
              @change="app.setVoice({ voice: ($event.target as HTMLSelectElement).value })"
            >
              <option v-if="voiceState === 'loading'" value="">检测中…</option>
              <option v-else-if="voiceState === 'none'" value="">未检测到</option>
              <option v-for="x in naturalVoices" :key="x.name" :value="x.name">{{ x.name }}</option>
            </select>
          </template>
        </SettingRow>
        <SettingRow label="语速" :value="rateLabel">
          <template #right>
            <input class="range" type="range" min="0.5" max="2" step="0.1" :value="v.rate" @input="setRate" />
          </template>
        </SettingRow>
        <SettingRow
          label="本机音色检测"
          :value="voiceState === 'loading' ? '检测中…' : voiceState === 'ok' ? `${naturalVoices.length} 个可用` : '没有自然音色'"
        >
          <template #right>
            <button class="btn btn-xs" type="button" @click="scanVoices">重新检测</button>
          </template>
        </SettingRow>
      </SettingGroup>
      <button
        class="btn"
        type="button"
        style="margin: 4px 0 0"
        :disabled="!naturalVoices.length"
        @click="speak('这是一段试听。研学帮会用本机的自然音色朗读报告要点。')"
      >
        试听一句
      </button>
      <p class="note">
        语音由本机合成，音频不上传、不缓存。若这里显示「没有自然音色」：在 Edge 中开启「在线自然语音」，
        或在系统设置里安装中文增强语音包；装好回来点「重新检测」。
      </p>

      <!-- 微软语音：可选，音质明显更好 -->
      <SettingGroup title="微软语音（可选）">
        <div class="azure-box">
          <p class="note" style="margin: 0 0 10px">
            填了就用微软的神经音色朗读，比系统 TTS 自然。Key 在本机加密保存，只用于合成语音。
            免费额度以 Azure 官网为准；不填也不影响使用。
          </p>
          <div class="azure-row">
            <label class="az-field">
              <span>区域</span>
              <input v-model="azureRegion" class="input" placeholder="eastasia" />
            </label>
            <label class="az-field">
              <span>音色</span>
              <select v-model="azureVoiceName" class="input">
                <option v-for="z in AZURE_VOICES" :key="z.id" :value="z.id">{{ z.label }}</option>
              </select>
            </label>
          </div>
          <label class="az-field" style="margin-top: 8px">
            <span>密钥（Key 1 或 Key 2）</span>
            <input
              v-model="azureKey"
              class="input"
              type="password"
              autocomplete="off"
              :placeholder="azureReady ? '已保存，留空则不修改' : '粘贴 Azure 语音服务的密钥'"
            />
          </label>
          <div class="row" style="gap: 8px; margin-top: 10px">
            <button class="btn btn-sm btn-primary" type="button" :disabled="azureSaving" @click="saveAzure">
              {{ azureSaving ? '保存中…' : '保存' }}
            </button>
            <button v-if="azureReady" class="btn btn-sm" type="button" @click="clearAzure">清除</button>
            <span class="muted small" style="align-self: center">
              {{ azureReady ? '已接入微软语音' : '未接入，用本机语音' }}
            </span>
          </div>
        </div>
      </SettingGroup>
      <p v-if="!naturalVoices.length" class="note">
        本机只有拼接式机械音，已停用朗读，也不会用机械音顶替。
      </p>
    </template>

    <!-- 功能管理 -->
    <template v-else>
      <SettingGroup title="内容与写作">
        <SettingRow label="AI 助手" note="首页 AI 入口与项目内的生成按钮" :value="f.aiAssist ? '开启' : '关闭'">
          <template #right>
            <label class="switch" @click.stop>
              <input type="checkbox" :checked="f.aiAssist" @change="toggleFeature('aiAssist', ($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </template>
        </SettingRow>
        <SettingRow label="文档导出" note="DOCX / Markdown / ZIP 打包" :value="f.docExport ? '开启' : '关闭'">
          <template #right>
            <label class="switch" @click.stop>
              <input type="checkbox" :checked="f.docExport" @change="toggleFeature('docExport', ($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </template>
        </SettingRow>
        <SettingRow label="文献检索" note="OpenAlex / Crossref 元数据检索" :value="f.search ? '开启' : '关闭'">
          <template #right>
            <label class="switch" @click.stop>
              <input type="checkbox" :checked="f.search" @change="toggleFeature('search', ($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </template>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="高级">
        <SettingRow label="开发者工具" note="开启后设置底部出现「开发者」入口" :value="f.devTools ? '开启' : '关闭'">
          <template #right>
            <label class="switch" @click.stop>
              <input type="checkbox" :checked="f.devTools" @change="toggleFeature('devTools', ($event.target as HTMLInputElement).checked)" />
              <span />
            </label>
          </template>
        </SettingRow>
      </SettingGroup>
      <p class="note">关闭不会删除任何数据；重新打开后原来的项目与报告都还在。</p>
    </template>
  </SubPage>
</template>

<style scoped>
.azure-box { padding: 10px 2px 2px; }
.azure-row { display: flex; gap: 10px; flex-wrap: wrap; }
.az-field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 160px; min-width: 0; }
.az-field span { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); }
.note { margin: 0 4px; font-size: calc(11.5px * var(--font-scale)); line-height: 1.75; color: var(--text-3); }
.switch { position: relative; display: inline-block; width: 44px; height: 26px; flex: 0 0 44px; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch span {
  position: absolute; inset: 0; background: var(--surface-3); border-radius: var(--r-full);
  transition: background var(--dur-2) var(--ease-out); cursor: pointer;
}
.switch span::after {
  content: ''; position: absolute; width: 20px; height: 20px; border-radius: 50%;
  background: #fff; top: 3px; left: 3px; transition: transform var(--dur-3) var(--ease-out);
}
.switch input:checked + span { background: var(--primary); }
.switch input:checked + span::after { transform: translateX(18px); }
.sel {
  height: 30px; padding: 0 8px;
  border: 1px solid var(--line); border-radius: var(--r-full);
  background: var(--surface-2); color: var(--text-2); font: inherit; font-size: calc(12.5px * var(--font-scale));
}
.range { width: 120px; accent-color: var(--primary); }
</style>
