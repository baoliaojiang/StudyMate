/**
 * 「让 AI 帮我分析要求」
 *
 * 两层策略：
 * 1. 规则解析（离线可用、零成本、结果确定）—— 先把能从原文里直接读到的字段抠出来；
 * 2. AI 精修（可选）—— 把规则结果和原文一起交给模型，要求它只补空缺、不猜测。
 *
 * 铁律：指导教师姓名、成员姓名 AI 不得猜测；推断值一律标记 confidence='low' 且必须由用户确认。
 */

export interface ExtractedField {
  key: string;
  label: string;
  value: string;
  /** 来源：rule = 原文直接匹配；ai = 模型推断（须确认）；user = 用户已填 */
  from: 'rule' | 'ai' | 'user';
  /** 原文片段，便于用户核对 */
  evidence?: string;
}

export interface RequirementAnalysis {
  fields: ExtractedField[];
  /** 规则层无法得到的必填项 */
  missing: string[];
  warnings: string[];
}

const PATTERNS: { key: string; label: string; re: RegExp; group?: number }[] = [
  { key: 'school', label: '学校', re: /([\u4e00-\u9fa5]{2,12}(?:中学|高中|学校|附中|实验学校))/, group: 1 },
  { key: 'grade', label: '年级', re: /(高一|高二|高三|七年级|八年级|九年级|初一|初二|初三|[一二三]年级)/, group: 1 },
  { key: 'className', label: '班级', re: /(\d{1,2}\s*班|[一二三四五六七八九十]{1,3}\s*班)/, group: 1 },
  { key: 'groupName', label: '小组名称', re: /(第?\s*[一二三四五六七八九十\d]{1,3}\s*(?:研究)?小组|[\u4e00-\u9fa5]{2,8}小组)/, group: 1 },
  { key: 'teacher', label: '指导教师', re: /(?:指导教师|指导老师|辅导教师)[：:\s]*([\u4e00-\u9fa5]{2,4})/, group: 1 },
  {
    key: 'dateRange',
    label: '项目时间',
    re: /(\d{4}\s*[年.\-/]\s*\d{1,2}\s*[月.\-/]?\s*(?:至|到|—|-|~)\s*\d{4}\s*[年.\-/]\s*\d{1,2}\s*月?)/,
    group: 1,
  },
  { key: 'recordTotal', label: '研究记录篇数', re: /(?:研究记录|记录表|过程记录)[^。\n]{0,12}?(\d{1,2})\s*(?:篇|次|份)/, group: 1 },
  { key: 'wordCount', label: '字数要求', re: /(\d{3,5})\s*字(?:以上|左右)?/, group: 1 },
  { key: 'format', label: '格式要求', re: /(字体|字号|宋体|黑体|小四|三号|行距|页边距)/, group: 1 },
];

export function analyzeRequirement(text: string): RequirementAnalysis {
  const fields: ExtractedField[] = [];
  const warnings: string[] = [];
  const src = text || '';

  if (!src.trim()) {
    return {
      fields: [],
      missing: ['研究主题', '指导教师姓名', '小组成员姓名', '教师布置的研究性学习要求'],
      warnings: ['没有可分析的要求文本。可以先粘贴教师要求，或手动填写。'],
    };
  }

  for (const p of PATTERNS) {
    const m = p.re.exec(src);
    if (!m) continue;
    const val = (p.group ? m[p.group] : m[0])?.trim();
    if (!val) continue;
    fields.push({
      key: p.key,
      label: p.label,
      value: val,
      from: 'rule',
      evidence: excerpt(src, m.index, m[0].length),
    });
  }

  // 时间范围拆成起止
  const dr = fields.find((f) => f.key === 'dateRange');
  if (dr) {
    const parts = dr.value.split(/至|到|—|-|~/);
    if (parts.length === 2) {
      fields.push({ key: 'startDate', label: '开始时间', value: normDate(parts[0]), from: 'rule', evidence: dr.evidence });
      fields.push({ key: 'endDate', label: '结束时间', value: normDate(parts[1]), from: 'rule', evidence: dr.evidence });
    }
  }

  if (!fields.some((f) => f.key === 'teacher')) {
    warnings.push('要求文本中没有写明指导教师姓名。请手动填写——AI 不会猜测导师是谁。');
  }
  if (!fields.some((f) => f.key === 'school')) {
    warnings.push('没有识别到学校名称，请手动确认。');
  }

  const missing: string[] = [];
  for (const [k, label] of [
    ['topic', '研究主题'],
    ['teacher', '指导教师姓名'],
  ] as const) {
    if (!fields.some((f) => f.key === k)) missing.push(label);
  }

  return { fields: dedupe(fields), missing, warnings };
}

function dedupe(fields: ExtractedField[]): ExtractedField[] {
  const seen = new Set<string>();
  return fields.filter((f) => {
    if (seen.has(f.key)) return false;
    seen.add(f.key);
    return true;
  });
}

function excerpt(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 12);
  return `…${text.slice(start, index + len + 12)}…`.replace(/\s+/g, ' ');
}

function normDate(s: string): string {
  const m = /(\d{4})\D*(\d{1,2})/.exec(s);
  if (!m) return s.trim();
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-01`;
}

/* ------------------------------------------------------------------ */
/* AI 精修：只补空缺，不覆盖规则结果                                     */
/* ------------------------------------------------------------------ */

export const REQUIREMENT_EXTRACT_PROMPT = `你是研究性学习项目信息抽取助手。
从下面的「教师要求原文」中抽取项目字段，输出严格 JSON（不要 markdown 代码块、不要解释）：

{
  "topic": "",            // 研究主题/课题名称，原文没写就留空字符串
  "teacher": "",          // 指导教师姓名，没写就留空，绝对不要猜
  "members": [],          // 小组成员姓名，没写就留空数组，绝对不要编
  "school": "",
  "grade": "",
  "className": "",
  "groupName": "",
  "startDate": "",        // YYYY-MM-DD
  "endDate": "",
  "recordTotal": 0,       // 要求交几篇研究记录，没写填 0
  "notes": ""             // 其他格式/字数/提交方式要求，一句话概括
}

规则：
- 只抽原文明确写出的信息。任何推断都不允许，尤其是人名。
- 拿不准的字段一律留空，由学生自己填。
- 不要补全学校全称之外的任何身份信息。`;

export function parseAiExtraction(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 合并规则结果与 AI 结果：规则优先，其次 AI，冲突时保留两者并提示用户确认。
 */
export function mergeAnalysis(
  rule: RequirementAnalysis,
  ai: Record<string, unknown> | null,
): { fields: ExtractedField[]; warnings: string[] } {
  const fields = [...rule.fields];
  const warnings = [...rule.warnings];
  if (!ai) return { fields, warnings };

  const labels: Record<string, string> = {
    topic: '研究主题',
    teacher: '指导教师',
    school: '学校',
    grade: '年级',
    className: '班级',
    groupName: '小组名称',
    startDate: '开始时间',
    endDate: '结束时间',
  };

  for (const [key, label] of Object.entries(labels)) {
    const v = ai[key];
    if (typeof v !== 'string' || !v.trim()) continue;
    const existing = fields.find((f) => f.key === key);
    if (existing) {
      if (existing.value !== v.trim()) {
        warnings.push(`「${label}」原文与模型理解不一致（${existing.value} / ${v.trim()}），请手动确认。`);
      }
      continue;
    }
    fields.push({ key, label, value: v.trim(), from: 'ai' });
  }

  const members = ai.members;
  if (Array.isArray(members) && members.length) {
    const names = members.filter((x): x is string => typeof x === 'string' && !!x.trim());
    if (names.length) {
      fields.push({
        key: 'members',
        label: '小组成员',
        value: names.join('、'),
        from: 'rule' === 'rule' ? 'ai' : 'ai',
      });
      warnings.push('成员姓名来自 AI 抽取，请逐个核对拼写与人数。');
    }
  }

  if (typeof ai.recordTotal === 'number' && ai.recordTotal > 0) {
    const existing = fields.find((f) => f.key === 'recordTotal');
    if (!existing) {
      fields.push({
        key: 'recordTotal',
        label: '研究记录篇数',
        value: String(ai.recordTotal),
        from: 'ai',
      });
    }
  }

  return { fields, warnings };
}
