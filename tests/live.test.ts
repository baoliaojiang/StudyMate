/**
 * 真实网络测试（默认跳过）
 *
 * 两种跑法：
 *
 * 1) 只验「请求确实打到了服务商」——不需要 Key，用假 Key 拿 401：
 *    SM_LIVE_PROBE=1 npx vitest run tests/live.test.ts
 *
 * 2) 验「指定模型真实生成」——用你自己的 Key（不会写进文件、不会进日志）：
 *    SM_API_KEY=... SM_BASE_URL=https://api.deepseek.com/v1 SM_MODEL=deepseek-chat \
 *      npx vitest run tests/live.test.ts
 *
 * 注意：Key 只从环境变量读，测试输出里也不会打印它。
 */
import { describe, expect, it } from 'vitest';
import type { ProviderRow } from '../src/core/db';
import { testProvider } from '../src/ai/manager';

const PROBE = process.env.SM_LIVE_PROBE === '1';
const KEY = process.env.SM_API_KEY ?? '';
const BASE = process.env.SM_BASE_URL ?? '';
const MODEL = process.env.SM_MODEL ?? '';

function row(patch: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: 'live',
    kind: 'openai-compatible',
    label: 'Live',
    baseUrl: BASE || 'https://api.deepseek.com/v1',
    models: MODEL ? [{ id: 'm', name: MODEL }] : [],
    defaultModel: MODEL || undefined,
    supportsModelList: true,
    timeoutMs: 20000,
    maxRetries: 0,
    createdAt: 0,
    apiKeySealed: KEY as never,
    apiKeyPreview: '',
    apiKeyLen: KEY.length,
    enabled: true,
    ...patch,
  };
}

describe('真实端点', () => {
  it.skipIf(!PROBE)(
    '假 Key 请求 DeepSeek：地址可达、鉴权被拒、提示里没有 Key',
    async () => {
      const fake = 'sk-not-a-real-key-1234567890';
      const report = await testProvider(row({ apiKeySealed: fake as never }), { model: 'deepseek-chat' });
      const address = report.stages.find((s) => s.stage === 'address');
      const auth = report.stages.find((s) => s.stage === 'auth');
      expect(address?.status).toBe('ok');
      expect(auth?.status).toBe('fail');
      expect(auth?.message).toMatch(/401|无效|权限/);
      expect(JSON.stringify(report)).not.toContain(fake);
      expect(report.ok).toBe(false);
    },
    30000,
  );

  it.skipIf(!KEY || !BASE || !MODEL)(
    '用真实 Key 跑一次指定模型生成',
    async () => {
      const report = await testProvider(row(), { model: MODEL });
      expect(report.ok).toBe(true);
      const gen = report.stages.find((s) => s.stage === 'generate');
      expect(gen?.status).toBe('ok');
      expect(report.text?.length).toBeGreaterThan(0);
      expect(JSON.stringify(report)).not.toContain(KEY);
    },
    60000,
  );
});
