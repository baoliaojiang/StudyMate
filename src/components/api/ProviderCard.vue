<script setup lang="ts">
/** 服务商卡片：状态一眼可见，主要动作都在这儿 */
import { computed } from 'vue';
import type { ProviderRow } from '../../core/db';
import type { TestReport } from '../../ai/manager';
import { supportOf } from '../../ai/catalog';
import ProviderLogo from './ProviderLogo.vue';

const props = defineProps<{
  row: ProviderRow;
  report?: TestReport | null;
  busy?: boolean;
  devMode?: boolean;
}>();
const emit = defineEmits<{
  test: [];
  refresh: [];
  edit: [];
  remove: [];
  'toggle-enabled': [];
  'set-default': [];
}>();

const support = computed(() => supportOf(props.row.kind));
const verifiedCount = computed(() => props.row.models.filter((m) => m.cap?.verified).length);
const keyState = computed(() =>
  props.row.apiKeyLen
    ? props.row.apiKeyPreview
    : props.row.kind === 'local'
      ? '未配置（本地服务）'
      : '未配置',
);
const lastTest = computed(() => props.row.lastTest);
</script>

<template>
  <article class="prov" :class="{ off: row.enabled === false }">
    <div class="prov-top">
      <ProviderLogo :label="row.label" :kind="row.kind" />
      <div class="grow">
        <div class="line1">
          <b>{{ row.label }}</b>
          <span class="tag">{{ support.label }}</span>
          <span v-if="row.beta" class="tag beta">Beta</span>
          <span v-if="row.isDefault" class="tag star">默认</span>
          <span v-if="row.enabled === false" class="tag off-tag">已停用</span>
        </div>
        <div class="mono url">{{ row.baseUrl }}</div>
        <div class="meta">
          <span>密钥：{{ keyState }}</span>
          <span class="dot" />
          <span>{{ row.models.length }} 个模型</span>
          <template v-if="verifiedCount">
            <span class="dot" />
            <span class="ok-text">{{ verifiedCount }} 个已校验</span>
          </template>
        </div>
      </div>
      <button
        class="icon-btn"
        type="button"
        :title="row.enabled === false ? '启用' : '停用'"
        @click="emit('toggle-enabled')"
      >
        <span class="switch" :class="{ on: row.enabled !== false }"><i /></span>
      </button>
    </div>

    <div class="actions">
      <button class="btn btn-sm" type="button" :disabled="busy" @click="emit('test')">
        {{ busy ? '测试中…' : '连接测试' }}
      </button>
      <button class="btn btn-sm" type="button" :disabled="busy || !row.supportsModelList" @click="emit('refresh')">
        同步模型
      </button>
      <button class="btn btn-sm" type="button" @click="emit('edit')">编辑</button>
      <button v-if="!row.isDefault" class="btn btn-sm" type="button" @click="emit('set-default')">设为默认</button>
      <button class="btn btn-sm btn-danger" type="button" @click="emit('remove')">删除</button>
    </div>

    <div v-if="report" class="report">
      <div v-for="s in report.stages" :key="s.stage" class="stage" :class="s.status">
        <span class="stage-name">{{ s.label }}</span>
        <span class="stage-msg">{{ s.message }}</span>
        <span class="stage-ms tnum">{{ s.ms ? s.ms.toFixed(0) + 'ms' : '' }}</span>
      </div>
    </div>

    <div v-else-if="lastTest" class="last">
      上次检查 {{ new Date(lastTest.at).toLocaleString('zh-CN', { hour12: false }) }} ·
      <span :class="lastTest.ok ? 'ok-text' : 'bad-text'">{{ lastTest.ok ? '通过' : '未通过' }}</span>
      <span v-if="!lastTest.ok"> · {{ lastTest.message }}</span>
    </div>

    <div v-if="devMode" class="scope">
      <div class="scope-label">适配器支持范围</div>
      <p>{{ support.scope }}</p>
    </div>
  </article>
</template>

<style scoped>
.prov {
  padding: 14px 15px; border-radius: var(--r-3);
  background: var(--surface-2);
  transition: background var(--dur-2) var(--ease-out);
}
.prov.off { opacity: 0.62; }
.prov-top { display: flex; align-items: flex-start; gap: 12px; }
.mark {
  width: 34px; height: 34px; flex: 0 0 34px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-3); color: var(--text-2);
  font-size: calc(14px * var(--font-scale)); font-weight: var(--fw-strong);
}
.line1 { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.line1 b { font-size: var(--fs-3); font-weight: var(--fw-strong); }
.tag {
  font-size: calc(10.5px * var(--font-scale)); padding: 2px 6px; border-radius: var(--r-full);
  background: var(--surface-3); color: var(--text-3);
}
.tag.beta { background: color-mix(in srgb, var(--primary) 12%, transparent); color: var(--primary); }
.tag.star { background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--primary); }
.tag.off-tag { background: var(--surface-3); color: var(--text-3); }
.url { font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); margin-top: 3px; word-break: break-all; }
.meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 5px; font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); }
.dot { width: 3px; height: 3px; border-radius: 50%; background: var(--text-3); opacity: 0.5; }
.ok-text { color: var(--primary); }
.bad-text { color: var(--danger, #c0392b); }

.icon-btn { border: none; background: transparent; padding: 4px; cursor: pointer; }
.switch {
  display: inline-block; width: 38px; height: 22px; border-radius: var(--r-full);
  background: var(--surface-3); position: relative;
  transition: background var(--dur-2) var(--ease-out);
}
.switch.on { background: var(--primary); }
.switch i {
  position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; transition: transform var(--dur-3) var(--ease-out);
}
.switch.on i { transform: translateX(16px); }

.actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.report { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.stage {
  display: grid; grid-template-columns: 34px 1fr auto; gap: 8px;
  padding: 7px 9px; border-radius: var(--r-2); background: var(--surface);
  font-size: calc(11.5px * var(--font-scale)); line-height: 1.55;
}
.stage-name { color: var(--text-3); }
.stage-msg { color: var(--text-2); word-break: break-word; }
.stage-ms { color: var(--text-3); }
.stage.ok .stage-name { color: var(--primary); }
.stage.fail { background: color-mix(in srgb, var(--danger, #c0392b) 8%, var(--surface)); }
.stage.fail .stage-name { color: var(--danger, #c0392b); }
.stage.skipped { opacity: 0.7; }
.last { margin-top: 10px; font-size: calc(11.5px * var(--font-scale)); color: var(--text-3); line-height: 1.6; }
.scope { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); }
.scope-label { font-size: calc(11px * var(--font-scale)); color: var(--text-3); margin-bottom: 4px; }
.scope p { margin: 0; font-size: calc(11.5px * var(--font-scale)); color: var(--text-2); line-height: 1.7; }
</style>
