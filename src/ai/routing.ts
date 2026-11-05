import type { ProviderRow } from '../core/db';
import type { AppSettings, ModelEntry, RoutingConfig } from '../core/types';
import { BUILTIN_AGENTS } from '../agents/definitions';

export type Tier = 'cheap' | 'balanced' | 'strong';

export type TaskKind = 'chat' | 'record' | 'report' | 'plan' | 'analysis' | 'summary';

export interface RouteRequest {
  agentId?: string;
  task?: TaskKind;
  explicitProviderId?: string;
  explicitModel?: string;
  /** 顶栏「快速 / 进阶」的选择 */
  userPick?: { providerId: string; model: string; tier: 'fast' | 'pro' } | null;
  /** 调用方判断这是复杂任务（长文、需要推理、多步） */
  complex?: boolean;
}

export type RouteReason =
  | 'explicit'
  | 'agent'
  | 'user-pick'
  | 'rule'
  | 'default'
  | 'only-available';

export interface RouteDecision {
  providerId: string;
  model: string;
  tier: Tier;
  reason: string;
  reasonCode: RouteReason;
  /** 供界面展示的估算档 */
  costLevel: 'free' | 'low' | 'mid' | 'high' | 'unknown';
}

/** 任务类型 → 需要多强的模型。规则写死，避免「什么都用最强」 */
export const TASK_TIER: Record<TaskKind, Tier> = {
  chat: 'balanced',
  record: 'cheap',
  report: 'strong',
  plan: 'strong',
  analysis: 'strong',
  summary: 'cheap',
};

const CHEAP_RE = /(mini|flash|lite|small|haiku|nano|turbo|8b|7b|3b|1\.5b|qwen.*(0\.5b|1b|3b))/i;
const STRONG_RE = /(pro|opus|max|o1|o3|o4|reason|large|plus|sonnet|r1|qwen.*(32b|72b))/i;

const TASK_LABEL: Record<TaskKind, string> = {
  chat: '对话',
  record: '记录',
  report: '报告',
  plan: '规划',
  analysis: '分析',
  summary: '小结',
};

export function classifyTier(req: RouteRequest): { tier: Tier; why: string } {
  if (req.complex) return { tier: 'strong', why: '调用方标记为复杂任务' };
  const agent = req.agentId ? BUILTIN_AGENTS.find((a) => a.id === req.agentId) : undefined;
  if (agent) return { tier: agent.tier as Tier, why: `按 ${agent.name} 的默认档位` };
  if (req.task) return { tier: TASK_TIER[req.task], why: `按任务类型「${TASK_LABEL[req.task]}」` };
  return { tier: 'balanced', why: '未指定任务类型，采用均衡档位' };
}

function priceOf(m: ModelEntry): number {
  if (m.priceIn == null) return Number.POSITIVE_INFINITY;
  return m.priceIn;
}

function costLevelOf(m: ModelEntry): RouteDecision['costLevel'] {
  if (m.priceIn == null) return 'unknown';
  if (m.priceIn === 0) return 'free';
  if (m.priceIn < 1) return 'low';
  if (m.priceIn < 5) return 'mid';
  return 'high';
}

interface Candidate {
  provider: ProviderRow;
  model: ModelEntry;
}

function candidatesOf(providers: ProviderRow[], tier: Tier): Candidate[] {
  const all: Candidate[] = [];
  for (const p of providers) {
    if (p.enabled === false) continue;
    if (!p.apiKeyLen && p.kind !== 'local') continue;
    for (const m of p.models) all.push({ provider: p, model: m });
  }
  // 没有服务商标了 enabled 但全被过滤掉时，退一步用全部有模型的
  if (!all.length) {
    for (const p of providers) for (const m of p.models) all.push({ provider: p, model: m });
  }
  return all;
}

/** 同一档位内怎么挑：先看实测可用，再看收藏，再看价格 */
function rank(a: Candidate, b: Candidate, tier: Tier): number {
  const av = a.model.cap?.verified ? 0 : 1;
  const bv = b.model.cap?.verified ? 0 : 1;
  if (av !== bv) return av - bv;
  if (tier === 'strong') {
    const ar = a.model.cap?.reasoning ? 0 : 1;
    const br = b.model.cap?.reasoning ? 0 : 1;
    if (ar !== br) return ar - br;
  }
  const af = a.model.favorite ? 0 : 1;
  const bf = b.model.favorite ? 0 : 1;
  if (af !== bf) return af - bf;
  if (tier === 'cheap') {
    // 名字本身就是轻量款的优先（mini / flash / 3b 这类），再看价格
    const an = CHEAP_RE.test(a.model.name) ? 0 : 1;
    const bn = CHEAP_RE.test(b.model.name) ? 0 : 1;
    if (an !== bn) return an - bn;
    return priceOf(a.model) - priceOf(b.model);
  }
  if (tier === 'strong') {
    const ap = a.model.priceIn ?? -1;
    const bp = b.model.priceIn ?? -1;
    return bp - ap;
  }
  // balanced：优先服务商标的默认模型
  const ad = a.provider.defaultModel === a.model.name ? 0 : 1;
  const bd = b.provider.defaultModel === b.model.name ? 0 : 1;
  if (ad !== bd) return ad - bd;
  return priceOf(a.model) - priceOf(b.model);
}

function pickInTier(cands: Candidate[], tier: Tier): Candidate | null {
  if (!cands.length) return null;
  if (tier === 'cheap') {
    const cheap = cands.filter((c) => CHEAP_RE.test(c.model.name) || (c.model.priceIn != null && c.model.priceIn <= 1));
    if (cheap.length) return [...cheap].sort((a, b) => rank(a, b, tier))[0];
  }
  if (tier === 'strong') {
    const strong = cands.filter((c) => STRONG_RE.test(c.model.name) || c.model.cap?.reasoning);
    if (strong.length) return [...strong].sort((a, b) => rank(a, b, tier))[0];
  }
  return [...cands].sort((a, b) => rank(a, b, tier))[0];
}

/**
 * 选模型。顺序固定：手动指定 → Agent 映射 → 顶栏选择 → 规则 → 默认服务商 → 唯一可用。
 * 任何一步都不看「模型列表里有没有」，只看这个服务商配了 Key、这个模型被选进来了。
 */
export function routeModel(
  providers: ProviderRow[],
  settings: Pick<AppSettings, 'agentModels' | 'currentModel' | 'routing' | 'autoAssign'>,
  req: RouteRequest = {},
): RouteDecision | null {
  const routing: RoutingConfig = settings.routing;
  const live = providers.filter((p) => p.models.length > 0);

  // 1. 显式指定
  if (req.explicitProviderId && req.explicitModel) {
    const p = providers.find((x) => x.id === req.explicitProviderId);
    const m = p?.models.find((x) => x.name === req.explicitModel);
    if (p && m) {
      return { providerId: p.id, model: m.name, tier: 'balanced', reason: '手动指定', reasonCode: 'explicit', costLevel: costLevelOf(m) };
    }
  }

  // 2. Agent 映射（自动分配开启时才生效）
  if (settings.autoAssign && req.agentId) {
    const mapped = settings.agentModels[req.agentId];
    const p = mapped ? providers.find((x) => x.id === mapped.providerId) : undefined;
    const m = p?.models.find((x) => x.name === mapped?.model);
    if (p && m) {
      const agent = BUILTIN_AGENTS.find((a) => a.id === req.agentId);
      return {
        providerId: p.id,
        model: m.name,
        tier: (agent?.tier as Tier) ?? 'balanced',
        reason: `按 Agent「${agent?.name ?? req.agentId}」指定`,
        reasonCode: 'agent',
        costLevel: costLevelOf(m),
      };
    }
  }

  // 3. 顶栏选择
  if (req.userPick) {
    const p = providers.find((x) => x.id === req.userPick!.providerId);
    const m = p?.models.find((x) => x.name === req.userPick!.model);
    if (p && m) {
      return {
        providerId: p.id,
        model: m.name,
        tier: req.userPick.tier === 'pro' ? 'strong' : 'cheap',
        reason: '顶栏手动选择',
        reasonCode: 'user-pick',
        costLevel: costLevelOf(m),
      };
    }
  }

  const { tier: baseTier, why } = classifyTier(req);
  let tier = baseTier;
  // 复杂任务才用高性能：不复杂就把 strong 降成 balanced
  if (routing.strongOnlyForComplex && tier === 'strong' && !req.complex && req.task !== 'report' && req.task !== 'plan' && req.task !== 'analysis') {
    tier = 'balanced';
  }

  // 4. 规则优先（关掉自动分配就跳过，尊重人工选择）
  if (routing.ruleFirst && settings.autoAssign) {
    const pick = pickInTier(candidatesOf(live, tier), tier);
    if (pick) {
      return {
        providerId: pick.provider.id,
        model: pick.model.name,
        tier,
        reason: `${why}，${tier === 'cheap' ? '优先低成本模型' : tier === 'strong' ? '选用高性能模型' : '选用均衡档位'}`,
        reasonCode: 'rule',
        costLevel: costLevelOf(pick.model),
      };
    }
  }

  // 5. 默认服务商
  const def = live.find((p) => p.isDefault) ?? live.find((p) => p.enabled !== false);
  if (def) {
    const m = def.models.find((x) => x.name === def.defaultModel) ?? def.models[0];
    if (m) {
      return {
        providerId: def.id,
        model: m.name,
        tier,
        reason: '使用默认服务商的默认模型',
        reasonCode: 'default',
        costLevel: costLevelOf(m),
      };
    }
  }

  // 6. 唯一可用
  const only = live[0];
  if (only?.models[0]) {
    return {
      providerId: only.id,
      model: only.models[0].name,
      tier,
      reason: '仅有一个可用模型',
      reasonCode: 'only-available',
      costLevel: costLevelOf(only.models[0]),
    };
  }
  return null;
}

/** 供界面展示：按 Agent 列出当前会落到哪个模型 */
export function previewRoutes(
  providers: ProviderRow[],
  settings: Pick<AppSettings, 'agentModels' | 'currentModel' | 'routing' | 'autoAssign'>,
): { agentId: string; name: string; tier: Tier; decision: RouteDecision | null; manual: boolean }[] {
  return BUILTIN_AGENTS.map((a) => ({
    agentId: a.id,
    name: a.name,
    tier: a.tier as Tier,
    decision: routeModel(providers, settings, { agentId: a.id, complex: a.tier === 'strong' }),
    manual: Boolean(settings.agentModels[a.id]),
  }));
}
