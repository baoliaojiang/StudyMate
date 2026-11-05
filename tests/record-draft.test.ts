import { describe, expect, it } from 'vitest';
import { DRAFT_BATCH, batchCount, draftMessages, parseDrafts, termName } from '../src/workflow/record-draft';

describe('批次大小', () => {
  it('一批最多 3 篇', () => {
    expect(DRAFT_BATCH).toBe(3);
    expect(batchCount(8, 6)).toBe(3);
    expect(batchCount(2, 6)).toBe(2);
  });

  it('调用次数不够时按剩余次数收窄，不会硬塞', () => {
    expect(batchCount(8, 1)).toBe(1);
    expect(batchCount(8, 0)).toBe(0);
  });

  it('还差 0 篇就不生成', () => {
    expect(batchCount(0, 6)).toBe(0);
  });
});

describe('解析模型输出', () => {
  it('标准 JSON 数组能解析出全部字段', () => {
    const raw = JSON.stringify([
      {
        stageName: '第一阶段：准备',
        activityName: '确定问卷题目',
        startDate: '2026-09-12',
        endDate: '2026-09-12',
        place: '教室',
        participants: ['张一', '李二'],
        goal: '把题目定下来',
        work: '小组讨论并试填',
        materials: '问卷初稿',
        outputs: '待补充',
        summary: '题目需要再删两题',
        nextPlan: '下周打印',
      },
    ]);
    const out = parseDrafts(raw, 3);
    expect(out).toHaveLength(1);
    expect(out[0].activityName).toBe('确定问卷题目');
    expect(out[0].participants).toEqual(['张一', '李二']);
    expect(out[0].outputs).toBe('待补充');
  });

  it('带代码块围栏也认', () => {
    const raw = '```json\n[{"activityName":"做访谈","work":"问了三个人"}]\n```';
    expect(parseDrafts(raw, 3)[0].activityName).toBe('做访谈');
  });

  it('前后有废话只取数组', () => {
    const raw = '好的，下面是记录：\n[{"activityName":"整理资料"}]\n希望有用。';
    expect(parseDrafts(raw, 3)).toHaveLength(1);
  });

  it('人数超过上限只取前 N 篇', () => {
    const raw = JSON.stringify([
      { activityName: 'a' },
      { activityName: 'b' },
      { activityName: 'c' },
      { activityName: 'd' },
    ]);
    expect(parseDrafts(raw, 2)).toHaveLength(2);
  });

  it('空壳条目丢掉，不生成空记录', () => {
    const raw = JSON.stringify([{ activityName: '', work: '' }, { activityName: '有效' }]);
    const out = parseDrafts(raw, 3);
    expect(out).toHaveLength(1);
    expect(out[0].activityName).toBe('有效');
  });

  it('没有活动名但写了做法时，用做法补标题', () => {
    const raw = JSON.stringify([{ work: '在食堂门口记录人流' }]);
    expect(parseDrafts(raw, 3)[0].activityName).toBe('在食堂门口记录人流');
  });

  it('脏输出（截断 / 非数组 / 空）一律返回空，不抛错', () => {
    expect(parseDrafts('', 3)).toEqual([]);
    expect(parseDrafts('[{"activityName":', 3)).toEqual([]);
    expect(parseDrafts('{"activityName":"对象不是数组"}', 3)).toEqual([]);
    expect(parseDrafts('模型今天不想干活', 3)).toEqual([]);
  });

  it('参与人写成顿号串也能拆开', () => {
    const raw = JSON.stringify([{ activityName: 'x', participants: '张一、李二、王三' }]);
    expect(parseDrafts(raw, 3)[0].participants).toEqual(['张一', '李二', '王三']);
  });
});

describe('提示词', () => {
  const ctx = {
    topic: '校园食品安全',
    grade: '高二',
    modes: ['practice'],
    members: ['张一', '李二'],
    startDate: '2026-09-01',
    endDate: '2027-01-10',
  };

  it('带上主题、成员与研究周期，并说明只写该做的事', () => {
    const [sys, user] = draftMessages(ctx, 1, 3, 5);
    expect(sys.content).toContain('不得编造');
    expect(user.content).toContain('校园食品安全');
    expect(user.content).toContain('张一');
    expect(user.content).toContain('第 6～8 篇');
    expect(user.content).toContain('2026-09-01');
  });

  it('学期名称正确', () => {
    expect(termName(1)).toBe('上学期');
    expect(termName(2)).toBe('下学期');
    expect(draftMessages(ctx, 2, 2, 0)[1].content).toContain('下学期');
  });
});
