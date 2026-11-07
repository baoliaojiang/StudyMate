/**
 * 写作前先检索
 *
 * 目的：AI 一上手就写，容易凭常识编背景、编理论依据。这里在起草前
 * 用课题名做一次学术检索，把命中的题目当「线索」塞进上下文，
 * 让模型有的可依，也让它知道——没查到的就别写。
 *
 * 三条边界：
 * 1. 只调用户已启用的公开接口（OpenAlex / Crossref / arXiv 等），不抓登录页。
 * 2. 结果不自动写进来源表：来源是用户的证据，得他自己确认。
 * 3. 一律标「待核实」，模型只能引用确实相关的，不得据此编数据、DOI、年份。
 */
import type { SearchProviderConfig } from '../core/types';
import { runCombinedSearch, type CombinedSearch } from '../search/providers';

export interface PrefetchOutcome {
  query: string;
  /** 直接拼进提示词的段落；没查到也给一段话，告诉模型别编 */
  text: string;
  count: number;
  /** 面向用户的一句话说明 */
  message: string;
  ok: boolean;
}

/** 检索超时：宁可少这一条线索，也不让用户干等 */
const PREFETCH_TIMEOUT = 6500;

/** 课题名往往带「的」「研究」这类虚词，检索前收一收 */
export function searchQueryOf(topic: string): string {
  const t = String(topic ?? '').trim();
  if (!t) return '';
  return t
    .replace(/[《》「」“”"]/g, ' ')
    .replace(/(课题)?(研究性学习|开题|中期|结题)报告?/g, ' ')
    .replace(/^(关于|浅谈|初探)/, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

export async function prefetchReferences(
  topic: string,
  providers: SearchProviderConfig[],
  limit = 6,
): Promise<PrefetchOutcome> {
  const query = searchQueryOf(topic);
  if (!query) {
    return { query: '', text: '', count: 0, message: '课题名称还没填，跳过检索。', ok: false };
  }
  const usable = (providers ?? []).filter((p) => p.enabled && p.kind !== 'local-files');
  if (!usable.length) {
    return {
      query,
      text: '',
      count: 0,
      message: '没有启用检索服务，本次不检索。',
      ok: false,
    };
  }

  try {
    const timedOut: CombinedSearch = {
      hits: [],
      outcomes: [{ hits: [], provider: 'timeout', message: '检索超时，本次只用现有材料' }],
      used: [],
    };
    const res = await Promise.race([
      runCombinedSearch(usable, { query, mode: 'academic', limit }),
      new Promise<CombinedSearch>((r) => setTimeout(() => r(timedOut), PREFETCH_TIMEOUT)),
    ]);
    const hits = (res.hits ?? []).slice(0, limit);
    if (!hits.length) {
      const why = res.outcomes.find((o) => o.message)?.message ?? '没有命中结果';
      return {
        query,
        text: `【检索结果】按「${query}」检索没有找到可用文献（${why}）。不要编造参考文献、作者或 DOI；需要文献支撑的地方写「待补充：相关文献」。`,
        count: 0,
        message: `检索「${query}」没有结果，这一段会按现有材料写。`,
        ok: true,
      };
    }
    const lines = hits.map((h, i) => {
      const bits = [`${i + 1}. 《${h.title}》`];
      if (h.authors) bits.push(h.authors);
      if (h.date) bits.push(h.date.slice(0, 4));
      if (h.institution) bits.push(h.institution);
      const link = h.doi ? `DOI:${h.doi}` : h.url || '';
      if (link) bits.push(link);
      if (h.abstract) bits.push(`摘要：${h.abstract.slice(0, 120)}`);
      return `- ${bits.join('；')}`;
    });
    return {
      query,
      text: [
        `【检索到的候选文献（按「${query}」检索，共 ${hits.length} 条，均未核实）】`,
        ...lines,
        '用法：这些只是线索。只有与课题确实相关、且能对应上正文论述的才可以提一句，并标注「（待核实）」；不得据此编造数据、结论、作者或年份；不得把未读过的条目写进参考文献表。',
      ].join('\n'),
      count: hits.length,
      message: `按「${query}」检索到 ${hits.length} 条候选文献，写作时会作为线索标注「待核实」。`,
      ok: true,
    };
  } catch (e) {
    return {
      query,
      text: '',
      count: 0,
      message: `检索失败（${(e as Error)?.message ?? '网络问题'}），这一段按现有材料写。`,
      ok: false,
    };
  }
}
