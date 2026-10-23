import { describe, expect, it } from "vitest";

import {
  computeBudgetSummary,
  createBudgetPlan,
  impactOfVerifiedPrice,
  suggestMealBudget,
  updateBudgetPlan,
  validateBudgetPlan,
  SUGGESTED_BUDGET_MAX_FEN,
  SUGGESTED_BUDGET_MIN_FEN,
} from "@/lib/budget/budget-engine";
import { createExpense } from "@/lib/budget/ledger";
import type { BudgetPlan, ExpenseRecord } from "@/lib/budget/types";
import { BUDGET_MAX_FEN, BUDGET_MIN_FEN } from "@/lib/recommendation/schema";

/** 任务 003：预算引擎（概览、超支、预留、建议单餐预算） */

let seq = 0;
const idFactory = () => `id-${++seq}`;
const NOW = new Date("2026-10-21T04:00:00.000Z");

function plan900(overrides: Partial<BudgetPlan> = {}): BudgetPlan {
  const { plan } = createBudgetPlan({
    name: "10 月餐饮",
    totalFen: 90_000,
    reserveFen: 0,
    periodKind: "month",
    anchorDate: "2026-10-15",
    timezone: "Asia/Shanghai",
    dailyMealCount: 3,
    now: NOW,
    idFactory: () => "plan-900",
  });
  return { ...plan, ...overrides };
}

function expense(input: {
  amountFen: number;
  at: string;
  status?: "planned" | "confirmed";
  planId?: string;
}): ExpenseRecord {
  return createExpense({
    planId: input.planId ?? "plan-900",
    amountFen: input.amountFen,
    occurredAt: input.at,
    description: "餐费",
    status: input.status ?? "confirmed",
    now: NOW,
    idFactory,
  });
}

const RECORDS = [
  expense({ amountFen: 2_450, at: "2026-10-02T04:00:00.000Z" }),
  expense({ amountFen: 1_890, at: "2026-10-10T04:00:00.000Z" }),
  expense({ amountFen: 3_120, at: "2026-10-18T04:00:00.000Z" }),
];

describe("创建预算计划", () => {
  it("每月：自动取整月", () => {
    const plan = plan900();
    expect(plan.startDate).toBe("2026-10-01");
    expect(plan.endDate).toBe("2026-10-31");
    expect(plan.timezone).toBe("Asia/Shanghai");
    expect(plan.periodKind).toBe("month");
  });

  it("每周：自动取当周周一到周日", () => {
    const { plan } = createBudgetPlan({
      totalFen: 20_000,
      periodKind: "week",
      anchorDate: "2026-10-21",
      timezone: "Asia/Shanghai",
      now: NOW,
      idFactory,
    });
    expect(plan.startDate).toBe("2026-10-19");
    expect(plan.endDate).toBe("2026-10-25");
    expect(plan.name).toBe("每周餐饮预算");
  });

  it("自定义周期可以跨年", () => {
    const { plan } = createBudgetPlan({
      totalFen: 60_000,
      periodKind: "custom",
      startDate: "2026-12-20",
      endDate: "2027-01-10",
      timezone: "Asia/Shanghai",
      now: NOW,
      idFactory,
    });
    expect(plan.startDate).toBe("2026-12-20");
    expect(plan.endDate).toBe("2027-01-10");
  });

  it("非法输入直接报错", () => {
    expect(() =>
      createBudgetPlan({
        totalFen: 10_000,
        periodKind: "custom",
        startDate: "2026-10-31",
        endDate: "2026-10-01",
        timezone: "Asia/Shanghai",
      }),
    ).toThrow(/结束日期/);

    expect(() =>
      createBudgetPlan({
        totalFen: 10_000,
        periodKind: "month",
        anchorDate: "2026-10-01",
        timezone: "Mars/Base",
      }),
    ).toThrow(/时区/);

    expect(() =>
      createBudgetPlan({
        totalFen: -1,
        periodKind: "month",
        anchorDate: "2026-10-01",
        timezone: "Asia/Shanghai",
      }),
    ).toThrow(/预算总额/);
  });

  it("计划自身的问题用告警表达，而不是拒绝保存", () => {
    const plan = plan900({ totalFen: 5_000, reserveFen: 8_000 });
    const warnings = validateBudgetPlan(plan);
    expect(warnings.map((w) => w.code)).toContain("RESERVE_EXCEEDS_TOTAL");

    const zero = plan900({ totalFen: 0, reserveFen: 0 });
    expect(validateBudgetPlan(zero).map((w) => w.code)).toContain("BUDGET_ZERO");
  });

  it("修改计划保留 createdAt", () => {
    const plan = plan900();
    const updated = updateBudgetPlan(plan, { totalFen: 120_000 }, new Date("2026-10-25T00:00:00Z"));
    expect(updated.totalFen).toBe(120_000);
    expect(updated.createdAt).toBe(plan.createdAt);
    expect(updated.updatedAt).toBe("2026-10-25T00:00:00.000Z");
  });
});

describe("900 元月度预算概览（2026-10-01 ~ 10-31，今天 10-21）", () => {
  const summary = computeBudgetSummary(plan900(), RECORDS, { today: "2026-10-21" });

  it("已花 / 剩余 / 可支配", () => {
    expect(summary.spentFen).toBe(7_460);
    expect(summary.remainingFen).toBe(82_540);
    expect(summary.disposableFen).toBe(82_540);
    expect(summary.overBudgetFen).toBe(0);
  });

  it("天数与日均", () => {
    expect(summary.daysTotal).toBe(31);
    expect(summary.daysElapsed).toBe(21);
    expect(summary.daysRemaining).toBe(11);
    expect(summary.dailyAllowanceFen).toBe(7_504); // 82540 / 11 = 7503.6
  });

  it("进度与健康状态", () => {
    expect(summary.consumedRatio).toBeCloseTo(0.0829, 3);
    expect(summary.progressRatio).toBeCloseTo(0.6774, 3);
    expect(summary.health).toBe("ok");
  });

  it("计划消费不扣减已花预算", () => {
    const withPlanned = computeBudgetSummary(
      plan900(),
      [...RECORDS, expense({ amountFen: 3_000, at: "2026-10-20T04:00:00.000Z", status: "planned" })],
      { today: "2026-10-21" },
    );
    expect(withPlanned.spentFen).toBe(7_460);
    expect(withPlanned.plannedFen).toBe(3_000);
    expect(withPlanned.remainingFen).toBe(82_540);
    expect(withPlanned.committedFen).toBe(10_460);
    // 计划支出的影响单独算：花掉 3000 后日均下降
    expect(withPlanned.plannedImpact.remainingAfterFen).toBe(79_540);
    expect(withPlanned.plannedImpact.afterDailyFen).toBe(7_231); // 79540 / 11
  });

  it("没有记录时给出提示但不报错", () => {
    const empty = computeBudgetSummary(plan900(), [], { today: "2026-10-21" });
    expect(empty.spentFen).toBe(0);
    expect(empty.confirmedCount).toBe(0);
    expect(empty.warnings.map((w) => w.code)).toContain("NO_RECORDS");
    expect(empty.dailyAllowanceFen).toBe(8_182); // 90000 / 11
    expect(empty.health).toBe("ok");
  });

  it("周期外与其它计划的记录都不计入", () => {
    const extra = [
      expense({ amountFen: 9_999, at: "2026-11-02T04:00:00.000Z" }),
      expense({ amountFen: 9_999, at: "2026-10-15T04:00:00.000Z", planId: "plan-other" }),
    ];
    const result = computeBudgetSummary(plan900(), [...RECORDS, ...extra], { today: "2026-10-21" });
    expect(result.spentFen).toBe(7_460);
    expect(result.outOfPeriodCount).toBe(1);
    expect(result.warnings.map((w) => w.code)).toContain("OUT_OF_PERIOD_RECORDS");
  });
});

describe("异常场景", () => {
  it("超预算：剩余为负、健康状态为 over", () => {
    const summary = computeBudgetSummary(
      plan900({ totalFen: 5_000 }),
      [expense({ amountFen: 6_000, at: "2026-10-05T04:00:00.000Z" })],
      { today: "2026-10-21" },
    );
    expect(summary.spentFen).toBe(6_000);
    expect(summary.remainingFen).toBe(-1_000);
    expect(summary.overBudgetFen).toBe(1_000);
    expect(summary.dailyAllowanceFen).toBe(0);
    expect(summary.health).toBe("over");
    expect(summary.warnings.map((w) => w.code)).toContain("OVER_BUDGET");
  });

  it("预算为 0：不除零，进度记为 0", () => {
    const summary = computeBudgetSummary(plan900({ totalFen: 0 }), [], { today: "2026-10-21" });
    expect(summary.consumedRatio).toBe(0);
    expect(summary.remainingFen).toBe(0);
    expect(summary.dailyAllowanceFen).toBe(0);
    expect(summary.warnings.map((w) => w.code)).toContain("BUDGET_ZERO");
  });

  it("周期已结束：剩余天数为 0，日均 null", () => {
    const summary = computeBudgetSummary(plan900(), RECORDS, { today: "2026-11-02" });
    expect(summary.daysRemaining).toBe(0);
    expect(summary.dailyAllowanceFen).toBeNull();
    expect(summary.health).toBe("ended");
    expect(summary.warnings.map((w) => w.code)).toContain("PERIOD_ENDED");
  });

  it("周期还没开始：已过 0 天，剩余为整周期", () => {
    const summary = computeBudgetSummary(plan900(), [], { today: "2026-09-25" });
    expect(summary.daysElapsed).toBe(0);
    expect(summary.daysRemaining).toBe(31);
    expect(summary.warnings.map((w) => w.code)).toContain("PERIOD_NOT_STARTED");
  });

  it("预留大于总额：可支配为负，健康状态为 tight", () => {
    const summary = computeBudgetSummary(plan900({ totalFen: 10_000, reserveFen: 12_000 }), [], {
      today: "2026-10-21",
    });
    expect(summary.disposableFen).toBe(-2_000);
    expect(summary.dailyAllowanceFen).toBe(0);
    expect(summary.health).toBe("tight");
  });

  it("花钱进度明显快于时间进度：健康状态为 ahead", () => {
    const summary = computeBudgetSummary(
      plan900(),
      [expense({ amountFen: 60_000, at: "2026-10-05T04:00:00.000Z" })],
      { today: "2026-10-10" },
    );
    expect(summary.health).toBe("ahead");
  });

  it("跨月跨年周期：12-20 ~ 01-10，今天 12-31 剩 11 天", () => {
    const { plan } = createBudgetPlan({
      totalFen: 60_000,
      periodKind: "custom",
      startDate: "2026-12-20",
      endDate: "2027-01-10",
      timezone: "Asia/Shanghai",
      now: NOW,
      idFactory: () => "plan-ny",
    });
    const summary = computeBudgetSummary(
      plan,
      [expense({ planId: "plan-ny", amountFen: 10_000, at: "2026-12-31T04:00:00.000Z" })],
      { today: "2026-12-31" },
    );
    expect(summary.daysTotal).toBe(22);
    expect(summary.daysRemaining).toBe(11);
    expect(summary.spentFen).toBe(10_000);
    expect(summary.remainingFen).toBe(50_000);
  });
});

describe("建议单餐预算", () => {
  it("900 元 / 剩 11 天 / 每天 3 餐 → 每餐 ¥25", () => {
    const summary = computeBudgetSummary(plan900(), RECORDS, { today: "2026-10-21" });
    const suggestion = suggestMealBudget(summary, { dailyMealCount: 3 });
    expect(suggestion.suggestedFen).toBe(2_500);
    expect(suggestion.basis?.perMealFen).toBe(2_500);
    expect(suggestion.explanation).toContain("25.00");
  });

  it("常用单餐预算作为上限", () => {
    const summary = computeBudgetSummary(plan900(), RECORDS, { today: "2026-10-21" });
    const suggestion = suggestMealBudget(summary, { dailyMealCount: 3, defaultMealBudgetFen: 2_000 });
    expect(suggestion.suggestedFen).toBe(2_000);
    expect(suggestion.basis?.cappedByDefault).toBe(true);
  });

  it("已超支时不给建议，并说明原因", () => {
    const summary = computeBudgetSummary(
      plan900({ totalFen: 1_000 }),
      [expense({ amountFen: 2_000, at: "2026-10-05T04:00:00.000Z" })],
      { today: "2026-10-21" },
    );
    const suggestion = suggestMealBudget(summary, { dailyMealCount: 2 });
    expect(suggestion.suggestedFen).toBeNull();
    expect(suggestion.blockedReason).toBeTruthy();
  });

  it("周期结束不给建议", () => {
    const summary = computeBudgetSummary(plan900(), RECORDS, { today: "2026-11-05" });
    expect(suggestMealBudget(summary).suggestedFen).toBeNull();
  });

  it("均摊后低于 ¥5 时不给假建议", () => {
    const summary = computeBudgetSummary(
      plan900({ totalFen: 1_000 }),
      [expense({ amountFen: 700, at: "2026-10-05T04:00:00.000Z" })],
      { today: "2026-10-30" },
    );
    const suggestion = suggestMealBudget(summary, { dailyMealCount: 3 });
    expect(suggestion.suggestedFen).toBeNull();
    expect(suggestion.basis?.cappedByApiFloor).toBe(true);
  });

  it("建议值必须落在推荐 API 允许的区间内（防止自己拒掉自己）", () => {
    expect(SUGGESTED_BUDGET_MIN_FEN).toBe(BUDGET_MIN_FEN);
    expect(SUGGESTED_BUDGET_MAX_FEN).toBe(BUDGET_MAX_FEN);
  });
});

describe("推荐价格 → 预算影响", () => {
  it("用已核验价格计算，剩余预算相应减少", () => {
    const summary = computeBudgetSummary(plan900(), RECORDS, { today: "2026-10-21" });
    const impact = impactOfVerifiedPrice(summary, 2_500);
    expect(impact.remainingBeforeFen).toBe(82_540);
    expect(impact.remainingAfterFen).toBe(80_040);
    expect(impact.afterDailyFen).toBe(8_004); // 80040 / 10
  });

  it("今天还有两餐时按 11 天摊", () => {
    const summary = computeBudgetSummary(plan900(), RECORDS, { today: "2026-10-21" });
    const impact = impactOfVerifiedPrice(summary, 2_500, { mealsLeftToday: 2 });
    expect(impact.afterDailyFen).toBe(7_276); // 80040 / 11
  });

  it("负数或非整数价格直接拒绝", () => {
    const summary = computeBudgetSummary(plan900(), RECORDS, { today: "2026-10-21" });
    expect(() => impactOfVerifiedPrice(summary, -100)).toThrow();
    expect(() => impactOfVerifiedPrice(summary, 12.5)).toThrow();
  });
});
