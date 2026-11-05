/**
 * 答辩演示稿的数据层
 *
 * 职责边界很清楚：
 * - 这里只做「整理项目里已有的事实」，不生成新事实。
 * - AI 返回的 JSON 一律过 normalizeSlides() 洗一遍：长度、条数、版式、
 *   模拟标识、数据集引用都在本地校验，模型写错了也不会带进导出文件。
 * - 没有模型、模型失败、模型返回一堆废话时，templateDeck() 也能给出
 *   一份能直接导出的骨架，缺的地方一律写「待补充」。
 */
import { uid } from '../core/id';
import type {
  Dataset,
  Deck,
  Project,
  Report,
  SlideItem,
  SlideLayout,
  Source,
  StudyRecord,
} from '../core/types';

export interface DeckFacts {
  project: Project;
  reports: Report[];
  records: StudyRecord[];
  datasets: Dataset[];
  sources: Source[];
}

export const LAYOUTS: SlideLayout[] = ['cover', 'section', 'points', 'two', 'data', 'end'];

export const LAYOUT_LABEL: Record<SlideLayout, string> = {
  cover: '封面',
  section: '章节页',
  points: '要点页',
  two: '对照页',
  data: '数据页',
  end: '结尾页',
};

export interface DeckIssue {
  page: number;
  level: 'high' | 'mid' | 'low';
  text: string;
}

const GAP = '待补充';

function chars(s: string): string[] {
  return Array.from(s);
}

function clip(s: string, max: number): string {
  const arr = chars(s);
  return arr.length > max ? `${arr.slice(0, max - 1).join('')}…` : s;
}

/**
 * 上屏文字清洗：去思考标签、去 Markdown 符号、去机械排比开头、压空白、限长。
 * 「（AI 模拟示例）」是真实性标识，必须保留。
 */
export function cleanSlideText(raw: unknown, max = 40): string {
  let s = String(raw ?? '');
  s = s.replace(/<\s*(think|thinking|thought|reasoning)\s*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  s = s.replace(/```[\s\S]*?```/g, '');
  s = s.replace(/^\s*(?:作为\s*AI|以下是|下面是|希望对你有帮助|综上所述|值得注意的是)\s*[:：,，]?\s*/i, '');
  s = s.replace(/^\s*(?:首先|其次|再次|最后|总之)[、，,:：]\s*/, '');
  s = s.replace(/[#*`>|]/g, '');
  s = s.replace(/^\s*[-–—•]\s*/gm, '');
  s = s.replace(/^\s*\d+[.、]\s*/gm, '');
  s = s.replace(/[\r\n\t]+/g, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (!s) return GAP;
  return clip(s, max);
}

/** 取正文第一句做摘要，模板页用，不改写、不补写 */
function firstSentence(body: string, max = 120): string {
  const flat = String(body ?? '')
    .replace(/[#*`>|]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!flat) return '';
  const m = flat.match(/^[^。！？.!?]{4,}[。！？!?]?/);
  return clip((m?.[0] ?? flat).trim(), max);
}

function excerpt(reports: Report[], kind: string, pattern: RegExp, max = 120): string {
  const report = reports.find((r) => r.kind === kind);
  const sec = report?.sections.find((s) => pattern.test(s.heading) && s.body.trim());
  return sec ? firstSentence(sec.body, max) : '';
}

function slide(layout: SlideLayout, title: string, extra: Partial<SlideItem> = {}): SlideItem {
  return {
    id: uid('sl'),
    layout,
    title: cleanSlideText(title, 24),
    bullets: [],
    ...extra,
  };
}

/** 项目里是否有已确认的真实研究记录 */
export function hasRealRecords(f: DeckFacts): boolean {
  return f.records.some((r) => r.confirmed && r.sourceType !== 'simulated' && (r.work || r.outputs || r.summary));
}

/**
 * 离线模板：不调用模型也能生成一份 10 页答辩稿。
 * 所有内容来自项目里已经写下的文字；没有的地方写「待补充」。
 */
export function templateDeck(f: DeckFacts): Deck {
  const p = f.project;
  const title = p.topic || '研究性学习课题';
  const members = p.members.map((m) => m.name).filter(Boolean);
  const confirmedRecords = f.records.filter((r) => r.confirmed);
  const data = f.datasets[0];
  const sim = p.pureAi || p.modes.includes('simulated');

  const slides: SlideItem[] = [
    slide('cover', title, {
      kicker: '研究性学习 · 结题答辩',
      lead: p.school ? `${p.school}　${p.grade} ${p.className}` : GAP,
      bullets: [p.groupName || GAP, `指导教师：${p.teacher || GAP}`, `成员：${members.join('、') || GAP}`],
      note: `大家好，我们小组汇报的题目是「${title}」。`,
      source: '项目基本信息',
    }),
    slide('points', '为什么选这个课题', {
      kicker: '01 · 问题的由来',
      lead: excerpt(f.reports, 'proposal', /背景|由来|目的|意义/) || GAP,
      bullets: [
        excerpt(f.reports, 'proposal', /背景|由来/) || GAP,
        excerpt(f.reports, 'proposal', /目的|意义/) || GAP,
        '课题边界与重点：待补充',
      ],
      note: '先说清楚这个题目是怎么来的，以及我们想弄明白什么。',
      source: '开题报告 · 背景与目的意义',
    }),
    slide('points', '我们想弄明白什么', {
      kicker: '01 · 研究目标',
      lead: excerpt(f.reports, 'proposal', /目标|问题|内容/) || GAP,
      bullets: [
        excerpt(f.reports, 'proposal', /目标|问题/) || GAP,
        excerpt(f.reports, 'proposal', /方法|步骤|计划/) || GAP,
        `项目周期：${p.startDate || GAP} 至 ${p.endDate || GAP}`,
      ],
      note: '这一页交代研究目标和大致的时间安排。',
      source: '开题报告 · 研究目标与活动计划',
    }),
    slide('section', '怎么做的', {
      kicker: '02',
      bullets: [],
      note: '接下来介绍方法和实际做过的事。',
      source: '开题报告 · 研究方法',
    }),
    slide('points', '方法与分工', {
      kicker: '02 · 研究设计',
      lead: excerpt(f.reports, 'proposal', /方法|步骤/) || GAP,
      bullets: [
        `成员：${members.join('、') || GAP}`,
        `组长：${p.members.find((m) => m.role === 'leader')?.name ?? GAP}`,
        `研究方式：${p.modes.length ? p.modes.join('、') : GAP}`,
      ],
      note: '用的是什么方法、谁负责哪一块，这一页说完。',
      source: '开题报告 · 成员与分工',
    }),
    slide('points', '过程记录到哪一步', {
      kicker: '03 · 研究过程',
      lead: `已确认记录 ${confirmedRecords.length} 篇，共安排 ${p.recordPlan.total} 篇`,
      bullets: [
        `上学期 ${p.recordPlan.firstTerm} 篇 / 下学期 ${p.recordPlan.secondTerm} 篇`,
        confirmedRecords[0]
          ? `最近一次：第 ${confirmedRecords[0].index} 篇 ${confirmedRecords[0].activityName || confirmedRecords[0].stageName || GAP}`
          : '具体活动记录：待补充',
        hasRealRecords(f) ? '过程材料已由本人确认' : '真实活动记录：待补充',
      ],
      note: '过程记录是按学期一篇篇积累的，这里只报已经确认的篇数。',
      source: '研究记录（上学期 / 下学期）',
    }),
    data
      ? slide('data', data.title || '已有数据', {
          kicker: '04 · 数据',
          lead: `${data.points.length} 组数据　单位：${data.unit || '未填写'}`,
          bullets: data.points.slice(0, 4).map((pt) => `${pt.label}：${pt.value}${data.unit ?? ''}`),
          datasetId: data.id,
          source: data.sourceNote || GAP,
          simulated: data.sourceType === 'simulated' || sim,
          note: '这张图只画项目里已经录入的数据，读完结论就翻页。',
        })
      : slide('points', '数据还在整理', {
          kicker: '04 · 数据',
          lead: '项目里还没有数据集',
          bullets: ['样本量：待补充', '数据来源：待补充', '图表：待补充'],
          note: '数据还没有录入，这里先说明进度，不放没有来源的图。',
          source: GAP,
        }),
    slide('points', '目前得到的结论', {
      kicker: '05 · 阶段发现',
      lead: excerpt(f.reports, 'final', /成果|结论|发现/) || excerpt(f.reports, 'midterm', /成果|进展|发现/) || GAP,
      bullets: [
        excerpt(f.reports, 'midterm', /进展|问题|成果/) || GAP,
        excerpt(f.reports, 'final', /成果|结论/) || GAP,
        '结论的依据：待补充',
      ],
      note: '只讲报告里已经写下来的发现，没做完的部分不提前下结论。',
      source: '中期报告 / 结题报告',
    }),
    slide('points', '局限与下一步', {
      kicker: '06 · 还没做完的事',
      lead: '这部分需要自己补，不替你写结论',
      bullets: ['样本与范围的限制：待补充', '还没验证的说法：待补充', '如果重做会改什么：待补充'],
      note: '如实说局限，比把结论说满更可信。',
      source: GAP,
    }),
    slide('end', '谢谢，请老师指正', {
      kicker: '答辩结束',
      lead: 'AI 生成内容需核实后使用',
      bullets: ['结论以报告正文为准', '模拟内容不得当作真实研究结果', '指导教师意见由教师本人填写'],
      note: '汇报到这里，请老师提问。',
      source: '声明',
    }),
  ];

  const now = Date.now();
  return {
    id: p.id,
    projectId: p.id,
    title: `${title} · 结题答辩`,
    slides,
    origin: 'template',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

/** 把模型返回的一页规整成可导出的 SlideItem */
export function normalizeSlides(raw: unknown, f: DeckFacts): SlideItem[] {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const arr = Array.isArray(raw) ? raw : Array.isArray(obj.slides) ? obj.slides : [];
  const datasetIds = new Set(f.datasets.map((d) => d.id));
  const simProject = f.project.pureAi || f.project.modes.includes('simulated');

  const list: SlideItem[] = arr
    .slice(0, 16)
    .map((item: unknown) => {
      const s = (item ?? {}) as Record<string, unknown>;
      const layout: SlideLayout = LAYOUTS.includes(s.layout as SlideLayout)
        ? (s.layout as SlideLayout)
        : 'points';
      const rawBullets = Array.isArray(s.bullets) ? s.bullets : [];
      const bullets = rawBullets
        .map((b) => cleanSlideText(b, 30))
        .filter((b) => b && b !== GAP)
        .slice(0, 4);
      const datasetId = typeof s.datasetId === 'string' && datasetIds.has(s.datasetId) ? s.datasetId : undefined;
      const textAll = [s.title, s.lead, s.source, ...rawBullets].map((x) => String(x ?? '')).join(' ');
      const simulated =
        s.simulated === true || /AI\s*模拟示例|模拟数据|虚拟示例/.test(textAll) || (simProject && !!datasetId && f.datasets.find((d) => d.id === datasetId)?.sourceType === 'simulated');

      return {
        id: uid('sl'),
        layout: datasetId ? 'data' : layout,
        title: cleanSlideText(s.title, 24),
        kicker: s.kicker ? cleanSlideText(s.kicker, 24) : undefined,
        lead: s.lead ? cleanSlideText(s.lead, 46) : undefined,
        bullets: bullets.length ? bullets : [GAP],
        note: s.note ? cleanSlideText(s.note, 180) : undefined,
        source: s.source ? cleanSlideText(s.source, 60) : GAP,
        simulated,
        datasetId,
      } satisfies SlideItem;
    })
    .filter((s) => s.title && s.title !== GAP);

  if (list.length < 6) return templateDeck(f).slides;
  // 封面与结尾页是答辩稿的硬性结构：模型没给就补回来
  const tpl = templateDeck(f);
  if (list[0].layout !== 'cover') {
    list.unshift({ ...tpl.slides[0], title: cleanSlideText(f.project.topic || '研究性学习课题', 24) });
  }
  if (list[list.length - 1].layout !== 'end') list.push(tpl.slides[tpl.slides.length - 1]);
  return list.slice(0, 16);
}

/** 把任意来源（模型 JSON / 本地草稿 / 模板）合成一份完整 Deck */
export function normalizeDeck(raw: unknown, f: DeckFacts, base?: Deck): Deck {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const slides = normalizeSlides(raw, f);
  const now = Date.now();
  return {
    id: f.project.id,
    projectId: f.project.id,
    title: cleanSlideText(obj.title ?? base?.title ?? `${f.project.topic || '研究性学习'} · 结题答辩`, 60),
    slides,
    origin: base?.origin === 'template' ? 'mixed' : 'ai',
    issues: base?.issues ?? [],
    createdAt: base?.createdAt ?? now,
    updatedAt: now,
    version: (base?.version ?? 0) + 1,
  };
}

/**
 * 本地事实校验：模型终检之外再兜一层。
 * 只报问题，不自动删用户写的内容。
 */
export function auditDeck(deck: Deck, f: DeckFacts): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const real = hasRealRecords(f);
  deck.slides.forEach((s, i) => {
    const page = i + 1;
    const all = [s.title, s.lead ?? '', ...s.bullets].join(' ');
    if (chars(s.title).length > 18) issues.push({ page, level: 'low', text: '标题超过 18 字，投影上会偏挤' });
    if (s.bullets.length > 4) issues.push({ page, level: 'low', text: '要点超过 4 条，建议拆页' });
    if (chars(all).length > 120) issues.push({ page, level: 'mid', text: '这一页字太多，不像答辩稿' });
    if (/%|\d+\s*人|\d+\s*份/.test(all) && (!s.source || s.source.includes(GAP))) {
      issues.push({ page, level: 'high', text: '出现数字或百分比，但没写清来源与分母' });
    }
    if (!real && /已完成|顺利开展|圆满|实地走访|发放了\s*\d+/.test(all)) {
      issues.push({ page, level: 'high', text: '项目里没有已确认的真实记录，却写了「已完成」' });
    }
    if (s.simulated && !/AI\s*模拟示例/.test(`${s.title} ${s.lead ?? ''} ${s.source ?? ''}`)) {
      issues.push({ page, level: 'mid', text: '模拟内容页缺少「AI 模拟示例」标识' });
    }
    if (/https?:\/\/|DOI|doi\.org/.test(all) && !f.sources.some((x) => x.url || x.doi)) {
      issues.push({ page, level: 'high', text: '出现网址或 DOI，但来源表里没有对应条目' });
    }
    if (/作为\s*AI|以下是|希望对你有帮助/.test(all)) {
      issues.push({ page, level: 'low', text: '残留生成痕迹，导出前删掉' });
    }
    if (s.datasetId && !f.datasets.some((d) => d.id === s.datasetId)) {
      issues.push({ page, level: 'high', text: '引用的数据集已不存在，导出时会跳过图表' });
    }
  });
  if (!deck.slides.some((s) => /局限|下一步|不足|还没做完/.test(s.title))) {
    issues.push({ page: deck.slides.length, level: 'mid', text: '没有「局限与下一步」这一页' });
  }
  return issues;
}

/** 讲稿 Markdown：每页的上屏文字 + 口播词 + 依据，导出给用户自己改 */
export function deckToNotes(deck: Deck, f: DeckFacts): string {
  const p = f.project;
  const lines = [
    `# ${deck.title}`,
    '',
    `课题：${p.topic || '未填写'}　学校：${p.school || '未填写'}　小组：${p.groupName || '未填写'}`,
    `指导教师：${p.teacher || '未填写'}　导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '> 本讲稿由 AI 辅助整理，含「待补充」的地方请自己补齐；标有（AI 模拟示例）的内容不得当作真实研究结果。',
    '',
  ];
  deck.slides.forEach((s, i) => {
    lines.push(`## 第 ${i + 1} 页 · ${s.title}`, '');
    if (s.lead) lines.push(`**一句话结论**：${s.lead}`, '');
    if (s.bullets.length) lines.push(...s.bullets.map((b) => `- ${b}`), '');
    if (s.note) lines.push(`**口播**：${s.note}`, '');
    lines.push(`**依据**：${s.source || GAP}${s.simulated ? '　（AI 模拟示例）' : ''}`, '', '---', '');
  });
  lines.push(
    '声明：本资料由研学帮 StudyMate（第三方开源工具）生成，不代表学校、教师或教育主管部门立场。',
    '「指导教师意见」等学校栏目由教师本人填写，本软件不代写。',
  );
  return lines.join('\n');
}

/**
 * 交给三个助手的项目事实摘要。
 * 只放已经写进项目里的内容，并明确告诉模型「不许引入以外的东西」。
 */
export function factsBrief(f: DeckFacts): string {
  const p = f.project;
  const parts: string[] = [
    '【项目事实（只能使用以下材料，不得引入任何外部事实）】',
    `课题：${p.topic || '未填写'}`,
    `学校/年级/班级：${p.school || '—'} / ${p.grade || '—'} / ${p.className || '—'}`,
    `小组：${p.groupName || '未填写'}　指导教师：${p.teacher || '未填写'}`,
    `成员：${p.members.map((m) => `${m.name}${m.role === 'leader' ? '(组长)' : ''}`).join('、') || '未填写'}`,
    `项目时间：${p.startDate || '—'} 至 ${p.endDate || '—'}`,
    `研究方式：${p.modes.join('、') || '未选择'}　记录安排：共 ${p.recordPlan.total} 篇（上 ${p.recordPlan.firstTerm} / 下 ${p.recordPlan.secondTerm}）`,
    p.pureAi || p.modes.includes('simulated') ? '本项目含 AI 模拟实践：模拟内容必须标注「（AI 模拟示例）」。' : '',
    p.requirementText ? `【教师要求原文（节选）】\n${p.requirementText.slice(0, 600)}` : '',
  ];

  const reportLines: string[] = [];
  for (const r of f.reports) {
    const filled = r.sections.filter((s) => s.body.trim());
    if (!filled.length) continue;
    reportLines.push(
      `《${r.title}》(${r.status})：` +
        filled
          .slice(0, 12)
          .map((s) => `「${s.heading}」${firstSentence(s.body, 160)}`)
          .join('；'),
    );
  }
  parts.push(reportLines.length ? `【报告已写内容（节选）】\n${reportLines.join('\n')}` : '【报告已写内容】暂无正文，凡涉及结论的页写「待补充」。');

  const real = f.records.filter((r) => r.confirmed);
  parts.push(
    real.length
      ? `【已确认的研究记录（共 ${real.length} 篇，节选）】\n${real
          .slice(0, 10)
          .map((r) => `- 第${r.index}篇 ${r.activityName || r.stageName || '未命名'}｜做法：${firstSentence(r.work, 100)}｜结果：${firstSentence(r.outputs, 100)}｜来源类型：${r.sourceType}`)
          .join('\n')}`
      : '【已确认的研究记录】无。不得写任何「已完成」的研究工作。',
  );

  parts.push(
    f.datasets.length
      ? `【可用数据集（datasetId 只能取这里的 id）】\n${f.datasets
          .map((d) => `- id=${d.id}｜${d.title}｜单位：${d.unit || '未填写'}｜来源：${d.sourceNote || '未填写'}｜类型：${d.sourceType}｜数据：${d.points.slice(0, 12).map((x) => `${x.label}=${x.value}`).join('，')}`)
          .join('\n')}`
      : '【可用数据集】无。不要出现任何百分比、样本量或图表。',
  );

  parts.push(
    f.sources.length
      ? `【可用来源（引用序号与下表一致）】\n${f.sources
          .slice(0, 20)
          .map((s, i) => `[${i + 1}] ${s.title}｜${s.authors || '作者未填'}｜${s.verifyStatus === 'verified' ? '已核验' : '待核实'}`)
          .join('\n')}`
      : '【可用来源】无。不得编造文献、作者、DOI 或网址。',
  );

  parts.push(
    '【边界】没有写到的活动、数据、访谈、结论一律写「待补充」；不得编造文献、机构、网址；不得把「尚未开展」写成「已完成」；不得代写「指导教师意见」。',
  );
  return parts.filter(Boolean).join('\n\n').slice(0, 12_000);
}
