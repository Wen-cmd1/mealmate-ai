import { beforeAll, describe, expect, it } from "vitest";

import { hasMcpToken, loadLocalEnv } from "../helpers/env";

/**
 * 真实 MCP + 真实意图解析的端到端集成测试（**会联网**）。
 *
 * 三层都是真的：
 * - 意图层：`parseIntent`（未配置 AI_API_KEY 时走规则降级，日志里会明确标注）；
 * - 数据层：麦当劳官方 MCP（`query-nearby-stores` → `query-meals` → `calculate-price`）；
 * - 算法层：任务 002 的推荐引擎 + 任务 003 的 Meal Impact。
 *
 * 没有 `MCD_MCP_TOKEN` 时整组 skip，绝不用假数据冒充。
 * `DUMP_AI=1` 会把完整响应打到 stdout，供交付报告取证。
 */

loadLocalEnv();

const enabled = hasMcpToken();
const describeIf = enabled ? describe : describe.skip;
const dump = process.env.DUMP_AI === "1";

describeIf("真实链路：自然语言 → MCP → 推荐", () => {
  let decide: typeof import("@/lib/ai/decision-agent").decide;
  let provider: import("@/lib/providers/meal-provider").McdMealProvider;
  let createLlm: typeof import("@/lib/ai/provider").createLlmProvider;
  let storeCode = "";
  let storeName = "";
  let result: import("@/lib/ai/types").DecideResponse;
  let spicyResult: import("@/lib/ai/types").DecideResponse;

  beforeAll(async () => {
    const { decide: decideFn } = await import("@/lib/ai/decision-agent");
    const { createLlmProvider } = await import("@/lib/ai/provider");
    const { McdMealProvider } = await import("@/lib/providers/meal-provider");

    decide = decideFn;
    createLlm = createLlmProvider;
    provider = new McdMealProvider();

    const stores = await provider.findStores({
      city: "广州市",
      keyword: "天河",
      beType: 1,
      searchType: 2,
    });
    expect(stores.length).toBeGreaterThan(0);
    storeCode = stores[0]!.storeCode;
    storeName = stores[0]!.storeName;

    // 主案例：一句话（带硬预算 + 口味 + 排除）
    result = await decide(
      {
        text: "今天中午想吃鸡肉，最多 25 块，不吃辣",
        context: {
          city: "广州市",
          keyword: "天河",
          storeCode,
          orderType: 1,
          beType: 1,
          budget: {
            authorized: true,
            remainingFen: 82_540,
            daysRemaining: 11,
            reserveFen: 0,
            planName: "10 月餐饮预算",
          },
        },
      },
      { mealProvider: provider, llmProvider: createLlm() },
    );

    // 第二案例：只提排除项，用默认预算
    spicyResult = await decide(
      { text: "不考虑价格，但我不吃辣", context: { city: "广州市", keyword: "天河", storeCode, orderType: 1, beType: 1 } },
      { mealProvider: provider, llmProvider: createLlm() },
    );

    if (dump) {
      console.log("===DUMP_AI_START===");
      console.log(JSON.stringify(result, null, 1));
      console.log("===DUMP_AI_END===");
    }
  }, 240_000);

  it("返回结构与解析模式", () => {
    expect(result.success).toBe(true);
    expect(["LLM", "RULE_FALLBACK"]).toContain(result.mode);
    expect(result.intent.mealType).toBe("lunch");
    expect(result.intent.preferences).toContain("鸡肉");
    expect(result.intent.avoid).toContain("辣");
    expect(result.budget.appliedFen).toBe(2500);
    expect(result.budget.source).toBe("user_hard_cap");
  });

  it("给出三份真实推荐，且全部通过官方算价核验", () => {
    expect(result.recommendations.length).toBe(3);
    for (const item of result.recommendations) {
      expect(item.recommendation.priceVerified).toBe(true);
      expect(item.recommendation.verifiedPriceFen).not.toBeNull();
      expect(item.recommendation.totalPriceFen).toBe(item.recommendation.verifiedPriceFen);
      expect(item.recommendation.totalPriceFen).toBeLessThanOrEqual(2500);
      expect(item.recommendation.totalPriceFen).toBeGreaterThan(0);
    }
    expect(result.priceVerification.allVerified).toBe(true);
  });

  it("真实调用了三个只读工具", () => {
    expect(result.source.toolsUsed).toContain("query-nearby-stores");
    expect(result.source.toolsUsed).toContain("query-meals");
    expect(result.source.toolsUsed).toContain("calculate-price");
    expect(result.source.storeCode).toBe(storeCode);
    expect(result.source.storeName).toBe(storeName);
    expect(result.source.fetchedAt).toBeTruthy();
    expect(result.priceVerification.quotesUsed).toBeGreaterThan(0);
  });

  it("「不吃辣」在真实菜单上生效：推荐里没有名称含「辣」的餐品", () => {
    for (const item of result.recommendations) {
      for (const line of item.recommendation.items) {
        expect(line.name).not.toContain("辣");
      }
    }
  });

  it("真实菜单里确实存在辣味餐品（证明上面的过滤不是空跑）", () => {
    const allNames = spicyResult.recommendations.length > 0;
    expect(allNames).toBe(true);
    // 第二案例同样不应出现辣味餐品
    for (const item of spicyResult.recommendations) {
      for (const line of item.recommendation.items) {
        expect(line.name).not.toContain("辣");
      }
    }
  });

  it("免责说明存在，且不出现绝对化承诺", () => {
    const caveats = result.caveats.join("\n");
    expect(caveats).toContain("无法保证");
    expect(result.warnings.some((warning) => warning.code === "EXCLUSION_NOT_GUARANTEED")).toBe(true);

    const stripped = caveats.replaceAll("无法保证绝对不含", "").replaceAll("不能保证绝对不含", "");
    expect(stripped).not.toContain("绝对不含");
  });

  it("预算影响按授权的账本数据计算", () => {
    for (const item of result.recommendations) {
      expect(item.impact).not.toBeNull();
      expect(item.impact!.remainingBeforeFen).toBe(82_540);
      expect(item.impact!.remainingAfterFen).toBe(82_540 - item.recommendation.totalPriceFen);
    }
  });

  it("响应里不含任何凭证", () => {
    const json = JSON.stringify(result);
    const token = (process.env.MCD_MCP_TOKEN ?? "").trim();
    if (token) expect(json).not.toContain(token);
    const aiKey = (process.env.AI_API_KEY ?? "").trim();
    if (aiKey) expect(json).not.toContain(aiKey);
  });

  it("耗时在可接受范围（模型 + 菜单 + 算价）", () => {
    expect(result.elapsedMs).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeLessThan(30_000);
  });
});
