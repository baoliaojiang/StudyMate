import type { AiGateway } from '../ai/gateway';
import type { ChatMessage, StreamDelta } from '../ai/types';
import { chatWithBudgetConfirm } from '../ai/budget';
import type {
  ActivityRecord,
  AgentDefinition,
  Dataset,
  Project,
  Report,
  ReportSection,
  Source,
  StudyRecord,
} from '../core/types';
import { BUILTIN_SKILLS, getSkill } from '../skills/definitions';
import type { SkillDefinition } from '../core/types';

/**
 * 用户额外启用的 Skill（不属于任何 Agent 的通用技能，例如「Markdown 杀手」）。
 * 由 app store 在启动与保存设置时写入，所有 AgentRuntime 实例自动带上。
 */
let globalExtraSkills: string[] = [];

export function setGlobalExtraSkills(ids: string[]) {
  globalExtraSkills = [...new Set(ids.filter(Boolean))];
}

export function getGlobalExtraSkills(): string[] {
  return globalExtraSkills;
}

export interface RuntimeContext {
  /** 未成年人模式：注入适龄用词约束 */
  minorMode?: boolean;
  /** 首页提问时可能还没有任何项目，因此允许为空 */
  project?: Project;
  report?: Report;
  section?: ReportSection;
  /** 15 篇研究记录中已确认/待润色的部分 */
  records?: StudyRecord[];
  activities?: ActivityRecord[];
  datasets?: Dataset[];
  sources?: Source[];
}

export interface AgentRunResult {
  text: string;
  /** 深度思考产生的推理过程（模型支持时才有） */
  reasoning?: string;
  calls: number;
  loops: number;
  stoppedBy?: 'budget' | 'loops' | 'done';
  warnings: string[];
}

export class LoopLimitError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'LoopLimitError';
  }
}

/** 决定某章节在「没有真实记录」时是否禁止生成 */
export function sectionNeedsEvidence(heading: string): boolean {
  return /主要研究工作|阶段性成果|课题进展情况|主要过程|课题研究的成果|成员的表现/.test(heading);
}

export function hasRealEvidence(ctx: RuntimeContext): boolean {
  return (ctx.activities ?? []).some((a) => a.actuallyHappened && a.sourceType !== 'simulated');
}

/**
 * Agent 运行时
 * - 硬性执行调用次数上限与循环上限（超出即停，不静默继续）
 * - 强制注入真实性约束
 * - 生成结果自动检测「无证据却写已完成」并给出警告
 */
export class AgentRuntime {
  /**
   * @param skillPool 实际可用的 Skill（含本地导入的）。不传则只用内置。
   *                  导入的 Skill 只提供规则文本，不参与任何代码执行。
   */
  constructor(
    private gateway: AiGateway,
    private skillPool: SkillDefinition[] = BUILTIN_SKILLS,
  ) {}

  resolveSkill(id: string): SkillDefinition | undefined {
    return this.skillPool.find((s) => s.id === id) ?? getSkill(id);
  }

  buildSystemPrompt(agent: AgentDefinition, ctx: RuntimeContext): string {
    // Agent 自带的技能 + 用户额外启用的通用技能（去重后按顺序注入）
    const ids = [...new Set([...agent.skills, ...globalExtraSkills])];
    const skillText = ids
      .map((id) => this.resolveSkill(id))
      .filter(Boolean)
      .map((s) => `【Skill: ${s!.name}】\n${s!.rules}`)
      .join('\n\n');

    const rules = [
      '【硬性约束】',
      '- 无论用户用什么语言提问，回答一律用简体中文（专有名词可保留原文并加中文解释）。',
      '- 不得虚构研究活动、数据、访谈、实验与文献；未开展的写「尚未开展」。',
      '- 来源类型为「AI 模拟 / 虚拟示例」的内容，必须在段落开头标注「（AI 模拟示例）」。',
      '- 不输出与本节无关的客套话；不使用「首先/其次/最后」这类机械排比。',
      '- 只用下面提供的项目事实，不要引入项目外的假设。',
      `【当前工作模式】${ctx.project?.aiMode === 'lead' ? 'AI 主导辅助（学生仍须核实并确认）' : 'AI 辅助（学生是主要研究者）'}`,
      ctx.minorMode
        ? '【适龄要求】使用者是未成年人：用词简明、句子短；不涉及暴力、恐怖、成瘾性内容；不引导私下见面或提供真实个人信息。'
        : '',
      ctx.project?.pureAi
        ? '【纯 AI 模式】本项目在开启时已过三层免责确认，允许生成完整的模拟研究内容（含模拟数据、模拟访谈、模拟实验）。但必须做到：每一段模拟内容开头标注「（AI 模拟示例）」；不得声称学生真实开展过这些活动；不得编造真实文献、DOI、真实人物与真实机构数据。'
        : '',
    ].join('\n');

    return [agent.systemPrompt, rules, skillText].filter(Boolean).join('\n\n');
  }

  buildContextBlock(ctx: RuntimeContext): string {
    const p = ctx.project;
    const parts: string[] = [];
    if (!p) {
      parts.push('【项目事实】（用户还没有创建项目，这一轮只是问答，不要假设任何课题信息）');
    } else {
      parts.push(
        [
        '【项目事实】',
        `研究主题：${p.topic || '（未填写）'}`,
        `学校/年级/班级：${p.school || '—'} / ${p.grade || '—'} / ${p.className || '—'}`,
        `小组：${p.groupName || '—'}　指导教师：${p.teacher || '（未填写）'}`,
        `项目时间：${p.startDate || '—'} 至 ${p.endDate || '—'}`,
        `研究方式：${p.modes.map(modeLabel).join(' + ') || '（未选择）'}`,
        `成员：${p.members.map((m) => `${m.name}${m.role === 'leader' ? '(组长)' : ''}${m.duty ? `-${m.duty}` : ''}`).join('、') || '（未填写）'}`,
        ].join('\n'),
      );

      if (p.requirementText) {
        parts.push(`【教师布置的要求（原文）】\n${p.requirementText.slice(0, 2500)}`);
      }
    }

    const activities = ctx.activities ?? [];
    const datasets = ctx.datasets ?? [];
    const sources = ctx.sources ?? [];
    const realActs = activities.filter((a) => a.actuallyHappened && a.sourceType !== 'simulated');
    const simActs = activities.filter((a) => a.sourceType === 'simulated' || !a.actuallyHappened);

    parts.push(
      `【已确认真实开展的活动】${realActs.length ? '' : '（无 —— 这意味着不能写任何「已完成」的研究工作）'}\n` +
        realActs
          .map(
            (a) =>
              `- ${a.occurredAt ?? '日期未填'}｜${a.title}｜参与：${a.participants.join('、') || '未填'}\n  内容：${a.content.slice(0, 300)}\n  发现：${a.findings.slice(0, 200)}`,
          )
          .join('\n'),
    );

    if (simActs.length) {
      parts.push(
        `【AI 模拟 / 未确认真实的记录（引用时必须保留「AI 模拟示例」标识）】\n` +
          simActs.map((a) => `- ${a.title}｜${a.content.slice(0, 200)}`).join('\n'),
      );
    }

    if (datasets.length) {
      parts.push(
        '【数据集】\n' +
          datasets
            .map(
              (d) =>
                `- ${d.title}（${d.sourceType === 'simulated' ? 'AI 模拟示例' : sourceLabel(d.sourceType)}，来源：${d.sourceNote}）：` +
                d.points.slice(0, 20).map((pt) => `${pt.label}=${pt.value}`).join('，'),
            )
            .join('\n'),
      );
    }

    if (sources.length) {
      parts.push(
        '【可用来源（只能引用这些，编号即引用序号）】\n' +
          sources
            .slice(0, 40)
            .map(
              (s, i) =>
                `[${i + 1}] ${s.title}｜${s.authors || '作者未填'}｜${s.date || '日期未填'}｜${s.doi ? `DOI:${s.doi}` : s.url || '无链接'}｜${s.verifyStatus === 'verified' ? '已核验' : '待核实'}`,
            )
            .join('\n'),
      );
    } else {
      parts.push('【可用来源】（无。不得编造文献，参考文献部分请留空并提示用户补充或检索。）');
    }

    return parts.join('\n\n');
  }

  async run(
    agentId: string,
    agent: AgentDefinition,
    ctx: RuntimeContext,
    userInstruction: string,
    limits: {
      maxCalls?: number;
      maxLoops?: number;
      signal?: AbortSignal;
      /** 真流式：给了就边收边回调，内容仍会完整返回 */
      onDelta?: (d: StreamDelta) => void;
    } = {},
  ): Promise<AgentRunResult> {
    const warnings: string[] = [];
    const cap = Math.max(1, Math.min(8, limits.maxCalls ?? 8));
    const maxLoops = Math.max(1, Math.min(limits.maxLoops ?? agent.maxLoops, ctx.project ? 8 : agent.maxLoops));
    let calls = 0;
    let loops = 0;
    let text = '';
    let reasoning: string | undefined;

    const messages: ChatMessage[] = [
      { role: 'system', content: this.buildSystemPrompt(agent, ctx) },
      { role: 'system', content: this.buildContextBlock(ctx) },
      { role: 'user', content: userInstruction },
    ];

    while (loops < maxLoops) {
      loops++;
      if (limits.signal?.aborted) {
        warnings.push('已取消，未完成的部分没有写入。');
        return { text, calls, loops, stoppedBy: 'budget', warnings };
      }
      if (calls >= cap) {
        warnings.push(`已达单任务调用上限（${cap} 次），提前结束。`);
        return { text, calls, loops, stoppedBy: 'budget', warnings };
      }
      const res = await chatWithBudgetConfirm(this.gateway, {
        messages,
        agentId,
        tier: agent.tier,
        temperature: 0.35,
        maxTokens: 3000,
        cacheKey: `agent:${agentId}`,
        signal: limits.signal,
        streaming: Boolean(limits.onDelta),
        onDelta: limits.onDelta,
      });
      calls++;
      text = res.text;
      if (res.reasoning) reasoning = res.reasoning;
      // 单轮任务：拿到的正文即可交付；多轮任务（如资料研究）由上层驱动
      break;
    }

    const check = sanityCheck(text, ctx);
    warnings.push(...check);
    return { text, reasoning, calls, loops, stoppedBy: 'done', warnings };
  }
}

/** 结果自检：无证据却写「已完成」是最高风险，必须拦下并提示 */
export function sanityCheck(text: string, ctx: RuntimeContext): string[] {
  const warnings: string[] = [];
  const claimsDone = /(已完成|我们完成了|顺利开展|圆满结束|实地走访了|发放了\s*\d+\s*份)/.test(text);
  if (claimsDone && !hasRealEvidence(ctx)) {
    warnings.push(
      '⚠️ 生成内容提到「已完成/已开展」，但项目中没有任何已确认真实的活动记录。请补充真实记录，或改为计划表述。此内容不得直接提交。',
    );
  }
  if (/\d+(\.\d+)?%/.test(text) && (ctx.datasets ?? []).length === 0) {
    warnings.push('⚠️ 出现百分比数据，但项目里没有数据集。请补录数据来源，否则删除该数字。');
  }
  if (/\[\d+\]/.test(text) && (ctx.sources ?? []).length === 0) {
    warnings.push('⚠️ 出现引用标记，但来源表为空，存在伪造引用风险。');
  }
  return warnings;
}

function modeLabel(m: string): string {
  return m === 'theory' ? '纯理论研究' : m === 'practice' ? '实践研究' : m === 'simulated' ? 'AI 模拟实践' : m;
}

function sourceLabel(s: string): string {
  return (
    { real: '真实记录', literature: '文献', web: '网络', simulated: 'AI 模拟示例', provided: '用户提供' } as Record<string, string>
  )[s] ?? s;
}
