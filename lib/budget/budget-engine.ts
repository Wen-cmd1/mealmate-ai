/**
 * 长期预算引擎 —— 编排层。
 *
 * 职责边界：
 * - `period.ts` 负责「哪天 / 剩几天」；
 * - `ledger.ts` 负责「哪条记录算数 / 怎么改」；
 * - `forecast.ts` 负责「这一笔花下去会怎样」；
 * - 本文件只做**组合**：预算计划 → 概览（含计划支出的影响）→ 建议单餐预算。
 *
 * 全部是纯函数，输入输出都是普通对象：
 * 浏览器可以用同一份代码算（数据在 localStorage），单测也能直接跑，
 * 不存在「服务端一套算法、前端再写一遍」的漂移风险。
 */

import { assertFen } from "./money";
import { computeMealImpact } from "./forecast";
import type { IdFactory } from "./ledger";
import { defaultIdFactory } from "./ledger";
import {
  compareDateKeys,
  dateKeyOfInstant,
  dayCount,
  derivePeriodDates,
  elapsedDaysInPeriod,
  formatPeriodLabel,
  isValidDateKey,
  isValidTimeZone,
  remainingDaysInPeriod,
  todayKey,
} from "./period";
import type {
  BudgetHealth,
  BudgetPlan,
  BudgetSummary,
  BudgetWarning,
  DateKey,
  ExpenseRecord,
  MealBudgetSuggestion,
  MealImpact,
  PeriodKind,
} from "./types";

/* ------------------------------------------------------------------ *
 * 与推荐 API 对齐的边界
 * ------------------------------------------------------------------ */

/**
 * 建议单餐预算的可用区间。
 * 必须与 `lib/recommendation/schema.ts` 的 `BUDGET_MIN_FEN / BUDGET_MAX_FEN` 保持一致，
 * 否则「建议值」会被自己的 API 拒掉（单测里有一条断言守着这个一致性）。
 */
export const SUGGESTED_BUDGET_MIN_FEN = 500;
export const SUGGESTED_BUDGET_MAX_FEN = 20_000;

const DEFAULT_DAILY_MEAL_COUNT = 3;
const MAX_DAILY_MEAL_COUNT = 6;

/* ------------------------------------------------------------------ *
 * 预算计划
 * ------------------------------------------------------------------ */

export interface CreateBudgetPlanInput {
  name?: string;
  totalFen: number;
  reserveFen?: number;
  periodKind: PeriodKind;
  /** `week` / `month` 用它推算起止日期；`custom` 可省略（用 startDate） */
  anchorDate?: DateKey;
  startDate?: DateKey;
  endDate?: DateKey;
  timezone: string;
  dailyMealCount?: number;
  defaultMealBudgetFen?: number;
  now?: Date;
  idFactory?: IdFactory;
}

export interface CreateBudgetPlanResult {
  plan: BudgetPlan;
  warnings: BudgetWarning[];
}

export function createBudgetPlan(input: CreateBudgetPlanInput): CreateBudgetPlanResult {
  if (!Number.isInteger(input.totalFen) || input.totalFen < 0) {
    throw new RangeError("预算总额必须是非负整数分");
  }
  if (!isValidTimeZone(input.timezone)) {
    throw new RangeError(`时区不合法："${input.timezone}"`);
  }
  if (!Number.isInteger(input.reserveFen ?? 0) || (input.reserveFen ?? 0) < 0) {
    throw new RangeError("预留金额必须是非负整数分");
  }

  const anchor = input.anchorDate ?? input.startDate;
  if (!anchor || !isValidDateKey(anchor)) {
    throw new RangeError("缺少合法的起始日期");
  }

  let startDate: DateKey;
  let endDate: DateKey;

  if (input.periodKind === "custom") {
    startDate = input.startDate ?? anchor;
    endDate = input.endDate ?? startDate;
  } else {
    const derived = derivePeriodDates(input.periodKind, anchor);
    startDate = derived.startDate;
    endDate = derived.endDate;
  }

  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
    throw new RangeError("起止日期不合法（应为 YYYY-MM-DD）");
  }
  if (compareDateKeys(startDate, endDate) > 0) {
    throw new RangeError("结束日期不能早于开始日期");
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const plan: BudgetPlan = {
    id: (input.idFactory ?? defaultIdFactory)(),
    name: (input.name ?? defaultPlanName(input.periodKind)).slice(0, 40),
    totalFen: input.totalFen,
    reserveFen: input.reserveFen ?? 0,
    startDate,
    endDate,
    timezone: input.timezone,
    periodKind: input.periodKind,
    dailyMealCount: clampMealCount(input.dailyMealCount),
    ...(input.defaultMealBudgetFen !== undefined && input.defaultMealBudgetFen > 0
      ? { defaultMealBudgetFen: Math.round(input.defaultMealBudgetFen) }
      : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return { plan, warnings: validateBudgetPlan(plan) };
}

function defaultPlanName(periodKind: PeriodKind): string {
  if (periodKind === "week") return "每周餐饮预算";
  if (periodKind === "month") return "每月餐饮预算";
  return "自定义餐饮预算";
}

function clampMealCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_DAILY_MEAL_COUNT;
  return Math.min(MAX_DAILY_MEAL_COUNT, Math.max(1, Math.trunc(value)));
}

export interface UpdateBudgetPlanPatch {
  name?: string;
  totalFen?: number;
  reserveFen?: number;
  startDate?: DateKey;
  endDate?: DateKey;
  timezone?: string;
  dailyMealCount?: number;
  defaultMealBudgetFen?: number;
}

export function updateBudgetPlan(
  plan: BudgetPlan,
  patch: UpdateBudgetPlanPatch,
  now: Date = new Date(),
): BudgetPlan {
  const next: BudgetPlan = { ...plan };

  if (patch.totalFen !== undefined) {
    if (!Number.isInteger(patch.totalFen) || patch.totalFen < 0) {
      throw new RangeError("预算总额必须是非负整数分");
    }
    next.totalFen = patch.totalFen;
  }
  if (patch.reserveFen !== undefined) {
    if (!Number.isInteger(patch.reserveFen) || patch.reserveFen < 0) {
      throw new RangeError("预留金额必须是非负整数分");
    }
    next.reserveFen = patch.reserveFen;
  }
  if (patch.startDate !== undefined) {
    if (!isValidDateKey(patch.startDate)) throw new RangeError("开始日期不合法");
    next.startDate = patch.startDate;
  }
  if (patch.endDate !== undefined) {
    if (!isValidDateKey(patch.endDate)) throw new RangeError("结束日期不合法");
    next.endDate = patch.endDate;
  }
  if (compareDateKeys(next.startDate, next.endDate) > 0) {
    throw new RangeError("结束日期不能早于开始日期");
  }
  if (patch.timezone !== undefined) {
    if (!isValidTimeZone(patch.timezone)) throw new RangeError("时区不合法");
    next.timezone = patch.timezone;
  }
  if (patch.dailyMealCount !== undefined) next.dailyMealCount = clampMealCount(patch.dailyMealCount);
  if (patch.defaultMealBudgetFen !== undefined) {
    if (patch.defaultMealBudgetFen > 0) {
      next.defaultMealBudgetFen = Math.round(patch.defaultMealBudgetFen);
    } else {
      delete next.defaultMealBudgetFen;
    }
  }
  if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 40) || next.name;

  next.updatedAt = now.toISOString();
  return next;
}

/** 计划自身的配置问题（不是「花超了」，而是「这份计划本身有问题」） */
export function validateBudgetPlan(plan: BudgetPlan): BudgetWarning[] {
  const warnings: BudgetWarning[] = [];

  if (!isValidTimeZone(plan.timezone)) {
    warnings.push({ code: "PLAN_INVALID", message: `时区不合法：${plan.timezone}` });
  }
  if (!isValidDateKey(plan.startDate) || !isValidDateKey(plan.endDate)) {
    warnings.push({ code: "PLAN_INVALID", message: "起止日期不合法" });
  } else if (compareDateKeys(plan.startDate, plan.endDate) > 0) {
    warnings.push({ code: "PLAN_INVALID", message: "结束日期早于开始日期" });
  }
  if (plan.totalFen === 0) {
    warnings.push({ code: "BUDGET_ZERO", message: "预算总额为 0，所有消费都会被算作超支" });
  }
  if (plan.reserveFen > plan.totalFen) {
    warnings.push({
      code: "RESERVE_EXCEEDS_TOTAL",
      message: `预留金额（${(plan.reserveFen / 100).toFixed(2)} 元）大于预算总额（${(
        plan.totalFen / 100
      ).toFixed(2)} 元），可支配金额按 0 计算`,
    });
  }

  return warnings;
}

/* ------------------------------------------------------------------ *
 * 概览
 * ------------------------------------------------------------------ */

export interface SummaryOptions {
  /** 覆盖「今天」，便于单测固定日期 */
  today?: DateKey;
  now?: Date;
}

export function computeBudgetSummary(
  plan: BudgetPlan,
  records: readonly ExpenseRecord[],
  options: SummaryOptions = {},
): BudgetSummary {
  const timezone = isValidTimeZone(plan.timezone) ? plan.timezone : "UTC";
  const today = options.today ?? todayKey(timezone, options.now ?? new Date());

  const startDate = plan.startDate;
  const endDate = plan.endDate;
  const daysTotal = dayCount(startDate, endDate);
  const daysRemaining = remainingDaysInPeriod(startDate, endDate, today);
  const daysElapsed = elapsedDaysInPeriod(startDate, endDate, today);

  const warnings = validateBudgetPlan(plan);

  // 归属本计划的记录，再按周期过滤
  const ownRecords: ExpenseRecord[] = [];
  let outOfPeriodCount = 0;
  for (const record of records) {
    if (record.planId !== plan.id) continue;
    const day = dateKeyOfInstant(record.occurredAt, timezone);
    if (!day) {
      outOfPeriodCount += 1;
      continue;
    }
    if (day >= startDate && day <= endDate) ownRecords.push(record);
    else outOfPeriodCount += 1;
  }

  let spentFen = 0;
  let plannedFen = 0;
  let confirmedCount = 0;
  let plannedCount = 0;

  for (const record of ownRecords) {
    assertFen(record.amountFen, `记录 ${record.id} 的金额`);
    if (record.status === "confirmed") {
      spentFen += record.amountFen;
      confirmedCount += 1;
    } else {
      plannedFen += record.amountFen;
      plannedCount += 1;
    }
  }

  const totalFen = plan.totalFen;
  const reserveFen = plan.reserveFen;
  const remainingFen = totalFen - spentFen;
  const disposableFen = remainingFen - reserveFen; // 可能为负（已动用预留）
  const overBudgetFen = Math.max(0, -remainingFen);

  const dailyAllowanceFen =
    daysRemaining > 0 ? Math.max(0, Math.round(disposableFen / daysRemaining)) : null;

  const consumedRatio = totalFen > 0 ? Math.min(2, spentFen / totalFen) : 0;
  const progressRatio = daysTotal > 0 ? Math.min(1, daysElapsed / daysTotal) : 0;

  if (outOfPeriodCount > 0) {
    warnings.push({
      code: "OUT_OF_PERIOD_RECORDS",
      message: `有 ${outOfPeriodCount} 条记录不在本周期（或被判定为时间不可解析），未计入本次统计`,
    });
  }
  if (confirmedCount === 0 && plannedCount === 0) {
    warnings.push({ code: "NO_RECORDS", message: "本周期还没有任何消费记录" });
  }
  if (overBudgetFen > 0) {
    warnings.push({
      code: "OVER_BUDGET",
      message: `本周期已超预算 ${(overBudgetFen / 100).toFixed(2)} 元`,
    });
  }
  if (disposableFen < 0 && overBudgetFen === 0) {
    warnings.push({
      code: "RESERVE_TOUCHED",
      message: "可支配金额已为负（开始动用预留），剩余预算还没到 0",
    });
  }
  if (daysRemaining === 0) {
    warnings.push({ code: "PERIOD_ENDED", message: "本周期已结束，剩余天数为 0" });
  } else if (compareDateKeys(today, startDate) < 0) {
    warnings.push({ code: "PERIOD_NOT_STARTED", message: "本周期还没开始" });
  }

  // 计划支出对未来预算的影响（不扣减，只做前瞻）
  // 计划消费不假设「发生在今天并覆盖今天」，否则 planned=0 时日均也会虚高
  const plannedImpact = computeMealImpact({
    remainingFen,
    daysRemaining,
    plannedFen,
    reserveFen,
    assumeCoversToday: false,
  });

  return {
    planId: plan.id,
    planName: plan.name,
    startDate,
    endDate,
    timezone,
    today,

    totalFen,
    reserveFen,

    spentFen,
    plannedFen,
    committedFen: spentFen + plannedFen,

    remainingFen,
    disposableFen,
    overBudgetFen,

    daysRemaining,
    daysTotal,
    daysElapsed,
    dailyAllowanceFen,

    consumedRatio,
    progressRatio,

    health: resolveHealth({
      totalFen,
      spentFen,
      remainingFen,
      disposableFen,
      daysRemaining,
      daysTotal,
      consumedRatio,
      progressRatio,
    }),

    plannedImpact,
    outOfPeriodCount,
    confirmedCount,
    plannedCount,
    warnings,
  };
}

function resolveHealth(input: {
  totalFen: number;
  spentFen: number;
  remainingFen: number;
  disposableFen: number;
  daysRemaining: number;
  daysTotal: number;
  consumedRatio: number;
  progressRatio: number;
}): BudgetHealth {
  if (input.daysTotal === 0) return "empty";
  if (input.daysRemaining === 0) return "ended";
  if (input.remainingFen < 0) return "over";
  if (input.disposableFen < 0) return "tight";
  if (input.spentFen === 0) return "ok";
  // 花钱进度比时间进度快 15 个百分点以上 → 提示"花得偏快"（只陈述，不评价）
  if (input.consumedRatio > input.progressRatio + 0.15) return "ahead";
  return "ok";
}

/** 供 UI 直接展示的周期文案 */
export function describePeriod(plan: BudgetPlan): string {
  return formatPeriodLabel(plan.startDate, plan.endDate);
}

/* ------------------------------------------------------------------ *
 * 建议单餐预算
 * ------------------------------------------------------------------ */

export interface SuggestMealBudgetOptions {
  /** 覆盖计划的每日用餐次数 */
  dailyMealCount?: number;
  /** 覆盖计划的个人常用单餐预算 */
  defaultMealBudgetFen?: number;
}

/**
 * 根据剩余预算给出「这一餐可以花多少」。
 *
 * 算法（全部整数分，向下取整到整元）：
 *   日均可支配 = max(disposable, 0) / daysRemaining
 *   每餐 = 日均可支配 / 每日用餐次数
 *   若设置了个人的常用单餐预算 → 取两者较小值（作为上限）
 *   最后夹到 API 允许的 500~20000 分
 *
 * 无法给出建议时返回 null 并说明原因 —— **不返回一个"最低能查"的假建议**。
 */
export function suggestMealBudget(
  summary: BudgetSummary,
  options: SuggestMealBudgetOptions = {},
): MealBudgetSuggestion {
  const dailyMealCount = clampMealCount(options.dailyMealCount ?? 3);

  if (summary.daysRemaining <= 0) {
    return {
      suggestedFen: null,
      basis: null,
      explanation: "本周期已结束，没有可用于日均分摊的剩余天数",
      blockedReason: "预算周期已结束，请先开启新的预算周期",
    };
  }

  if (summary.disposableFen <= 0) {
    return {
      suggestedFen: null,
      basis: {
        dailyAllowanceFen: 0,
        dailyMealCount,
        perMealFen: 0,
        cappedByDefault: false,
        cappedByApiFloor: false,
        cappedByApiCeiling: false,
      },
      explanation: "当前可自由支配金额已经不大于 0，没有可以分配的单餐预算",
      blockedReason:
        summary.overBudgetFen > 0
          ? "本周期已超预算，仍可手动指定单餐预算去查询推荐"
          : "可支配金额已被预留占用，仍可手动指定单餐预算去查询推荐",
    };
  }

  const rawPerMeal = Math.floor(summary.disposableFen / summary.daysRemaining / dailyMealCount);
  let perMeal = rawPerMeal;
  let cappedByDefault = false;

  const defaultBudget = options.defaultMealBudgetFen ?? 0;
  if (defaultBudget > 0 && defaultBudget < perMeal) {
    perMeal = defaultBudget;
    cappedByDefault = true;
  }

  // 对齐到整元，便于用户理解与手动改数
  perMeal = Math.floor(perMeal / 100) * 100;

  if (perMeal < SUGGESTED_BUDGET_MIN_FEN) {
    return {
      suggestedFen: null,
      basis: {
        dailyAllowanceFen: Math.max(0, Math.round(summary.disposableFen / summary.daysRemaining)),
        dailyMealCount,
        perMealFen: perMeal,
        cappedByDefault,
        cappedByApiFloor: true,
        cappedByApiCeiling: false,
      },
      explanation: `按剩余预算均摊，这一餐只有约 ${(rawPerMeal / 100).toFixed(2)} 元，低于可查询的最低预算 ¥5`,
      blockedReason: "均摊后低于 ¥5，无法据此查询真实菜单；可以手动填一个更高的单餐预算",
    };
  }

  let cappedByApiCeiling = false;
  if (perMeal > SUGGESTED_BUDGET_MAX_FEN) {
    perMeal = SUGGESTED_BUDGET_MAX_FEN;
    cappedByApiCeiling = true;
  }

  const dailyAllowanceFen = Math.max(0, Math.round(summary.disposableFen / summary.daysRemaining));
  const explanation =
    `可自由支配 ${(summary.disposableFen / 100).toFixed(2)} 元 ÷ ${summary.daysRemaining} 天` +
    ` ÷ 每天 ${dailyMealCount} 餐 ≈ 每餐 ${(perMeal / 100).toFixed(2)} 元` +
    (cappedByDefault ? "（已按你的常用单餐预算封顶）" : "") +
    (cappedByApiCeiling ? "（已按单次查询上限 ¥200 封顶）" : "");

  return {
    suggestedFen: perMeal,
    basis: {
      dailyAllowanceFen,
      dailyMealCount,
      perMealFen: perMeal,
      cappedByDefault,
      cappedByApiFloor: false,
      cappedByApiCeiling,
    },
    explanation,
  };
}

/* ------------------------------------------------------------------ *
 * 推荐 × 预算 联动
 * ------------------------------------------------------------------ */

export interface RecommendationImpactOptions {
  otherMealsTodayFen?: number;
  mealsLeftToday?: number;
}

/**
 * 把一条推荐的**已核验价格**换算成 Meal Impact。
 *
 * 只接受 `verifiedPriceFen`（官方算价）作为入参；
 * 若推荐未核验（`priceVerified=false`），调用方必须自己拦住，不要用菜单标价冒充。
 */
export function impactOfVerifiedPrice(
  summary: BudgetSummary,
  verifiedPriceFen: number,
  options: RecommendationImpactOptions = {},
): MealImpact {
  assertFen(verifiedPriceFen, "推荐核验价");
  return computeMealImpact({
    remainingFen: summary.remainingFen,
    daysRemaining: summary.daysRemaining,
    plannedFen: verifiedPriceFen,
    reserveFen: summary.reserveFen,
    otherMealsTodayFen: options.otherMealsTodayFen ?? 0,
    mealsLeftToday: options.mealsLeftToday ?? 1,
  });
}
