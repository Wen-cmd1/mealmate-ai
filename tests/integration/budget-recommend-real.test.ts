import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  computeBudgetSummary,
  createBudgetPlan,
  impactOfVerifiedPrice,
  suggestMealBudget,
} from "@/lib/budget/budget-engine";
import { createExpense } from "@/lib/budget/ledger";
import { elapsedDaysInPeriod, todayKey } from "@/lib/budget/period";
import type {
  BudgetPlan,
  BudgetSummary,
  ExpenseRecord,
  MealBudgetSuggestion,
} from "@/lib/budget/types";
import type { RecommendResponse } from "@/lib/recommendation/types";
import { hasMcpToken, loadLocalEnv } from "../helpers/env";

/**
 * 真实 MCP × 长期预算 联动集成测试（**会联网**）。
 *
 * 流程：900 元月度预算 → 记 3 笔已确认消费 → 算概览 → 建议单餐预算
 *      → 用建议值调真实 `query-nearby-stores / query-meals / calculate-price`
 *      → 把每条推荐的核验价喂给 Meal Impact。
 *
 * 没有 `MCD_MCP_TOKEN` 时整组 skip（报告记 NOT RUN），绝不用 fixture 冒充。
 * 计划按「当前月份」动态创建，避免测试随日期腐烂。
 */

loadLocalEnv();

const enabled = hasMcpToken();
const describeIf = enabled ? describe : describe.skip;
const dump = process.env.DUMP_BUDGET === "1";

describeIf("真实 MCP × 长期预算联动", () => {
  let provider: import("@/lib/providers/meal-provider").McdMealProvider;
  let plan: BudgetPlan;
  let records: ExpenseRecord[];
  let summary: BudgetSummary;
  let suggestion: MealBudgetSuggestion;
  let result: RecommendResponse;
  let storeCode = "";
  let storeName = "";

  beforeAll(async () => {
    const { McdMealProvider } = await import("@/lib/providers/meal-provider");
    const { RecommendationEngine } = await import("@/lib/recommendation/engine");

    provider = new McdMealProvider();

    const timezone = "Asia/Shanghai";
    const today = todayKey(timezone);

    plan = createBudgetPlan({
      name: "真实联动 · 月度预算",
      totalFen: 90_000,
      reserveFen: 0,
      periodKind: "month",
      anchorDate: today,
      timezone,
      dailyMealCount: 3,
      idFactory: () => "plan-real",
    }).plan;

    // 只在本周期"已经过去"的日子里造记录，模拟真实账单
    const elapsed = elapsedDaysInPeriod(plan.startDate, plan.endDate, today);
    const dayAt = (offset: number): string => {
      const safeOffset = Math.max(0, Math.min(offset, elapsed - 1));
      const base = new Date(`${plan.startDate}T04:00:00.000Z`).getTime();
      return new Date(base + safeOffset * 86_400_000).toISOString();
    };

    let seq = 0;
    records = [
      createExpense({ planId: plan.id, amountFen: 2_450, occurredAt: dayAt(0), description: "午餐", idFactory: () => `real-${++seq}` }),
      createExpense({ planId: plan.id, amountFen: 1_890, occurredAt: dayAt(Math.floor(elapsed / 3)), description: "午餐", idFactory: () => `real-${++seq}` }),
      createExpense({ planId: plan.id, amountFen: 3_120, occurredAt: dayAt(Math.floor((elapsed * 2) / 3)), description: "晚餐", idFactory: () => `real-${++seq}` }),
    ];

    summary = computeBudgetSummary(plan, records, { today });
    suggestion = suggestMealBudget(summary, { dailyMealCount: plan.dailyMealCount });

    const stores = await provider.findStores({
      city: "广州市",
      keyword: "天河",
      beType: 1,
      searchType: 2,
    });
    expect(stores.length).toBeGreaterThan(0);
    storeCode = stores[0].storeCode;
    storeName = stores[0].storeName;

    const engine = new RecommendationEngine({ provider });
    result = await engine.recommend({
      budgetFen: suggestion.suggestedFen ?? 2_500,
      city: "广州市",
      keyword: "天河",
      storeCode,
      orderType: 1,
      beType: 1,
    });

    if (dump) {
      console.log("===DUMP_BUDGET_START===");
      console.log(JSON.stringify({ today, plan, summary, suggestion, result }, null, 1));
      console.log("===DUMP_BUDGET_END===");
    }
  }, 180_000);

  afterAll(async () => {
    await provider?.close();
  });

  it("预算概览可用：已花金额只算 confirmed", () => {
    expect(summary.totalFen).toBe(90_000);
    expect(summary.spentFen).toBe(2_450 + 1_890 + 3_120);
    expect(summary.remainingFen).toBe(90_000 - summary.spentFen);
    expect(summary.daysRemaining).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(summary.remainingFen)).toBe(true);
  });

  it("建议单餐预算落在 API 允许区间，或被明确说明无法给出", () => {
    if (suggestion.suggestedFen === null) {
      expect(suggestion.blockedReason).toBeTruthy();
      return;
    }
    expect(suggestion.suggestedFen).toBeGreaterThanOrEqual(500);
    expect(suggestion.suggestedFen).toBeLessThanOrEqual(20_000);
    expect(suggestion.suggestedFen % 100).toBe(0);
    expect(suggestion.suggestedFen).toBe(result.budgetFen);
  });

  it("真实推荐返回 1~3 条，全部通过官方算价核验且在预算内", () => {
    expect(result.success).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeLessThanOrEqual(3);
    for (const rec of result.recommendations) {
      expect(rec.priceVerified).toBe(true);
      expect(rec.verifiedPriceFen).not.toBeNull();
      expect(rec.totalPriceFen).toBeLessThanOrEqual(result.budgetFen);
    }
  });

  it("每条推荐的 Meal Impact 与本周期剩余预算一致", () => {
    for (const rec of result.recommendations) {
      const value = impactOfVerifiedPrice(summary, rec.verifiedPriceFen as number);
      expect(value.remainingBeforeFen).toBe(summary.remainingFen);
      expect(value.remainingAfterFen).toBe(summary.remainingFen - rec.totalPriceFen);
      expect(Number.isInteger(value.remainingAfterFen)).toBe(true);
      if (value.afterDailyFen !== null) {
        expect(Number.isInteger(value.afterDailyFen)).toBe(true);
      }
    }
  });

  it("查询推荐不会写账本（账本仍然是 3 条）", () => {
    expect(records).toHaveLength(3);
    expect(summary.confirmedCount).toBe(3);
  });

  it("来源信息与预算数据里都不含 token", () => {
    expect(result.source.storeName).toBe(storeName);
    expect(result.source.storeCode).toBe(storeCode);
    expect(result.source.toolsUsed).toContain("calculate-price");

    const text = JSON.stringify({ result, summary, suggestion });
    expect(text).not.toContain("Bearer");
    const token = process.env.MCD_MCP_TOKEN?.trim() ?? "";
    if (token) expect(text).not.toContain(token);
  });
});

describe.runIf(!enabled)("未配置 token", () => {
  it("真实预算联动集成测试被跳过（无 MCD_MCP_TOKEN，未验证）", () => {
    expect(enabled).toBe(false);
  });
});
