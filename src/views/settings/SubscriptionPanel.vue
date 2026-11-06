<script setup lang="ts">
/** 订阅：本软件没有付费墙，这里如实展示订阅状态与用量，不编造套餐。 */
import { onMounted, ref } from 'vue';
import { useCopyFeedback } from '../../core/copy';
import { useRouter } from 'vue-router';
import { backOr } from '../../core/nav';
import { SITE } from '../../config/site';
import { useAppStore } from '../../stores/app';
import { db } from '../../core/db';
import SettingGroup from '../../components/settings/SettingGroup.vue';
import SettingRow from '../../components/settings/SettingRow.vue';
import SubPage from '../../components/settings/SubPage.vue';

const app = useAppStore();
const router = useRouter();

/** 返回上一级：有历史原路返回，没有则回设置首页 */
function back() {
  backOr(router, '/settings');
}

const usage = ref({ calls: 0, failed: 0, cost: 0, tokens: 0, avgDuration: 0 });
const providers = ref(0);

onMounted(async () => {
  usage.value = await app.gateway.usageSummary();
  providers.value = await db.providers.count();
});

const { copied: versionCopied, copy: copyText } = useCopyFeedback();

async function copyVersion() {
  const ok = await copyText(`StudyMate ${SITE.version} · MIT`);
  if (!ok) app.toast('复制失败，可手动选中文字', 'warn');
}
</script>

<template>
  <SubPage title="订阅" subtitle="没有会员、没有额度限制、没有付费墙。所有功能本地可用，费用只来自你自己的模型 Key。" @back="back">
    <div class="plan">
      <div class="plan-top">
        <span class="tag">当前方案</span>
        <b>Free · 完整功能</b>
        <p>开源发布，MIT 许可。不存在「升级解锁导出」这类限制。</p>
      </div>
      <div class="plan-grid">
        <div><b>{{ usage.calls }}</b><span>今日 AI 调用</span></div>
        <div><b>¥{{ usage.cost.toFixed(3) }}</b><span>今日估算费用</span></div>
        <div><b>{{ providers }}</b><span>模型服务</span></div>
      </div>
    </div>

    <SettingGroup>
      <SettingRow label="我的订阅" value="Free" note="无需订阅" chevron @click="app.toast('当前就是完整版，没有需要购买的项目', 'info', 2600)" />
      <SettingRow label="额度与用量" value="查看" chevron @click="router.push('/settings/model')" />
      <SettingRow label="礼品卡与兑换" value="无兑换服务" note="本软件不发放兑换码，遇到售卖请警惕" />
    </SettingGroup>

    <SettingGroup title="支持作者">
      <SettingRow
        label="爱发电"
        :value="app.settings.update.afdianUrl || '尚未配置'"
        :note="app.settings.minor.hideExternal ? '未成年人模式下已隐藏外部链接' : '自愿支持，不影响任何功能'"
      />
    </SettingGroup>

    <button class="btn btn-sm" type="button" @click="copyVersion">
      <span class="copy-swap" :class="{ on: versionCopied }">
        <span class="copy-a">复制版本信息</span>
        <span class="copy-b">已复制</span>
      </span>
    </button>
  </SubPage>
</template>

<style scoped>
.plan {
  padding: 18px;
  margin-bottom: 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-3);
}
.plan-top { display: flex; flex-direction: column; gap: 6px; }
.tag {
  align-self: flex-start;
  font-size: calc(10.5px * var(--font-scale)); padding: 2px 8px; border-radius: var(--r-full);
  background: var(--primary-soft, rgba(31, 79, 216, 0.1)); color: var(--primary);
}
.plan-top b { font-size: calc(20px * var(--font-scale)); letter-spacing: -0.01em; }
.plan-top p { margin: 0; font-size: calc(12.5px * var(--font-scale)); line-height: 1.7; color: var(--text-2); }
.plan-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line);
}
.plan-grid div { display: flex; flex-direction: column; gap: 3px; }
.plan-grid b { font-size: calc(17px * var(--font-scale)); font-variant-numeric: tabular-nums; }
.plan-grid span { font-size: calc(11px * var(--font-scale)); color: var(--text-3); }
@media (max-width: 560px) { .plan-grid { grid-template-columns: 1fr; } }
</style>
