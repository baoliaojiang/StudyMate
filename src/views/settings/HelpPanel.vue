<script setup lang="ts">
/** 帮助中心 / 反馈 / 关于 / 检查更新 */
import { computed, ref } from 'vue';
import { useCopyFeedback } from '../../core/copy';
import { useRouter } from 'vue-router';
import { backOr } from '../../core/nav';
import { useAppStore } from '../../stores/app';
import { AI_NOTICE_TEXT, DISCLAIMER_TEXT, SIMULATED_TEXT } from '../../core/settings';
import { TEMPLATE_NOTE } from '../../core/settings';
import { SITE, externalLinks } from '../../config/site';
import { openExternal } from '../../core/shell';
import { resolveUpdateSource, hostOf } from '../../core/update-mirror';
import SettingGroup from '../../components/settings/SettingGroup.vue';
import SettingRow from '../../components/settings/SettingRow.vue';
import SubPage from '../../components/settings/SubPage.vue';
import AppIcon from '../../components/settings/AppIcon.vue';

const props = defineProps<{ kind: 'help' | 'feedback' | 'about' | 'update' }>();
const app = useAppStore();
const router = useRouter();

/** 返回上一级：有历史原路返回，没有则回设置首页 */
function back() {
  backOr(router, '/settings');
}

const VERSION = SITE.version;
/** 未成年人模式且隐藏外链时，关于页的外链一条都不列 */
const links = computed(() => {
  const minor = app.settings.minor;
  return minor.enabled && minor.hideExternal ? [] : externalLinks();
});
function openLink(url: string) {
  openExternal(url);
}

/* 彩蛋：关于页里连点版本号 7 下 */
const versionTaps = ref(0);
const eggOpen = ref(false);
let versionTapTimer: number | undefined;
function tapVersion() {
  versionTaps.value += 1;
  if (versionTapTimer) window.clearTimeout(versionTapTimer);
  versionTapTimer = window.setTimeout(() => (versionTaps.value = 0), 1600);
  if (versionTaps.value >= 7) {
    versionTaps.value = 0;
    eggOpen.value = true;
    eggStage.value = 'intro';
    eggIndex.value = 0;
    eggScore.value = 0;
    eggPick.value = null;
  }
}
function closeEgg() {
  eggOpen.value = false;
}

/**
 * 彩蛋小游戏：「研究小白闯关」
 *
 * 名字取自应用名「研学帮」——帮学生过几道最基本的研究常识题。
 * 答错不惩罚，只把正确做法说出来；全对给一句彩蛋结语。
 */
interface EggQ {
  q: string;
  a: boolean;
  tip: string;
}
const EGG_QUIZ: EggQ[] = [
  { q: '没做过的调查，可以写成「已完成」吗？', a: false, tip: '没做就写「尚未开展」，这是底线。' },
  { q: '引用文献必须能追溯到真实来源。', a: true, tip: '编造作者和 DOI 属于学术不端。' },
  { q: '「指导教师意见」可以让 AI 代写。', a: false, tip: '这一栏只能老师本人写、本人签。' },
  { q: 'AI 生成的模拟数据需要标注来源是模拟。', a: true, tip: '标识不能手动去掉。' },
  { q: '百分比只要写出来就行，不必给分母。', a: false, tip: '说 60% 就要写清 15/25 人。' },
];
const eggStage = ref<'intro' | 'play' | 'done'>('intro');
const eggIndex = ref(0);
const eggScore = ref(0);
const eggPick = ref<boolean | null>(null);

function eggStart() {
  eggStage.value = 'play';
  eggIndex.value = 0;
  eggScore.value = 0;
  eggPick.value = null;
}

function eggAnswer(v: boolean) {
  if (eggPick.value !== null) return;
  eggPick.value = v;
  const cur = EGG_QUIZ[eggIndex.value];
  if (v === cur.a) eggScore.value += 1;
}

function eggNext() {
  if (eggIndex.value + 1 >= EGG_QUIZ.length) {
    eggStage.value = 'done';
    return;
  }
  eggIndex.value += 1;
  eggPick.value = null;
}

const eggCur = computed(() => EGG_QUIZ[eggIndex.value]);

const titles = { help: '帮助中心', feedback: '反馈问题', about: '关于研学帮', update: '检查更新' } as const;

const steps = [
  { t: '1 · 立项', d: '填研究主题与教师要求，生成开题报告。教师姓名必须自己填，软件不会替你猜。' },
  { t: '2 · 过程', d: '每次活动后写一篇研究记录：活动名称、时间、参与成员、材料、结果。有多少写多少。' },
  { t: '3 · 中期', d: '用已经写下的记录汇总进展与问题。没记录的部分会标「待补充」，不会替你编。' },
  { t: '4 · 结题', d: '汇总过程、结果、结论、局限与反思，导出 DOCX 后与指导教师核对。' },
];

interface FaqItem {
  q: string;
  a: string;
}
interface FaqGroup {
  group: string;
  items: FaqItem[];
}

const faqGroups: FaqGroup[] = [
  {
    group: '开始使用',
    items: [
      {
        q: '第一次用，从哪一步开始？',
        a: '首页新建项目 → 填课题、学校、成员与教师要求 → 立项。开题报告生成后，再按活动逐篇写研究记录。报告里的章节会跟着记录走，没有记录就没有内容。',
      },
      {
        q: '教师姓名为什么不能自动填？',
        a: '指导教师是真实信息，写错会直接印在交给学校的表格上。软件不猜人名、不默认填「某老师」，留给你自己写。',
      },
      {
        q: '一个项目最多写多少篇研究记录？',
        a: '没有硬上限，但立项时会按周期给一个建议篇数。结题报告的过程部分直接取自这些记录，篇数太少会显得单薄，写作前检查里会提示。',
      },
      {
        q: '研究记录里可以写模拟或文献内容吗？',
        a: '可以，但要标清来源类型。模拟内容不会被当成真实开展的活动；未勾选「真实开展」的记录，不能作为已完成工作的证据。',
      },
      {
        q: '换手机或换电脑，项目还在吗？',
        a: '不在了。数据只在这台设备上，换设备前请先在 设置 → 数据与备份 导出加密备份，再在新设备用同一口令恢复。',
      },
    ],
  },
  {
    group: '报告与内容',
    items: [
      {
        q: '为什么有些章节写着「待补充」？',
        a: '因为对应的真实材料还没提供。默认情况下，缺少事实时软件只提问或留空，不会编造数据、访谈或实验结果。若你更需要先把篇幅撑起来，可在 设置 → 个性化 → 缺材料时 切换为「写满再核对」：AI 会尽量写满，推断处标「需核实」，具体数字与日期仍留横线，正文末尾附免责声明。提交前必须逐条核对。',
      },
      {
        q: '「写满再核对」生成的内容能直接交吗？',
        a: '不能。这个模式只是把篇幅补齐，方便你先有骨架再改。凡标注「需核实」或留横线的地方，都是软件不确定的部分，必须换成你们真实的材料与数据，否则属于编造。',
      },
      {
        q: '导出的文档是学校官方格式吗？',
        a: '是。内置模板按鼓山中学下发的四份表格（开题报告、研究记录表、中期报告、结题报告）逐行还原：章节名称、表格栏目、签名栏、一级到四级的编号方式都照原表，不改顺序、不并栏。开题与中期用下发表格，结题另附封面与目录可选。非鼓山中学的同学，可在报告页导入本校模板后套用；提交前请指导教师核对一遍，各校表格偶有微调。',
      },
      {
        q: '章节标题可以自己改吗？',
        a: '可以改名、增删，但学校表格的固定栏目（如「指导教师意见」）不建议动。改了标题之后，导出时按你改后的名称排版。',
      },
      {
        q: '「指导教师意见」为什么是空的？',
        a: '这一栏由教师手写签名，软件不代写、不伪造。打印后交教师签署。',
      },
      {
        q: '字数写不够怎么办？',
        a: '先看写作前检查里的缺口，把记录、成果、数据补上再重新生成。仍然不足时，把该节已有的真实内容扩写，而不是让 AI 堆形容词。',
      },
      {
        q: 'AI 生成的内容算我写的吗？',
        a: '算你组织的，但事实要你负责。生成结果只是草稿：数据、结论、引用必须自己核对，模拟内容要保留「AI 模拟示例」标识。',
      },
      {
        q: '参考文献必须是真的吗？',
        a: '必须。软件不会编造作者、年份、DOI 或链接；没有来源就不写参考文献。检索到的条目会标「待核实」，需要你打开原文确认后再引用。',
      },
    ],
  },
  {
    group: '模型与 API',
    items: [
      {
        q: '为什么必须自己配 API？',
        a: '软件没有云端中转，也没有内置额度。AI 功能走你自己的模型账号：请求从这台设备直接发到你填的服务商，费用与配额都记在你名下。不配也能用，只是没有 AI 起草。',
      },
      {
        q: '支持哪些服务商？',
        a: '内置 30 个预设，分四类：通用协议（OpenAI Compatible、OpenAI Responses、Anthropic、Gemini）、国内厂商（DeepSeek、Kimi、智谱、MiniMax、小米、LongCat 等）、聚合网关（OpenRouter、302.AI、SiliconFlow、PPIO、ModelScope 等）、本地运行（Ollama、LM Studio、vLLM）。都不合适就选「自定义」，手填 Base URL 与协议。',
      },
      {
        q: 'API Key 存在哪里？会被上传吗？',
        a: 'Key 用 WebCrypto 的 AES-GCM 加密后存在本机 IndexedDB，列表中只显示掩码。它不会进入报告、日志、导出的 DOCX，也不会随备份以外的方式离开设备。导出备份时 Key 单独加密，需要口令才能还原。',
      },
      {
        q: '在网页版里填 Key 安全吗？',
        a: '不如本地安装版稳妥。浏览器环境无法阻止扩展或页面脚本读取本地存储，建议只在本地安装版填写 Key；网页版可用于试用与排版。',
      },
      {
        q: '模型列表里有名字，为什么用不了？',
        a: '模型列表只说明服务商提供了这个名称，不代表你的账号有权限，也不代表协议对得上。每个模型要在「测试」里实际发一次请求，通过后才会标记为可用。列表 ≠ 可用。',
      },
      {
        q: '测试一直失败怎么排查？',
        a: '按三步看：① Base URL 是否多了或少了 /v1（多数服务商要求以 /v1 结尾，Anthropic 原生不要）；② 协议选得对不对（Responses 与 Chat Completions 不是同一个接口）；③ Key 是否有该模型权限、账户是否欠费。报错原文会显示在测试结果里，不会吞掉。',
      },
      {
        q: 'Responses、Compatible、原生协议有什么区别？',
        a: '同一家服务商可能同时提供多种接口。OpenAI Responses 走 /responses，支持内置工具；Compatible 走 /chat/completions，兼容性最好；Anthropic 原生走 /v1/messages，Gemini 原生走 generateContent。选错协议通常表现为 404 或参数校验失败。',
      },
      {
        q: '能用国内网络直连吗？',
        a: '取决于服务商。国内厂商与聚合网关一般可直连；OpenAI、Anthropic、Google 官方接口在部分网络下需要自备代理，软件不内置代理，也不提供绕过方案。',
      },
      {
        q: '怎么让不同任务用不同模型？',
        a: '在 API 管理中心 → 按 Agent 指定模型：报告起草用强模型，摘要、打标签用便宜模型。也可以打开自动分配，由软件按任务复杂度选档位。',
      },
      {
        q: '怎么控制花费？',
        a: '每日预算与每日调用次数上限都在设置首页。规则优先、结果缓存、重复内容复用、上下文压缩都会先跑，命中就不调用模型。超出预算时默认暂停并询问，不会静默扣费。',
      },
      {
        q: '费用数字准吗？',
        a: '是估算。按你填的单价与 Token 数计算，不含服务商的阶梯价、缓存折扣与汇率波动。以服务商账单为准。',
      },
      {
        q: '本地模型怎么接？',
        a: 'Ollama 默认 http://127.0.0.1:11434/v1，LM Studio 默认 http://127.0.0.1:1234/v1，vLLM 按启动参数。协议选 OpenAI Compatible，Key 可留空。本地模型标记为 Beta，长文质量与稳定性取决于你的显存与量化等级。',
      },
      {
        q: '免费额度能一直用吗？',
        a: '不能承诺。各家免费额度、限流与条款随时会变，指引中心里的额度与「最后核实日期」只代表当时查到的官方说法，以服务商页面为准。',
      },
    ],
  },
  {
    group: '检索与来源',
    items: [
      {
        q: '不配搜索 Key 能检索吗？',
        a: '能。OpenAlex、Crossref、arXiv、Semantic Scholar 是公开接口，默认开启，不需要 Key。通用网页搜索（Tavily、Brave、Serper、博查等）需要各自申请 Key。',
      },
      {
        q: '多个检索服务是怎么合并的？',
        a: '按优先级依次发起，各自限流；结果轮转合并后去重（DOI 优先，其次 URL，最后规范化标题）。同一个 DOI 只保留一条，来源标注 via 哪个服务。',
      },
      {
        q: '为什么会提示「请求过于频繁」？',
        a: '公开学术接口有速率限制，软件已按各服务的限制做节流。短时间反复检索仍可能被临时拒绝，等一会儿再试，或降低并发服务数量。',
      },
      {
        q: '搜到的文献可以直接引用吗？',
        a: '不能。检索结果只是线索，不是事实证明。点开原文确认作者、年份、结论后再引用；无法核验的标「待核实」，不要写进参考文献。',
      },
      {
        q: 'DOI 校验是干什么的？',
        a: '检查格式与能否解析到对应条目。格式不对会直接标红；能解析但信息不一致时，以出版方页面为准。',
      },
      {
        q: '抓取网页正文为什么失败？',
        a: '多数站点不允许跨域读取，浏览器会拦截。软件会如实报错并保留标题与摘要，不会把失败伪装成成功。需要全文时请自行打开页面复制。',
      },
      {
        q: '可以检索本地文件吗？',
        a: '可以。检索服务 → 本地文件，导入 txt、md、csv、log（单文件 2MB 以内），在本机做全文匹配，不上传。PDF 与 DOCX 请先转成文本。',
      },
      {
        q: '资料里的「关联报告段落」有什么用？',
        a: '把来源挂到具体章节上。生成该章节时，这些来源会作为已知事实一起送进提示词，避免引用与段落对不上。',
      },
    ],
  },
  {
    group: '数据与隐私',
    items: [
      {
        q: '数据会上传吗？',
        a: '项目、报告、记录都存在本机 IndexedDB。只有你点击 AI 生成时，相关文本才会发送到你配置的模型服务商；使用检索服务时，查询词会发到对应服务。没有第三方统计与埋点。',
      },
      {
        q: '怎么备份、怎么恢复？',
        a: '设置 → 数据与备份 → 导出全部数据，用口令加密成一个文件；新设备上用同一口令恢复。口令丢了就打不开，软件也没有后门。',
      },
      {
        q: '清档后能找回吗？',
        a: '不能。没有云端副本，也没有回收站。清档前先导出备份。',
      },
      {
        q: '可以只导出某一份报告吗？',
        a: '可以。报告页支持导出 DOCX 与 Markdown，只含这一份报告，不含其他项目数据与 Key。',
      },
      {
        q: '未成年人模式做了什么？',
        a: '隐藏外链与支持入口，限制部分生成行为，界面上去掉可能诱导消费的文案。它不代替监护，也不能识别使用者年龄。',
      },
      {
        q: '卸载应用数据还在吗？',
        a: '浏览器数据被清除或应用被卸载时，IndexedDB 会一起消失。重要项目请定期导出备份。',
      },
    ],
  },
  {
    group: '界面与其他',
    items: [
      {
        q: '语音播报为什么有时是灰的？',
        a: '软件只朗读自然音色（Neural / Natural / Enhanced / 在线神经语音）。本机没有这类音色时功能保持关闭，不朗读机械音。可在系统里安装语音包，或在 Edge 浏览器使用在线神经语音（如 Microsoft Xiaoxiao、Yunxi）。',
      },
      {
        q: '界面动效可以关掉吗？',
        a: '可以。设置首页 → 外观 → 界面动效。关闭后所有过渡瞬时完成，系统开启「减少动态效果」时也会自动降级。',
      },
      {
        q: '开发者选项在哪？',
        a: '设置 → 其他设置 → 开发者选项。默认关闭，打开后才会出现开发者面板（Agent、Skills、执行日志），普通使用不需要。',
      },
      {
        q: '怎么重新看一遍引导？',
        a: '设置 → 其他设置 → 重新引导。只回看流程，不清空项目、记录或已保存的配置。',
      },
      {
        q: '检查更新为什么总说已是最新？',
        a: '还没配置更新源时，软件只核对本地版本号，不编造新版本，也不会下载任何东西。配置仓库地址后才会去读取发布信息。',
      },
      {
        q: '反馈提到哪里？',
        a: '本软件没有服务器接收反馈。在 设置 → 帮助 → 反馈问题 写完后复制到剪贴板，自行发到仓库 Issue 或其他渠道。',
      },
      {
        q: '这个软件和学校是什么关系？',
        a: '个人开发的第三方工具，与学校及其管理部门无隶属、授权、合作或背书关系。表格模板参照学校下发的样式，不代表学校认可本软件。',
      },
    ],
  },
];

const faqQuery = ref('');
const faqFiltered = computed(() => {
  const q = faqQuery.value.trim().toLowerCase();
  if (!q) return faqGroups;
  return faqGroups
    .map((g) => ({
      group: g.group,
      items: g.items.filter((f) => `${f.q}${f.a}`.toLowerCase().includes(q)),
    }))
    .filter((g) => g.items.length);
});
const faqTotal = computed(() => faqGroups.reduce((n, g) => n + g.items.length, 0));

const openFaq = ref<string | null>(faqGroups[0]?.items[0]?.q ?? null);
const feedbackText = ref('');
const updateState = ref<'idle' | 'checking' | 'none'>('idle');

const update = computed(() => app.settings.update);

/** 检查更新后探测到的可用源地址（含协议），未探测或都连不上为 null */
const reachedSource = ref<string | null>(null);

async function checkUpdate() {
  updateState.value = 'checking';
  reachedSource.value = null;
  // 没有配置任何更新源时，如实说明，不去连不存在的地址
  if (!update.value.mirrors.length && !update.value.githubRepo) {
    updateState.value = 'none';
    app.toast('还没有可用的更新源，先到「其他设置」里配置', 'warn', 4000);
    return;
  }
  const src = await resolveUpdateSource(update.value.mirrors, update.value.githubRepo);
  updateState.value = 'none';
  if (!src.url) {
    app.toast('暂时连不上更新源，请检查网络后重试', 'warn', 3600);
    return;
  }
  reachedSource.value = src.url;
  const where = src.via === 'mirror' ? '镜像站' : 'GitHub 官方';
  app.toast(`已找到可用更新源（${where}），可前往查看最新版本`, 'info', 3600);
}

const { copied: feedbackCopied, copy: copyText } = useCopyFeedback();

/** 反馈不走邮箱：统一进 QQ 群，公告与版本都在群里说 */
const QQ_GROUP = '1134731856';
async function copyGroup() {
  const ok = await copyText(QQ_GROUP);
  app.toast(ok ? `群号 ${QQ_GROUP} 已复制，去 QQ 搜索加入` : '复制失败，手动记一下：' + QQ_GROUP, ok ? 'ok' : 'warn', 3600);
}

async function sendFeedback() {
  const text = feedbackText.value.trim();
  if (!text) {
    app.toast('先写点内容', 'warn');
    return;
  }
  // 没有服务端接收反馈：复制到剪贴板，让用户自行粘贴到仓库 Issue
  const ok = await copyText(`[StudyMate ${VERSION}] ${text}`);
  if (ok) {
    feedbackText.value = '';
  } else {
    app.toast('复制失败，请手动选中文字复制', 'warn', 3500);
  }
}
</script>

<template>
  <SubPage :title="titles[props.kind]" @back="back">
    <!-- 帮助中心 -->
    <template v-if="props.kind === 'help'">
      <SettingGroup title="一个课题怎么走完">
        <div class="steps">
          <div v-for="s in steps" :key="s.t" class="step">
            <b>{{ s.t }}</b>
            <p>{{ s.d }}</p>
          </div>
        </div>
      </SettingGroup>

      <div class="faq-search">
        <input v-model="faqQuery" class="input" type="search" :placeholder="`搜索 ${faqTotal} 条常见问题，例如「API」「备份」「待补充」`" />
      </div>

      <SettingGroup v-for="g in faqFiltered" :key="g.group" :title="g.group">
        <div v-for="f in g.items" :key="f.q" class="faq">
          <button class="faq-q" type="button" :aria-expanded="openFaq === f.q" @click="openFaq = openFaq === f.q ? null : f.q">
            <span>{{ f.q }}</span>
            <i :class="{ open: openFaq === f.q }">＋</i>
          </button>
          <p v-if="openFaq === f.q" class="faq-a">{{ f.a }}</p>
        </div>
      </SettingGroup>
      <p v-if="!faqFiltered.length" class="note">没有匹配的问题。换个词试试，或直接看「模型与 API」与「报告与内容」两组。</p>
      <p class="note">{{ TEMPLATE_NOTE }}</p>
    </template>

    <!-- 反馈 -->
    <template v-else-if="props.kind === 'feedback'">
      <SettingGroup title="写下遇到的问题">
        <div class="fb">
          <textarea v-model="feedbackText" class="textarea" rows="6" maxlength="600" placeholder="发生了什么、在哪个页面、你期望的结果是什么。不要贴 API Key。" />
          <div class="fb-foot">
            <span class="muted small">{{ feedbackText.length }}/600</span>
            <button class="btn btn-sm btn-primary" type="button" @click="sendFeedback">
              <span class="copy-swap" :class="{ on: feedbackCopied }">
                <span class="copy-a">复制反馈内容</span>
                <span class="copy-b">已复制</span>
              </span>
            </button>
          </div>
        </div>
      </SettingGroup>
      <SettingGroup>
        <SettingRow
          label="提交到 GitHub Issue"
          :value="update.githubRepo ? hostOf(update.githubRepo) : '待补充'"
          :chevron="!!update.githubRepo"
          @click="update.githubRepo && openLink(update.githubRepo + '/issues')"
        />
        <SettingRow
          label="作者主页"
          :value="SITE.authorHome.replace(/^https?:\/\//, '')"
          chevron
          @click="openLink(SITE.authorHome)"
        />
        <SettingRow
          :label="`QQ 群：${QQ_GROUP}`"
          value="点此复制群号"
          chevron
          @click="copyGroup"
        />
      </SettingGroup>
      <p class="note">
        本软件暂不支持服务器云端接收反馈：把内容复制到剪贴板，发到 QQ 群（群号 {{ QQ_GROUP }}）里就行，别贴 API Key。
      </p>
    </template>

    <!-- 关于 -->
    <template v-else-if="props.kind === 'about'">
      <div class="about-head">
        <img src="/icon.svg" alt="" class="logo" />
        <div>
          <b>研学帮 StudyMate</b>
          <span class="ver-tap" role="button" tabindex="0" title="版本号也能点" @click="tapVersion" @keyup.enter="tapVersion">v{{ VERSION }} · MIT License</span>
        </div>
      </div>
      <SettingGroup title="声明">
        <div class="legal">
          <p>{{ DISCLAIMER_TEXT }}</p>
          <p>{{ AI_NOTICE_TEXT }}</p>
          <p>{{ SIMULATED_TEXT }}</p>
        </div>
      </SettingGroup>
      <SettingGroup title="外链（点击跳转系统浏览器）">
        <SettingRow
          v-for="l in links"
          :key="l.key"
          :label="l.label"
          :value="l.ok ? l.url.replace(/^https?:\/\//, '') : '待补充'"
          :chevron="l.ok"
          @click="l.ok && openLink(l.url)"
        />
        <SettingRow
          :label="`QQ 群：${QQ_GROUP}`"
          value="点此复制群号"
          chevron
          @click="copyGroup"
        />
        <SettingRow label="更新日志" value="版本记录" chevron @click="router.push('/settings/changelog')">
          <template #icon><AppIcon name="changelog" /></template>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="引导">
        <SettingRow
          label="重新引导"
          value="重看设置流程"
          chevron
          @click="router.push('/onboarding?replay=1')"
        >
          <template #icon><AppIcon name="restart" /></template>
        </SettingRow>
      </SettingGroup>
      <p class="note">重新引导只回看流程，不会清空项目、记录或已保存的配置。</p>
    </template>

    <!-- 检查更新 -->
    <template v-else>
      <div class="ver">
        <img src="/icon.svg" alt="" class="logo" />
        <b>StudyMate v{{ VERSION }}</b>
        <span>当前渠道：本地安装</span>
      </div>
      <SettingGroup>
        <SettingRow
          label="GitHub 仓库"
          :value="reachedSource ? hostOf(reachedSource) : (update.githubRepo ? hostOf(update.githubRepo) : '待补充（仓库尚未发布）')"
          :chevron="!!(reachedSource || update.githubRepo)"
          @click="(reachedSource || update.githubRepo) && openLink(reachedSource || update.githubRepo)"
        />
        <SettingRow
          label="作者主页"
          :value="SITE.authorHome.replace(/^https?:\/\//, '')"
          chevron
          @click="openLink(SITE.authorHome)"
        />
        <SettingRow
          label="夸克网盘（备用下载）"
          :value="update.quarkUrl ? update.quarkUrl.replace(/^https?:\/\//, '') : '即将上线'"
          :chevron="!!update.quarkUrl"
          @click="update.quarkUrl && openLink(update.quarkUrl)"
        />
      </SettingGroup>
      <button class="btn btn-primary btn-block" type="button" :disabled="updateState === 'checking'" @click="checkUpdate">
        {{ updateState === 'checking' ? '正在检查…' : '检查更新' }}
      </button>
      <p class="note">
        {{ updateState === 'checking' ? '正在依次探测镜像站可用性…' : '更新前会先探测哪个镜像可达，不会编造版本号，也不会下载任何东西。' }}
      </p>
    </template>

    <Teleport to="body">
      <Transition name="egg">
        <div v-if="eggOpen" class="egg-mask" @click.self="closeEgg">
          <div class="egg-card" role="dialog" aria-modal="true">
            <template v-if="eggStage === 'intro'">
              <div class="egg-emoji">🎓</div>
              <h2>彩蛋解锁</h2>
              <p>你竟然把版本号点了 7 下。</p>
              <p>既然来了，玩个小的吧：<b>研究小白闯关</b>，五道常识题，答错不扣分。</p>
              <button class="egg-btn" type="button" @click="eggStart">开始</button>
              <button class="egg-skip" type="button" @click="closeEgg">先不玩</button>
            </template>

            <template v-else-if="eggStage === 'play'">
              <div class="egg-progress">
                <span>{{ eggIndex + 1 }} / {{ EGG_QUIZ.length }}</span>
                <span>得分 {{ eggScore }}</span>
              </div>
              <h2 class="egg-q">{{ eggCur.q }}</h2>
              <div class="egg-actions">
                <button
                  class="egg-btn"
                  type="button"
                  :disabled="eggPick !== null"
                  :class="{ right: eggPick !== null && eggCur.a === false, wrong: eggPick !== null && eggCur.a === true }"
                  @click="eggAnswer(false)"
                >
                  不可以
                </button>
                <button
                  class="egg-btn"
                  type="button"
                  :disabled="eggPick !== null"
                  :class="{ right: eggPick !== null && eggCur.a === true, wrong: eggPick !== null && eggCur.a === false }"
                  @click="eggAnswer(true)"
                >
                  可以
                </button>
              </div>
              <p v-if="eggPick !== null" class="egg-tip">
                {{ eggPick === eggCur.a ? '答对了。' : '答错了。' }}{{ eggCur.tip }}
              </p>
              <button v-if="eggPick !== null" class="egg-btn" type="button" @click="eggNext">
                {{ eggIndex + 1 >= EGG_QUIZ.length ? '看结果' : '下一题' }}
              </button>
            </template>

            <template v-else>
              <div class="egg-emoji">{{ eggScore === EGG_QUIZ.length ? '🏅' : eggScore >= 3 ? '🎉' : '🌱' }}</div>
              <h2>{{ eggScore }} / {{ EGG_QUIZ.length }}</h2>
              <p v-if="eggScore === EGG_QUIZ.length">全对。你比大多数交上来的报告认真。</p>
              <p v-else-if="eggScore >= 3">不错了，把错的那两条记住就够用。</p>
              <p v-else>翻回去看看「条目与来源」那几条，都是保命的知识。</p>
              <p>研学帮是个人开发者利用课余时间一点一点写出来的：没有团队、没有融资、没有 KPI，只有一个念头——帮中学生把研究性学习做得更顺手一点。</p>
              <p class="egg-sign">—— 开发者</p>
              <button class="egg-btn" type="button" @click="closeEgg">知道了</button>
              <button class="egg-skip" type="button" @click="eggStart">再玩一次</button>
            </template>
          </div>
        </div>
      </Transition>
    </Teleport>
  </SubPage>
</template>

<style scoped>
.note { margin: 0 4px; font-size: 11.5px; line-height: 1.75; color: var(--text-3); }

.steps { padding: 8px 16px 14px; }
.step { padding: 12px 0; border-bottom: 1px solid var(--line); }
.step:last-child { border-bottom: none; }
.step b { font-size: 13.5px; font-weight: var(--fw-strong); }
.step p { margin: 5px 0 0; font-size: 12.5px; line-height: 1.7; color: var(--text-2); }

.faq-search { margin: 0 0 14px; }
.faq-search .input { width: 100%; }
.faq { border-bottom: 1px solid var(--line); }
.faq:last-child { border-bottom: none; }
.faq-q {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 13px 16px; border: none; background: transparent;
  color: var(--text); font: inherit; font-size: 13.5px; text-align: left; cursor: pointer;
}
.faq-q span { flex: 1; }
.faq-q i { font-style: normal; color: var(--text-3); transition: transform var(--dur-3) var(--ease-out); }
.faq-q i.open { transform: rotate(45deg); }
.faq-a {
  margin: 0; padding: 0 16px 14px;
  font-size: 12.5px; line-height: 1.75; color: var(--text-2);
  animation: rise var(--dur-3) var(--ease-out);
}
@keyframes rise { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

.fb { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.fb-foot { display: flex; align-items: center; justify-content: space-between; }
.textarea { width: 100%; }

.about-head { display: flex; align-items: center; gap: 14px; padding: 8px 4px 22px; }
.logo { width: 54px; height: 54px; border-radius: 14px; }
.about-head b { display: block; font-size: 17px; }
.about-head span { font-size: 11.5px; color: var(--text-3); }
.legal { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.legal p { margin: 0; font-size: 12px; line-height: 1.8; color: var(--text-2); }

.ver { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 6px 0 24px; }
.ver b { font-size: 16px; }
.ver span { font-size: 11.5px; color: var(--text-3); }

.ver-tap { cursor: pointer; user-select: none; }
.ver-tap:hover { color: var(--text-2); }

.egg-mask {
  position: fixed; inset: 0; z-index: 9999;
  display: grid; place-items: center; padding: 24px;
  background: rgba(8, 10, 16, 0.55);
}
.egg-card {
  width: 100%; max-width: 340px;
  background: var(--surface);
  border-radius: calc(var(--r-3) + 4px);
  padding: 26px 22px 18px; text-align: center;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.28);
}
.egg-emoji { font-size: 36px; line-height: 1; margin-bottom: 6px; }
.egg-card h2 { margin: 0 0 12px; font-size: 19px; font-weight: var(--fw-strong); }
.egg-card p { margin: 0 0 10px; font-size: 13px; line-height: 1.78; color: var(--text-2); text-align: left; }
.egg-sign { text-align: right; color: var(--text-3); margin-top: 4px; }
.egg-progress {
  display: flex; justify-content: space-between;
  font-size: 11.5px; color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.egg-q { font-size: 16px; line-height: 1.6; margin: 6px 0 4px; }
.egg-actions { display: flex; gap: 10px; }
.egg-actions .egg-btn { flex: 1; }
.egg-btn.right { border-color: var(--ok); color: var(--ok); }
.egg-btn.wrong { border-color: var(--danger); color: var(--danger); }
.egg-tip { margin: 0; font-size: 12px; color: var(--text-2); line-height: 1.7; }
.egg-skip {
  border: none; background: none; padding: 4px;
  font-size: 11.5px; color: var(--text-3); cursor: pointer;
}
.egg-skip:hover { color: var(--text-2); }

.egg-btn {
  margin-top: 12px; width: 100%;
  border: none; border-radius: var(--r-2);
  background: var(--primary); color: #fff;
  font-size: 14px; padding: 11px; cursor: pointer;
  transition: filter var(--dur-2) var(--ease-out);
}
.egg-btn:hover { filter: brightness(1.06); }
.egg-btn:active { filter: brightness(0.96); }

.egg-enter-active, .egg-leave-active { transition: opacity var(--dur-3) var(--ease-out); }
.egg-enter-from, .egg-leave-to { opacity: 0; }
.egg-enter-active .egg-card { animation: egg-pop var(--dur-3) var(--ease-out); }
@keyframes egg-pop { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
</style>
