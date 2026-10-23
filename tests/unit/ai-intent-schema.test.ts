import { describe, expect, it } from "vitest";

import {
  LLM_INTENT_KEYS,
  normalizeLlmPayload,
  parseLlmIntent,
} from "@/lib/ai/intent-schema";

/**
 * 模型输出 Schema 校验测试。
 *
 * 核心命题：**模型的输出是不可信输入**。
 * 合法就采纳，不合法就整条丢弃并降级——不存在"修一修继续用"。
 */

describe("合法输出", () => {
  it("完整合法对象被采纳", () => {
    const result = parseLlmIntent({
      mealType: "lunch",
      budgetKind: "hard_cap",
      budgetYuan: 25,
      preferences: ["鸡肉"],
      avoid: ["辣"],
      goal: "balanced",
      userStates: ["rushed"],
      wantsLongTermBudget: false,
      wantsCompleteMeal: false,
      needsClarification: false,
      clarifyingQuestions: [],
      unsupportedConditions: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.budgetYuan).toBe(25);
    expect(result.value.avoid).toEqual(["辣"]);
    expect(result.ignoredFields).toEqual([]);
  });

  it("缺字段时用默认值补齐，而不是判失败", () => {
    const result = parseLlmIntent({ budgetYuan: 18 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mealType).toBe("unspecified");
    expect(result.value.goal).toBe("balanced");
    expect(result.value.preferences).toEqual([]);
    expect(result.value.budgetKind).toBe("unspecified");
  });

  it("数字字符串被归一化成数字（不依赖供应商的结构化输出）", () => {
    const result = parseLlmIntent({ budgetYuan: "25.5", budgetKind: "hard_cap" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.budgetYuan).toBe(25.5);
  });
});

describe("不合法输出一律失败", () => {
  it("未知枚举值判失败（例如 mealType: \"brunch\"）", () => {
    const result = parseLlmIntent({ mealType: "brunch" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("mealType");
  });

  it("偏好标签不在白名单判失败", () => {
    const result = parseLlmIntent({ preferences: ["米其林"] });
    expect(result.ok).toBe(false);
  });

  it("金额为负数或超上限判失败", () => {
    expect(parseLlmIntent({ budgetYuan: -5 }).ok).toBe(false);
    expect(parseLlmIntent({ budgetYuan: 999_999 }).ok).toBe(false);
  });

  it("金额是乱码字符串判失败", () => {
    expect(parseLlmIntent({ budgetYuan: "随便" }).ok).toBe(false);
  });

  it("clarifyingQuestions 超长判失败", () => {
    const result = parseLlmIntent({
      clarifyingQuestions: ["a".repeat(80)],
    });
    expect(result.ok).toBe(false);
  });

  it("非对象输入判失败", () => {
    expect(parseLlmIntent("好的，这是结果：25 元").ok).toBe(false);
    expect(parseLlmIntent(null).ok).toBe(false);
    expect(parseLlmIntent([1, 2, 3]).ok).toBe(false);
  });

  it("失败原因不包含模型原文（避免把用户数据带回响应/日志）", () => {
    const result = parseLlmIntent({ mealType: "用户说他叫某某某" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).not.toContain("某某某");
  });
});

describe("敏感属性与多余字段被丢弃", () => {
  it("模型擅自输出过敏史/收入等字段时被 strip 并记录", () => {
    const result = parseLlmIntent({
      budgetYuan: 20,
      allergy: "花生",
      disease: "糖尿病",
      income: 3000,
      priceQuote: 19.9,
      recommendedDish: "麦辣鸡腿堡",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 值本身一定没被采纳（类型里根本没有这些位置）
    expect(Object.keys(result.value)).not.toContain("allergy");
    expect(Object.keys(result.value)).not.toContain("income");
    expect(Object.keys(result.value)).not.toContain("recommendedDish");
    // 但留下了可审计痕迹
    expect(result.ignoredFields).toEqual(
      expect.arrayContaining(["allergy", "disease", "income", "priceQuote", "recommendedDish"]),
    );
  });

  it("normalizeLlmPayload 只保留白名单键", () => {
    const { value, ignoredFields } = normalizeLlmPayload({
      mealType: "dinner",
      token: "sk-xxx",
      __proto__: { polluted: true },
    });
    expect(Object.keys(value)).toEqual(["mealType"]);
    expect(ignoredFields).toContain("token");
  });

  it("白名单里没有价格/菜品/营养字段（模型想编也没地方放）", () => {
    const keys = LLM_INTENT_KEYS.join(",");
    expect(keys).not.toContain("price");
    expect(keys).not.toContain("recommend");
    expect(keys).not.toContain("nutrition");
    expect(keys).not.toContain("coupon");
    expect(keys).not.toContain("allergy");
  });
});
