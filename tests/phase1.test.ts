import { describe, expect, it } from 'vitest';
import {
  REPORT_STATUS_ORDER,
  REPORT_STATUS_LABEL,
  deriveRecordsStatus,
  REPORT_KINDS,
} from '../src/core/types';
import { LEGAL_DOCS } from '../src/core/legal';
import { importAllData, BACKUP_FORMAT } from '../src/core/backup';

describe('四份报告的状态机', () => {
  it('状态顺序与文案固定为 未开始 / 草稿 / 待审核 / 已确认', () => {
    expect(REPORT_STATUS_ORDER).toEqual(['not-started', 'draft', 'review', 'confirmed']);
    expect(REPORT_STATUS_ORDER.map((s) => REPORT_STATUS_LABEL[s])).toEqual([
      '未开始',
      '草稿',
      '待审核',
      '已确认',
    ]);
    expect(REPORT_KINDS).toEqual(['proposal', 'progress', 'midterm', 'final']);
  });

  it('研究记录状态由 15 篇记录反推', () => {
    const empty = { goal: '', work: '', confirmed: false };
    const filled = { goal: '目标', work: '做了什么', confirmed: false };
    const confirmed = { goal: '目标', work: '做了什么', confirmed: true };

    expect(deriveRecordsStatus([])).toBe('not-started');
    expect(deriveRecordsStatus([empty, empty])).toBe('not-started');
    expect(deriveRecordsStatus([filled, empty])).toBe('draft');
    expect(deriveRecordsStatus([filled, filled])).toBe('review');
    expect(deriveRecordsStatus([confirmed, confirmed])).toBe('confirmed');
    // 填满了但只确认了一部分 → 待审核（等剩下的确认）
    expect(deriveRecordsStatus([confirmed, filled])).toBe('review');
  });
});

describe('法务文本', () => {
  it('隐私政策 / 用户协议 / 声明 / 开源许可 四份都在，且各有多条正文', () => {
    expect(LEGAL_DOCS.map((d) => d.id)).toEqual(['privacy', 'terms', 'statement', 'license']);
    for (const doc of LEGAL_DOCS) {
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.version).toMatch(/^\d+\.\d+$/);
      expect(doc.sections.length).toBeGreaterThanOrEqual(3);
      for (const s of doc.sections) {
        expect(s.heading.length).toBeGreaterThan(1);
        // 正文可以是一段文字，也可以是一张表（文档信息 / 摘要 / 清单类）
        const hasText = s.body.length > 40;
        const hasTable = Boolean(s.table && s.table.rows.length > 0);
        expect(hasText || hasTable).toBe(true);
      }
    }
  });

  it('关键承诺写进了文本（数据留在本机、开源许可、模拟标识）', () => {
    const privacy = LEGAL_DOCS.find((d) => d.id === 'privacy')!;
    const terms = LEGAL_DOCS.find((d) => d.id === 'terms')!;
    const statement = LEGAL_DOCS.find((d) => d.id === 'statement')!;
    const all = (d: typeof privacy) => d.sections.map((s) => s.body).join('\n');

    expect(all(privacy)).toContain('本机');
    expect(all(privacy)).toContain('IndexedDB');
    expect(all(terms)).toContain('需先取得授权');
    // 许可已改成「学习免费、商用与分发需授权」，条款里不能再留「MIT 开源可自由再分发」
    expect(all(terms)).not.toContain('以 MIT 许可证开源');
    expect(all(statement)).toContain('（AI 模拟示例）');
    expect(all(statement)).toContain('不代表');
  });

  it('没有留下「待补充」「TODO」这类占位文本', () => {
    const text = LEGAL_DOCS.flatMap((d) => d.sections.map((s) => s.body)).join('\n');
    expect(text).not.toMatch(/TODO|待补充|占位|Lorem/i);
  });
});

describe('备份文件的校验', () => {
  it('不是 JSON 时直接拒绝', async () => {
    await expect(importAllData('这不是 json', 'password123')).rejects.toThrow(/JSON/);
  });

  it('JSON 但不是本软件的备份时拒绝', async () => {
    await expect(importAllData(JSON.stringify({ hello: 1 }), 'password123')).rejects.toThrow(
      /备份文件/,
    );
  });

  it('格式标识与版本号写在文件头', () => {
    expect(BACKUP_FORMAT).toBe('studymate-backup');
  });
});
