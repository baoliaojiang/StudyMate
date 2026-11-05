import { describe, expect, it } from 'vitest';
import { completeMarkdown, safeCut } from '../src/components/typing';

describe('打字机的 Markdown 安全边界', () => {
  it('切点退到最近的中文标点，不把句子劈成两半', () => {
    const text = '第一句话说完了。第二句话刚开始';
    const cut = safeCut(text, 9);
    expect(cut).toBeLessThanOrEqual(9);
    expect(text.slice(0, cut).endsWith('。')).toBe(true);
  });

  it('给定下限时绝不倒退，保证每一拍都有进展', () => {
    const text = '一，二，三，四，五';
    const cut = safeCut(text, 4, 3);
    expect(cut).toBeGreaterThanOrEqual(3);
  });

  it('切到头或超长时直接返回全文长度', () => {
    expect(safeCut('短句', 10)).toBe(2);
    expect(safeCut('短句', 0)).toBe(0);
  });

  it('没闭合的代码围栏会自动补上，不让渲染器吞掉后文', () => {
    const part = '说明：\n```js\nconst a = 1;';
    const out = completeMarkdown(part);
    expect((out.match(/```/g) ?? []).length % 2).toBe(0);
    expect(out.endsWith('```')).toBe(true);
  });

  it('没闭合的加粗与行内代码也会补齐', () => {
    expect(completeMarkdown('这里有**半截加粗')).toBe('这里有**半截加粗**');
    expect(completeMarkdown('命令 `npm run')).toBe('命令 `npm run`');
  });

  it('已经闭合的 Markdown 不会被多补符号', () => {
    const full = '**加粗** 与 `代码` 都完整。';
    expect(completeMarkdown(full)).toBe(full);
  });
});
