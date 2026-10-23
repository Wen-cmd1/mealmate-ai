import { describe, expect, it } from "vitest";

import {
  BUDGET_MAX_FEN,
  BUDGET_MIN_FEN,
  parseRecommendRequest,
} from "@/lib/recommendation/schema";

/**
 * 请求参数校验测试。
 *
 * 覆盖任务书要求的「无效请求参数」，同时确认默认值（25 元 / 到店自提）确实生效。
 */

const validBody = {
  budgetFen: 2500,
  city: "广州市",
  storeCode: "1400359",
  orderType: 1,
  beType: 1,
  preferences: ["汉堡"],
};

describe("合法请求", () => {
  it("完整请求通过校验并保持原值", () => {
    const result = parseRecommendRequest(validBody);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.budgetFen).toBe(2500);
    expect(result.value.storeCode).toBe("1400359");
    expect(result.value.preferences).toEqual(["汉堡"]);
  });

  it("只给门店编码时套用默认值：预算 25 元、广州市、到店自提", () => {
    const result = parseRecommendRequest({ storeCode: "1400359" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.budgetFen).toBe(2500);
    expect(result.value.city).toBe("广州市");
    expect(result.value.orderType).toBe(1);
    expect(result.value.beType).toBe(1);
  });
});

describe("无效请求", () => {
  const cases: Array<{ name: string; body: unknown; expectField?: string }> = [
    { name: "预算为 0", body: { ...validBody, budgetFen: 0 }, expectField: "budgetFen" },
    { name: "预算低于下限", body: { ...validBody, budgetFen: BUDGET_MIN_FEN - 1 }, expectField: "budgetFen" },
    { name: "预算高于上限", body: { ...validBody, budgetFen: BUDGET_MAX_FEN + 1 }, expectField: "budgetFen" },
    { name: "预算不是整数分", body: { ...validBody, budgetFen: 2499.5 }, expectField: "budgetFen" },
    { name: "预算是字符串", body: { ...validBody, budgetFen: "2500" }, expectField: "budgetFen" },
    { name: "缺少门店编码", body: { ...validBody, storeCode: undefined }, expectField: "storeCode" },
    { name: "门店编码含字母", body: { ...validBody, storeCode: "abc" }, expectField: "storeCode" },
    { name: "门店编码过短", body: { ...validBody, storeCode: "12" }, expectField: "storeCode" },
    { name: "orderType=2（外送未接入）", body: { ...validBody, orderType: 2 }, expectField: "orderType" },
    { name: "beType=5（得来速未接入）", body: { ...validBody, beType: 5 }, expectField: "beType" },
    { name: "偏好不在白名单", body: { ...validBody, preferences: ["寿司"] }, expectField: "preferences.0" },
    { name: "偏好过多", body: { ...validBody, preferences: ["汉堡", "鸡肉", "牛肉", "鱼", "辣", "汉堡"] }, expectField: "preferences" },
    { name: "maxResults 超限", body: { ...validBody, maxResults: 4 }, expectField: "maxResults" },
    { name: "排除分类过多", body: { ...validBody, excludeCategories: Array.from({ length: 11 }, (_, i) => `c${i}`) }, expectField: "excludeCategories" },
    { name: "出现未知字段", body: { ...validBody, token: "x" }, expectField: "body" },
    { name: "请求体不是对象", body: "hello" },
    { name: "请求体为 null", body: null },
    { name: "请求体为数组", body: [validBody] },
  ];

  for (const item of cases) {
    it(`${item.name} → 拒绝`, () => {
      const result = parseRecommendRequest(item.body);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message.length).toBeGreaterThan(0);
      if (item.expectField) expect(result.field).toBe(item.expectField);
    });
  }

  it("外送请求的报错文案说明原因，而不是只说参数错误", () => {
    const result = parseRecommendRequest({ ...validBody, orderType: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("到店自提");
  });
});
