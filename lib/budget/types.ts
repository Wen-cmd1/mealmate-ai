/**
 * 长期餐饮预算 —— 类型契约（任务 003）。
 *
 * 金额约定（与任务 002 一致）：**所有金额字段都是整数「分」**，字段名以 `Fen` 结尾。
 * 但注意：预算类计算会产生**负值**（超支、透支），因此本模块内部不用
 * `lib/budget/money.ts` 的 `assertFen`（它拒绝负数）做中间结果校验，
 * 只对「输入」做非负校验，中间结果允许为负并显式暴露（`overBudgetFen` 等）。
 *
 * 时间约定：
 * - 日期一律用 `DateKey`（`YYYY-MM-DD`，**本地日历日**，不带时区偏移）；
 * - 时间戳一律用 `IsoDateTime`（带 Z 的 ISO 字符串）；
 * - 「哪一天」由 `dateKeyOfInstant(instant, timezone)` 决定，绝不用 `Date.getDate()`
 *   这类依赖运行环境的字段（服务端 UTC、客户端东八区会算出不同的日子）。
 */

/** 本地日历日，格式固定 `YYYY-MM-DD` */
export type DateKey = string;

/** ISO 8601 时间戳 */
export type IsoDateTime = string;

/* ------------------------------------------------------------------ *
 * 预算计划
 * ------------------------------------------------------------------ */

export const PERIOD_KINDS = ["week", "month", "custom"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export const PERIOD_KIND_LABELS: Record<PeriodKind, string> = {
  week: "每周",
  month: "每月",
  custom: "自定义日期",
};

export interface BudgetPlan {
  id: string;
  name: string;
  /** 本周期预算总额（分） */
  totalFen: number;
  /** 希望预留的餐费（分），从可支配金额中扣除，但不属于「已花」 */
  reserveFen: number;
  startDate: DateKey;
  endDate: DateKey;
  /** IANA 时区，如 `Asia/Shanghai` */
  timezone: string;
  /** 周期类型：决定新建计划时如何推算起止日期，不参与后续计算 */
  periodKind: PeriodKind;
  /** 每日用餐次数，仅用于「建议单餐预算」的估算 */
  dailyMealCount: number;
  /** 个人常用单餐预算（分），可选；作为建议值的上限 */
  defaultMealBudgetFen?: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ *
 * 消费记录
 * ------------------------------------------------------------------ */

/**
 * `planned`：计划消费 —— **不扣减**已花预算；
 * `confirmed`：用户确认已发生的消费 —— 默认只有它扣减预算。
 *
 * 推荐结果永远不会自动写入账本，也不会自动变成 `confirmed`。
 */
export const EXPENSE_STATUSES = ["planned", "confirmed"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  planned: "计划中",
  confirmed: "已消费",
};

export const EXPENSE_SOURCES = ["manual", "recommendation", "import"] as const;
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];

export const EXPENSE_SOURCE_LABELS: Record<ExpenseSource, string> = {
  manual: "手动记录",
  recommendation: "推荐写入",
  import: "导入",
};

export interface ExpenseRecord {
  id: string;
  /** 归属的预算计划 */
  planId: string;
  /** 金额（分），必须是非负整数 */
  amountFen: number;
  /** 发生时间（ISO 时间戳）；「哪一天」按 plan.timezone 判定 */
  occurredAt: IsoDateTime;
  description: string;
  source: ExpenseSource;
  status: ExpenseStatus;
  /** 关联的餐品 SKU（来自推荐时写入），可选 */
  relatedProductCode?: string;
  /** 关联的推荐方案类型，便于回溯，可选 */
  relatedRecommendationType?: string;
  /**
   * 幂等键：同一次「记为已消费」的重复提交带同一个值，
   * 账本按它去重，避免双击/网络重试写出两条记录。
   */
  requestId?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ *
 * 告警
 * ------------------------------------------------------------------ */

export const BUDGET_WARNING_CODES = [
  "PERIOD_ENDED",
  "PERIOD_NOT_STARTED",
  "BUDGET_ZERO",
  "OVER_BUDGET",
  "OVER_BUDGET_AFTER_SPEND",
  "RESERVE_EXCEEDS_TOTAL",
  "RESERVE_TOUCHED",
  "NO_RECORDS",
  "OUT_OF_PERIOD_RECORDS",
  "OTHER_MEALS_TODAY",
  "NO_DAYS_LEFT",
  "CORRUPT_STORAGE",
  "STORAGE_UNAVAILABLE",
  "PLAN_INVALID",
] as const;

export type BudgetWarningCode = (typeof BUDGET_WARNING_CODES)[number];

export interface BudgetWarning {
  code: BudgetWarningCode;
  message: string;
}

/* ------------------------------------------------------------------ *
 * 预算概览
 * ------------------------------------------------------------------ */

export type BudgetHealth = "ok" | "ahead" | "tight" | "over" | "ended" | "empty";

export const BUDGET_HEALTH_LABELS: Record<BudgetHealth, string> = {
  ok: "进度正常",
  ahead: "花得偏快",
  tight: "已动用预留",
  over: "已超预算",
  ended: "周期已结束",
  empty: "还没有记录",
};

export interface BudgetSummary {
  planId: string;
  planName: string;
  startDate: DateKey;
  endDate: DateKey;
  timezone: string;
  /** 今天（按 plan.timezone 判定的日历日） */
  today: DateKey;

  totalFen: number;
  reserveFen: number;

  /** 本周期已花（仅 confirmed） */
  spentFen: number;
  /** 本周期计划中（planned，不扣减） */
  plannedFen: number;
  /** 已花 + 计划（仅用于展示"如果都花掉会怎样"） */
  committedFen: number;

  /** 本周期剩余预算 = total - spent（含预留，可为负） */
  remainingFen: number;
  /** 可自由支配金额 = remaining - reserve（可为负） */
  disposableFen: number;
  /** 已透支金额 = max(0, -remaining) */
  overBudgetFen: number;

  /** 剩余预算天数（含今天；周期已结束为 0） */
  daysRemaining: number;
  /** 周期总天数（含首尾） */
  daysTotal: number;
  /** 已经过的天数（含今天，最多等于总天数） */
  daysElapsed: number;
  /** 后续日均可用金额（分）；无剩余天数时为 null；已透支配额为 0 */
  dailyAllowanceFen: number | null;

  /** 消费进度 = spent / total（total=0 时为 0） */
  consumedRatio: number;
  /** 时间进度 = elapsed / total（total=0 时为 0） */
  progressRatio: number;

  health: BudgetHealth;
  /** 计划支出（planned）对未来预算的影响 */
  plannedImpact: MealImpact;
  /** 不计入本周期的记录数（日期在周期外） */
  outOfPeriodCount: number;
  /** 已确认记录条数 / 计划记录条数 */
  confirmedCount: number;
  plannedCount: number;
  warnings: BudgetWarning[];
}

/* ------------------------------------------------------------------ *
 * Meal Impact
 * ------------------------------------------------------------------ */

export interface MealImpactInput {
  /**
   * 当前剩余预算（分，**含预留**，即 total - spent）。
   * 允许为负（已经超支）。
   */
  remainingFen: number;
  /** 剩余预算天数（含今天），0 表示周期已结束 */
  daysRemaining: number;
  /** 本次计划消费（分） */
  plannedFen: number;
  /** 预留金额（分），默认 0 */
  reserveFen?: number;
  /**
   * 今天其它还没计入的餐费（分），默认 0。
   * 用于「今天还有别的餐」的场景，不允许把今天的额度全算给这一次。
   */
  otherMealsTodayFen?: number;
  /**
   * 今天还剩几餐（含本次），默认 1。
   * 为 1 表示本次是今天最后一餐 → 可视为「已覆盖今天」，后续按 daysRemaining-1 摊。
   * 大于 1 表示今天还要再花钱 → 剩余预算仍要摊到今天。
   */
  mealsLeftToday?: number;
  /**
   * 显式指定「这笔消费是否覆盖今天剩余餐次」，优先级高于 `mealsLeftToday` 的推断。
   *
   * 用于「计划消费」这类**不该假设发生在今天**的场景：
   * 汇总里的 `plannedImpact` 传 `false`，表示计划支出仍按整段剩余天数摊，
   * 否则 `plannedFen=0` 时也会因为「覆盖今天」而虚高日均。
   */
  assumeCoversToday?: boolean;
}

export interface MealImpact {
  plannedFen: number;
  otherMealsTodayFen: number;
  /** 本次消费前的剩余预算（含预留） */
  remainingBeforeFen: number;
  /** 本次消费后的剩余预算（含预留，可为负） */
  remainingAfterFen: number;
  /** 消费后透支金额 = max(0, -remainingAfter) */
  overBudgetFen: number;
  /** 消费后吃掉了多少预留 */
  reserveTouchedFen: number;

  /** 消费前的可支配日均（分/天）；无剩余天数为 null */
  beforeDailyFen: number | null;
  /** 消费后的可支配日均（分/天）；无剩余天数为 null */
  afterDailyFen: number | null;
  /** 日均变化 = after - before；任一为 null 时也是 null */
  dailyDeltaFen: number | null;

  daysRemaining: number;
  /** 本次消费后剩余的「完整预算日」数（= daysRemaining - 1，不小于 0） */
  daysAfterToday: number;
  mealsLeftToday: number;
  /** 本次消费是否被视为覆盖了今天剩余餐次 */
  coversToday: boolean;
  /** 本次消费占「消费前剩余预算」的比例（0~1，剩余为 0 时记 0） */
  shareOfRemaining: number;

  /** 预测前提（必须一并展示给用户） */
  assumptions: string[];
  /** 不确定性说明 */
  caveats: string[];
  warnings: BudgetWarning[];
}

/* ------------------------------------------------------------------ *
 * 推荐联动
 * ------------------------------------------------------------------ */

export interface MealBudgetSuggestion {
  /** 建议单餐预算（分）；无法给出时为 null */
  suggestedFen: number | null;
  /** 收到约束后的最终单餐预算（分），已对齐 API 的 500~20000 区间 */
  basis: {
    dailyAllowanceFen: number;
    dailyMealCount: number;
    perMealFen: number;
    cappedByDefault: boolean;
    cappedByApiFloor: boolean;
    cappedByApiCeiling: boolean;
  } | null;
  /** 面向用户的一句话解释 */
  explanation: string;
  /** 无法给出建议时的原因 */
  blockedReason?: string;
}

export interface RecommendationImpact {
  recommendationType: string;
  totalPriceFen: number;
  impact: MealImpact;
}
