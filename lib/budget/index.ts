/**
 * 预算模块统一导出。
 *
 * ⚠️ 客户端组件可以直接引 `types` / `period` / `ledger` / `forecast` /
 * `budget-engine` / `storage` / `meal-link` —— 它们都是纯逻辑，不碰 MCP、不碰 token。
 * 唯一要注意的是别把 `lib/mcp/*` 或 `lib/recommendation/engine` 带进客户端 import 图。
 */

export * from "./types";
export {
  addDays,
  compareDateKeys,
  dateKeyOfInstant,
  dayCount,
  daysInMonth,
  derivePeriodDates,
  diffDays,
  elapsedDaysInPeriod,
  endOfMonth,
  formatPeriodLabel,
  fromEpochDay,
  isPeriodEnded,
  isPeriodNotStarted,
  isValidDateKey,
  isValidTimeZone,
  isoToLocalDateTimeInput,
  localDateTimeToIso,
  maxDateKey,
  minDateKey,
  parseDateKey,
  remainingDaysInPeriod,
  startOfMonth,
  startOfWeek,
  toEpochDay,
  todayKey,
  weekdayOf,
} from "./period";
export {
  addExpense,
  confirmExpense,
  createExpense,
  dedupeById,
  defaultIdFactory,
  expenseSignature,
  removeExpense,
  scopeRecords,
  sortByOccurredAtDesc,
  sumAmountFen,
  sumByStatus,
  updateExpense,
  validateExpenseAmount,
} from "./ledger";
export { computeMealImpact } from "./forecast";
export {
  computeBudgetSummary,
  createBudgetPlan,
  describePeriod,
  impactOfVerifiedPrice,
  SUGGESTED_BUDGET_MAX_FEN,
  SUGGESTED_BUDGET_MIN_FEN,
  suggestMealBudget,
  updateBudgetPlan,
  validateBudgetPlan,
} from "./budget-engine";
export { draftExpenseFromRecommendation } from "./meal-link";
export {
  BUDGET_STORE_KEY,
  BUDGET_STORE_VERSION,
  clearBudgetState,
  emptyBudgetState,
  getActivePlan,
  getBrowserStorage,
  loadBudgetState,
  parseBudgetStore,
  saveBudgetState,
  serializeBudgetStore,
  deletePlan,
  setActivePlan,
  upsertPlan,
  withRecords,
  withSettings,
} from "./storage";
export { parseAmountInput } from "./schema";
