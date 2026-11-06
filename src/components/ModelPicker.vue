<script setup lang="ts">
/**
 * 顶栏模型选择
 *
 * 以前是「快速 / 进阶」两个词并排，看不出区别、也不知道会切到哪个模型。
 * 现在只有一颗胶囊，写着当前正在用的模型名；点开按「快 / 强」分两栏，
 * 每行标出属于哪个服务商、单价多少，选中即生效。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import { db, type ProviderRow } from '../core/db';

const app = useAppStore();
const router = useRouter();

const providers = ref<ProviderRow[]>([]);
const open = ref(false);

async function load() {
  providers.value = await db.providers.toArray();
}
onMounted(load);
/** 配置页保存 Key / 拉取模型 / 启用停用之后，这里立刻跟着变 */
watch(() => app.modelVersion, load);
defineExpose({ refresh: load });

interface Row {
  providerId: string;
  providerLabel: string;
  model: string;
  priceIn?: number;
  priceOut?: number;
  local: boolean;
  fast: boolean;
  reasoning: boolean;
}

/** 依型号名粗排快慢：带 flash / mini / lite 这类后缀的算「快」 */
const isFast = (name: string) => /flash|mini|lite|small|turbo|haiku|8b|7b/i.test(name);

const rows = computed<Row[]>(() =>
  providers.value
    .filter((p) => p.enabled !== false)
    .flatMap((p) =>
      p.models.map((m) => ({
        providerId: p.id,
        providerLabel: p.label,
        model: m.name,
        priceIn: m.priceIn,
        priceOut: m.priceOut,
        local: p.kind === 'local',
        fast: isFast(m.name),
        reasoning: Boolean(m.cap?.reasoning),
      })),
    ),
);

const current = computed(() => app.settings.currentModel);

/** 选中的模型对象，用来显示档位 */
const currentRow = computed(() => rows.value.find((r) => r.model === current.value?.model));

const fastRows = computed(() => rows.value.filter((r) => r.fast));
const strongRows = computed(() => rows.value.filter((r) => !r.fast));

const label = computed(() => {
  if (current.value?.model) return current.value.model;
  if (!rows.value.length) return providers.value.length ? '模型未启用' : '未配置模型';
  return '选择模型';
});

const tierText = computed(() => {
  if (!rows.value.length) return providers.value.length ? '待启用' : '未配置';
  if (!current.value?.model) return '未选择';
  return currentRow.value?.fast ? '快速' : '进阶';
});

/** 接口不返回价格，这里不再显示估算单价，只标本地模型 */

/**
 * 深度思考的三档：
 * - yes：模型自己声明了推理能力，或名字一看就是推理模型（r1 / thinking / o3 / qwq…）
 * - maybe：服务商的模型列表没带能力位（agnes、网关自建模型常这样）。
 *           **不能因为没声明就禁用**——很多模型是支持的，只是列表里没写。
 * - no：还没选模型。
 */
const THINK_NAME_RE = /(?:^|[-_.])(r1|reasoner|reasoning|thinking|qwq|o1|o3|o4)(?:$|[-_.])/i;
const thinkState = computed<'yes' | 'maybe' | 'no'>(() => {
  const r = currentRow.value;
  if (!r) return 'no';
  if (r.reasoning) return 'yes';
  if (THINK_NAME_RE.test(r.model)) return 'yes';
  return 'maybe';
});
const canThink = computed(() => thinkState.value !== 'no');
const thinkHint = computed(() => {
  if (thinkState.value === 'yes') return '先推理再回答，更慢也更费 token';
  if (thinkState.value === 'maybe') return '该模型没有声明推理能力，开启后若服务商不支持会自动忽略';
  return '先选一个模型';
});

async function toggleThinking(v: boolean) {
  await app.saveSettings({ thinking: v });
  app.toast(
    v
      ? thinkState.value === 'yes'
        ? '已开启深度思考：回复会先给出思考过程'
        : '已开启深度思考；若这个模型不支持，服务商会忽略该参数'
      : '已关闭深度思考',
    'ok',
    2600,
  );
}

function priceText(r: Row) {
  if (r.local) return '本地';
  return '';
}

async function pick(r: Row) {
  await app.setCurrentModel({ providerId: r.providerId, model: r.model, tier: r.fast ? 'fast' : 'pro' });
  open.value = false;
  app.toast(`已切换到 ${r.model}（${r.fast ? '快速' : '进阶'}）`, 'ok', 2000);
}

function goSettings() {
  open.value = false;
  router.push('/settings/model');
}

/** 打开时若还没选过，自动落一个可用模型，避免“有模型但用不了” */
watch(open, (v) => {
  if (v && !current.value?.model && rows.value.length) {
    const r = rows.value[0];
    app.setCurrentModel({ providerId: r.providerId, model: r.model, tier: r.fast ? 'fast' : 'pro' });
  }
});
</script>

<template>
  <div class="mp">
    <button class="chip" :class="{ open }" type="button" @click="open = !open" :aria-expanded="open">
      <span class="dot" :class="{ off: !rows.length }" />
      <span class="chip-name">{{ label }}</span>
      <span class="tier">{{ tierText }}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
    </button>

    <transition name="drop">
      <div v-if="open" class="scrim" @click.self="open = false">
        <div class="sheet" role="dialog" aria-label="选择模型">
          <div class="sheet-head">
            <b>用哪个模型</b>
            <button class="x" type="button" aria-label="关闭" @click="open = false">×</button>
          </div>

          <p v-if="rows.length" class="hint">
            「快速」适合提纲、润色这类轻活；「进阶」用于长文与推理。切换只影响之后的调用。
          </p>

          <label v-if="current?.model" class="think-row" :class="{ off: !canThink }">
            <span class="tr-text">
              <b>深度思考</b>
              <span>{{ thinkHint }}</span>
            </span>
            <input
              type="checkbox"
              :checked="app.settings.thinking === true"
              :disabled="!canThink"
              @change="toggleThinking(($event.target as HTMLInputElement).checked)"
            />
          </label>

          <div v-if="!rows.length" class="empty">
            <p>还没有可用的模型。到设置里添加服务商、拉取模型列表后，这里才有东西可选。</p>
            <button class="btn btn-sm btn-primary" type="button" @click="goSettings">去配置模型</button>
          </div>

          <template v-else>
            <section v-if="fastRows.length" class="group">
              <div class="group-head">
                <b>快速</b><span>更快、更便宜</span>
              </div>
              <button
                v-for="r in fastRows"
                :key="r.providerId + r.model"
                class="row"
                :class="{ on: current?.model === r.model }"
                type="button"
                @click="pick(r)"
              >
                <span class="row-main">
                  <span class="row-name">{{ r.model }}</span>
                  <span class="row-sub">{{ r.providerLabel }}</span>
                </span>
                <span class="row-price">{{ priceText(r) }}</span>
                <span v-if="current?.model === r.model" class="tick">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 5 5L19 7" /></svg>
                </span>
              </button>
            </section>

            <section v-if="strongRows.length" class="group">
              <div class="group-head">
                <b>进阶</b><span>更强、更准</span>
              </div>
              <button
                v-for="r in strongRows"
                :key="r.providerId + r.model"
                class="row"
                :class="{ on: current?.model === r.model }"
                type="button"
                @click="pick(r)"
              >
                <span class="row-main">
                  <span class="row-name">{{ r.model }}</span>
                  <span class="row-sub">{{ r.providerLabel }}</span>
                </span>
                <span class="row-price">{{ priceText(r) }}</span>
                <span v-if="current?.model === r.model" class="tick">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 5 5L19 7" /></svg>
                </span>
              </button>
            </section>

            <button class="manage" type="button" @click="goSettings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L20 8l-4-4L4 16z" /></svg>
              管理模型服务
            </button>
          </template>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.mp { display: flex; align-items: center; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  max-width: 190px; height: 32px; padding: 0 10px;
  border: 1px solid var(--line); border-radius: var(--r-full);
  background: var(--surface-2); color: var(--text-2);
  font: inherit; font-size: calc(12px * var(--font-scale)); cursor: pointer;
  transition: border-color var(--dur-2), background var(--dur-2);
}
.chip:hover { border-color: var(--line-strong); background: var(--surface); }
.chip.open { border-color: var(--line-strong); background: var(--surface); color: var(--text); }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); flex: 0 0 6px; }
.dot.off { background: var(--text-3); }
.chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 108px; }
.tier { font-size: calc(10px * var(--font-scale)); color: var(--text-3); padding: 1px 5px; border-radius: var(--r-full); background: var(--surface-3); }

.scrim {
  position: fixed; inset: 0; z-index: 90;
  background: var(--scrim);
  display: flex; align-items: flex-start; justify-content: center;
  padding: calc(var(--nav-h) + var(--safe-top, env(safe-area-inset-top, 0px)) + 8px) 12px 12px;
}
.sheet {
  width: min(420px, 100%);
  max-height: 70vh; overflow-y: auto;
  background: var(--bg);
  border-radius: var(--r-4);
  box-shadow: var(--shadow-3);
  padding: 16px;
}
.sheet-head { display: flex; align-items: center; padding: 2px 4px 8px; }
.sheet-head b { font-size: calc(15px * var(--font-scale)); flex: 1; }
.x { width: 30px; height: 30px; border: none; background: transparent; color: var(--text-3); font-size: calc(20px * var(--font-scale)); border-radius: 50%; cursor: pointer; }
.x:hover { background: var(--surface-2); }
.hint { margin: 0 4px 12px; font-size: calc(11.5px * var(--font-scale)); line-height: 1.7; color: var(--text-3); }

.think-row {
  display: flex; align-items: center; gap: 10px;
  margin: 0 4px 12px; padding: 10px 12px;
  border-radius: var(--r-2); background: var(--surface);
  cursor: pointer;
}
.think-row.off { opacity: 0.55; cursor: default; }
.tr-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.tr-text b { font-size: calc(12.5px * var(--font-scale)); font-weight: var(--fw-medium); }
.tr-text span { font-size: calc(11px * var(--font-scale)); color: var(--text-3); }
.think-row input { width: 17px; height: 17px; accent-color: var(--primary); flex: 0 0 17px; }

.group + .group { margin-top: 14px; }
.group-head { display: flex; align-items: baseline; gap: 8px; padding: 0 6px 6px; }
.group-head b { font-size: calc(12.5px * var(--font-scale)); }
.group-head span { font-size: calc(11px * var(--font-scale)); color: var(--text-3); }

.row {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 11px 12px; margin-bottom: 4px;
  border: none; border-radius: var(--r-2);
  background: var(--surface); color: var(--text);
  text-align: left; font: inherit; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out);
}
.row:hover { background: var(--surface-2); }
.row.on { background: var(--surface-2); }
.row-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.row-name { font-size: calc(13.5px * var(--font-scale)); font-weight: var(--fw-medium); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-sub { font-size: calc(10.5px * var(--font-scale)); color: var(--text-3); }
.row-price { font-size: calc(11px * var(--font-scale)); color: var(--text-3); font-variant-numeric: tabular-nums; }
.tick { color: var(--primary); display: inline-flex; animation: pop-in 380ms var(--spring-under) both; }

.manage {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; margin-top: 10px; padding: 12px;
  border: none; border-top: 1px solid var(--line); background: transparent;
  color: var(--text-2); font: inherit; font-size: calc(12px * var(--font-scale)); cursor: pointer;
}
.empty { padding: 18px 6px; display: flex; flex-direction: column; gap: 12px; }
.empty p { margin: 0; font-size: calc(12.5px * var(--font-scale)); line-height: 1.7; color: var(--text-2); }

.drop-enter-active { transition: opacity var(--dur-2) var(--ease-out); }
.drop-leave-active { transition: opacity var(--dur-2) var(--ease-in); }
.drop-enter-from, .drop-leave-to { opacity: 0; }
.drop-enter-active .sheet { animation: drop var(--dur-3) var(--spring-over) both; }
@keyframes drop { from { opacity: 0; transform: translateY(-8px) scale(0.98); } to { opacity: 1; transform: none; } }

@media (max-width: 860px) {
  .scrim { align-items: flex-end; padding: 0; }
  .sheet {
    width: 100%; max-height: 72dvh;
    border-radius: var(--r-4) var(--r-4) 0 0;
    padding-bottom: calc(16px + var(--safe-bottom, env(safe-area-inset-bottom, 0px)));
    animation: sheet-up var(--dur-4) var(--spring-over) both;
  }
  @keyframes sheet-up { from { transform: translateY(100%); } to { transform: none; } }
}
</style>
