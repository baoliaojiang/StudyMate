import type { ProviderConfig } from '../core/types';

/** 适配器只需要配置信息，不需要明文 Key（Key 单独传入） */
export type AdapterConfig = Omit<ProviderConfig, 'apiKey'>;

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

/** 流式增量：正文与思考分开，绝不允许把思考当正文塞给界面 */
export interface StreamDelta {
  /** 本次新增的正文片段 */
  text?: string;
  /** 本次新增的思考片段 */
  reasoning?: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** 外部取消 */
  signal?: AbortSignal;
  /** 覆盖 provider 默认超时 */
  timeoutMs?: number;
  /** 深度思考：仅在模型支持时由上层打开，适配器按各家参数名分别透传 */
  thinking?: boolean;
  /** 真流式：为 true 且给了 onDelta 时走 SSE，边收边回调 */
  streaming?: boolean;
  /** 每收到一段就回调；结束时 ChatResult 里是完整文本 */
  onDelta?: (d: StreamDelta) => void;
}

export interface ChatResult {
  text: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  /** 秒 */
  duration: number;
  /** 推理模型的思考过程（reasoning_content / reasoning）；非推理模型为 undefined */
  reasoning?: string;
}

export interface TokenCount {
  promptTokens?: number;
  completionTokens?: number;
}

/** 统一适配器接口 —— 新增服务商只需实现这里 */
export interface ProviderAdapter {
  kind: ProviderConfig['kind'];
  chat(
    cfg: AdapterConfig,
    apiKey: string,
    model: string,
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): Promise<ChatResult>;
  /** 拉取模型列表；不支持时应抛 ModelListUnsupportedError，由 UI 引导手动添加 */
  listModels(cfg: AdapterConfig, apiKey: string): Promise<string[]>;
  /**
   * 该服务商是否可能在官方接口提供余额/实际用量。
   * 返回 false 时 UI 不得显示余额字段（不猜测、不伪造）。
   */
  supportsBalance: boolean;
}

export class ModelListUnsupportedError extends Error {
  constructor(message = '该服务商不提供模型列表接口，请手动添加模型') {
    super(message);
    this.name = 'ModelListUnsupportedError';
  }
}

export class ProviderError extends Error {
  status?: number;
  /** 已脱敏的响应体片段 */
  detail?: string;
  retryable: boolean;
  constructor(message: string, status: number | undefined, detail: string | undefined, retryable: boolean) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.detail = detail;
    this.retryable = retryable;
  }
}
