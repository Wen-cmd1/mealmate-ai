import { describe, expect, it } from "vitest";

import { computeBudgetSummary, createBudgetPlan, impactOfVerifiedPrice, suggestMealBudget } from "@/lib/budget/budget-engine";
import { addExpense, createExpense } from "@/lib/budget/ledger";
import { draftExpenseFromRecommendation } from "@/lib/budget/meal-link";
import type { BudgetPlan, ExpenseRecord } from "@/lib/budget/types";
import { RecommendationEngine } from "@/lib/recommendation/engine";
import { parseRecommendRequest } from "@/lib/recommendation/schema";
import type { RecommendRequest, Recommendation } from "@/lib/recommendation/types";
import { createFakeProvider } from "../helpers/fake-provider";

/**
 * 任务 003：推荐结果 × 预算预测 的联动，以及任务 002 API 的向后兼容。
 *
 * 关键断言：**点「查看推荐」不得产生任何账本写入**。
 */

const NOW = new Date("2026-10-21T04:00:00.000Z");
const TODAY = "2026-10-21";

function plan900(): BudgetPlan {
  return createBudgetPlan({
    name: "10 月餐饮",
    totalFen: 90_000,
    periodKind: "month",
    anchorDate: "2026-10-15",
    timezone: "Asia/Shanghai",
    dailyMealCount: 3,
    now: NOW,
    idFactory: () => "plan-900",
  }).plan;
}

let seq = 0;
function seedRecords(): ExpenseRecord[] {
  seq = 0;
  return [
    createExpense({
      planId: "plan-900",
      amountFen: 2_450,
      occurredAt: "2026-10-02T04:00:00.000Z",
      description: "午餐",
      now: NOW,
      idFactory: () => `seed-${++seq}`,
    }),
    createExpense({
      planId: "plan-900",
      amountFen: 1_890,
      occurredAt: "2026-10-10T04:00:00.000Z",
      description: "午餐",
      now: NOW,
      idFactory: () => `seed-${++seq}`,
    }),
    createExpense({
      planId: "plan-900",
      amountFen: 3_120,
      occurredAt: "2026-10-18T04:00:00.000Z",
      description: "晚餐",
      now: NOW,
      idFactory: () => `seed-${++seq}`,
    }),
  ];
}

function baseRequest(budgetFen: number): RecommendRequest {
  return {
    budgetFen,
    city: "广州市",
    keyword: "天河",
    storeCode: "1400359",
    orderType: 1,
    beType: 1,
  };
}

describe("建议预算 → 推荐 → Meal Impact 全链路（假 Provider，真实菜单 fixture）", () => {
  it("建议单餐预算落在 API 允许的区间，且推荐结果全部可核验", async () => {
    const plan = plan900();
    const records = seedRecords();
    const summary = computeBudgetSummary(plan, records, { today: TODAY });

    const suggestion = suggestMealBudget(summary, { dailyMealCount: plan.dailyMealCount });
    expect(suggestion.suggestedFen).toBe(2_500);

    const engine = new RecommendationEngine({ provider: createFakeProvider() });
    const result = await engine.recommend(baseRequest(suggestion.suggestedFen as number));

    expect(result.success).toBe(true);
    expect(result.budgetFen).toBe(2_500);
    expect(result.recommendations.length).toBeGreaterThan(0);
    for (const rec of result.recommendations) {
      expect(rec.priceVerified).toBe(true);
      expect(rec.verifiedPriceFen).not.toBeNull();
      expect(rec.totalPriceFen).toBeLessThanOrEqual(2_500);
    }
  });

  it("查看推荐不会写入账本；只有用户确认后才扣预算", async () => {
    const plan = plan900();
    const records = seedRecords();
    const summary = computeBudgetSummary(plan, records, { today: TODAY });
    const spentBefore = summary.spentFen;

    const engine = new RecommendationEngine({ provider: createFakeProvider() });
    const result = await engine.recommend(baseRequest(2_500));

    // 1. 查询推荐后：账本条数与已花金额都没变
    expect(records).toHaveLength(3);
    expect(computeBudgetSummary(plan, records, { today: TODAY }).spentFen).toBe(spentBefore);

    const rec = result.recommendations[0] as Recommendation;

    // 2. 每条推荐的 impact 都用「已核验价格」计算，且余额等于剩余减价格
    for (const candidate of result.recommendations) {
      const impact = impactOfVerifiedPrice(summary, candidate.verifiedPriceFen as number);
      expect(impact.remainingBeforeFen).toBe(summary.remainingFen);
      expect(impact.remainingAfterFen).toBe(summary.remainingFen - candidate.totalPriceFen);
    }

    // 3. 用户显式确认后，才真正写账本
    //    这里挑一条「不需要再选内容」的推荐：需要再选的套餐金额必须留空由用户填
    const simple = result.recommendations.find((candidate) => !candidate.needsFurtherSelection);
    const draft = draftExpenseFromRecommendation(simple ?? rec);
    if (simple) {
      expect(draft.amountFen).toBe(simple.verifiedPriceFen);
      expect(draft.requiresUserAmount).toBe(false);
    } else {
      expect(draft.amountFen).toBeNull();
      expect(draft.requiresUserAmount).toBe(true);
    }

    const chosen = simple ?? rec;
    const record = createExpense({
      planId: plan.id,
      amountFen: chosen.verifiedPriceFen as number,
      occurredAt: "2026-10-21T04:30:00.000Z",
      description: draft.description,
      source: "recommendation",
      status: "confirmed",
      relatedProductCode: draft.relatedProductCode,
      relatedRecommendationType: draft.relatedRecommendationType,
      requestId: "req-1",
      now: NOW,
      idFactory: () => "new-1",
    });

    const added = addExpense(records, record);
    expect(added.duplicate).toBe(false);
    expect(added.records).toHaveLength(4);

    const after = computeBudgetSummary(plan, added.records, { today: TODAY });
    expect(after.spentFen).toBe(spentBefore + chosen.totalPriceFen);
    expect(after.remainingFen).toBe(summary.remainingFen - chosen.totalPriceFen);
    expect(after.dailyAllowanceFen).toBeLessThan(summary.dailyAllowanceFen as number);
  });

  it("同一条推荐重复点击只落一条", () => {
    const plan = plan900();
    const records = seedRecords();
    const base = { planId: plan.id, requestId: "req-same" };

    const first = addExpense(
      records,
      createExpense({
        ...base,
        amountFen: 1_390,
        occurredAt: "2026-10-21T04:30:00.000Z",
        description: "随心配",
        now: NOW,
        idFactory: () => "dup-1",
      }),
    );
    const second = addExpense(
      first.records,
      createExpense({
        ...base,
        amountFen: 1_390,
        occurredAt: "2026-10-21T04:30:00.000Z",
        description: "随心配",
        now: new Date(NOW.getTime() + 2_000),
        idFactory: () => "dup-2",
      }),
    );

    expect(second.duplicate).toBe(true);
    expect(second.records).toHaveLength(4);
  });
});

describe("需要进一步选择的套餐不能直接当实付金额", () => {
  it("needsFurtherSelection 时金额留空并要求用户确认", () => {
    const rec = {
      type: "save",
      title: "省钱优先",
      items: [
        {
          code: "9900013304",
          name: "人气经典随心配",
          role: "combo",
          quantity: 1,
          menuPriceFen: 1_390,
          unitPriceFen: 1_390,
          onSale: false,
          needsFurtherSelection: true,
        },
      ],
      totalPriceFen: 1_390,
      menuPriceFen: 1_390,
      verifiedPriceFen: 1_390,
      priceVerified: true,
      priceMismatch: false,
      remainingFen: 1_110,
      composition: "combo",
      needsFurtherSelection: true,
      reason: "测试用",
      highlights: [],
      score: 1,
      scoreBreakdown: { priceFit: 1, completeness: 1, preference: 0, value: 0 },
    } satisfies Recommendation;

    const draft = draftExpenseFromRecommendation(rec);
    expect(draft.amountFen).toBeNull();
    expect(draft.requiresUserAmount).toBe(true);
    expect(draft.note).toContain("实际支付");
  });

  it("未核验的推荐同样不预填金额", () => {
    const rec = {
      type: "balanced",
      title: "均衡选择",
      items: [],
      totalPriceFen: 2_000,
      menuPriceFen: 2_000,
      verifiedPriceFen: null,
      priceVerified: false,
      priceMismatch: false,
      remainingFen: 500,
      composition: "main",
      needsFurtherSelection: false,
      reason: "测试用",
      highlights: [],
      score: 1,
      scoreBreakdown: { priceFit: 1, completeness: 1, preference: 0, value: 0 },
    } satisfies Recommendation;

    const draft = draftExpenseFromRecommendation(rec);
    expect(draft.amountFen).toBeNull();
    expect(draft.requiresUserAmount).toBe(true);
  });
});

describe("任务 002 的 API 向后兼容", () => {
  it("旧请求体（含 preferences / maxResults）仍然可用", () => {
    const parsed = parseRecommendRequest({
      budgetFen: 2500,
      city: "广州市",
      keyword: "天河",
      storeCode: "1400359",
      orderType: 1,
      beType: 1,
      preferences: ["鸡肉"],
      maxResults: 3,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.budgetFen).toBe(2_500);
      expect(parsed.value.preferences).toEqual(["鸡肉"]);
    }
  });

  it("省略所有可选字段仍然可用（默认 25 元 / 到店自提）", () => {
    const parsed = parseRecommendRequest({ city: "广州市", storeCode: "1400359" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.budgetFen).toBe(2_500);
      expect(parsed.value.orderType).toBe(1);
      expect(parsed.value.beType).toBe(1);
    }
  });

  it("响应结构保留了任务 002 的全部字段", async () => {
    const engine = new RecommendationEngine({ provider: createFakeProvider() });
    const result = await engine.recommend(baseRequest(2_500));

    for (const key of [
      "success",
      "budgetFen",
      "recommendations",
      "source",
      "stats",
      "warnings",
      "elapsedMs",
    ]) {
      expect(result).toHaveProperty(key);
    }

    const rec = result.recommendations[0] as Recommendation;
    for (const key of [
      "type",
      "title",
      "items",
      "totalPriceFen",
      "menuPriceFen",
      "verifiedPriceFen",
      "priceVerified",
      "priceMismatch",
      "remainingFen",
      "composition",
      "needsFurtherSelection",
      "reason",
      "highlights",
      "score",
      "scoreBreakdown",
    ]) {
      expect(rec).toHaveProperty(key);
    }

    expect(result.source.toolsUsed).toContain("query-meals");
    expect(result.source.toolsUsed).toContain("calculate-price");
  });
});
