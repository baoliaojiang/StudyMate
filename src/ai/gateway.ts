import { open_ } from '../core/crypto';
import type { StudyMateDB, ProviderRow } from '../core/db';
import type { AppSettings, BudgetConfig, UsageRecord } from '../core/types';
import { estimateTokens } from './http';
import { adapterFor } from './providers';
import { ProviderError, type ChatMessage, type ChatResult, type StreamDelta } from './types';
import { routeModel, type TaskKind, type Tier } from './routing';

export interface ChatRequest {
  messages: ChatMessage[];
  providerId?: string;
  model?: string;
  agentId?: string;
  /** 任务类型；决定走便宜模型还是高性能模型 */
  task?: TaskKind;
  /** 调用方判定为复杂任务 */
  complex?: boolean;
  /** 自动分配时使用的档位（显式传则跳过规则） */
  tier?: Tier;
  temperature?: number;
  maxTokens?: number;
  /** 相同 cacheKey 在 TTL 内直接命中，省钱 */
  cacheKey?: string;
  /** 深度思考：未传则跟随全局设置 */
  thinking?: boolean;
  /** 真流式：为 true 时边收边回调，界面不必等全文 */
  streaming?: boolean;
  onDelta?: (d: StreamDelta) => void;
  /** 已确认「超预算继续」，避免二次拦截 */
  confirmOverBudget?: boolean;
  signal?: AbortSignal;
}

export interface BudgetSnapshot {
  callsToday: number;
  costToday: number;
  tokensToday: number;
  callsLimit: number;
  costLimit: number;
  blocked: boolean;
  /** 已用到提醒线（默认 80%） */
  nearLimit: boolean;
  /** 已用比例，0–1；未设上限时为 0 */
  ratio: number;
  reason?: string;
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

/** 到上限但策略是「暂停确认」时抛这个；UI 弹确认框，用户同意后带 confirmOverBudget 重试 */
export class BudgetConfirmRequiredError extends Error {
  constructor(
    message: string,
    readonly snapshot: BudgetSnapshot,
  ) {
    super(message);
    this.name = 'BudgetConfirmRequiredError';
  }
}

const CACHE_MAX = 60;

interface CacheEntry {
  at: number;
  result: ChatResult;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface UsageStats {
  calls: number;
  failed: number;
  cost: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  avgDuration: number;
  /** 平均单次耗时（秒） */
  cacheHits: number;
  dedupeHits: number;
  byModel: { key: string; providerId: string; model: string; calls: number; tokens: number; cost: number; avgDuration: number }[];
  byAgent: { agentId: string; calls: number; cost: number }[];
}

export class AiGateway {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<ChatResult>>();
  private cacheHits = 0;
  private dedupeHits = 0;

  constructor(
    private db: StudyMateDB,
    private getSettings: () => AppSettings,
  ) {}

  /* ------------------------------ 预算 ------------------------------ */

  async budgetSnapshot(): Promise<BudgetSnapshot> {
    const b = this.getSettings().budget;
    const rows = await this.db.usage.where('at').aboveOrEqual(startOfToday()).toArray();
    const callsToday = rows.length;
    const costToday = rows.reduce((s, r) => s + (r.cost || 0), 0);
    const tokensToday = rows.reduce((s, r) => s + (r.promptTokens ?? 0) + (r.completionTokens ?? 0), 0);

    const callRatio = b.dailyCalls > 0 ? callsToday / b.dailyCalls : 0;
    const costRatio = b.dailyCost > 0 ? costToday / b.dailyCost : 0;
    const ratio = Math.max(callRatio, costRatio);
    const callsBlocked = b.dailyCalls > 0 && callsToday >= b.dailyCalls;
    const costBlocked = b.dailyCost > 0 && costToday >= b.dailyCost;
    const warn = b.warnRatio > 0 ? b.warnRatio : 0.8;

    return {
      callsToday,
      costToday,
      tokensToday,
      callsLimit: b.dailyCalls,
      costLimit: b.dailyCost,
      blocked: callsBlocked || costBlocked,
      nearLimit: !(callsBlocked || costBlocked) && ratio >= warn && ratio > 0,
      ratio: Math.min(ratio, 1),
      reason: callsBlocked
        ? `今日调用已达上限 ${b.dailyCalls} 次`
        : costBlocked
          ? `今日预算已达上限 ¥${b.dailyCost}`
          : undefined,
    };
  }

  /**
   * 预算判定。
   * pauseOnExceed + confirmOnBudget = 到上限时暂停，等用户确认；
   * 否则按旧行为直接拒绝。两条路都不会静默超支。
   */
  private assertBudget(b: BudgetConfig, snapshot: BudgetSnapshot, req: ChatRequest) {
    if (b.maxCallsPerTask <= 0) throw new BudgetExceededError('单任务调用上限必须大于 0');
    if (!snapshot.blocked) return;
    const confirmMode = b.pauseOnExceed && this.getSettings().routing.confirmOnBudget;
    // 允许确认后继续；否则到线即停，不静默超支
    if (confirmMode && req.confirmOverBudget) return;
    if (confirmMode) {
      throw new BudgetConfirmRequiredError(snapshot.reason ?? '已达预算上限', snapshot);
    }
    throw new BudgetExceededError(snapshot.reason ?? '已达预算上限');
  }

  /* --------------------------- 模型选择 --------------------------- */

  async resolveTarget(req: ChatRequest): Promise<{
    provider: ProviderRow;
    model: string;
    apiKey: string;
    reason: string;
  }> {
    const settings = this.getSettings();
    const providers = await this.db.providers.toArray();
    if (!providers.length) {
      throw new ProviderError('尚未配置任何服务商，请先前往「设置 → API 管理中心」添加。', undefined, undefined, false);
    }

    const decision = routeModel(providers, settings, {
      agentId: req.agentId,
      task: req.task,
      complex: req.complex,
      explicitProviderId: req.providerId,
      explicitModel: req.model,
      userPick: settings.currentModel,
    });

    const provider = decision ? providers.find((p) => p.id === decision.providerId) : undefined;
    const model = req.model || decision?.model || provider?.defaultModel || provider?.models[0]?.name;
    if (!provider || !model) {
      throw new ProviderError('没有可用的模型，请先在 API 管理中心配置服务商与模型。', undefined, undefined, false);
    }
    if (!provider.models.some((m) => m.name === model)) {
      // 允许显式指定一个不在列表里的模型名（服务商可能临时上新）
      if (!req.model) {
        throw new ProviderError(
          `服务商「${provider.label}」暂无可用模型，请同步或手动录入。`,
          undefined,
          undefined,
          false,
        );
      }
    }

    const apiKey = await open_(provider.apiKeySealed);
    if (!apiKey && provider.kind !== 'local') {
      throw new ProviderError(`服务商「${provider.label}」未配置 API 密钥`, undefined, undefined, false);
    }
    return { provider, model, apiKey, reason: decision?.reason ?? '默认' };
  }

  /* ------------------------------ 调用 ------------------------------ */

  async chat(req: ChatRequest): Promise<ChatResult> {
    const settings = this.getSettings();
    const routing = settings.routing;
    const snapshot = await this.budgetSnapshot();
    this.assertBudget(settings.budget, snapshot, req);

    const cacheKey = !req.streaming && req.cacheKey
      ? `${req.cacheKey}::${req.model ?? 'auto'}::${hash(req.messages.map((m) => m.content).join('|'))}`
      : undefined;

    if (routing.cache && cacheKey) {
      const hit = this.cache.get(cacheKey);
      const ttl = Math.max(1, routing.cacheTtlMin || 5) * 60_000;
      if (hit && Date.now() - hit.at < ttl) {
        this.cacheHits++;
        return hit.result;
      }
    }

    // 并发去重：两个一模一样的请求同时发，只发一次
    if (routing.dedupe && cacheKey) {
      const running = this.inflight.get(cacheKey);
      if (running) {
        this.dedupeHits++;
        return running;
      }
      const p = this.runChat(req, cacheKey);
      this.inflight.set(cacheKey, p);
      try {
        return await p;
      } finally {
        this.inflight.delete(cacheKey);
      }
    }

    return this.runChat(req, cacheKey);
  }

  private async runChat(req: ChatRequest, cacheKey?: string): Promise<ChatResult> {
    const cfg = this.getSettings();
    const routing = cfg.routing;
    const { provider, model, apiKey, reason } = await this.resolveTarget(req);
    const adapter = adapterFor(provider.kind);
    const params = provider.params ?? {};
    const messages = routing.compress ? compress(req.messages) : req.messages;

    const started = performance.now();
    try {
      const result = await adapter.chat(provider, apiKey, model, messages, {
        temperature: req.temperature ?? params.temperature,
        maxTokens: req.maxTokens ?? params.maxTokens,
        signal: req.signal,
        thinking: req.thinking ?? cfg.thinking === true,
        streaming: req.streaming,
        onDelta: req.onDelta,
      });

      const entry = provider.models.find((m) => m.name === model);
      const cost = computeCost(result, entry);
      await this.record({
        at: Date.now(),
        providerId: provider.id,
        model: result.model || model,
        agentId: req.agentId,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        duration: result.duration || (performance.now() - started) / 1000,
        cost,
        ok: true,
      });

      if (routing.cache && cacheKey) this.putCache(cacheKey, result);
      void reason;
      return result;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await this.record({
        at: Date.now(),
        providerId: provider.id,
        model,
        agentId: req.agentId,
        duration: (performance.now() - started) / 1000,
        cost: 0,
        ok: false,
        error: err.slice(0, 300),
      });

      // 备用 API：用户自行配置的 fallbackOf
      const backup = await this.db.providers.toArray();
      const fb = backup.find((p) => p.fallbackOf === provider.id && p.id !== provider.id && p.enabled !== false);
      if (fb && !req.providerId) {
        const fbKey = await open_(fb.apiKeySealed);
        const fbModel = fb.defaultModel ?? fb.models[0]?.name;
        if ((fbKey || fb.kind === 'local') && fbModel) {
          const r = await adapterFor(fb.kind).chat(fb, fbKey, fbModel, messages, {
            temperature: req.temperature,
            maxTokens: req.maxTokens,
            signal: req.signal,
          });
          await this.record({
            at: Date.now(),
            providerId: fb.id,
            model: fbModel,
            agentId: req.agentId,
            promptTokens: r.promptTokens,
            completionTokens: r.completionTokens,
            duration: r.duration,
            cost: computeCost(r, fb.models.find((m) => m.name === fbModel)),
            ok: true,
          });
          return r;
        }
      }
      throw e;
    }
  }

  private putCache(key: string, result: ChatResult) {
    if (this.cache.size >= CACHE_MAX) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    this.cache.set(key, { at: Date.now(), result });
  }

  async record(r: UsageRecord): Promise<void> {
    await this.db.usage.add(r);
  }

  async usageSummary(): Promise<UsageStats> {
    const rows = await this.db.usage.where('at').aboveOrEqual(startOfToday()).toArray();
    const byModelMap = new Map<string, UsageStats['byModel'][number]>();
    const byAgentMap = new Map<string, UsageStats['byAgent'][number]>();
    let promptTokens = 0;
    let completionTokens = 0;

    for (const r of rows) {
      promptTokens += r.promptTokens ?? 0;
      completionTokens += r.completionTokens ?? 0;

      const key = `${r.providerId}::${r.model}`;
      const cur = byModelMap.get(key) ?? {
        key,
        providerId: r.providerId,
        model: r.model,
        calls: 0,
        tokens: 0,
        cost: 0,
        avgDuration: 0,
      };
      cur.calls += 1;
      cur.tokens += (r.promptTokens ?? 0) + (r.completionTokens ?? 0);
      cur.cost += r.cost || 0;
      cur.avgDuration += r.duration || 0;
      byModelMap.set(key, cur);

      const agentKey = r.agentId || 'manual';
      const ac = byAgentMap.get(agentKey) ?? { agentId: agentKey, calls: 0, cost: 0 };
      ac.calls += 1;
      ac.cost += r.cost || 0;
      byAgentMap.set(agentKey, ac);
    }

    const byModel = [...byModelMap.values()]
      .map((m) => ({ ...m, avgDuration: m.calls ? m.avgDuration / m.calls : 0 }))
      .sort((a, b) => b.cost - a.cost || b.calls - a.calls);

    return {
      calls: rows.length,
      failed: rows.filter((r) => !r.ok).length,
      cost: rows.reduce((s, r) => s + (r.cost || 0), 0),
      tokens: promptTokens + completionTokens,
      promptTokens,
      completionTokens,
      avgDuration: rows.length ? rows.reduce((s, r) => s + (r.duration || 0), 0) / rows.length : 0,
      cacheHits: this.cacheHits,
      dedupeHits: this.dedupeHits,
      byModel,
      byAgent: [...byAgentMap.values()].sort((a, b) => b.calls - a.calls),
    };
  }

  /** 清掉内存缓存（改配置后调用，避免旧结果串味） */
  clearCache() {
    this.cache.clear();
  }
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                             */
/* ------------------------------------------------------------------ */

export function pickByTier(provider: ProviderRow, tier: Tier): string {
  const names = provider.models.map((m) => m.name);
  if (!names.length) return '';
  const cheapRe = /(mini|flash|lite|small|haiku|nano|turbo)/i;
  const strongRe = /(pro|opus|max|o1|o3|reason|large|plus|sonnet)/i;
  if (tier === 'cheap') return names.find((n) => cheapRe.test(n)) ?? names[0];
  if (tier === 'strong') return names.find((n) => strongRe.test(n)) ?? names[names.length - 1];
  return provider.defaultModel ?? names[Math.floor(names.length / 2)] ?? names[0];
}

export function computeCost(
  result: ChatResult,
  entry?: { priceIn?: number; priceOut?: number },
): number {
  if (!entry || (entry.priceIn == null && entry.priceOut == null)) return 0;
  const inTok = result.promptTokens ?? 0;
  const outTok = result.completionTokens ?? 0;
  return ((inTok * (entry.priceIn ?? 0) + outTok * (entry.priceOut ?? 0)) / 1_000_000) || 0;
}

/**
 * 上下文压缩：保留首条 system 与最近 N 条；较早的长消息折叠为摘要标记。
 * 目的是省钱，不改变语义主体。明确告知调用方发生了压缩。
 */
export function compress(messages: ChatMessage[], keepRecent = 8): ChatMessage[] {
  if (messages.length <= keepRecent + 2) return messages;
  const system = messages.filter((m) => m.role === 'system');
  const dialog = messages.filter((m) => m.role !== 'system');
  const head = dialog.slice(0, 1);
  const tail = dialog.slice(-keepRecent);
  const dropped = dialog.length - head.length - tail.length;
  if (dropped <= 0) return messages;
  const notice: ChatMessage = {
    role: 'system',
    content: `（已压缩 ${dropped} 条较早的上下文消息以控制成本；关键结论请自行保留在后续消息中。）`,
  };
  return [...system, ...head, notice, ...tail];
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** 供 UI 预估本次调用成本 */
export function estimateCost(prompt: string, maxOut: number, priceIn = 0, priceOut = 0): number {
  return (estimateTokens(prompt) * priceIn + maxOut * priceOut) / 1_000_000;
}
