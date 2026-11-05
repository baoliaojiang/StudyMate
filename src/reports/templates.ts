/**
 * 四份报告的结构定义 —— 严格按学校下发的四份表格还原
 *
 * 来源（用户提供，鼓山中学）：
 *   1. 鼓山中学研究性学习课题开题报告.docx      —— 8 行 / 7 列网格
 *   2. 研究性学习阶段性记录表.doc               —— 6 行 / 2 列网格
 *   3. 研究性学习中期检查报告模版.doc            —— 7 行 / 6 列网格
 *   4. 研究性学习结题报告（范例参考）.doc         —— 十章长文
 *
 * 铁律：行数、列宽、单元格合并方式、标签文字、字号、字体、页边距都与原表一致，
 * 不改、不合并、不新增行列。内容为空时只在原格内写「（本节尚未填写）」。
 */

import type { ReportKind, ReportSection } from '../core/types';
import { uid } from '../core/id';

/* ------------------------------------------------------------------ */
/* 表格型模板的表单描述                                                 */
/* ------------------------------------------------------------------ */

/** 从项目 / 记录里取值的字段 */
export type FieldKey =
  | 'topic'
  | 'members'
  | 'leader'
  | 'teacher'
  | 'class'
  | 'mainCourse'
  | 'relatedCourse'
  | 'group'
  | 'recordIndex'
  | 'recorder'
  | 'recordedAt'
  | 'period';

export type FormCell =
  /** 标签格：居中、加粗（开题/中期）或黑体（记录表） */
  | { t: 'label'; text: string; span?: number; font?: 'song' | 'hei' }
  /** 取值格 */
  | { t: 'field'; key: FieldKey; span?: number }
  /** 内容格：整格，首行是标签，下面是正文 */
  | {
      t: 'section';
      heading: string;
      span?: number;
      /** 覆盖显示的标签文字（原表有些格子带括号说明） */
      label?: string;
      /** 标签后缀，原表开题带「：」 */
      suffix?: string;
      /** 标签已在左侧单元格里，正文格不再重复 */
      hideLabel?: boolean;
      /** 正文之后固定追加的行（签名 / 日期） */
      tail?: string[];
    }
  /** 空占位格 */
  | { t: 'empty'; span?: number };

export interface FormRow {
  /** 行高（twip），与原表一致，保证表格撑满一页 */
  height?: number;
  cells: FormCell[];
}

export interface TemplateForm {
  /** 表格上方的标题行，逐行居中 */
  titleLines: { text: string; size: number; bold?: boolean }[];
  /** 表格与标题之间的一行小字（记录表的「第 __ 研究阶段 记录人 记录时间」） */
  metaLine?: 'record';
  /** 列宽（twip），与原表 tblGrid 完全相同 */
  grid: number[];
  rows: FormRow[];
  /** 页边距（twip） */
  margin: { top: number; right: number; bottom: number; left: number };
}

/* ------------------------------------------------------------------ */
/* 章节定义                                                            */
/* ------------------------------------------------------------------ */

export interface SectionSpec {
  heading: string;
  level: 1 | 2 | 3;
  /** 给 AI 的写作提示（不直接展示给学生） */
  hint: string;
  /** 建议字数 */
  words: number;
  /** 是否必填 */
  required: boolean;
  /** 缺少材料时章节里留下的占位说明 */
  placeholder?: string;
}

export interface ReportTemplate {
  kind: ReportKind;
  name: string;
  /** 表格型（有 form）或章节型 */
  layout: 'table' | 'section';
  /** 出处说明，导出时写进文档 */
  note: string;
  sections: SectionSpec[];
  form?: TemplateForm;
}

/* ------------------------------------------------------------------ */
/* 1. 开题报告                                                          */
/* ------------------------------------------------------------------ */

const PROPOSAL_FORM: TemplateForm = {
  titleLines: [
    { text: '鼓山中学研究性学习', size: 16 },
    { text: '课题开题报告', size: 18, bold: true },
  ],
  // 原表 tblGrid：1575 60 1470 1230 1950 855 1845
  grid: [1575, 60, 1470, 1230, 1950, 855, 1845],
  margin: { top: 1460, right: 1800, bottom: 1768, left: 1800 },
  rows: [
    {
      height: 524,
      cells: [{ t: 'label', text: '课题题目' }, { t: 'field', key: 'topic', span: 6 }],
    },
    {
      height: 328,
      cells: [{ t: 'label', text: '课题组成员' }, { t: 'field', key: 'members', span: 6 }],
    },
    {
      height: 328,
      cells: [
        { t: 'label', text: '组　长' },
        { t: 'field', key: 'leader', span: 2 },
        { t: 'label', text: '指导教师' },
        { t: 'field', key: 'teacher' },
        { t: 'label', text: '班级' },
        { t: 'field', key: 'class' },
      ],
    },
    {
      height: 328,
      cells: [{ t: 'section', heading: '简要背景说明', span: 7, suffix: '：' }],
    },
    {
      height: 3905,
      cells: [{ t: 'section', heading: '课题的目的和意义', span: 7, suffix: '：' }],
    },
    {
      height: 513,
      cells: [
        { t: 'label', text: '主导课程', span: 2 },
        { t: 'field', key: 'mainCourse', span: 2 },
        { t: 'label', text: '相关课程', span: 2 },
        { t: 'field', key: 'relatedCourse' },
      ],
    },
    {
      height: 10403,
      cells: [{ t: 'section', heading: '课题活动计划', span: 7, suffix: '：' }],
    },
    {
      height: 2391,
      cells: [
        {
          t: 'section',
          heading: '指导教师意见',
          span: 7,
          tail: ['', '　　　　　　　　　　　　　　　　　　　　签名：', '　　　　　　　　　　　　　　　　　年　　月　　日'],
        },
      ],
    },
  ],
};

export const PROPOSAL_TEMPLATE: ReportTemplate = {
  kind: 'proposal',
  name: '课题开题报告',
  layout: 'table',
  note: '结构按学校下发的《鼓山中学研究性学习课题开题报告》表格还原（8 行 / 7 列网格）。',
  form: PROPOSAL_FORM,
  sections: [
    {
      heading: '简要背景说明',
      level: 1,
      hint: '两三百字说清：从什么现象或经历出发、为什么值得研究、目前已知什么。只写真实观察到的情况。',
      words: 300,
      required: true,
      placeholder: '待补充：请写明触发这个选题的具体现象或经历。',
    },
    {
      heading: '课题的目的和意义',
      level: 1,
      hint: '目的 = 想回答什么、达到什么结果；意义 = 对自身、同学、学校或社区的实际用处。',
      words: 400,
      required: true,
      placeholder: '待补充：研究目的与实践意义需要你结合自身情况填写。',
    },
    {
      heading: '课题活动计划',
      level: 1,
      hint: '按阶段列时间、任务、负责人、预期产出，与项目里的阶段计划和成员分工一致；不能写没安排的活动。',
      words: 500,
      required: true,
      placeholder: '待补充：请先确定阶段划分与成员分工。',
    },
    {
      heading: '指导教师意见',
      level: 1,
      hint: '此栏由指导教师手写签名，AI 不得代写、不得伪造。留空，打印后交教师签署。',
      words: 60,
      required: false,
    },
  ],
};

/* ------------------------------------------------------------------ */
/* 2. 阶段性记录表                                                      */
/* ------------------------------------------------------------------ */

/**
 * 研究记录的字段 —— 与「课题阶段性工作小结记录表」的六行一一对应。
 * 起迄时间单独成行（不属正文），目标/工作/成果/小结/下阶段安排各占一行。
 */
export const RECORD_FIELDS: {
  key: 'goal' | 'work' | 'outputs' | 'summary' | 'nextPlan';
  label: string;
  /** 表格左列的分行写法（原表就这么折） */
  labelLines: string[];
  hint: string;
  words: number;
}[] = [
  {
    key: 'goal',
    label: '本阶段主要研究目标',
    labelLines: ['本阶段', '主要研', '究目标'],
    hint: '照抄该阶段计划目标，不要臆造新目标。',
    words: 150,
  },
  {
    key: 'work',
    label: '本阶段主要研究工作',
    labelLines: ['本阶段', '主要研', '究工作'],
    hint: '只写已真实开展的活动：谁、在哪、做了什么。没开展就写「本阶段尚未开展」。',
    words: 400,
  },
  {
    key: 'outputs',
    label: '阶段性成果',
    labelLines: ['阶', '段', '性', '成', '果'],
    hint: '实际产出：回收份数、有效样本、观测数据、图表、结论。数字必须来自原始记录。',
    words: 250,
  },
  {
    key: 'summary',
    label: '工作小结',
    labelLines: ['工', '作', '小', '结'],
    hint: '反思：做得好的、不足的、与计划的偏差及原因。',
    words: 300,
  },
  {
    key: 'nextPlan',
    label: '下阶段研究工作安排',
    labelLines: ['下阶段研究工作安排'],
    hint: '与项目计划的下一阶段保持一致。',
    words: 250,
  },
];

const RECORD_FORM: TemplateForm = {
  titleLines: [
    { text: '研究性学习', size: 22, bold: true },
    { text: '课题阶段性工作小结记录表', size: 22, bold: true },
  ],
  metaLine: 'record',
  // 原表 tblGrid：1114 8460
  grid: [1114, 8460],
  margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
  rows: [
    { height: 567, cells: [{ t: 'label', text: '起迄时间', font: 'hei' }, { t: 'field', key: 'period' }] },
    {
      height: 862,
      cells: [
        { t: 'label', text: '本阶段\n主要研\n究目标', font: 'hei' },
        { t: 'section', heading: '本阶段主要研究目标' },
      ],
    },
    {
      height: 1403,
      cells: [
        { t: 'label', text: '本阶段\n主要研\n究工作', font: 'hei' },
        { t: 'section', heading: '本阶段主要研究工作' },
      ],
    },
    {
      height: 3700,
      cells: [
        { t: 'label', text: '阶\n段\n性\n成\n果', font: 'hei' },
        { t: 'section', heading: '阶段性成果' },
      ],
    },
    {
      height: 1845,
      cells: [
        { t: 'label', text: '工\n作\n小\n结', font: 'hei' },
        { t: 'section', heading: '工作小结' },
      ],
    },
    {
      height: 1845,
      cells: [
        { t: 'label', text: '下阶段研究工作安排', font: 'hei' },
        { t: 'section', heading: '下阶段研究工作安排' },
      ],
    },
  ],
};

/** 记录表本身不是一份 Report，但导出时需要同一套版式 */
export const RECORD_TEMPLATE: ReportTemplate = {
  kind: 'progress',
  name: '研究性学习课题阶段性工作小结记录表',
  layout: 'table',
  note: '结构按学校下发的《研究性学习阶段性记录表》还原（6 行 / 2 列网格）。',
  form: RECORD_FORM,
  sections: RECORD_FIELDS.map((f) => ({
    heading: f.label,
    level: 1 as const,
    hint: f.hint,
    words: f.words,
    required: f.key === 'work',
  })),
};

/* ------------------------------------------------------------------ */
/* 3. 中期检查报告                                                      */
/* ------------------------------------------------------------------ */

const MIDTERM_FORM: TemplateForm = {
  titleLines: [
    { text: '研究性学习', size: 22, bold: true },
    { text: '课题中期检查报告', size: 22, bold: true },
  ],
  // 原表 tblGrid：1546 1260 868 1652 1173 2023
  grid: [1546, 1260, 868, 1652, 1173, 2023],
  margin: { top: 1440, right: 1800, bottom: 1440, left: 1800 },
  rows: [
    { height: 567, cells: [{ t: 'label', text: '课题名称' }, { t: 'field', key: 'topic', span: 5 }] },
    {
      height: 567,
      cells: [
        { t: 'label', text: '课题组长' },
        { t: 'field', key: 'leader' },
        { t: 'label', text: '记录人' },
        { t: 'field', key: 'recorder' },
        { t: 'label', text: '起止时间' },
        { t: 'field', key: 'period' },
      ],
    },
    { height: 1840, cells: [{ t: 'section', heading: '课题进展情况', span: 6, label: '课题进展情况' }] },
    { height: 2924, cells: [{ t: 'section', heading: '研究中遇到的问题及对策', span: 6, label: '研究中遇到的问题及对策（在研究活动中遇到哪些问题，采用了怎样的对策予以解决，目前还存在哪些问题，准备如何解决）' }] },
    {
      height: 1824,
      cells: [
        { t: 'label', text: '自我评定' },
        { t: 'section', heading: '自我评定', span: 5, hideLabel: true },
      ],
    },
    { height: 1917, cells: [{ t: 'section', heading: '前一阶段课题组成员的表现', span: 6, label: '前一阶段课题组成员的表现（课题组负责人填写）' }] },
    { height: 3026, cells: [{ t: 'section', heading: '下一阶段研究活动的要点及讨论', span: 6, label: '下一阶段研究活动的要点及讨论' }] },
  ],
};

export const MIDTERM_TEMPLATE: ReportTemplate = {
  kind: 'midterm',
  name: '课题中期检查报告',
  layout: 'table',
  note: '结构按学校下发的《研究性学习中期检查报告模版》还原（7 行 / 6 列网格）。',
  form: MIDTERM_FORM,
  sections: [
    {
      heading: '课题进展情况',
      level: 1,
      hint: '只汇总研究记录里真实存在的活动，按「已完成 / 进行中 / 未开始」三类陈述，并标注对应记录篇号。',
      words: 500,
      required: true,
      placeholder: '待补充：还没有可汇总的研究记录，请先填写阶段性记录表。',
    },
    {
      heading: '研究中遇到的问题及对策',
      level: 1,
      hint: '问题要具体（样本不足、设备受限、组员时间冲突…），对策写实际采取的做法，并说明仍未解决的部分。学校表格的提示语是：在研究活动中遇到哪些问题，采用了怎样的对策予以解决，目前还存在哪些问题，准备如何解决。',
      words: 450,
      required: true,
      placeholder: '待补充：请写下实际遇到的困难与已尝试的处理方式。',
    },
    {
      heading: '自我评定',
      level: 1,
      hint: '课题组对自身进展的评价，可含完成度、质量、协作情况。写得具体，不要只写「良好」。',
      words: 250,
      required: false,
      placeholder: '待补充：由课题组自评。',
    },
    {
      heading: '前一阶段课题组成员的表现',
      level: 1,
      hint: '课题组负责人填写，逐人写实际承担的工作与完成情况。没有分工记录就写「分工未记录」，不要编。',
      words: 350,
      required: true,
      placeholder: '待补充：需先有成员分工与活动记录。',
    },
    {
      heading: '下一阶段研究活动的要点及讨论',
      level: 1,
      hint: '列出下一阶段要点、需要教师指导的问题、小组内部分歧与结论。',
      words: 300,
      required: true,
      placeholder: '待补充：请与组员商定下一阶段安排。',
    },
  ],
};

/* ------------------------------------------------------------------ */
/* 4. 结题报告                                                          */
/* ------------------------------------------------------------------ */

export const FINAL_TEMPLATE: ReportTemplate = {
  kind: 'final',
  name: '研究性学习结题报告',
  layout: 'section',
  note: '章节与标题层级按学校下发的《研究性学习结题报告（范例参考）》还原：一级标题用「一、二、三」加粗，二级用「（一）（二）」，三级用「1. 2. 3.」，四级用「①②③」。',
  sections: [
    {
      heading: '一、课题研究的背景（或问题的提出）',
      level: 1,
      hint: '从背景、现状、基础三方面回答「为什么要选择这项课题」。用两三段简洁文字讲清原因与理由。',
      words: 600,
      required: true,
      placeholder: '待补充：请先完成开题报告中的背景部分。',
    },
    {
      heading: '二、课题研究的意义',
      level: 1,
      hint: '包括理论意义和现实意义，说明本课题研究的重要性和必要性，以及可能性。也可并入第一部分。',
      words: 350,
      required: true,
      placeholder: '待补充：参考开题报告的目的与意义，按实际调整。',
    },
    {
      heading: '三、课题研究的界定',
      level: 1,
      hint: '对课题名称中重要词语的内涵、研究涉及的范围作简单阐述；所依据的教育理论只摘录最精辟、最适用的部分，说明自己的主要研究思想。切忌全文照搬。',
      words: 400,
      required: true,
      placeholder: '待补充：请界定课题关键词与研究范围。',
    },
    {
      heading: '四、课题研究的达成目标',
      level: 1,
      hint: '目标要扣紧课题，不能过于空泛，注意结构的内在联系，最终要落实到成果中去。',
      words: 300,
      required: true,
      placeholder: '待补充：目标需与开题报告一致。',
    },
    {
      heading: '五、课题研究的主要内容',
      level: 1,
      hint: '陈述研究的范畴与立足点，紧扣研究目标，简洁准确；可把子课题表述为其中一项内容。',
      words: 400,
      required: true,
      placeholder: '待补充：请列出研究的具体内容。',
    },
    {
      heading: '六、课题研究的方法',
      level: 1,
      hint: '列出实际采用的方法（实验法、问卷法、调查法、统计法、分析法、文献资料法、行动研究法、个案研究法、观察法等），稍加说明即可。',
      words: 250,
      required: true,
      placeholder: '待补充：请选择实际使用的方法。',
    },
    {
      heading: '七、课题研究的步骤',
      level: 1,
      hint: '一般分准备、实施、总结三个阶段（也可四、五个），每个阶段简要陈述做了几项工作，简明扼要。',
      words: 300,
      required: true,
      placeholder: '待补充：请按阶段划分陈述。',
    },
    {
      heading: '八、课题研究的主要过程',
      level: 1,
      hint: '这部分可花较多笔墨。通过回顾、归纳、提炼，具体陈述采取了哪些措施、策略或基本做法。不要用总结式语调。可按（一）准备阶段 1. 2. 3.、（二）实施阶段、（三）总结阶段展开。',
      words: 900,
      required: true,
      placeholder: '待补充：尚无过程记录，无法还原研究过程。',
    },
    {
      heading: '九、课题研究的成果',
      level: 1,
      hint: '结题报告最重要的部分。从实践成果与理论成果两方面陈述，不能笼统。成果必须体现所确定的研究目标。',
      words: 900,
      required: true,
      placeholder: '待补充：尚未录入真实数据，成果部分不能凭空生成。',
    },
    {
      heading: '十、研究中的反思及今后的设想',
      level: 1,
      hint: '主要问题要准确中肯；今后的设想主要陈述后续研究或推广性研究如何开展。',
      words: 450,
      required: true,
      placeholder: '待补充：反思需要你们自己写，软件不代拟。',
    },
  ],
};

/* ------------------------------------------------------------------ */

export const TEMPLATES: Record<string, ReportTemplate> = {
  proposal: PROPOSAL_TEMPLATE,
  progress: RECORD_TEMPLATE,
  midterm: MIDTERM_TEMPLATE,
  final: FINAL_TEMPLATE,
};

/** 一个完整项目的交付顺序：开题 → N 篇记录 → 中期 → 结题 */
export const REPORT_ORDER: ReportKind[] = ['proposal', 'progress', 'midterm', 'final'];

export function templateFor(kind: ReportKind): ReportTemplate {
  return TEMPLATES[kind] ?? PROPOSAL_TEMPLATE;
}

/** 新建空报告（章节按模板铺好，正文留空） */
export function blankSections(kind: ReportKind): ReportSection[] {
  return templateFor(kind).sections.map((s) => ({
    id: uid('sec'),
    heading: s.heading,
    level: s.level,
    body: '',
    origin: 'template' as const,
    updatedAt: Date.now(),
  }));
}

/** 由导师填写、AI 不得代写的章节 */
export const NON_AI_SECTIONS = ['指导教师意见'];
