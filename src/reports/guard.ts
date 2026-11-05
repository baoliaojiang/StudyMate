/**
 * 正文守卫
 *
 * 有些模型（尤其开着深度思考、或者便宜的 flash 档）会把「我打算怎么写」
 * 直接写进正文：评论原草稿、说明还需要补什么、叮嘱自己要去问老师。
 * 这些话读起来通顺，但交上去就是废稿，而且很像 AI 在自言自语。
 *
 * 这里做两件事：
 * 1. stripInlineThink：把 <think>…</think> 这类内联思考标签从正文里剥出来；
 * 2. looksLikePlanning：判断一段文字到底是「正文」还是「写作计划」。
 *
 * 判定只用于「不写入正文 / 重试一次」，不删改用户的既有内容。
 */

export { stripInlineThink } from '../ai/think';

/** 一句话就能确定「这不是正文」的特征 */
const STRONG: RegExp[] = [
  /原来的草稿/,
  /这一点要等/,
  // 「我们先去参观车间」是正常叙述，只有「先写/需要把这段」才是计划句
  /(?:我|我们)(?:先|需要|应该|打算|准备)(?:写|整理|确认|补充|补上|把这段|把这一)/,
  // 只认句首的「用户/学生说」：正文里「受访学生说」是合法引述
  /(?:^|[。；\n])\s*(?:用户|学生)(?:说|提到|提供|要求|刚才)/m,
  /(?:下面|接下来)(?:我|我们)(?:来|要|先)/,
];

/** 单独出现还算正常，凑两条以上就说明整段在讲「怎么写」 */
const WEAK: RegExp[] = [
  /(?:这一节|本节|这段|这一段)[^。！？\n]{0,14}(?:要|需要|应该|可以)(?:写|讲|说|交代|补充|用)/,
  /(?:需要|应该|要)(?:换成|补上|改成|交代|说明一下|确认|问老师|等老师)/,
  /(?:还有|尚未|没有)(?:记录|确定|核实)[^。！？\n]{0,14}(?:需要|要|待)/,
  /(?:待补充|待确认|待核实)[^。\n]{0,8}(?:的|后|再)/,
  /(?:可以写|可以提|可以补|可以加)[^。！？\n]{0,12}(?:一下|进去|一句)/,
  /(?:思路|提纲|框架)[:：]/,
];

export interface PlanningVerdict {
  bad: boolean;
  hits: string[];
}

/** 判断这段文字是不是「写作计划」而不是正文 */
export function looksLikePlanning(raw: string): PlanningVerdict {
  const text = (raw ?? '').trim();
  if (!text) return { bad: false, hits: [] };
  const hits: string[] = [];
  for (const re of STRONG) {
    const m = text.match(re);
    if (m) hits.push(m[0]);
  }
  if (hits.length) return { bad: true, hits };
  let weak = 0;
  for (const re of WEAK) {
    const m = text.match(re);
    if (m) {
      weak++;
      hits.push(m[0]);
    }
  }
  // 结尾悬空（「比如是在哪里吃到、听」）也是没写完的信号
  if (/[、，,（(]$/.test(text)) {
    weak++;
    hits.push('结尾未写完');
  }
  return { bad: weak >= 2, hits };
}
