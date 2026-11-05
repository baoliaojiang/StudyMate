<script setup lang="ts">
/** 发现：从这里起步。选题方向只是示例，不伪造“热门数据” */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { REPORT_KIND_LABEL } from '../core/types';
import { TEMPLATES } from '../reports/templates';

const router = useRouter();
const topic = ref('');

const directions = [
  { t: '校园周边食品安全认知', d: '问卷 + 访谈，能拿到一手数据，样本也容易找。' },
  { t: '教室照明与用眼习惯', d: '可测量、可对比，注意需要学校许可才能进班测量。' },
  { t: '中学生短视频使用与睡眠', d: '问卷为主，涉及隐私，必须匿名并征得同意。' },
  { t: '本地非遗手艺的传承现状', d: '访谈为主，适合文献 + 实地结合。' },
  { t: '校园垃圾分类执行情况', d: '观察法 + 计数，数据直观，但要连续多天记录。' },
  { t: '同城公共交通换乘体验', d: '体验式观察，注意安全与出行成本。' },
];

const reports = Object.values(TEMPLATES).map((t) => ({
  key: t.kind,
  name: REPORT_KIND_LABEL[t.kind] ?? t.name,
  full: t.name,
  count: t.sections.length,
  sections: t.sections.slice(0, 4).map((s) => s.heading),
}));

function start() {
  const v = topic.value.trim();
  if (v) sessionStorage.setItem('studymate:draft-topic', v);
  router.push('/new');
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1>发现</h1>
      <p>不确定做什么？从一个具体、身边能观察到的问题开始。</p>
    </header>

    <section class="start-card">
      <label class="start-label" for="d-topic">你大概想研究什么</label>
      <div class="start-row">
        <input id="d-topic" v-model="topic" class="input" placeholder="例如：校园周边早餐摊的食品安全认知" @keyup.enter="start" />
        <button class="btn btn-primary" type="button" @click="start">开始立项</button>
      </div>
      <p class="start-note">只写一个方向也行，下一步会让你补教师要求与成员。</p>
    </section>

    <section class="block">
      <div class="block-head">
        <h2>四份报告长什么样</h2>
        <span class="muted small">通用模板 · 非学校官方格式</span>
      </div>
      <div class="rpt-grid">
        <article v-for="r in reports" :key="r.key" class="rpt card">
          <div class="rpt-name">{{ r.name }}</div>
          <div class="rpt-sub">{{ r.full }} · {{ r.count }} 节</div>
          <ul>
            <li v-for="s in r.sections" :key="s">{{ s }}</li>
          </ul>
        </article>
      </div>
      <p class="tip">学校有自己的表格时，可以在项目里导入模板后套用，不必照抄这里的结构。</p>
    </section>

    <section class="block">
      <div class="block-head">
        <h2>选题方向示例</h2>
        <span class="muted small">示例，不是排行榜</span>
      </div>
      <div class="dir-grid">
        <button v-for="d in directions" :key="d.t" class="dir" type="button" @click="topic = d.t">
          <b>{{ d.t }}</b>
          <span>{{ d.d }}</span>
        </button>
      </div>
      <p class="tip">点一下会填进上面的输入框。可行性要看你自己能不能真的拿到数据。</p>
    </section>

    <section class="block">
      <div class="block-head"><h2>三个常见的坑</h2></div>
      <ol class="pit">
        <li><b>题目太大</b><span>「中学生心理健康」写不完；缩到「本校高一学生的睡眠时长与作业量」才做得动。</span></li>
        <li><b>只有观点没有材料</b><span>报告里的每个结论都要有问卷、访谈或观察记录支撑，否则只能写成推测。</span></li>
        <li><b>让 AI 编数据</b><span>模拟内容会在界面与导出文件里明确标注，不能当作真实结果提交。</span></li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.page { max-width: 880px; margin: 0 auto; padding: 20px 20px 72px; }
.head h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
.head p { margin: 6px 0 22px; font-size: 13px; color: var(--text-3); }

.start-card {
  padding: 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-3);
}
.start-label { display: block; font-size: 12px; color: var(--text-3); margin-bottom: 8px; }
.start-row { display: flex; gap: 8px; }
.start-row .input { flex: 1; }
.start-note { margin: 10px 0 0; font-size: 11.5px; color: var(--text-3); }

.block { margin-top: 30px; }
.block-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.block-head h2 { margin: 0; font-size: 16px; font-weight: var(--fw-strong); }

.rpt-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.rpt { padding: 14px; }
.rpt-name { font-size: 14px; font-weight: var(--fw-strong); }
.rpt-sub { margin-top: 3px; font-size: 11px; color: var(--text-3); }
.rpt ul { margin: 10px 0 0; padding-left: 16px; display: flex; flex-direction: column; gap: 4px; }
.rpt li { font-size: 11.5px; color: var(--text-2); line-height: 1.5; }

.dir-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.dir {
  display: flex; flex-direction: column; gap: 4px;
  padding: 14px; text-align: left; font: inherit;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-2);
  color: var(--text); cursor: pointer;
  transition: border-color var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.dir:hover { border-color: var(--primary); }
.dir:active { transform: scale(0.995); }
.dir b { font-size: 13.5px; font-weight: var(--fw-strong); }
.dir span { font-size: 12px; color: var(--text-3); line-height: 1.6; }

.pit { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 10px; }
.pit li { font-size: 13px; line-height: 1.7; }
.pit b { display: block; font-weight: var(--fw-strong); }
.pit span { color: var(--text-2); }

.tip { margin: 10px 2px 0; font-size: 11.5px; color: var(--text-3); }

@media (max-width: 860px) {
  .page { padding: 12px 16px 60px; }
  .head h1 { font-size: 24px; }
  .rpt-grid { grid-template-columns: 1fr 1fr; }
  .dir-grid { grid-template-columns: 1fr; }
  .start-row { flex-direction: column; }
}
</style>
