import { describe, expect, it } from 'vitest';
import { openWithPassphrase, sealWithPassphrase } from '../src/core/crypto';

/**
 * 备份文件整体加密：一旦这里挂了，导出会「点了没反应」、
 * 导入会永远提示「口令错误或文件损坏」，所以必须留一条真实往返测试。
 */
describe('备份口令加密', () => {
  it('同一口令能原样解开，错误口令必须失败', async () => {
    const plain = JSON.stringify({ projects: [{ id: 'p1', topic: '课题' }], providers: [] });
    const sealed = await sealWithPassphrase(plain, 'password123');
    expect(sealed.kdf).toBe('PBKDF2-SHA256-210000');
    expect(sealed.data.length).toBeGreaterThan(0);
    expect(sealed.salt.length).toBeGreaterThan(0);
    await expect(openWithPassphrase(sealed, 'password123')).resolves.toBe(plain);
    await expect(openWithPassphrase(sealed, 'wrong-password')).rejects.toThrow();
  });

  it('同样明文每次导出密文都不同（盐与 IV 随机）', async () => {
    const a = await sealWithPassphrase('hello', 'password123');
    const b = await sealWithPassphrase('hello', 'password123');
    expect(a.iv).not.toBe(b.iv);
    expect(a.salt).not.toBe(b.salt);
    expect(a.data).not.toBe(b.data);
  });
});
