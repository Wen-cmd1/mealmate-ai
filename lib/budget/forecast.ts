/**
 * Meal Impact —— 单笔消费对**剩余预算**的影响预测（任务 003 核心创新模块）。
 *
 * 这个模块只做预算分析，不做任何价值判断：
 * 不会出现「太贵了」「你应该省一点」这类话术，
 * 只把「花了这笔钱之后，后面每天还剩多少」算清楚，并把**预测前提**一并交出去。
 *
 * 与「省不省钱」无关的三条边界：
 * 1. 除法永远先判分母，`daysRemaining = 0` 时返回 null 而不是 NaN/Infinity；
 * 2. 结果允许为负（超支），负值不会被悄悄夹成 0，而是单独用 `overBudgetFen` 暴露；
 * 3. 不假设「今天只有一餐」：`mealsLeftToday > 1` 或 `otherMealsTodayFen > 0` 时，
 *    今天剩余餐次仍然占用预算，日均不按 `daysRemaining - 1` 摊。
 */

import { assertFen } from "./money";
import type { BudgetWarning, MealImpact, MealImpactInput } from "./types";

/** 把浮点日均四舍五入到「分」。负数同样按绝对值四舍五入，避免 -0。 */
function roundFen(value: number): number {
  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function warn(code: BudgetWarning["code"], message: string): BudgetWarning {
  return { code, message };
}

export function computeMealImpact(input: MealImpactInput): MealImpact {
  const plannedFen = input.plannedFen;
  assertFen(plannedFen, "本次计划消费");

  const otherMealsTodayFen = input.otherMealsTodayFen ?? 0;
  assertFen(otherMealsTodayFen, "今天其它餐费");

  const reserveFen = input.reserveFen ?? 0;
  assertFen(reserveFen, "预留金额");

  if (!Number.isInteger(input.remainingFen)) {
    throw new RangeError(`剩余预算必须是整数分，收到：${input.remainingFen}`);
  }
  if (!Number.isInteger(input.daysRemaining) || input.daysRemaining < 0) {
    throw new RangeError(`剩余天数必须是非负整数，收到：${input.daysRemaining}`);
  }

  const daysRemaining = input.daysRemaining;
  const mealsLeftToday = clampInt(input.mealsLeftToday ?? 1, 1, 10);

  const remainingBeforeFen = input.remainingFen;
  const remainingAfterFen = remainingBeforeFen - plannedFen - otherMealsTodayFen;

  // 预留：本次消费是否吃到了预留额度
  const disposableBefore = remainingBeforeFen - reserveFen;
  const disposableAfter = remainingAfterFen - reserveFen;
  const reserveTouchedFen = clampInt(
    Math.min(reserveFen, Math.max(0, -disposableAfter)),
    0,
    reserveFen,
  );

  // 本次是今天最后一餐 → 今天被覆盖，后续按「完整预算日」摊
  // 显式传入 assumeCoversToday 时以调用方为准（计划支出不假设发生在今天）
  const coversToday =
    input.assumeCoversToday ?? (mealsLeftToday === 1 && otherMealsTodayFen === 0);
  const daysAfterToday = Math.max(0, daysRemaining - 1);
  const denominator = coversToday ? daysAfterToday : daysRemaining;

  const beforeDailyFen = daysRemaining > 0 ? roundFen(disposableBefore / daysRemaining) : null;
  const afterDailyFen = denominator > 0 ? roundFen(disposableAfter / denominator) : null;
  const dailyDeltaFen =
    beforeDailyFen !== null && afterDailyFen !== null ? afterDailyFen - beforeDailyFen : null;

  const shareOfRemaining =
    remainingBeforeFen > 0 ? Math.min(1, Math.max(0, plannedFen / remainingBeforeFen)) : 0;

  const warnings: BudgetWarning[] = [];
  if (daysRemaining === 0) {
    warnings.push(
      warn("NO_DAYS_LEFT", "预算周期已经没有剩余天数，无法计算「后续日均」——本笔只影响周期结束时的结余"),
    );
  }
  if (remainingAfterFen < 0) {
    warnings.push(
      warn("OVER_BUDGET_AFTER_SPEND", "这笔消费会让本周期预算变成负数（超支），请留意后续安排"),
    );
  }
  if (reserveTouchedFen > 0) {
    warnings.push(warn("RESERVE_TOUCHED", "这笔消费会动用你设置的预留餐费"));
  }
  if (otherMealsTodayFen > 0) {
    warnings.push(
      warn("OTHER_MEALS_TODAY", "已把今天其它餐费一并计入，今天不会被这笔消费「全部覆盖」"),
    );
  }

  const assumptions: string[] = [
    `剩余预算按 ${daysRemaining} 天（含今天）均摊，得到消费前日均`,
  ];
  if (coversToday) {
    assumptions.push(
      `本笔视为覆盖今天剩余餐次，后续只剩 ${daysAfterToday} 个完整预算日，消费后金额按这 ${daysAfterToday} 天均摊`,
    );
  } else if (input.assumeCoversToday === false) {
    assumptions.push(
      `不假设这一笔覆盖今天，消费后金额仍按剩 ${daysRemaining} 天（含今天）均摊`,
    );
  } else if (daysRemaining > 0) {
    assumptions.push(
      `今天还有 ${mealsLeftToday} 餐要吃，剩余预算仍按 ${daysRemaining} 天（含今天）均摊`,
    );
  }
  if (reserveFen > 0) {
    assumptions.push(`日均只统计可自由支配部分，已扣除预留 ${(reserveFen / 100).toFixed(2)} 元`);
  }
  assumptions.push("假设后续每天的花费与今天持平，且不再新增其它支出");

  const caveats: string[] = [
    "日均只是把剩余预算平摊，不代表你必须每天花这么多，也不代表花少了就「赚了」",
    "未考虑优惠券、门店临时调价与外卖配送费；实际到手价以门店结算为准",
    "若后续有聚餐、加餐等一次性大额支出，日均会再次下降",
  ];

  return {
    plannedFen,
    otherMealsTodayFen,
    remainingBeforeFen,
    remainingAfterFen,
    overBudgetFen: Math.max(0, -remainingAfterFen),
    reserveTouchedFen,
    beforeDailyFen,
    afterDailyFen,
    dailyDeltaFen,
    daysRemaining,
    daysAfterToday,
    mealsLeftToday,
    coversToday,
    shareOfRemaining,
    assumptions,
    caveats,
    warnings,
  };
}
