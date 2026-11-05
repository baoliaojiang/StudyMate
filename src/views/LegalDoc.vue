<script setup lang="ts">
/**
 * 法务文本独立页
 *
 * 从设置里点「用户协议 / 隐私政策 / 开源许可」进这里看全文，
 * 不再跳回引导流程——引导是首次激活用的，不该被当成阅读器。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { backOr } from '../core/nav';
import { LEGAL_DOCS, legalDoc, type LegalDocId } from '../core/legal';

const route = useRoute();
const router = useRouter();

/** 直接打开链接时没有历史可退，回落到帮助中心 */
function goBack() {
  backOr(router, '/settings/help');
}

const DOC_IDS = LEGAL_DOCS.map((d) => d.id);
const fallback = LEGAL_DOCS[0];

const doc = computed(() => {
  const id = String(route.params.doc ?? '') as LegalDocId;
  return DOC_IDS.includes(id) ? legalDoc(id) : fallback;
});

const active = ref('');
const bodyEl = ref<HTMLElement | null>(null);

watch(
  () => route.params.doc,
  async () => {
    active.value = '';
    await nextTick();
    bodyEl.value?.scrollTo?.({ top: 0 });
    window.scrollTo({ top: 0 });
  },
);

function jump(i: number) {
  const el = document.getElementById(`sec-${i}`);
  if (!el) return;
  active.value = `sec-${i}`;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 段落里手写的换行要保留，空行分段 */
function paras(body: string): string[] {
  return body.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
}
</script>

<template>
  <div class="legal-page">
    <div class="bar">
      <button class="back" type="button" aria-label="返回" @click="goBack">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6" /></svg>
      </button>
      <div class="grow" />
      <span class="tag">v{{ doc.version }}</span>
    </div>

    <article ref="bodyEl" class="sheet">
      <header class="head">
        <h1>{{ doc.title }}</h1>
        <p class="summary">{{ doc.summary }}</p>
        <dl class="meta">
          <div><dt>版本</dt><dd class="tnum">v{{ doc.version }}</dd></div>
          <div><dt>更新日期</dt><dd class="tnum">{{ doc.updatedAt }}</dd></div>
          <div><dt>生效日期</dt><dd class="tnum">{{ doc.updatedAt }}</dd></div>
        </dl>
      </header>

      <nav v-if="doc.sections.length > 2" class="toc" aria-label="目录">
        <div class="toc-title">目录</div>
        <ol>
          <li v-for="(s, i) in doc.sections" :key="s.heading">
            <button type="button" :class="{ on: active === `sec-${i}` }" @click="jump(i)">
              {{ s.heading }}
            </button>
          </li>
        </ol>
      </nav>

      <section
        v-for="(s, i) in doc.sections"
        :id="`sec-${i}`"
        :key="s.heading"
        class="sec"
      >
        <h2>{{ s.heading }}</h2>
        <p v-for="(p, j) in paras(s.body)" :key="j" class="p">{{ p }}</p>

        <!-- 两列当表格，多列在窄屏折成卡片，避免横向溢出 -->
        <div v-if="s.table" class="tbl-wrap">
          <table v-if="s.table.head.length <= 2" class="tbl">
            <thead>
              <tr><th v-for="h in s.table.head" :key="h">{{ h }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(r, ri) in s.table.rows" :key="ri">
                <td v-for="(c, ci) in r" :key="ci" :class="{ key: ci === 0 }">{{ c }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="cards">
            <div v-for="(r, ri) in s.table.rows" :key="ri" class="row-card">
              <b>{{ r[0] }}</b>
              <dl>
                <div v-for="(c, ci) in r.slice(1)" :key="ci">
                  <dt>{{ s.table.head[ci + 1] }}</dt>
                  <dd>{{ c }}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </section>

      <footer class="foot">
        <p>本页内容与软件实际行为保持一致；功能调整时会同步修订并更新上方日期。</p>
        <div class="links">
          <button
            v-for="d in LEGAL_DOCS.filter((x) => x.id !== doc.id)"
            :key="d.id"
            type="button"
            class="link"
            @click="router.replace(`/legal/${d.id}`)"
          >
            {{ d.title }}
          </button>
          <button type="button" class="link" @click="router.push('/settings/help')">返回设置</button>
        </div>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.legal-page {
  max-width: 780px; margin: 0 auto;
  padding: 12px 20px calc(var(--safe-bottom, env(safe-area-inset-bottom, 0px)) + 56px);
}
.bar { display: flex; align-items: center; gap: 10px; height: 44px; }
.back {
  width: 34px; height: 34px; border: none; border-radius: 50%;
  background: var(--surface-2); color: var(--text);
  display: grid; place-items: center; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out);
}
.back:hover { background: var(--surface-3); }
.tag {
  font-size: 11px; color: var(--text-3);
  background: var(--surface-2); border-radius: var(--r-full);
  padding: 3px 9px; font-variant-numeric: tabular-nums;
}

.sheet { padding-top: 8px; }
.head h1 { font-size: 26px; line-height: 1.3; letter-spacing: -0.02em; margin: 0; }
.summary { margin: 8px 0 0; color: var(--text-2); font-size: var(--fs-2); line-height: 1.7; text-wrap: pretty; }
.meta {
  display: flex; flex-wrap: wrap; gap: 8px 22px;
  margin: 18px 0 0; padding: 12px 14px;
  background: var(--surface); border-radius: var(--r-3);
}
.meta div { display: flex; gap: 8px; align-items: baseline; }
.meta dt { font-size: 11.5px; color: var(--text-3); }
.meta dd { margin: 0; font-size: 12px; color: var(--text-2); }

.toc {
  margin-top: 5px; padding: 14px 16px;
  background: var(--surface); border-radius: var(--r-3);
}
.toc-title { font-size: 11.5px; color: var(--text-3); margin-bottom: 8px; }
.toc ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.toc button {
  border: none; background: none; padding: 4px 0; text-align: left;
  font-size: 12.5px; color: var(--text-2); cursor: pointer;
  transition: color var(--dur-1) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.toc button:hover { color: var(--text); transform: translateX(2px); }
.toc button.on { color: var(--primary); }

.sec { scroll-margin-top: 72px; padding: 26px 0 0; }
.sec h2 {
  font-size: 15px; margin: 0 0 10px;
  font-weight: var(--fw-strong); letter-spacing: -0.01em;
}
.p {
  margin: 0 0 12px; font-size: 13.5px; line-height: 1.95;
  color: var(--text-2); white-space: pre-wrap; text-wrap: pretty;
}
.foot {
  margin-top: 34px; padding-top: 16px;
  border-top: 1px solid var(--line);
  font-size: 11.5px; color: var(--text-3); line-height: 1.7;
}
.links { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; }
.link {
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 12px; color: var(--primary);
}
/* ---- 表格 ---- */
.tbl-wrap { margin: 0 0 14px; overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tbl th, .tbl td {
  padding: 8px 10px; text-align: left; vertical-align: top;
  border-bottom: 1px solid var(--line); line-height: 1.7; color: var(--text-2);
}
.tbl th { font-size: 11.5px; font-weight: var(--fw-medium); color: var(--text-3); background: var(--surface); }
.tbl td.key { color: var(--text); white-space: nowrap; }

.cards { display: grid; gap: 8px; }
.row-card { padding: 12px 14px; border-radius: var(--r-2); background: var(--surface); }
.row-card b { display: block; font-size: 13px; margin-bottom: 6px; color: var(--text); }
.row-card dl { margin: 0; display: grid; gap: 5px; }
.row-card dl > div { display: grid; grid-template-columns: 5.5em 1fr; gap: 8px; }
.row-card dt { font-size: 11.5px; color: var(--text-3); }
.row-card dd { margin: 0; font-size: 12.5px; color: var(--text-2); line-height: 1.7; }

@media (max-width: 600px) {
  .legal-page { padding: 4px 16px calc(var(--safe-bottom, env(safe-area-inset-bottom, 0px)) + 64px); }
  .head h1 { font-size: 22px; }
  .p { font-size: 13px; line-height: 1.9; }
}
</style>
