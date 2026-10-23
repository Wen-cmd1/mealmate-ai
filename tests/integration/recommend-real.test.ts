import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasMcpToken, loadLocalEnv } from "../helpers/env";

/**
 * 真实 MCP 单餐推荐集成测试（**会联网**）。
 *
 * 没有 `MCD_MCP_TOKEN` 时整组 skip，报告里记 NOT RUN，
 * 绝不用 fixture 或 mock 冒充"真实推荐结果"。
 *
 * 设置 `DUMP_RECOMMEND=1` 会把完整响应打到 stdout，供生成交付报告时取证。
 */

loadLocalEnv();

const enabled = hasMcpToken();
const describeIf = enabled ? describe : describe.skip;
const dump = process.env.DUMP_RECOMMEND === "1";

describeIf("真实 MCP 单餐推荐", () => {
  let provider: import("@/lib/providers/meal-provider").McdMealProvider;
  let engine: import("@/lib/recommendation/engine").RecommendationEngine;
  let storeCode = "";
  let storeName = "";
  let result: import("@/lib/recommendation/types").RecommendResponse;

  beforeAll(async () => {
    const { McdMealProvider } = await import("@/lib/providers/meal-provider");
    const { RecommendationEngine } = await import("@/lib/recommendation/engine");

    provider = new McdMealProvider();
    engine = new RecommendationEngine({ provider });

    const stores = await provider.findStores({
      city: "广州市",
      keyword: "天河",
      beType: 1,
      searchType: 2,
    });
    expect(stores.length).toBeGreaterThan(0);
    storeCode = stores[0].storeCode;
    storeName = stores[0].storeName;

    result = await engine.recommend({
      budgetFen: 2500,
      city: "广州市",
      keyword: "天河",
      storeCode,
      orderType: 1,
      beType: 1,
      preferences: ["鸡肉"],
    });

    if (dump) {
      console.log("===DUMP_RECOMMEND_START===");
      console.log(JSON.stringify(result, null, 1));
      console.log("===DUMP_RECOMMEND_END===");
    }
  }, 180_000);

  afterAll(async () => {
    await provider?.close();
  });

  it("25 元预算返回 1~3 条推荐，且全部通过官方算价核验", () => {
    expect(result.success).toBe(true);
    expect(result.budgetFen).toBe(2500);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeLessThanOrEqual(3);

    for (const rec of result.recommendations) {
      expect(rec.priceVerified).toBe(true);
      expect(rec.verifiedPriceFen).not.toBeNull();
      expect(rec.totalPriceFen).toBe(rec.verifiedPriceFen);
      expect(rec.totalPriceFen).toBeLessThanOrEqual(2500);
      expect(rec.remainingFen).toBe(2500 - rec.totalPriceFen);
      expect(Number.isInteger(rec.totalPriceFen)).toBe(true);
      expect(rec.items.length).toBeGreaterThan(0);
      expect(rec.reason.length).toBeGreaterThan(10);
    }
  });

  it("三条方案使用不同主 SKU，且没有任何一条是饮料/酱料/周边", () => {
    const primaryCodes = result.recommendations.map((r) => r.items[0].code);
    expect(new Set(primaryCodes).size).toBe(primaryCodes.length);

    for (const rec of result.recommendations) {
      for (const item of rec.items) {
        expect(["combo", "main", "side", "dessert"]).toContain(item.role);
      }
      // 主餐品必须是套餐或主食
      expect(["combo", "main"]).toContain(rec.items[0].role);
    }
  });

  it("来源信息完整：门店、抓取时间、真实调用过的工具", () => {
    expect(result.source.provider).toBe("mcd-mcp");
    expect(result.source.storeCode).toBe(storeCode);
    expect(result.source.storeName).toBe(storeName);
    expect(result.source.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.source.toolsUsed).toContain("query-meals");
    expect(result.source.toolsUsed).toContain("calculate-price");
    expect(result.source.toolsUsed).toContain("query-nearby-stores");
  });

  it("响应中不含 token 或 Bearer 认证头", () => {
    const text = JSON.stringify(result);
    const token = process.env.MCD_MCP_TOKEN?.trim() ?? "";
    expect(text).not.toContain("Bearer");
    if (token) expect(text).not.toContain(token);
  });

  it("10 元预算：要么给不出并说明原因，要么给的都是预算内且已核验的", async () => {
    const poor = await engine.recommend({
      budgetFen: 1000,
      city: "广州市",
      keyword: "天河",
      storeCode,
      orderType: 1,
      beType: 1,
    });

    expect(poor.success).toBe(true);

    if (poor.recommendations.length === 0) {
      // 没有候选落在 ¥10 内：必须给出原因，且不能凭空算价
      expect(poor.emptyReason).toBeTruthy();
      expect(poor.stats.quotesUsed).toBe(0);
    } else {
      // 上游菜单是实时数据。任务 006 实测到：2026-10-22 门店出现 ¥9.90 的
      // 「芝芝火腿扒堡组合」，于是「10 元内一定没有完整正餐」这条断言当场变红。
      // 断言应该落在**不变量**上——给得出就必须在预算内、必须已核验；
      // 给不出就必须说明原因——而不是赌某天的菜单长什么样。
      for (const item of poor.recommendations) {
        expect(item.totalPriceFen).toBeLessThanOrEqual(1000);
        expect(item.priceVerified).toBe(true);
      }
    }

    if (dump) {
      console.log("===DUMP_RECOMMEND_1000_START===");
      console.log(
        JSON.stringify(
          {
            count: poor.recommendations.length,
            emptyReason: poor.emptyReason,
            prices: poor.recommendations.map((r) => r.totalPriceFen),
            stats: poor.stats,
          },
          null,
          1,
        ),
      );
      console.log("===DUMP_RECOMMEND_1000_END===");
    }
  }, 60_000);
});

describe.runIf(!enabled)("未配置 token", () => {
  it("真实推荐集成测试被跳过（无 MCD_MCP_TOKEN，未验证）", () => {
    expect(enabled).toBe(false);
  });
});
