import { describe, expect, it } from "vitest";

import { parseChineseAmount, parseIntentByRules } from "@/lib/ai/parse-intent";

/**
 * 规则解析测试（**不联网、不调模型**）。
 *
 * 任务 004 第五节列出的 10 类表达逐条锁定，另外补充中文数字、边界与澄清行为。
 * 这些断言是"没有大模型时产品也不能瞎猜"的底线。
 */

function parse(text: string) {
  return parseIntentByRules(text).intent;
}

describe("预算抽取：硬上限 vs 软偏好", () => {
  it("「不超过 20 块」是硬上限", () => {
    const intent = parse("不超过 20 块。");
    expect(intent.budgetFen).toBe(2000);
    expect(intent.budgetKind).toBe("hard_cap");
  });

  it("「20 元左右」是软偏好", () => {
    const intent = parse("20 元左右。");
    expect(intent.budgetFen).toBe(2000);
    expect(intent.budgetKind).toBe("soft_target");
  });

  it("「最多 25 块」与「25 元以内」都判为硬上限", () => {
    expect(parse("最多 25 块").budgetKind).toBe("hard_cap");
    expect(parse("25 元以内").budgetKind).toBe("hard_cap");
    expect(parse("25 元以内").budgetFen).toBe(2500);
  });

  it("「我只有 15 元」是硬上限，且识别到「想吃一顿完整的」", () => {
    const intent = parse("我只有 15 元，但想吃一顿完整的。");
    expect(intent.budgetFen).toBe(1500);
    expect(intent.budgetKind).toBe("hard_cap");
    expect(intent.wantsCompleteMeal).toBe(true);
  });

  it("中文金额也能解析：二十块 / 十五元 / 一百元", () => {
    expect(parseChineseAmount("二十")).toBe(20);
    expect(parseChineseAmount("二十五")).toBe(25);
    expect(parseChineseAmount("十五")).toBe(15);
    expect(parseChineseAmount("一百")).toBe(100);
    expect(parse("最多二十块").budgetFen).toBe(2000);
  });

  it("没有提到金额时不编预算", () => {
    const intent = parse("今天想吃鸡肉。");
    expect(intent.budgetFen).toBeNull();
    expect(intent.budgetKind).toBe("unspecified");
  });

  it("「越便宜越好」不产生具体金额，只确定目标", () => {
    const intent = parse("越便宜越好。");
    expect(intent.budgetFen).toBeNull();
    expect(intent.goal).toBe("save");
  });
});

describe("周期剩余不能被当成单餐预算", () => {
  it("「这个月还剩 300 元」只记 remainingMentionFen", () => {
    const intent = parse("这个月还剩 300 元。");
    expect(intent.remainingMentionFen).toBe(30_000);
    expect(intent.budgetFen).toBeNull();
    expect(intent.wantsLongTermBudget).toBe(true);
  });

  it("「本周还剩 120 元，想吃鸡肉」不会把 120 当成单餐预算", () => {
    const intent = parse("本周还剩 120 元，想吃鸡肉");
    expect(intent.remainingMentionFen).toBe(12_000);
    expect(intent.budgetFen).toBeNull();
    expect(intent.preferences).toContain("鸡肉");
  });
});

describe("餐次识别", () => {
  it("中午 → lunch，晚上 → dinner，早上 → breakfast", () => {
    expect(parse("今天中午想吃鸡肉").mealType).toBe("lunch");
    expect(parse("晚上吃点什么").mealType).toBe("dinner");
    expect(parse("早饭想吃点热的").mealType).toBe("breakfast");
    expect(parse("想吃点东西").mealType).toBe("unspecified");
  });
});

describe("偏好与排除", () => {
  it("完整示例：「今天中午想吃鸡肉，不想吃辣，最多 25 块」", () => {
    const intent = parse("今天中午想吃鸡肉，不想吃辣，最多 25 块。");
    expect(intent).toMatchObject({
      mealType: "lunch",
      budgetFen: 2500,
      budgetKind: "hard_cap",
      preferences: ["鸡肉"],
      avoid: ["辣"],
      goal: "balanced",
      needsClarification: false,
    });
  });

  it("「不吃辣」只产生排除项，不会同时变成偏好", () => {
    const intent = parse("不吃辣。");
    expect(intent.avoid).toEqual(["辣"]);
    expect(intent.preferences).toEqual([]);
  });

  it("「不要牛肉」是排除项", () => {
    const intent = parse("不要牛肉。");
    expect(intent.avoid).toEqual(["牛肉"]);
    expect(intent.preferences).toEqual([]);
  });

  it("「不吃辣但想吃点辣的」仍然以排除为准（安全优先）", () => {
    const intent = parse("不想吃辣，但是有点想吃辣的鸡腿堡");
    expect(intent.avoid).toContain("辣");
    expect(intent.preferences).not.toContain("辣");
  });

  it("「昨天吃了汉堡，今天换一种」把汉堡作为排除项", () => {
    const intent = parse("昨天吃了汉堡，今天换一种。");
    expect(intent.avoid).toContain("汉堡");
    expect(intent.preferences).not.toContain("汉堡");
  });
});

describe("目标与状态", () => {
  it("「今天想吃点好的」→ satisfy", () => {
    expect(parse("今天想吃点好的。").goal).toBe("satisfy");
  });

  it("「想吃点好的」同时被识别为「想犒劳自己」的状态", () => {
    expect(parse("今天想吃点好的。").userStates).toContain("reward");
  });

  it("「赶时间」被识别为状态", () => {
    expect(parse("赶时间，随便来个堡").userStates).toContain("rushed");
  });
});

describe("澄清：无法理解就不猜", () => {
  it("「随便，你帮我决定」视为明确委托，不追问", () => {
    const intent = parse("随便，你帮我决定。");
    expect(intent.needsClarification).toBe(false);
    expect(intent.clarifyingQuestions).toEqual([]);
  });

  it("完全读不出条件的输入会要求澄清", () => {
    const intent = parse("嗯那个啥你懂的");
    expect(intent.needsClarification).toBe(true);
    expect(intent.clarifyingQuestions.length).toBeGreaterThan(0);
  });

  it("预算低于接口下限时会追问", () => {
    const intent = parse("我只有 3 元");
    expect(intent.budgetFen).toBe(300);
    expect(intent.needsClarification).toBe(true);
  });

  it("过敏相关表述被标记为「无法确认」，不做安全承诺", () => {
    const intent = parse("我对花生过敏，想吃个汉堡");
    expect(intent.unsupportedConditions.join()).toContain("过敏原");
  });
});
