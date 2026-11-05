/**
 * 答辩演示稿生成：策划 → 撰写 → 终检，三步都看得见
 *
 * 每一步对应一个内置 Agent，规则由各自的 Skill 注入（见 agents/definitions.ts）。
 * 结构化 JSON 不做流式：流式只适合给人读的连续正文，JSON 半截没法用。
 * 过程可见靠步骤状态、耗时、调用次数和每步产出，而不是把原始 JSON 刷给用户。
 *
 * 兜底纪律：任何一步失败（没配模型、限流、模型返回废话、助手被关掉），
 * 都退回离线模板，用户仍然能编辑并导出一份 PPTX，不会卡在转圈上。
 */
import { getAgent as builtinAgent } from '../agents/definitions';
import { getAgentById } from '../agents/registry';
import { AgentRuntime, type RuntimeContext } from '../agents/runtime';
import { stripInlineThink } from '../ai/think';
import type { AgentDefinition, Deck, SlideItem } from '../core/types';
import {
  auditDeck,
  factsBrief,
  normalizeDeck,
  templateDeck,
  type DeckFacts,
  type DeckIssue,
} from './model';

export type DeckStepKey = 'outline' | 'write' | 'audit';

export interface DeckStep {
  key: DeckStepKey;
  label: string;
  agentId: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  note?: string;
  ms?: number;
  calls?: number;
  chars?: number;
  warnings?: string[];
}

export interface GenerateOptions {
  facts: DeckFacts;
  runtime: AgentRuntime;
  /** 用户在设置里启用的助手；空数组/未设置 = 全部可用 */
  enabledAgents?: string[];
  /** 已有稿子：重写时保留创建时间与版本 */
  base?: Deck;
  signal?: AbortSignal;
  onSteps?: (steps: DeckStep[]) => void;
}

export interface GenerateResult {
  deck: Deck;
  steps: DeckStep[];
  warnings: string[];
  /** 是否完全来自离线模板（如实显示，不冒充 AI 生成） */
  usedTemplate: boolean;
}

const STEP_DEFS: { key: DeckStepKey; label: string; agentId: string }[] = [
  { key: 'outline', label: '排页：决定每页讲什么', agentId: 'deck-architect' },
  { key: 'write', label: '写文案：结论、要点、口播词', agentId: 'slide-writer' },
  { key: 'audit', label: '终检：查虚构、来源与标识', agentId: 'deck-reviewer' },
];

/** 从模型输出里捞 JSON：容忍思考标签、代码围栏、前后解释与尾随逗号 */
export function parseJsonLoose(raw: string): Record<string, unknown> | null {
  const { text } = stripInlineThink(raw ?? '');
  let s = text.trim().replace(/^```(?:json|JSON)?\s*/m, '').replace(/```\s*$/m, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const body = s.slice(start, end + 1);
  for (const candidate of [body, body.replace(/,\s*([}\]])/g, '$1')]) {
    try {
      const v: unknown = JSON.parse(candidate);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // 继续试下一个候选
    }
  }
  return null;
}

function toOutline(slides: SlideItem[]): string {
  return JSON.stringify({
    slides: slides.map((s) => ({
      layout: s.layout,
      title: s.title,
      intent: s.lead ?? s.bullets[0] ?? '',
      evidence: s.source ?? '待补充',
    })),
  });
}

function toReviewBody(slides: SlideItem[]): string {
  return JSON.stringify(
    slides.map((s, i) => ({
      page: i + 1,
      title: s.title,
      lead: s.lead ?? '',
      bullets: s.bullets,
      source: s.source ?? '',
      simulated: !!s.simulated,
    })),
  );
}

function mergeIssues(ai: DeckIssue[], local: DeckIssue[]): DeckIssue[] {
  const seen = new Set<string>();
  return [...ai, ...local].filter((x) => {
    const key = `${x.page}:${x.text.slice(0, 18)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseIssues(raw: unknown): DeckIssue[] {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(obj.issues)) return [];
  return obj.issues
    .slice(0, 20)
    .map((x: unknown) => {
      const i = (x ?? {}) as Record<string, unknown>;
      const level = i.level === 'high' || i.level === 'low' ? i.level : 'mid';
      return {
        page: Math.max(1, Number(i.page) || 1),
        level,
        text: String(i.text ?? '').replace(/[#*`>|]/g, '').slice(0, 120),
      } as DeckIssue;
    })
    .filter((x) => x.text);
}

export async function generateDeck(opts: GenerateOptions): Promise<GenerateResult> {
  const { facts, runtime, onSteps, signal, base } = opts;
  const steps: DeckStep[] = STEP_DEFS.map((d) => ({ ...d, status: 'pending' }));
  const warnings: string[] = [];
  const publish = () => onSteps?.(steps.map((s) => ({ ...s })));
  publish();

  const enabled = opts.enabledAgents ?? [];
  const allowed = (id: string) => enabled.length === 0 || enabled.includes(id);

  const ctx: RuntimeContext = {
    project: facts.project,
    records: facts.records,
    activities: [],
    datasets: facts.datasets,
    sources: facts.sources,
  };

  async function agentFor(id: string): Promise<AgentDefinition | undefined> {
    return (await getAgentById(id)) ?? builtinAgent(id);
  }

  /** 调一次助手并解析 JSON；失败重试一次，再失败返回 null */
  async function callJson(
    step: DeckStep,
    instruction: string,
    strictNote = '上一次没有返回合法 JSON。这次只输出一个 JSON 对象本身，不要任何说明、注释或代码块。',
  ): Promise<Record<string, unknown> | null> {
    const agent = await agentFor(step.agentId);
    if (!agent) {
      step.status = 'failed';
      step.note = `找不到助手「${step.agentId}」`;
      publish();
      return null;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) return null;
      try {
        const result = await runtime.run(step.agentId, agent, ctx, attempt ? `${instruction}\n\n${strictNote}` : instruction, {
          signal,
          maxLoops: 1,
        });
        step.calls = (step.calls ?? 0) + result.calls;
        step.chars = result.text.length;
        step.warnings = result.warnings;
        const parsed = parseJsonLoose(result.text);
        if (parsed) return parsed;
        step.note = attempt ? '两次都没返回可解析的结构，改用模板' : '返回内容看不懂，正在重试一次';
        publish();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        step.status = 'failed';
        step.note = msg.slice(0, 80);
        publish();
        warnings.push(`${step.label}：${msg.slice(0, 80)}`);
        return null;
      }
    }
    step.status = 'failed';
    publish();
    return null;
  }

  const brief = factsBrief(facts);
  let deck = templateDeck(facts);
  let usedTemplate = true;
  let outlineJson: Record<string, unknown> | null = null;

  /* ---------------- 第 1 步：排页 ---------------- */
  const s1 = steps[0];
  if (!allowed(s1.agentId)) {
    s1.status = 'skipped';
    s1.note = '这个助手在设置里被关掉了，用内置结构排页';
    publish();
  } else {
    s1.status = 'running';
    publish();
    const t0 = Date.now();
    const outline = await callJson(
      s1,
      [
        brief,
        '',
        '【本步任务】把上述材料排成一份 8–12 页的结题答辩大纲，决定每页讲哪个结论、依据哪份材料。',
        '只输出 JSON：{"title":"演示标题","slides":[{"layout":"cover|section|points|two|data|end","title":"本页结论","intent":"要讲清什么","evidence":"依据来自哪份材料，没有就写待补充"}]}。',
        '第一页 layout=cover，最后一页 layout=end；数据页只允许在存在可用数据集时排。',
      ].join('\n'),
    );
    s1.ms = Date.now() - t0;
    s1.status = outline ? 'done' : 'failed';
    if (outline) {
      s1.note = `排出 ${Array.isArray(outline.slides) ? outline.slides.length : 0} 页`;
      // 大纲交给下一步；解析出来的结构不直接当成品
      outlineJson = outline;
    }
    publish();
  }

  /* ---------------- 第 2 步：写文案 ---------------- */
  const s2 = steps[1];
  const outlineText = outlineJson ? JSON.stringify(outlineJson) : toOutline(deck.slides);
  if (!allowed(s2.agentId)) {
    s2.status = 'skipped';
    s2.note = '这个助手在设置里被关掉了，保留模板文字';
    publish();
  } else {
    s2.status = 'running';
    publish();
    const t0 = Date.now();
    const written = await callJson(
      s2,
      [
        brief,
        '',
        '【上一步定下的页序（页数与顺序必须保持一致）】',
        outlineText,
        '',
        '【本步任务】按页序写出能直接上屏的文字：title、lead、bullets(2–4 条)、note(口播词)、source(依据)，有数据页时填 datasetId。',
        '只输出 JSON：{"slides":[{"layout":"points","title":"","lead":"","bullets":[""],"note":"","source":"","simulated":false,"datasetId":""}]}。',
        'datasetId 只能取【可用数据集】里列出的 id；没有的材料写「待补充」，不要编造。',
      ].join('\n'),
    );
    s2.ms = Date.now() - t0;
    if (written) {
      deck = normalizeDeck({ ...written, title: outlineJson?.title ?? deck.title }, facts, base);
      usedTemplate = false;
      s2.status = 'done';
      s2.note = `写好 ${deck.slides.length} 页`;
    } else {
      s2.status = 'failed';
      s2.note = s2.note ?? '改用离线模板，内容仍可编辑导出';
    }
    publish();
  }

  if (usedTemplate) {
    deck.title = cleanTitle(outlineJson?.title, deck.title);
    deck.origin = 'template';
    warnings.push('AI 没能用上，已生成一份离线模板：内容来自项目里已有的文字，空缺处写「待补充」，可以直接编辑导出。');
  }

  /* ---------------- 第 3 步：终检 ---------------- */
  const s3 = steps[2];
  const aiIssues: DeckIssue[] = [];
  if (!allowed(s3.agentId)) {
    s3.status = 'skipped';
    s3.note = '这个助手在设置里被关掉了，只做本地检查';
    publish();
  } else {
    s3.status = 'running';
    publish();
    const t0 = Date.now();
    const verdict = await callJson(
      s3,
      [
        brief,
        '',
        '【待检查的逐页内容】',
        toReviewBody(deck.slides),
        '',
        '【本步任务】逐页核对事实、来源、标识与篇幅，只报告问题。',
        '只输出 JSON：{"canExport":true,"issues":[{"page":1,"level":"high|mid|low","text":"问题与位置"}]}。没有问题就返回空数组。',
      ].join('\n'),
    );
    s3.ms = Date.now() - t0;
    if (verdict) {
      aiIssues.push(...parseIssues(verdict));
      s3.status = 'done';
      s3.note = aiIssues.length ? `发现 ${aiIssues.length} 处待核对` : '没有发现问题';
    } else {
      s3.status = 'failed';
      s3.note = '终检没跑起来，已用本地规则检查';
    }
    publish();
  }

  const local = auditDeck(deck, facts);
  deck.issues = mergeIssues(aiIssues, local);
  deck.updatedAt = Date.now();
  deck.version = (base?.version ?? 0) + 1;
  if (base?.createdAt) deck.createdAt = base.createdAt;

  if (local.length) warnings.push(`本地检查发现 ${local.length} 处待核对，导出前请看下面的清单。`);
  return { deck, steps, warnings, usedTemplate };
}

function cleanTitle(raw: unknown, fallback: string): string {
  const s = String(raw ?? '').replace(/[#*`>|]/g, '').trim();
  return s && s.length <= 60 ? s : fallback;
}
