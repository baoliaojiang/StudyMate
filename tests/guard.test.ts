import { describe, expect, it } from 'vitest';
import { looksLikePlanning, stripInlineThink } from '../src/reports/guard';

/** 实际出现过的一段「把思考当正文」（截图里的原文） */
const PLANNING = `这个课题来自指导教师张三布置的研究主题“福州特色美食”。老师在要求里列出了可以涉及的几个方面：美食的种类与名称、地域分布、历史渊源、食材与制作工艺、饮食习俗、传承与变化、传播与产业现状。做整体综述可以，只挑一类美食、一片区域、一门制作技艺或一种饮食文化现象也可以。课题的边界和重点由老师审定，目前还没定下来，这一点要等老师答复后才能往下走。

选题的具体由头还没有记录。原来的草稿只有一个占位句，需要换成真实的情况，比如是在哪里吃到、听`;

/** 正常的研究背景正文 */
const REAL = `福州是一座以小吃闻名的城市，鱼丸、肉燕、锅边糊在街头巷尾都能见到。本研究以福州鱼丸为例，观察它的制作工艺与销售情况。选择这个题目，是因为我家附近的鱼丸店已经开了二十多年，从早到晚都有人排队。

为了弄清鱼丸从原料到出锅的完整过程，我在十月的一个周末到店观察了一个上午，记录了原料种类、制作步骤与耗时。`;

describe('正文守卫', () => {
  it('认出「写作计划」而不是正文', () => {
    const v = looksLikePlanning(PLANNING);
    expect(v.bad).toBe(true);
    expect(v.hits.length).toBeGreaterThan(0);
  });

  it('不误伤正常正文', () => {
    expect(looksLikePlanning(REAL).bad).toBe(false);
  });

  it('「受访学生说」这类引述不算计划句', () => {
    expect(looksLikePlanning('受访学生说，他每周来店里三次。').bad).toBe(false);
  });

  it('正文里的「我们先去参观」不算计划句', () => {
    expect(looksLikePlanning('上午我们先去参观了制作车间，随后回到门店记录出餐流程。').bad).toBe(false);
  });

  it('把内联思考标签剥出来，正文保持干净', () => {
    const r = stripInlineThink('<think>先想想要写什么</think>福州鱼丸的外皮用鱼肉打浆制成。');
    expect(r.text).toBe('福州鱼丸的外皮用鱼肉打浆制成。');
    expect(r.reasoning).toContain('先想想');
  });
});
