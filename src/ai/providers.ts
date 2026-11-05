import type { ProviderConfig } from '../core/types';
import type { AdapterConfig } from './types';
import { fetchJson, fetchSse, joinUrl, trimSlash } from './http';
import { stripInlineThink } from './think';
import {
  ModelListUnsupportedError,
  ProviderError,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type ProviderAdapter,
} from './types';

/** OpenAI 兼容接口：绝大多数国产与大厂服务商都走这套（/chat/completions） */
export const openaiCompatible: ProviderAdapter = {
  kind: 'openai-compatible',
  supportsBalance: false,

  async chat(cfg, apiKey, model, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    if (!apiKey) throw new ProviderError('尚未填写 API Key', undefined, undefined, false);
    const effectiveModel = model || cfg.defaultModel || cfg.models[0]?.name;
    if (!effectiveModel) throw new ProviderError('尚未选择模型', undefined, undefined, false);
    const p = cfg.params ?? {};

    const url = joinUrl(cfg.baseUrl, '/chat/completions');
    const body = {
      model: effectiveModel,
      messages,
      temperature: opts.temperature ?? p.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? p.maxTokens ?? 2048,
      ...(p.topP != null ? { top_p: p.topP } : {}),
      ...(p.frequencyPenalty != null ? { frequency_penalty: p.frequencyPenalty } : {}),
      // 深度思考：兼容层用 reasoning_effort（OpenAI o 系与多数网关都认这个字段）
      ...(opts.thinking ? { reasoning_effort: 'medium' } : {}),
      // 开发者模式里填的额外字段最后覆盖，便于兼容个别服务商的私有参数
      ...(p.extraBody ?? {}),
    };

    /* ---------------------------- 真流式 ---------------------------- */
    if (opts.streaming && opts.onDelta) {
      let text = '';
      let reasoning = '';
      let hitTokens: number | undefined;
      let outTokens: number | undefined;
      let modelName = effectiveModel;

      const run = async (withUsage: boolean) =>
        fetchSse(url, {
          timeoutMs: opts.timeoutMs ?? cfg.timeoutMs ?? 120000,
          maxRetries: cfg.maxRetries ?? 1,
          secrets: [apiKey],
          signal: opts.signal,
          headers: { Authorization: `Bearer ${apiKey}`, ...(p.headers ?? {}) },
          body: {
            ...body,
            stream: true,
            // 费用统计要用 usage；少数网关不认这个字段，由外层降级重试
            ...(withUsage ? { stream_options: { include_usage: true } } : {}),
          },
          onData: (d: any) => {
            if (d?.model) modelName = d.model;
            if (d?.usage) {
              hitTokens = d.usage.prompt_tokens ?? hitTokens;
              outTokens = d.usage.completion_tokens ?? outTokens;
            }
            const choice = d?.choices?.[0];
            const piece = choice?.delta ?? choice?.message;
            if (!piece) return;
            const t = typeof piece.content === 'string' ? piece.content : '';
            // 思考只走 reasoning 字段：绝不把它累加进正文
            const r =
              typeof piece.reasoning_content === 'string'
                ? piece.reasoning_content
                : typeof piece.reasoning === 'string'
                  ? piece.reasoning
                  : '';
            if (r) {
              reasoning += r;
              opts.onDelta?.({ reasoning: r });
            }
            if (t) {
              text += t;
              opts.onDelta?.({ text: t });
            }
          },
        });

      let duration = 0;
      try {
        duration = (await run(true)).duration;
      } catch (e) {
        // 一个字都没吐出来才敢重来：换成不带 stream_options 的请求
        const rejected =
          e instanceof ProviderError &&
          e.status === 400 &&
          /stream_options|unknown field|unsupported/i.test(String(e.detail ?? ''));
        if (rejected && !text && !reasoning) duration = (await run(false)).duration;
        else throw e;
      }

      if (!text && !reasoning) {
        throw new ProviderError('服务商没有返回任何内容', undefined, undefined, true);
      }
      return {
        text,
        model: modelName,
        promptTokens: hitTokens,
        completionTokens: outTokens,
        duration,
        reasoning: reasoning || undefined,
      };
    }

    /* --------------------------- 非流式 --------------------------- */
    const res = await fetchJson<any>(url, {
      timeoutMs: opts.timeoutMs ?? cfg.timeoutMs ?? 60000,
      maxRetries: cfg.maxRetries ?? 1,
      secrets: [apiKey],
      signal: opts.signal,
      headers: { Authorization: `Bearer ${apiKey}`, ...(p.headers ?? {}) },
      body: { ...body, stream: false },
    });

    const choice = res.data?.choices?.[0];
    // 有的网关把思考直接拼在 content 里（<think>…</think>），先剥出来
    const split = stripInlineThink(choice?.message?.content ?? '');
    const text: string = split.text;
    // 推理模型（DeepSeek-R1、Agnes 3.0 等）会把思考写在 reasoning_content，
    // 在很短的输出额度下正文可能为空——这是「额度被思考占满」，不是配置错误。
    const reasoning: string | undefined =
      [choice?.message?.reasoning_content || choice?.message?.reasoning, split.reasoning]
        .filter(Boolean)
        .join('\n\n') || undefined;
    if (!text && !reasoning) {
      throw new ProviderError('服务商返回了空内容', res.status, JSON.stringify(res.data).slice(0, 300), false);
    }
    return {
      text,
      model: res.data?.model ?? effectiveModel,
      promptTokens: res.data?.usage?.prompt_tokens,
      completionTokens: res.data?.usage?.completion_tokens,
      duration: res.duration,
      reasoning,
    };
  },

  async listModels(cfg, apiKey) {
    if (cfg.supportsModelList === false) throw new ModelListUnsupportedError();
    try {
      const res = await fetchJson<any>(joinUrl(cfg.baseUrl, '/models'), {
        timeoutMs: Math.min(cfg.timeoutMs ?? 20000, 20000),
        maxRetries: 0,
        secrets: [apiKey],
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      const list: any[] = res.data?.data ?? res.data?.models ?? [];
      const names = list
        .map((m) => (typeof m === 'string' ? m : m?.id ?? m?.name))
        .filter((x): x is string => typeof x === 'string' && x.length > 0);
      if (!names.length) throw new ModelListUnsupportedError('该地址返回了空的模型列表，请手动添加');
      return names.sort();
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) throw new ModelListUnsupportedError();
      throw e;
    }
  },
};

/** Anthropic Messages API */
export const anthropic: ProviderAdapter = {
  kind: 'anthropic',
  supportsBalance: false,

  async chat(cfg, apiKey, model, messages, opts = {}) {
    if (!apiKey) throw new ProviderError('尚未填写 API Key', undefined, undefined, false);
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');

    const p = cfg.params ?? {};
    const url = joinUrl(cfg.baseUrl || 'https://api.anthropic.com', '/v1/messages');
    const headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // 浏览器环境需要显式允许，官方要求；仅作用于请求头而非 URL
      'anthropic-dangerous-direct-browser-access': 'true',
      ...(p.headers ?? {}),
    };
    const body = {
      model: model || cfg.defaultModel || cfg.models[0]?.name,
      // 开思考时预算必须大于 thinking.budget_tokens，且 temperature 只能为 1
      max_tokens: opts.thinking
        ? Math.max(opts.maxTokens ?? p.maxTokens ?? 2048, 2048)
        : (opts.maxTokens ?? p.maxTokens ?? 2048),
      temperature: opts.thinking ? 1 : (opts.temperature ?? p.temperature ?? 0.4),
      ...(opts.thinking ? { thinking: { type: 'enabled', budget_tokens: 1024 } } : {}),
      ...(p.topP != null ? { top_p: p.topP } : {}),
      system: system || undefined,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
      ...(p.extraBody ?? {}),
    };

    if (opts.streaming && opts.onDelta) {
      let text = '';
      let reasoning = '';
      let inTok: number | undefined;
      let outTok: number | undefined;
      let modelName = model;

      const { duration } = await fetchSse(url, {
        timeoutMs: opts.timeoutMs ?? cfg.timeoutMs ?? 120000,
        maxRetries: cfg.maxRetries ?? 1,
        secrets: [apiKey],
        signal: opts.signal,
        headers,
        body: { ...body, stream: true },
        onData: (d: any) => {
          if (d?.type === 'message_start') {
            modelName = d.message?.model ?? modelName;
            inTok = d.message?.usage?.input_tokens ?? inTok;
          } else if (d?.type === 'content_block_delta') {
            const dl = d.delta;
            // Anthropic 把思考和正文分成两种 delta，按类型分开累积
            if (dl?.type === 'thinking_delta' && dl.thinking) {
              reasoning += dl.thinking;
              opts.onDelta?.({ reasoning: dl.thinking });
            } else if (dl?.type === 'text_delta' && dl.text) {
              text += dl.text;
              opts.onDelta?.({ text: dl.text });
            }
          } else if (d?.type === 'message_delta') {
            outTok = d.usage?.output_tokens ?? outTok;
          }
        },
      });

      if (!text && !reasoning) throw new ProviderError('返回内容为空', undefined, undefined, true);
      return {
        text,
        model: modelName,
        promptTokens: inTok,
        completionTokens: outTok,
        duration,
        reasoning: reasoning || undefined,
      };
    }

    const res = await fetchJson<any>(url, {
      timeoutMs: opts.timeoutMs ?? cfg.timeoutMs ?? 60000,
      maxRetries: cfg.maxRetries ?? 1,
      secrets: [apiKey],
      signal: opts.signal,
      headers,
      body,
    });

    const blocks: any[] = res.data?.content ?? [];
    const text = blocks
      .filter((c: any) => c?.type === 'text')
      .map((c: any) => c.text)
      .join('');
    const reasoning = blocks
      .filter((c: any) => c?.type === 'thinking' || c?.type === 'redacted_thinking')
      .map((c: any) => c?.thinking ?? '')
      .filter(Boolean)
      .join('\n\n');
    if (!text && !reasoning) throw new ProviderError('返回内容为空', res.status, undefined, false);
    return {
      text,
      model: res.data?.model ?? model,
      promptTokens: res.data?.usage?.input_tokens,
      completionTokens: res.data?.usage?.output_tokens,
      duration: res.duration,
      reasoning: reasoning || undefined,
    };
  },

  async listModels(cfg, apiKey) {
    try {
      const res = await fetchJson<any>(joinUrl(cfg.baseUrl || 'https://api.anthropic.com', '/v1/models'), {
        timeoutMs: 15000,
        maxRetries: 0,
        secrets: [apiKey],
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      });
      const names = (res.data?.data ?? []).map((m: any) => m?.id).filter(Boolean);
      if (!names.length) throw new ModelListUnsupportedError();
      return names;
    } catch {
      throw new ModelListUnsupportedError('未能自动拉取 Anthropic 模型列表，请手动添加');
    }
  },
};

/** Google Gemini generateContent —— key 走 header，不拼进 URL */
export const gemini: ProviderAdapter = {
  kind: 'gemini',
  supportsBalance: false,

  async chat(cfg, apiKey, model, messages, opts = {}) {
    if (!apiKey) throw new ProviderError('尚未填写 API Key', undefined, undefined, false);
    const m = model || cfg.defaultModel || cfg.models[0]?.name || 'gemini-2.0-flash';
    const base = cfg.baseUrl || 'https://generativelanguage.googleapis.com';

    const system = messages.filter((x) => x.role === 'system').map((x) => x.content).join('\n\n');
    const contents = messages
      .filter((x) => x.role !== 'system')
      .map((x) => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] }));

    const p = cfg.params ?? {};
    const body = {
      contents,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: {
        temperature: opts.temperature ?? p.temperature ?? 0.4,
        maxOutputTokens: opts.maxTokens ?? p.maxTokens ?? 2048,
        ...(p.topP != null ? { topP: p.topP } : {}),
        // 2.5 系列支持思考摘要；不支持的模型会忽略这个字段
        ...(opts.thinking ? { thinkingConfig: { includeThoughts: true, thinkingBudget: 1024 } } : {}),
      },
      ...(p.extraBody ?? {}),
    };

    if (opts.streaming && opts.onDelta) {
      let text = '';
      let reasoning = '';
      let inTok: number | undefined;
      let outTok: number | undefined;

      const { duration } = await fetchSse(
        joinUrl(base, `/v1beta/models/${m}:streamGenerateContent?alt=sse`),
        {
          timeoutMs: opts.timeoutMs ?? cfg.timeoutMs ?? 120000,
          maxRetries: cfg.maxRetries ?? 1,
          secrets: [apiKey],
          signal: opts.signal,
          headers: { 'x-goog-api-key': apiKey, ...(p.headers ?? {}) },
          body,
          onData: (d: any) => {
            if (d?.usageMetadata) {
              inTok = d.usageMetadata.promptTokenCount ?? inTok;
              outTok = d.usageMetadata.candidatesTokenCount ?? outTok;
            }
            const parts: any[] = d?.candidates?.[0]?.content?.parts ?? [];
            for (const x of parts) {
              const t = typeof x?.text === 'string' ? x.text : '';
              if (!t) continue;
              if (x?.thought) {
                reasoning += t;
                opts.onDelta?.({ reasoning: t });
              } else {
                text += t;
                opts.onDelta?.({ text: t });
              }
            }
          },
        },
      );

      if (!text && !reasoning) throw new ProviderError('返回内容为空（可能被安全策略拦截）', undefined, undefined, true);
      return {
        text,
        reasoning: reasoning || undefined,
        model: m,
        promptTokens: inTok,
        completionTokens: outTok,
        duration,
      };
    }

    const res = await fetchJson<any>(joinUrl(base, `/v1beta/models/${m}:generateContent`), {
      timeoutMs: opts.timeoutMs ?? cfg.timeoutMs ?? 60000,
      maxRetries: cfg.maxRetries ?? 1,
      secrets: [apiKey],
      signal: opts.signal,
      headers: { 'x-goog-api-key': apiKey, ...(p.headers ?? {}) },
      body,
    });

    const parts: any[] = res.data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((x: any) => !x?.thought)
      .map((x: any) => x?.text ?? '')
      .join('');
    const reasoning = parts
      .filter((x: any) => x?.thought)
      .map((x: any) => x?.text ?? '')
      .join('\n\n');
    if (!text && !reasoning) throw new ProviderError('返回内容为空（可能被安全策略拦截）', res.status, undefined, false);
    return {
      text,
      reasoning: reasoning || undefined,
      model: m,
      promptTokens: res.data?.usageMetadata?.promptTokenCount,
      completionTokens: res.data?.usageMetadata?.candidatesTokenCount,
      duration: res.duration,
    };
  },

  async listModels(cfg, apiKey) {
    try {
      const res = await fetchJson<any>(
        joinUrl(cfg.baseUrl || 'https://generativelanguage.googleapis.com', '/v1beta/models'),
        { timeoutMs: 15000, maxRetries: 0, secrets: [apiKey], headers: { 'x-goog-api-key': apiKey } },
      );
      const names = (res.data?.models ?? [])
        .map((m: any) => String(m?.name ?? '').replace(/^models\//, ''))
        .filter(Boolean);
      if (!names.length) throw new ModelListUnsupportedError();
      return names;
    } catch {
      throw new ModelListUnsupportedError('未能自动拉取 Gemini 模型列表，请手动添加');
    }
  },
};

/**
 * 本地模型（Beta）
 * 对话走 OpenAI 兼容路径；Ollama 的模型列表在 /models 上不总是稳定，
 * 所以额外回退到 /api/tags（Ollama 原生接口）。
 */
export const localAdapter: ProviderAdapter = {
  ...openaiCompatible,
  kind: 'local' as const,
  async listModels(cfg, apiKey) {
    try {
      return await openaiCompatible.listModels(cfg, apiKey);
    } catch {
      // Ollama 原生接口
      try {
        const res = await fetchJson<any>(joinUrl(cfg.baseUrl.replace(/\/v1$/, ''), '/api/tags'), {
          timeoutMs: Math.min(cfg.timeoutMs ?? 10000, 10000),
          maxRetries: 0,
          secrets: [apiKey],
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        });
        const names = (res.data?.models ?? [])
          .map((m: any) => String(m?.name ?? m?.model ?? ''))
          .filter(Boolean);
        if (names.length) return names.sort();
      } catch {
        /* 忽略，统一抛下面的错误 */
      }
      throw new ModelListUnsupportedError(
        '本地服务没有返回模型列表：确认服务已启动、地址端口正确，或直接手动添加模型名',
      );
    }
  },
};

/**
 * OpenAI Responses API
 *
 * 与 Chat Completions 是两条不同路径（POST /responses）。
 * 这里只做最小映射：system → instructions，其余消息 → input 数组，回复从 output_text 取。
 * 原生工具调用、文件检索、会话状态都没有接。
 */
export const openaiResponses: ProviderAdapter = {
  kind: 'openai-responses',
  supportsBalance: false,

  async chat(cfg, apiKey, model, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    if (!apiKey) throw new ProviderError('尚未配置 API 密钥', undefined, undefined, false);
    const effectiveModel = model || cfg.defaultModel || cfg.models[0]?.name;
    if (!effectiveModel) throw new ProviderError('尚未选择模型', undefined, undefined, false);
    const p = cfg.params ?? {};
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');

    const res = await fetchJson<any>(joinUrl(cfg.baseUrl, '/responses'), {
      timeoutMs: opts.timeoutMs ?? cfg.timeoutMs ?? 60000,
      maxRetries: cfg.maxRetries ?? 1,
      secrets: [apiKey],
      signal: opts.signal,
      headers: { Authorization: `Bearer ${apiKey}`, ...(p.headers ?? {}) },
      body: {
        model: effectiveModel,
        instructions: system || undefined,
        input: rest.map((m) => ({ role: m.role, content: m.content })),
        temperature: opts.temperature ?? p.temperature ?? 0.4,
        max_output_tokens: opts.maxTokens ?? p.maxTokens ?? 2048,
        ...(p.topP != null ? { top_p: p.topP } : {}),
        stream: false,
        ...(p.extraBody ?? {}),
      },
    });

    const direct: string = res.data?.output_text ?? '';
    const collected: string = (res.data?.output ?? [])
      .flatMap((o: any) => o?.content ?? [])
      .map((c: any) => (c?.type === 'output_text' || c?.type === 'text' ? c?.text : ''))
      .filter(Boolean)
      .join('');
    const text = direct || collected;
    if (!text) {
      throw new ProviderError('服务商返回了空内容', res.status, JSON.stringify(res.data).slice(0, 300), false);
    }
    return {
      text,
      model: res.data?.model ?? effectiveModel,
      promptTokens: res.data?.usage?.input_tokens,
      completionTokens: res.data?.usage?.output_tokens,
      duration: res.duration,
    };
  },

  async listModels(cfg, apiKey) {
    // Responses 规范本身没有模型列表；OpenAI 与部分服务商仍有 /models，沿用兼容实现
    if (cfg.supportsModelList === false) throw new ModelListUnsupportedError();
    return openaiCompatible.listModels(cfg, apiKey);
  },
};

export const ADAPTERS: Record<string, ProviderAdapter> = {
  'openai-compatible': openaiCompatible,
  'openai-responses': openaiResponses,
  anthropic,
  gemini,
  local: localAdapter,
};

export function adapterFor(kind: ProviderConfig['kind']): ProviderAdapter {
  return ADAPTERS[kind] ?? openaiCompatible;
}

export { trimSlash };
