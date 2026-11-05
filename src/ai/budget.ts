import type { AiGateway, ChatRequest } from './gateway';
import { BudgetConfirmRequiredError } from './gateway';
import type { ChatResult } from './types';

/**
 * 带预算确认的调用。
 *
 * 到达预算上限时，网关抛 BudgetConfirmRequiredError 而不是硬拒绝；
 * 这里弹一次确认，用户同意才带 confirmOverBudget 重发。
 * 拒绝的话原样抛出，由调用方按「预算不足」处理。
 */
export async function chatWithBudgetConfirm(gw: AiGateway, req: ChatRequest): Promise<ChatResult> {
  try {
    return await gw.chat(req);
  } catch (e) {
    if (!(e instanceof BudgetConfirmRequiredError)) throw e;
    const s = e.snapshot;
    const detail = [
      `今日已发起 ${s.callsToday} 次请求，估算费用 ¥${s.costToday.toFixed(3)}。`,
      `${e.message}。`,
      '继续调用将产生额外费用，是否继续？',
    ].join('\n');
    // 安卓 WebView 里 window.confirm 可能被拦掉或阻塞，这里必须兜住，否则界面会一直转圈
    let ok = false;
    try {
      ok = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(detail) : false;
    } catch {
      ok = false;
    }
    if (!ok) throw e;
    return gw.chat({ ...req, confirmOverBudget: true });
  }
}
