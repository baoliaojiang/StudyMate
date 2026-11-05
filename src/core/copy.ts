/**
 * 复制反馈：对勾自己亮起，2.5 秒后自己熄掉。
 * 不给用户留一个「已复制」的僵死状态，也不用弹窗抢注意力。
 */
import { ref } from 'vue';

export function useCopyFeedback(ms = 2500) {
  const copied = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(text: string): Promise<boolean> {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
    } catch {
      return false;
    }
    copied.value = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      copied.value = false;
      timer = undefined;
    }, ms);
    return true;
  }

  return { copied, copy };
}
