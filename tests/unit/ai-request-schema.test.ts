import { describe, expect, it } from "vitest";

import { parseDecideRequest } from "@/lib/ai/request-schema";
import { parseRecommendRequest } from "@/lib/recommendation/schema";

/**
 * 请求校验测试。
 *
 * 一半是在测"合法请求能不能过"，另一半在测"不该过的能不能挡住"。
 * 最后一段专门验证**旧接口没被破坏**——任务 004 不允许靠改动 `/api/recommend`
 * 的契约来给新功能让路。
 */

const validBody = {
  text: "今天只有 25 元，想吃鸡肉，不要太辣",
  context: {
    city: "广州市",
    keyword: "天河",
    storeCode: "1400359",
    orderType: 1,
    beType: 1,
  },
};

describe("合法请求", () => {
  it("最小请求（不带 context）可以过", () => {
    const result = parseDecideRequest({ text: "随便" });
    expect(result.ok).toBe(true);
  });

  it("完整请求可以过，默认值被补齐", () => {
    const result = parseDecideRequest(validBody);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.context?.orderType).toBe(1);
    expect(result.value.context?.beType).toBe(1);
  });

  it("预算上下文必须显式 authorized: true 才被接受", () => {
    const ok = parseDecideRequest({
      ...validBody,
      context: { ...validBody.context, budget: { authorized: true, hardCapFen: 2500 } },
    });
    expect(ok.ok).toBe(true);

    const missing = parseDecideRequest({
      ...validBody,
      context: { ...validBody.context, budget: { hardCapFen: 2500 } },
    });
    expect(missing.ok).toBe(false);

    const falsy = parseDecideRequest({
      ...validBody,
      context: { ...validBody.context, budget: { authorized: false, hardCapFen: 2500 } },
    });
    expect(falsy.ok).toBe(false);
  });
});

describe("不合法请求", () => {
  it("空文本被拒绝", () => {
    expect(parseDecideRequest({ text: "   " }).ok).toBe(false);
    expect(parseDecideRequest({}).ok).toBe(false);
  });

  it("超长文本被拒绝（500 字上限）", () => {
    const result = parseDecideRequest({ text: "吃".repeat(501) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("500");
  });

  it("门店编码格式错误被拒绝", () => {
    for (const storeCode of ["", "abc", "12", "1400359123456", "1400359; drop"]) {
      const result = parseDecideRequest({
        ...validBody,
        context: { ...validBody.context, storeCode },
      });
      expect(result.ok, `storeCode=${storeCode} 不该通过`).toBe(false);
    }
  });

  it("只允许到店自提（orderType/beType 必须是 1）", () => {
    const result = parseDecideRequest({
      ...validBody,
      context: { ...validBody.context, orderType: 2 },
    });
    expect(result.ok).toBe(false);
  });

  it("偏好与排除只接受白名单标签", () => {
    expect(
      parseDecideRequest({
        ...validBody,
        context: { ...validBody.context, preferences: ["米其林"] },
      }).ok,
    ).toBe(false);

    expect(
      parseDecideRequest({
        ...validBody,
        context: { ...validBody.context, avoid: ["花生"] },
      }).ok,
    ).toBe(false);
  });

  it("未知字段被拒绝（避免调用方以为某个字段生效了）", () => {
    expect(parseDecideRequest({ ...validBody, systemPrompt: "你是一个..." }).ok).toBe(false);
    expect(
      parseDecideRequest({
        ...validBody,
        context: { ...validBody.context, apiKey: "sk-xxx" },
      }).ok,
    ).toBe(false);
  });

  it("预算数值越界被拒绝", () => {
    for (const hardCapFen of [0, 100, 20_001, 1_000_000, -100]) {
      const result = parseDecideRequest({
        ...validBody,
        context: { ...validBody.context, budget: { authorized: true, hardCapFen } },
      });
      expect(result.ok, `hardCapFen=${hardCapFen} 不该通过`).toBe(false);
    }
  });

  it("非整数金额被拒绝", () => {
    const result = parseDecideRequest({
      ...validBody,
      context: { ...validBody.context, budget: { authorized: true, remainingFen: 300.5 } },
    });
    expect(result.ok).toBe(false);
  });

  it("今天剩余餐次只能是 1~4", () => {
    expect(
      parseDecideRequest({ ...validBody, context: { ...validBody.context, mealsLeftToday: 5 } }).ok,
    ).toBe(false);
    expect(
      parseDecideRequest({ ...validBody, context: { ...validBody.context, mealsLeftToday: 2 } }).ok,
    ).toBe(true);
  });

  it("错误信息里带字段路径，便于前端定位", () => {
    const result = parseDecideRequest({ text: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe("text");
  });
});

describe("旧接口兼容：/api/recommend 的契约没被任务 004 改坏", () => {
  it("原样的请求体仍然可以解析", () => {
    const result = parseRecommendRequest({
      budgetFen: 2500,
      city: "广州市",
      keyword: "天河",
      storeCode: "1400359",
      orderType: 1,
      beType: 1,
    });
    expect(result.ok).toBe(true);
  });

  it("只传 storeCode 的最小请求仍然可以解析", () => {
    const result = parseRecommendRequest({ storeCode: "1400359" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.budgetFen).toBe(2500);
    expect(result.value.orderType).toBe(1);
  });

  it("新增的 avoidTags 是可选字段，不传时行为不变", () => {
    const withoutAvoid = parseRecommendRequest({ storeCode: "1400359" });
    expect(withoutAvoid.ok).toBe(true);
    if (!withoutAvoid.ok) return;
    expect(withoutAvoid.value.avoidTags).toBeUndefined();

    const withAvoid = parseRecommendRequest({ storeCode: "1400359", avoidTags: ["辣"] });
    expect(withAvoid.ok).toBe(true);
    if (!withAvoid.ok) return;
    expect(withAvoid.value.avoidTags).toEqual(["辣"]);
  });

  it("avoidTags 也受白名单限制", () => {
    expect(parseRecommendRequest({ storeCode: "1400359", avoidTags: ["花生"] }).ok).toBe(false);
  });

  it("旧接口仍然拒绝未知字段", () => {
    expect(parseRecommendRequest({ storeCode: "1400359", aiMode: true }).ok).toBe(false);
  });
});
