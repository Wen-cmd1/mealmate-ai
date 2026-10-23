import { afterEach, describe, expect, it } from "vitest";

import { RecommendationEngine, RecommendationError } from "@/lib/recommendation/engine";
import type { RecommendRequest } from "@/lib/recommendation/types";
import {
  buildFixtureMenu,
  createFakeProvider,
  makeMenuItem,
  makeMenu,
  makeQuote,
  menuTotalOf,
  timeoutError,
  toolError,
} from "../helpers/fake-provider";

/**
 * 推荐引擎测试（**不联网**）。
 *
 * 默认菜单来自真实抓取的 fixture，所以"预算 25 元能出 3 条"这类断言
 * 是对真实菜单结构成立的，不是对假数据成立。
 * 极端场景（算价不一致、超时、候选不足）用假 Provider 构造。
 */

const fixtureMenu = buildFixtureMenu();

function baseRequest(overrides: Partial<RecommendRequest> = {}): RecommendRequest {
  return {
    budgetFen: 2500,
    city: "广州市",
    keyword: "天河",
    storeCode: "1400359",
    orderType: 1,
    beType: 1,
    ...overrides,
  };
}

function engineWith(provider: ReturnType<typeof createFakeProvider>): RecommendationEngine {
  return new RecommendationEngine({ provider });
}

afterEach(() => {
  delete process.env.MCD_MCP_TOKEN;
});

describe("推荐主流程（真实菜单 fixture，¥25）", () => {
  it("返回 3 条推荐，全部通过官方算价核验且不超预算", async () => {
    const provider = createFakeProvider();
    const result = await engineWith(provider).recommend(baseRequest({ preferences: ["鸡肉"] }));

    expect(result.success).toBe(true);
    expect(result.recommendations).toHaveLength(3);
    expect(result.warnings.filter((w) => w.code === "INSUFFICIENT_CANDIDATES")).toHaveLength(0);

    for (const rec of result.recommendations) {
      expect(rec.priceVerified).toBe(true);
      expect(rec.verifiedPriceFen).not.toBeNull();
      expect(rec.totalPriceFen).toBe(rec.verifiedPriceFen);
      expect(rec.totalPriceFen).toBeLessThanOrEqual(2500);
      expect(rec.remainingFen).toBe(2500 - rec.totalPriceFen);
      expect(Number.isInteger(rec.totalPriceFen)).toBe(true);
      expect(rec.reason.length).toBeGreaterThan(10);
    }

    expect(result.recommendations.map((r) => r.type)).toEqual(["save", "balanced", "satisfy"]);
    expect(result.stats.quotesUsed).toBe(provider.calls.quotePrice);
    expect(result.stats.quotesUsed).toBeLessThanOrEqual(12);
    expect(result.source.toolsUsed).toContain("calculate-price");
    expect(result.source.toolsUsed).toContain("query-meals");
  });

  it("三种方案使用不同主 SKU", async () => {
    const result = await engineWith(createFakeProvider()).recommend(baseRequest());
    const primaryCodes = result.recommendations.map((r) => r.items[0].code);
    expect(new Set(primaryCodes).size).toBe(primaryCodes.length);
  });

  it("省钱方案的价格不高于另外两个方案", async () => {
    const result = await engineWith(createFakeProvider()).recommend(baseRequest());
    const save = result.recommendations.find((r) => r.type === "save");
    const others = result.recommendations.filter((r) => r.type !== "save");
    expect(save).toBeDefined();
    for (const other of others) {
      expect(save!.totalPriceFen).toBeLessThanOrEqual(other.totalPriceFen);
    }
  });

  it("每条推荐都包含至少一份套餐或主食，不会拿饮料/酱料/周边凑数", async () => {
    const result = await engineWith(createFakeProvider()).recommend(baseRequest());
    for (const rec of result.recommendations) {
      expect(["combo", "main"]).toContain(rec.items[0].role);
      for (const item of rec.items) {
        expect(["merch", "sauce"]).not.toContain(item.role);
      }
    }
  });

  it("maxResults=1 时只返回 1 条", async () => {
    const result = await engineWith(createFakeProvider()).recommend(baseRequest({ maxResults: 1 }));
    expect(result.recommendations).toHaveLength(1);
  });
});

describe("预算档位 10 / 15 / 20 / 25 / 30 / 50 元", () => {
  const budgets = [1000, 1500, 2000, 2500, 3000, 5000];

  for (const budgetFen of budgets) {
    it(`预算 ${budgetFen / 100} 元：所有推荐都不超预算，且价格已核验`, async () => {
      const result = await engineWith(createFakeProvider()).recommend(baseRequest({ budgetFen }));

      expect(result.success).toBe(true);
      expect(result.budgetFen).toBe(budgetFen);
      for (const rec of result.recommendations) {
        expect(rec.totalPriceFen).toBeLessThanOrEqual(budgetFen);
        expect(rec.priceVerified).toBe(true);
        expect(rec.remainingFen).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it("预算 10 元：菜单最低正餐 ¥13.90，返回 0 条并给出可执行原因", async () => {
    const provider = createFakeProvider();
    const result = await engineWith(provider).recommend(baseRequest({ budgetFen: 1000 }));

    expect(result.recommendations).toEqual([]);
    expect(result.stats.withinBudgetCount).toBe(0);
    // 没有任何候选进预算，就不该浪费算价调用
    expect(provider.calls.quotePrice).toBe(0);
    expect(result.emptyReason).toContain("¥10.00");
    expect(result.emptyReason).toContain("不算一顿饭");
  });

  it("预算 15 元：仍能给出完整正餐，且不会推荐 ¥13 的薯条", async () => {
    const result = await engineWith(createFakeProvider()).recommend(baseRequest({ budgetFen: 1500 }));
    expect(result.recommendations.length).toBeGreaterThan(0);
    for (const rec of result.recommendations) {
      expect(rec.items[0].name).not.toBe("薯条");
      expect(rec.totalPriceFen).toBeLessThanOrEqual(1500);
    }
  });
});

describe("价格核验", () => {
  it("菜单标价与官方算价不一致时，标记 mismatch 并以算价为准", async () => {
    const provider = createFakeProvider({
      quote: (items) => makeQuote(fixtureMenu, items, menuTotalOf(items, fixtureMenu) + 500),
    });
    const result = await engineWith(provider).recommend(baseRequest({ budgetFen: 2500 }));

    expect(result.recommendations.length).toBeGreaterThan(0);
    for (const rec of result.recommendations) {
      expect(rec.priceMismatch).toBe(true);
      expect(rec.totalPriceFen).toBe(rec.menuPriceFen + 500);
      expect(rec.highlights.join()).toContain("不一致");
    }
  });

  it("算价后超预算的候选会被剔除，而不是按菜单价放行", async () => {
    const provider = createFakeProvider({
      quote: (items) => makeQuote(fixtureMenu, items, 999_900),
    });
    const result = await engineWith(provider).recommend(baseRequest({ budgetFen: 2500 }));

    expect(result.recommendations).toEqual([]);
    expect(result.stats.rejectionCounts.over_budget).toBeGreaterThan(0);
    expect(result.warnings.map((w) => w.code)).toContain("QUOTE_REJECTED_OVER_BUDGET");
    expect(result.emptyReason).toContain("算价");
  });

  it("某个候选算价失败时跳过它，继续尝试下一个", async () => {
    let attempt = 0;
    const provider = createFakeProvider({
      quote: (items) => {
        attempt += 1;
        // 第一次报价失败，之后正常
        if (attempt === 1) throw toolError("该商品暂不可售");
        return makeQuote(fixtureMenu, items, menuTotalOf(items, fixtureMenu));
      },
    });

    const result = await engineWith(provider).recommend(baseRequest());

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.stats.rejectionCounts.quote_failed).toBe(1);
    expect(result.warnings.map((w) => w.code)).toContain("QUOTE_FAILED");
  });

  it("算价返回 0 分视为异常价格，直接丢弃该候选", async () => {
    const provider = createFakeProvider({
      quote: (items) => makeQuote(fixtureMenu, items, 0),
    });
    const result = await engineWith(provider).recommend(baseRequest());
    expect(result.recommendations).toEqual([]);
    expect(result.stats.rejectionCounts.quote_invalid).toBeGreaterThan(0);
  });

  it("算价请求带的是真实 SKU 编码", async () => {
    const provider = createFakeProvider();
    await engineWith(provider).recommend(baseRequest());

    const menuCodes = new Set(fixtureMenu.items.map((i) => i.code));
    expect(provider.quotedCodes.length).toBeGreaterThan(0);
    for (const codes of provider.quotedCodes) {
      expect(codes.length).toBeGreaterThan(0);
      for (const code of codes) expect(menuCodes.has(code)).toBe(true);
    }
  });
});

describe("故障与降级", () => {
  it("MCP 连接超时 → 抛出 MCP_TIMEOUT（HTTP 504），不返回假结果", async () => {
    const provider = createFakeProvider({ getMenuError: timeoutError() });
    const error = await engineWith(provider)
      .recommend(baseRequest())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RecommendationError);
    expect((error as RecommendationError).code).toBe("MCP_TIMEOUT");
    expect((error as RecommendationError).httpStatus).toBe(504);
    expect((error as RecommendationError).retryable).toBe(true);
  });

  it("门店查询失败 → 降级继续（门店名留空 + 告警），不影响菜单与核验", async () => {
    const provider = createFakeProvider({ findStoresError: new Error("connection reset by peer") });
    const result = await engineWith(provider).recommend(baseRequest());

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.source.storeName).toBe("");
    expect(result.source.storeCode).toBe("1400359");
    expect(result.warnings.map((w) => w.code)).toContain("STORE_LOOKUP_FAILED");
  });

  it("没有商圈关键词时不查门店，只告警", async () => {
    const provider = createFakeProvider();
    const result = await engineWith(provider).recommend(baseRequest({ keyword: undefined }));

    expect(provider.calls.findStores).toBe(0);
    expect(result.warnings.map((w) => w.code)).toContain("STORE_NAME_UNAVAILABLE");
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("门店编码不在搜索结果里 → STORE_NOT_FOUND 告警", async () => {
    const provider = createFakeProvider({ stores: [] });
    const result = await engineWith(provider).recommend(baseRequest());
    expect(result.warnings.map((w) => w.code)).toContain("STORE_NOT_FOUND");
  });

  it("门店休息中 → 给出 STORE_CLOSED 告警但仍返回实时菜单结果", async () => {
    const provider = createFakeProvider({
      stores: [
        {
          storeCode: "1400359",
          storeName: "麦当劳广州天源路餐厅",
          businessStatus: false,
        },
      ],
    });
    const result = await engineWith(provider).recommend(baseRequest());
    expect(result.warnings.map((w) => w.code)).toContain("STORE_CLOSED");
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});

describe("非餐食商品排除", () => {
  it("周边 / 酱料 / 单点饮料不会被当作正餐推荐", async () => {
    const menu = makeMenu([
      makeMenuItem({ code: "M1", name: "麦当劳联名徽章", priceFen: 3490, categoryName: "人气热卖" }),
      makeMenuItem({ code: "S0", name: "韩式烟熏芝士风味酱", priceFen: 300, categoryName: "炸鸡" }),
      makeMenuItem({ code: "D0", name: "可乐", priceFen: 950, categoryName: "饮品" }),
      makeMenuItem({ code: "F0", name: "薯条", priceFen: 1350, categoryName: "小食甜品 /其他" }),
      makeMenuItem({ code: "B1", name: "板烧鸡腿堡", priceFen: 2350, categoryName: "鸡肉汉堡 /卷" }),
    ]);

    const result = await engineWith(createFakeProvider({ menu })).recommend(baseRequest());

    expect(result.recommendations.length).toBe(1);
    expect(result.recommendations[0].items[0].code).toBe("B1");
    expect(result.stats.exclusionCounts.non_food).toBe(1);
    expect(result.stats.exclusionCounts.sauce).toBe(1);
    expect(result.stats.exclusionCounts.drink_only).toBe(1);
    expect(result.stats.exclusionCounts.side_only).toBe(1);
  });

  it("菜单里只有高价周边时，宁可返回 0 条也不推荐", async () => {
    const menu = makeMenu([
      makeMenuItem({ code: "M1", name: "麦当劳联名徽章", priceFen: 1000 }),
      makeMenuItem({ code: "M2", name: "薯条脆卜卜毛绒周边", priceFen: 2000 }),
    ]);
    const result = await engineWith(createFakeProvider({ menu })).recommend(
      baseRequest({ budgetFen: 3000 }),
    );

    expect(result.recommendations).toEqual([]);
    expect(result.emptyReason).toContain("没有识别到可作为正餐");
  });
});

describe("候选不足时不凑数", () => {
  it("只有 1 份正餐 → 返回 1 条，并明确告警", async () => {
    const menu = makeMenu([makeMenuItem({ code: "B1", name: "板烧鸡腿堡", priceFen: 2350 })]);
    const result = await engineWith(createFakeProvider({ menu })).recommend(baseRequest());

    expect(result.recommendations.length).toBe(1);
    expect(result.warnings.map((w) => w.code)).toContain("INSUFFICIENT_CANDIDATES");
    expect(result.warnings.find((w) => w.code === "INSUFFICIENT_CANDIDATES")?.message).toContain("1");
  });

  it("只有 2 份正餐 → 返回 2 条", async () => {
    const menu = makeMenu([
      makeMenuItem({ code: "B1", name: "板烧鸡腿堡", priceFen: 2350 }),
      makeMenuItem({ code: "B2", name: "巨无霸", priceFen: 2550, categoryName: "巨无霸 /牛鱼肉堡" }),
    ]);
    const result = await engineWith(createFakeProvider({ menu })).recommend(
      baseRequest({ budgetFen: 3000 }),
    );

    expect(result.recommendations).toHaveLength(2);
    expect(result.recommendations.map((r) => r.type)).toEqual(["save", "balanced"]);
  });

  it("菜单为空时给出明确原因，而不是抛错", async () => {
    const result = await engineWith(createFakeProvider({ menu: makeMenu([]) })).recommend(
      baseRequest(),
    );
    expect(result.recommendations).toEqual([]);
    expect(result.emptyReason).toContain("没有返回任何在售餐品");
  });
});

describe("安全：响应不含凭证", () => {
  it("响应 JSON 里没有 token、Bearer、Authorization", async () => {
    process.env.MCD_MCP_TOKEN = "fake-token-for-test-0123456789abcdef";
    const result = await engineWith(createFakeProvider()).recommend(baseRequest());
    const text = JSON.stringify(result);

    expect(text).not.toContain("fake-token-for-test");
    expect(text).not.toContain("Bearer");
    expect(text.toLowerCase()).not.toContain("authorization");
  });

  it("推荐项只暴露展示所需字段，不带上游原始载荷", async () => {
    const result = await engineWith(createFakeProvider()).recommend(baseRequest());
    const item = result.recommendations[0].items[0];

    expect(Object.keys(item).sort()).toEqual([
      "categoryName",
      "code",
      "menuPriceFen",
      "name",
      "needsFurtherSelection",
      "onSale",
      "originalPriceFen",
      "quantity",
      "role",
      "unitPriceFen",
    ]);
    expect(item).not.toHaveProperty("nutrition");
    expect(item).not.toHaveProperty("source");
  });
});
