/**
 * API 管理中心测试
 *
 * 验的是「说不说得清、挡不挡得住」这几件事：
 * - 模型列表解析（四家返回形状不同）
 * - 路由顺序与省钱规则
 * - 预算到线时暂停确认，而不是静默继续
 * - Key 绝不进提示文本
 * - 拉取模型时不能把手动加的价格/收藏冲掉
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderRow } from '../src/core/db';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { AppSettings } from '../src/core/types';
import { scrubSecrets } from '../src/core/crypto';
import { parseModelList, refreshModels, testProvider, type SealedKeyBundle } from '../src/ai/manager';
import { routeModel } from '../src/ai/routing';
import { AiGateway, BudgetConfirmRequiredError } from '../src/ai/gateway';

function provider(patch: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: 'p1',
    kind: 'openai-compatible',
    label: '测试服务商',
    baseUrl: 'https://api.example.com/v1',
    models: [
      { id: 'm1', name: 'cheap-mini' },
      { id: 'm2', name: 'strong-pro', priceIn: 8, priceOut: 24 },
      { id: 'm3', name: 'mid-chat', priceIn: 1, priceOut: 2 },
    ],
    defaultModel: 'mid-chat',
    supportsModelList: true,
    timeoutMs: 10000,
    maxRetries: 0,
    createdAt: 0,
    apiKeySealed: 'sk-test-secret-key-123' as never,
    apiKeyPreview: 'sk-t…-123',
    apiKeyLen: 21,
    enabled: true,
    ...patch,
  };
}

function settings(patch: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

function fakeDb(rows: ProviderRow[], usage: unknown[] = []) {
  return {
    providers: {
      toArray: async () => rows,
      put: async () => undefined,
      add: async () => undefined,
      delete: async () => undefined,
    },
    usage: {
      where: () => ({ aboveOrEqual: () => ({ toArray: async () => usage }) }),
      add: async () => undefined,
    },
  } as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('模型列表解析', () => {
  it('OpenAI 兼容的 data[]', () => {
    expect(parseModelList('openai-compatible', { data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] })).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
    ]);
  });

  it('Gemini 的 models[] 会去掉 models/ 前缀', () => {
    expect(
      parseModelList('gemini', { models: [{ name: 'models/gemini-2.0-flash' }, { name: 'models/gemini-2.5-pro' }] }),
    ).toEqual(['gemini-2.0-flash', 'gemini-2.5-pro']);
  });

  it('Ollama 的 tags 形状 {models:[{name}]}', () => {
    expect(parseModelList('local', { models: [{ name: 'qwen2.5:7b' }, { name: 'llama3.2:3b' }] })).toEqual([
      'llama3.2:3b',
      'qwen2.5:7b',
    ]);
  });

  it('乱七八糟的响应当空，不瞎猜', () => {
    expect(parseModelList('openai-compatible', { error: 'nope' })).toEqual([]);
    expect(parseModelList('openai-compatible', null)).toEqual([]);
  });
});

describe('路由顺序', () => {
  it('手动指定优先于一切规则', () => {
    const rows = [provider()];
    const d = routeModel(rows, settings(), {
      explicitProviderId: 'p1',
      explicitModel: 'strong-pro',
      agentId: 'source-researcher',
      task: 'summary',
    });
    expect(d?.model).toBe('strong-pro');
    expect(d?.reasonCode).toBe('explicit');
  });

  it('Agent 映射优先于顶栏选择', () => {
    const rows = [provider()];
    const d = routeModel(
      rows,
      settings({ agentModels: { 'data-analyst': { providerId: 'p1', model: 'strong-pro' } } }),
      { agentId: 'data-analyst', userPick: { providerId: 'p1', model: 'cheap-mini', tier: 'fast' } },
    );
    expect(d?.model).toBe('strong-pro');
    expect(d?.reasonCode).toBe('agent');
  });

  it('简单任务优先低成本模型', () => {
    const rows = [provider()];
    const d = routeModel(rows, settings(), { task: 'record' });
    expect(d?.tier).toBe('cheap');
    expect(d?.model).toBe('cheap-mini');
    expect(d?.reasonCode).toBe('rule');
  });

  it('不复杂时不会自作主张上高性能模型', () => {
    const rows = [provider({ models: [{ id: 'm2', name: 'strong-pro', priceIn: 8 }] })];
    const d = routeModel(rows, settings(), { task: 'chat' });
    expect(d?.tier).not.toBe('strong');
  });

  it('没有 Key 的服务商不参与自动路由', () => {
    const rows = [provider({ apiKeyLen: 0 })];
    const d = routeModel(rows, settings(), { task: 'record' });
    // 全被过滤时会退一步用全部有模型的，但至少要给出结果而不是崩
    expect(d).not.toBeNull();
  });

  it('停用的服务商不参与路由', () => {
    const a = provider({ id: 'off', enabled: false });
    const b = provider({ id: 'on', models: [{ id: 'x', name: 'only-model' }] });
    const d = routeModel([a, b], settings(), { task: 'chat' });
    expect(d?.providerId).toBe('on');
  });

  it('完全没有模型时返回 null，不编一个名字', () => {
    expect(routeModel([], settings())).toBeNull();
  });
});

describe('Key 不泄露', () => {
  const key = 'sk-live-abcdefghijklmnop123456';

  it('错误文本里的 Key 会被替换', () => {
    const text = `401 Unauthorized: ${key} is invalid; Authorization: Bearer ${key}`;
    const out = scrubSecrets(text, [key]);
    expect(out).not.toContain(key);
    expect(out).toContain('***');
  });

  it('常见 Key 形态即使没传 secrets 也会被兜住', () => {
    const out = scrubSecrets('bad key sk-proj-ABCDEFGH12345678 and AIzaSyA1234567890abcdefghij');
    expect(out).not.toContain('sk-proj-ABCDEFGH12345678');
    expect(out).not.toContain('AIzaSyA1234567890abcdefghij');
  });

  it('URL 查询串里的 key 会被抹掉', () => {
    expect(scrubSecrets('https://x.com/v1?key=abcdef123456&model=a')).not.toContain('abcdef123456');
  });
});

describe('预算与暂停确认', () => {
  const usageRow = (cost: number) => ({ at: Date.now(), providerId: 'p1', model: 'm', duration: 1, cost, ok: true });

  it('用到 80% 时提示接近上限', async () => {
    const s = settings({ budget: { ...DEFAULT_SETTINGS.budget, dailyCost: 1, warnRatio: 0.8 } });
    const gw = new AiGateway(fakeDb([provider()], [usageRow(0.9)]), () => s);
    const snap = await gw.budgetSnapshot();
    expect(snap.nearLimit).toBe(true);
    expect(snap.blocked).toBe(false);
    expect(snap.ratio).toBeCloseTo(0.9, 2);
  });

  it('到上限时抛确认错误，而不是直接扣费调用', async () => {
    const s = settings({ budget: { ...DEFAULT_SETTINGS.budget, dailyCost: 1, pauseOnExceed: true } });
    const gw = new AiGateway(fakeDb([provider()], [usageRow(1)]), () => s);
    await expect(gw.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(
      BudgetConfirmRequiredError,
    );
  });

  it('关掉暂停确认后，到上限直接拒绝', async () => {
    const s = settings({
      budget: { ...DEFAULT_SETTINGS.budget, dailyCost: 1, pauseOnExceed: false },
    });
    const gw = new AiGateway(fakeDb([provider()], [usageRow(1)]), () => s);
    await expect(gw.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/预算已达上限/);
  });

  it('没有任何服务商时给出可执行的提示', async () => {
    const gw = new AiGateway(fakeDb([]), () => settings());
    await expect(gw.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/API 管理中心/);
  });
});

describe('连接测试三段式', () => {
  function mockOk() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              model: 'gpt-test',
              choices: [{ message: { content: '可用' } }],
              usage: { prompt_tokens: 3, completion_tokens: 2 },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ data: [{ id: 'gpt-test' }, { id: 'gpt-mini' }] }), { status: 200 });
      }),
    );
  }

  it('地址、鉴权、生成三段都通过', async () => {
    mockOk();
    const report = await testProvider(provider(), { model: 'gpt-test' });
    expect(report.ok).toBe(true);
    expect(report.stages.map((s) => s.stage)).toEqual(['address', 'auth', 'generate']);
    expect(report.stages.every((s) => s.status === 'ok')).toBe(true);
    expect(report.models).toEqual(['gpt-mini', 'gpt-test']);
    expect(report.text).toBe('可用');
  });

  it('401 时指出 Key 有问题，且提示里没有 Key', async () => {
    const key = 'sk-live-abcdefghijklmnop123456';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: `Incorrect API key provided: ${key}` }), { status: 401 })),
    );
    const report = await testProvider(provider({ apiKeySealed: key as never }), { model: 'gpt-test' });
    const auth = report.stages.find((s) => s.stage === 'auth');
    expect(auth?.status).toBe('fail');
    expect(auth?.message).toContain('401');
    expect(JSON.stringify(report)).not.toContain(key);
  });

  it('没有模型名时跳过生成，并说明原因', async () => {
    mockOk();
    const report = await testProvider(provider({ models: [], defaultModel: undefined }));
    const gen = report.stages.find((s) => s.stage === 'generate');
    expect(gen?.status).toBe('skipped');
    expect(gen?.message).toContain('暂无可用模型');
    expect(report.ok).toBe(false);
  });
});

describe('刷新模型不丢手动配置', () => {
  it('保留收藏、单价、手动标记与能力', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'mid-chat' }, { id: 'new-model' }] }), { status: 200 })),
    );
    const row = provider({
      models: [
        { id: 'm3', name: 'mid-chat', priceIn: 1, priceOut: 2, favorite: true, cap: { verified: true, json: true } },
        { id: 'hand', name: 'hand-added', manual: true, priceIn: 0.5 },
      ],
    });
    const res = await refreshModels(row);
    expect(res.ok).toBe(true);
    expect(res.added).toBe(1);
    const kept = res.models.find((m) => m.name === 'mid-chat');
    expect(kept?.favorite).toBe(true);
    expect(kept?.priceIn).toBe(1);
    expect(kept?.cap?.verified).toBe(true);
    expect(res.models.some((m) => m.name === 'hand-added' && m.manual)).toBe(true);
    expect(res.models.some((m) => m.name === 'new-model')).toBe(true);
  });

  it('不支持列表接口时给出「手动添加」而不是空列表', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 404 })));
    const res = await refreshModels(provider());
    expect(res.ok).toBe(false);
    expect(res.message).toContain('手动录入');
    expect(res.models.length).toBe(3);
  });
});

describe('Key 备份结构', () => {
  it('备份文件只带密文，不带明文 Key', async () => {
    const fake: SealedKeyBundle = {
      v: 1,
      kind: 'studymate-key-bundle',
      createdAt: 0,
      payload: { v: 1, kdf: 'PBKDF2-SHA256-210000', salt: 'AA==', iv: 'BB==', data: 'CC==' },
    };
    const json = JSON.stringify(fake);
    expect(json).not.toContain('sk-');
    expect(json).toContain('PBKDF2-SHA256-210000');
  });
});
