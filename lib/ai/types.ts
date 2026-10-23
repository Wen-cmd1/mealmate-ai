/**
 * AI 决策 Agent —— 类型契约（任务 004）。
 *
 * 三条边界写在这里，因为它们是**类型层面**的约束，不是文案层面的承诺：
 *
 * 1. **大模型只产出「意图」，不产出「数据」**。
 *    `ParsedIntent` 里没有任何价格、餐品、优惠券、营养字段——大模型想编也没有地方放。
 *    价格只能来自 MCP 的 `calculate-price`，菜单只能来自 `query-meals`。
 *
 * 2. **预算上下文是"用户授权的用户数据"，不是服务端账户**。
 *    所以它被单独包在 `AuthorizedBudgetContext` 里，并且必须带 `authorized: true`
 *    才会被采纳——没有显式授权就当作没提供，绝不默默读取。
 *
 * 3. **不存在"敏感属性"通道**。
 *    `ParsedIntent` 里没有过敏史/疾病/收入/宗教字段；模型即便输出，也会在
 *    Schema 层被 strip 掉，并在 `ignoredFields` 里留下痕迹（见 `intent-schema.ts`）。
 *
 * 本文件不依赖任何服务端模块，可以被 "use client" 组件以 `import type` 引用。
 */

import type { Recommendation, RecommendationSource, RecommendWarning } from "../recommendation/types";

/* ------------------------------------------------------------------ *
 * 枚举
 * ------------------------------------------------------------------ */

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "unspecified"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  unspecified: "这一餐",
};

/**
 * 预算语义。这是任务 004 最容易做错的地方：
 *
 * - `hard_cap`：硬上限（"不超过 20"、"只有 15 元"）——超过就**不能推荐**；
 * - `soft_target`：软偏好（"20 元左右"）——可以略低于它，但**绝不能超过**用户已设的硬上限；
 * - `unspecified`：用户没提预算。
 */
export const BUDGET_KINDS = ["hard_cap", "soft_target", "unspecified"] as const;
export type BudgetKind = (typeof BUDGET_KINDS)[number];

export const BUDGET_KIND_LABELS: Record<BudgetKind, string> = {
  hard_cap: "硬上限",
  soft_target: "期望价位",
  unspecified: "未指定",
};

export const DECISION_GOALS = ["save", "balanced", "satisfy"] as const;
export type DecisionGoal = (typeof DECISION_GOALS)[number];

export const DECISION_GOAL_LABELS: Record<DecisionGoal, string> = {
  save: "省钱优先",
  balanced: "均衡选择",
  satisfy: "满足口味",
};

export const USER_STATES = ["tired", "rushed", "reward", "budget_worried"] as const;
export type UserState = (typeof USER_STATES)[number];

export const USER_STATE_LABELS: Record<UserState, string> = {
  tired: "有点累",
  rushed: "赶时间",
  reward: "想犒劳自己",
  budget_worried: "担心花超",
};

/** 可抽取的食材/口味标签（与推荐层 `AVOIDABLE_TAGS` 对齐，避免两套词表） */
export const AI_FOOD_TAGS = ["汉堡", "鸡肉", "牛肉", "猪肉", "鱼", "辣"] as const;
export type AiFoodTag = (typeof AI_FOOD_TAGS)[number];

/* ------------------------------------------------------------------ *
 * 意图
 * ------------------------------------------------------------------ */

/**
 * 结构化意图。
 *
 * 注意 `budgetFen` 与 `remainingMentionFen` 是**两个不同字段**：
 * 「这个月还剩 300 元」说的是**周期剩余**，不是"这一顿花 300"。
 * 混成一个字段会让系统把月度剩余当成单餐预算，是任务书明令禁止的。
 */
export interface ParsedIntent {
  mealType: MealType;
  /** 预算语义 */
  budgetKind: BudgetKind;
  /** 用户提到的单餐预算（分）。未提到为 null */
  budgetFen: number | null;
  /**
   * 用户在**同一次表达里同时给了两个数**时的期望价位（分）。
   *
   * 例：「预算 20 元左右，但绝对不能超过 25 元」
   *   → budgetKind = hard_cap、budgetFen = 2500（不可突破的上限）、preferredFen = 2000（想花的钱）
   *
   * 没有这种双重表达时为 null。存在时**推荐按 preferredFen 找**，
   * 而 budgetFen 仍然作为不可突破的硬上限——两个语义不能互相吞掉。
   */
  preferredFen?: number | null;
  /** 用户提到的**周期剩余**金额（分），只用于提示，不会写进账本 */
  remainingMentionFen: number | null;
  /**
   * 用户在句子里**自己提到**"昨天/上次吃过什么"的品类。
   *
   * 这不是"系统读到的历史"——系统没有历史用餐记录，也读不到。
   * 这个字段只用来在响应里如实说明："我只有你这句话，没有你的历史数据"。
   */
  historyTags?: AiFoodTag[];
  preferences: AiFoodTag[];
  /** 明确排除项 —— 会走确定性过滤，不是打分惩罚 */
  avoid: AiFoodTag[];
  goal: DecisionGoal;
  userStates: UserState[];
  /** 用户是否希望结合长期预算 */
  wantsLongTermBudget: boolean | null;
  /** 是否强调"想吃一顿完整的" */
  wantsCompleteMeal: boolean;
  /** 本系统无法可靠满足的条件（如过敏原），必须如实告知 */
  unsupportedConditions: string[];
  /** 是否还需要用户补充信息 */
  needsClarification: boolean;
  clarifyingQuestions: string[];
  /** 抽取依据（不含用户原文，便于排查与解释） */
  signals: string[];
}

/** 意图解析模式：真实大模型 / 规则降级 */
export const INTENT_PARSE_MODES = ["LLM", "RULE_FALLBACK"] as const;
export type IntentParseMode = (typeof INTENT_PARSE_MODES)[number];

export const INTENT_PARSE_MODE_LABELS: Record<IntentParseMode, string> = {
  LLM: "大模型解析",
  RULE_FALLBACK: "规则解析（未接入大模型）",
};

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AiMeta {
  /** 仅暴露模型名，不暴露 Key / BaseURL 凭证 */
  model?: string;
  elapsedMs: number;
  usage?: AiUsage;
  /** 降级原因（面向用户的短句，不含内部堆栈） */
  fallbackReason?: string;
  /** 模型输出里被丢弃的字段名（如模型擅自输出敏感属性） */
  ignoredFields?: string[];
}

/* ------------------------------------------------------------------ *
 * 预算上下文（用户授权）
 * ------------------------------------------------------------------ */

/**
 * 用户从本机账本带来的预算上下文。
 *
 * **这是用户提供的数据，必须当成不可信输入校验**：
 * 数值范围、整数性、日期天数都要在服务端重新校验；
 * 不能被当成"服务端账户余额"直接信任。
 */
export interface AuthorizedBudgetContext {
  /** 必须显式为 true 才会被采纳 */
  authorized: true;
  /** 用户自己设的单餐硬上限（分） */
  hardCapFen?: number;
  /** 由账本推算的建议单餐预算（分） */
  suggestedMealBudgetFen?: number;
  /** 周期剩余预算（分，可为负） */
  remainingFen?: number;
  /** 剩余预算天数（含今天） */
  daysRemaining?: number;
  /** 预留金额（分） */
  reserveFen?: number;
  /** 计划名，仅用于展示 */
  planName?: string;
}

export interface DecideContext {
  city: string;
  keyword?: string;
  storeCode: string;
  orderType: 1;
  beType: 1;
  /** 用户在界面上**确认过**的口味偏好（与自然语言抽取的合并） */
  preferences?: AiFoodTag[];
  /** 用户在界面上确认过的排除项 */
  avoid?: AiFoodTag[];
  /** 今天还剩几餐（含这顿）。不传就不做"覆盖今天"的假设 */
  mealsLeftToday?: number;
  budget?: AuthorizedBudgetContext;
}

export interface DecideInput {
  text: string;
  context?: DecideContext;
}

/* ------------------------------------------------------------------ *
 * 预算裁决
 * ------------------------------------------------------------------ */

export const BUDGET_SOURCES = [
  "user_hard_cap",
  "user_soft_target",
  "plan_suggestion",
  "context_hard_cap",
  "default",
] as const;
export type BudgetSource = (typeof BUDGET_SOURCES)[number];

export const BUDGET_SOURCE_LABELS: Record<BudgetSource, string> = {
  user_hard_cap: "你这次说的硬上限",
  user_soft_target: "你这次说的期望价位",
  plan_suggestion: "按你的长期预算推算的建议值",
  context_hard_cap: "你设置的单餐上限",
  default: "默认预算（你没说多少钱）",
};

export interface BudgetDecision {
  /** 最终用于推荐的单餐预算（分），已对齐接口 500~20000 区间 */
  appliedFen: number;
  kind: BudgetKind;
  source: BudgetSource;
  /** 用户原话里的金额（分），未提及为 null */
  mentionedFen: number | null;
  /** 同一句话里另外提到的期望价位（分）；没有则为 null 或省略 */
  preferredFen?: number | null;
  /** 是否因为用户已设的硬上限而被下调 */
  clampedByContext: boolean;
  /** 是否因为接口区间而被调整 */
  clampedByApiLimit: boolean;
  /** 硬上限（分）：推荐结果一定不超过它；没有硬上限时为 null */
  hardCapFen: number | null;
  /** 面向用户的一句话说明 */
  explanation: string;
}

/* ------------------------------------------------------------------ *
 * 告警
 * ------------------------------------------------------------------ */

export const AI_WARNING_CODES = [
  "RULE_FALLBACK",
  "INJECTION_SUSPECTED",
  "BUDGET_DEFAULTED",
  "BUDGET_CLAMPED_BY_CONTEXT",
  "BUDGET_CLAMPED_BY_API_LIMIT",
  "SOFT_BUDGET_NOTED",
  "EXCLUSION_NOT_GUARANTEED",
  "ALLERGEN_UNVERIFIED",
  "LEDGER_UNTOUCHED",
  "LEDGER_ESTIMATED",
  "HISTORY_NOT_RECORDED",
  "MIXED_BUDGET_NOTED",
  "IGNORED_SENSITIVE_FIELDS",
  "CLARIFICATION_NEEDED",
  "PRICE_NOT_VERIFIED",
  "NO_RESULT",
] as const;

export type AiWarningCode = (typeof AI_WARNING_CODES)[number];

export interface AiWarning {
  code: AiWarningCode;
  message: string;
}

/* ------------------------------------------------------------------ *
 * 推荐结果（带影响预测）
 * ------------------------------------------------------------------ */

/** 单个方案对预算的影响；没有授权预算上下文时为 null */
export interface AiImpactView {
  remainingBeforeFen: number;
  remainingAfterFen: number;
  beforeDailyFen: number | null;
  afterDailyFen: number | null;
  dailyDeltaFen: number | null;
  reserveTouchedFen: number;
  overBudgetFen: number;
  /** 本次预测的前提（必须展示） */
  assumptions: string[];
}

export interface AiRecommendation {
  /** 原始推荐（价格、组成、理由全部来自任务 002 的引擎） */
  recommendation: Recommendation;
  /** 预算影响，未授权预算时为 null */
  impact: AiImpactView | null;
  /** 该方案与本次意图的契合点（由确定性规则生成，不是模型自由发挥） */
  fitNotes: string[];
  /** 是否是当前目标的首选 */
  primary: boolean;
}

/* ------------------------------------------------------------------ *
 * 响应
 * ------------------------------------------------------------------ */

export interface UnderstoodRequirement {
  mealType: MealType;
  mealTypeLabel: string;
  budgetKind: BudgetKind;
  budgetLabel: string;
  preferences: AiFoodTag[];
  avoid: AiFoodTag[];
  goal: DecisionGoal;
  goalLabel: string;
  userStates: UserState[];
  wantsCompleteMeal: boolean;
  wantsLongTermBudget: boolean | null;
  /** 用户提到的周期剩余（分），仅提示 */
  remainingMentionFen: number | null;
}

export interface Clarification {
  needed: boolean;
  questions: string[];
}

export interface PriceVerificationSummary {
  quotesUsed: number;
  verifiedCount: number;
  /** 所有返回的方案是否都经过官方算价核验 */
  allVerified: boolean;
}

export interface DecideResponse {
  success: true;
  mode: IntentParseMode;
  ai: AiMeta | null;
  intent: ParsedIntent;
  understood: UnderstoodRequirement;
  budget: BudgetDecision;
  recommendations: AiRecommendation[];
  priceVerification: PriceVerificationSummary;
  clarification: Clarification;
  /** 必须原样展示给用户的前提与限制 */
  caveats: string[];
  source: RecommendationSource;
  warnings: AiWarning[];
  /** 复用推荐引擎的告警（价格/门店相关） */
  recommendationWarnings: RecommendWarning[];
  emptyReason?: string;
  elapsedMs: number;
}

/* ------------------------------------------------------------------ *
 * 错误
 * ------------------------------------------------------------------ */

export const AI_ERROR_KINDS = [
  "INVALID_REQUEST",
  "TEXT_TOO_LONG",
  "MISSING_CONFIG",
  "TIMEOUT",
  "HTTP_ERROR",
  "INVALID_RESPONSE",
] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

/** 用户输入最大长度（字符），超长直接拒绝，不截断后继续解析 */
export const MAX_TEXT_CHARS = 500;
/** 单餐预算下限 / 上限，与 /api/recommend 保持一致 */
export const AI_BUDGET_MIN_FEN = 500;
export const AI_BUDGET_MAX_FEN = 20_000;
/** 默认预算：用户没说多少钱时使用，并明确告知 */
export const AI_DEFAULT_BUDGET_FEN = 2_500;
