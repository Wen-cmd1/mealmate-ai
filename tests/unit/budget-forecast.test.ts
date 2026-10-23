import { describe, expect, it } from "vitest";

import { computeMealImpact } from "@/lib/budget/forecast";

/**
 * 任务 003：Meal Impact 预测准确性
 *
 * 任务书给的样例作为**必须逐位吻合**的基准：
 *   剩余 360 元、剩 12 天（含今天）、本次 39 元、无预留
 *   → 消费后余额 321 元、后续日均约 29.18 元、消费前日均 30 元
 */

describe("任务书样例（必须逐位吻合）", () => {
  const impact = computeMealImpact({
    remainingFen: 36_000,
    daysRemaining: 12,
    plannedFen: 3_900,
  });

  it("消费后余额 = 剩余 - 本次", () => {
    expect(impact.remainingBeforeFen).toBe(36_000);
    expect(impact.remainingAfterFen).toBe(32_100);
    expect(impact.plannedFen).toBe(3_900);
  });

  it("消费前日均 30.00 元（360 / 12）", () => {
    expect(impact.beforeDailyFen).toBe(3_000);
  });

  it("消费后日均 29.18 元（321 / 11 个完整预算日，四舍五入到分）", () => {
    expect(impact.coversToday).toBe(true);
    expect(impact.daysAfterToday).toBe(11);
    expect(impact.afterDailyFen).toBe(2_918);
    expect(impact.dailyDeltaFen).toBe(-82);
  });

  it("给出预测前提与不确定性说明", () => {
    expect(impact.assumptions.length).toBeGreaterThanOrEqual(2);
    expect(impact.assumptions.join(" ")).toContain("11 个完整预算日");
    expect(impact.caveats.length).toBeGreaterThan(0);
    expect(impact.warnings).toEqual([]);
  });
});

describe("不能假设今天只有一餐", () => {
  it("今天还剩 2 餐：今天不被覆盖，剩余预算仍按 12 天摊", () => {
    const impact = computeMealImpact({
      remainingFen: 36_000,
      daysRemaining: 12,
      plannedFen: 3_900,
      mealsLeftToday: 2,
    });
    expect(impact.coversToday).toBe(false);
    expect(impact.afterDailyFen).toBe(2_675); // 32100 / 12
    expect(impact.beforeDailyFen).toBe(3_000);
    expect(impact.assumptions.join(" ")).toContain("今天还有 2 餐");
  });

  it("今天还有其它餐费时，一并从余额里扣", () => {
    const impact = computeMealImpact({
      remainingFen: 36_000,
      daysRemaining: 12,
      plannedFen: 3_900,
      otherMealsTodayFen: 1_500,
    });
    expect(impact.remainingAfterFen).toBe(30_600);
    expect(impact.coversToday).toBe(false);
    expect(impact.afterDailyFen).toBe(2_550); // 30600 / 12
    expect(impact.warnings.map((w) => w.code)).toContain("OTHER_MEALS_TODAY");
  });

  it("明确传入 1 餐时才会按 daysRemaining-1 摊", () => {
    const impact = computeMealImpact({
      remainingFen: 36_000,
      daysRemaining: 12,
      plannedFen: 3_900,
      mealsLeftToday: 1,
      otherMealsTodayFen: 0,
    });
    expect(impact.coversToday).toBe(true);
  });
});

describe("边界场景", () => {
  it("剩余天数为 0：不除零，日均为 null", () => {
    const impact = computeMealImpact({ remainingFen: 5_000, daysRemaining: 0, plannedFen: 2_000 });
    expect(impact.beforeDailyFen).toBeNull();
    expect(impact.afterDailyFen).toBeNull();
    expect(impact.dailyDeltaFen).toBeNull();
    expect(impact.remainingAfterFen).toBe(3_000);
    expect(impact.warnings.map((w) => w.code)).toContain("NO_DAYS_LEFT");
    expect(Number.isNaN(impact.remainingAfterFen)).toBe(false);
  });

  it("只剩 1 天且今天被覆盖：没有完整预算日 → afterDaily 为 null 但余额仍结算", () => {
    const impact = computeMealImpact({ remainingFen: 3_000, daysRemaining: 1, plannedFen: 2_500 });
    expect(impact.daysAfterToday).toBe(0);
    expect(impact.afterDailyFen).toBeNull();
    expect(impact.remainingAfterFen).toBe(500);
  });

  it("超支：余额为负，并单独给出透支金额", () => {
    const impact = computeMealImpact({ remainingFen: 2_000, daysRemaining: 5, plannedFen: 3_500 });
    expect(impact.remainingAfterFen).toBe(-1_500);
    expect(impact.overBudgetFen).toBe(1_500);
    expect(impact.warnings.map((w) => w.code)).toContain("OVER_BUDGET_AFTER_SPEND");
    // 负值不会被悄悄夹成 0
    expect(impact.afterDailyFen).toBe(-375);
  });

  it("剩余预算为 0：占比按 0 处理，不会出现 NaN", () => {
    const impact = computeMealImpact({ remainingFen: 0, daysRemaining: 10, plannedFen: 1_200 });
    expect(impact.shareOfRemaining).toBe(0);
    expect(impact.beforeDailyFen).toBe(0);
    expect(impact.remainingAfterFen).toBe(-1_200);
  });

  it("预留金额：日均只按可支配部分算，动到预留要提示", () => {
    const impact = computeMealImpact({
      remainingFen: 36_000,
      daysRemaining: 12,
      plannedFen: 30_000,
      reserveFen: 10_000,
    });
    // 可支配 26000 → 30000 花下去后 -4000，动用预留 4000
    expect(impact.reserveTouchedFen).toBe(4_000);
    expect(impact.assumptions.join(" ")).toContain("预留");
    expect(impact.warnings.map((w) => w.code)).toContain("RESERVE_TOUCHED");
  });

  it("本次消费为 0：余额不变，日均因「今天已被覆盖」按剩余天数重算", () => {
    const impact = computeMealImpact({ remainingFen: 36_000, daysRemaining: 12, plannedFen: 0 });
    expect(impact.remainingAfterFen).toBe(36_000);
    // 36000 摊到 11 个完整预算日 = 3272.7 → 3273
    expect(impact.afterDailyFen).toBe(3_273);
    expect(impact.dailyDeltaFen).toBe(273);
  });

  it("显式指定不覆盖今天时，0 消费不会改变日均", () => {
    const impact = computeMealImpact({
      remainingFen: 36_000,
      daysRemaining: 12,
      plannedFen: 0,
      assumeCoversToday: false,
    });
    expect(impact.coversToday).toBe(false);
    expect(impact.afterDailyFen).toBe(impact.beforeDailyFen);
    expect(impact.dailyDeltaFen).toBe(0);
  });

  it("非法入参直接报错，不做静默兜底", () => {
    expect(() => computeMealImpact({ remainingFen: 100, daysRemaining: -1, plannedFen: 10 })).toThrow();
    expect(() => computeMealImpact({ remainingFen: 100.5, daysRemaining: 3, plannedFen: 10 })).toThrow();
    expect(() => computeMealImpact({ remainingFen: 100, daysRemaining: 3, plannedFen: -1 })).toThrow();
  });
});

describe("文案不做价值判断", () => {
  it("不含羞辱/恐吓性措辞", () => {
    const impact = computeMealImpact({ remainingFen: 2_000, daysRemaining: 5, plannedFen: 3_500 });
    const text = [...impact.assumptions, ...impact.caveats, ...impact.warnings.map((w) => w.message)].join(
      " ",
    );
    for (const word of ["太贵", "败家", "不应该", "克制", "忍住", "你完了", "警告你"]) {
      expect(text).not.toContain(word);
    }
  });
});
