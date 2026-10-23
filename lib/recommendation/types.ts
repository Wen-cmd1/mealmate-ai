/**
 * 单餐推荐引擎 —— 类型契约（任务 002）。
 *
 * 金额约定：**所有金额字段都是整数「分」**，字段名统一以 `Fen` 结尾。
 * 元只出现在展示层（`formatFen` / `fenToYuan`）。
 *
 * 本文件不依赖任何服务端模块，可以被 "use client" 组件以 `import type` 方式引用。
 */

import type { MealItem, MealProviderId, MenuSnapshot, PriceQuote, StoreRef } from "../../types/meal";

/* ------------------------------------------------------------------ *
 * 方案类型
 * ------------------------------------------------------------------ */

export const PLAN_TYPES = ["save", "balanced", "satisfy"] as const;
export type RecommendationType = (typeof PLAN_TYPES)[number];

export const PLAN_TITLES: Record<RecommendationType, string> = {
  save: "省钱优先",
  balanced: "均衡选择",
  satisfy: "满足优先",
};

export const PLAN_DESCRIPTIONS: Record<RecommendationType, string> = {
  save: "在预算内选价格最低的完整正餐——注意，酱料/单品饮料/周边不算一顿饭。",
  balanced: "在价格与餐品组成之间取折中（套餐 > 单主食 > 单主食+饮料）。本阶段不含营养判断。",
  satisfy: "尽量对齐你想吃的品类与口味，同时不超预算。",
};

/* ------------------------------------------------------------------ *
 * 餐品角色分类
 * ------------------------------------------------------------------ */

export const ITEM_ROLES = [
  "combo",
  "main",
  "side",
  "drink",
  "dessert",
  "sauce",
  "merch",
  "unknown",
] as const;

export type ItemRole = (typeof ITEM_ROLES)[number];

export interface ItemClassification {
  role: ItemRole;
  /** 能否作为「一顿正餐」的锚点（套餐或主食） */
  mealAnchor: boolean;
  /**
   * 套餐内容需用户进一步选择（如「随心选」「1+1」「任选」）。
   * 这类 SKU 可以算价，但**组成未知**，不得伪造完整套餐明细。
   */
  needsFurtherSelection: boolean;
  /** 用于偏好匹配的标签（品类/口味） */
  tags: string[];
  /** 分类依据，便于排查误判 */
  reason: string;
}

export interface ClassifiedItem extends ItemClassification {
  item: MealItem;
}

/* ------------------------------------------------------------------ *
 * 过滤
 * ------------------------------------------------------------------ */

export type ExclusionReason =
  | "non_food"
  | "sauce"
  | "drink_only"
  | "dessert_only"
  | "side_only"
  | "multi_person"
  | "unknown_role"
  | "excluded_category"
  /** 命中用户明确排除的口味/食材标签（确定性排除，不是低分惩罚） */
  | "excluded_tag"
  | "no_price"
  | "over_budget";

export interface ExcludedSample {
  code: string;
  name: string;
  reason: ExclusionReason;
}

export interface FilterReport {
  menuItemCount: number;
  /** 通过分类与排除规则、可作为正餐锚点的 SKU 数 */
  anchorCount: number;
  exclusionCounts: Partial<Record<ExclusionReason, number>>;
  /** 被排除的样例（最多 8 条），用于解释"为什么没有推荐" */
  excludedSamples: ExcludedSample[];
}

export type CompositionKind = "combo" | "main" | "main+side" | "main+drink";

/** 一个候选方案 = 1~2 个 SKU 的组合 */
export interface Candidate {
  items: MealItem[];
  /** 主 SKU（跨方案去重用），套餐或主食 */
  primaryCode: string;
  primaryName: string;
  primaryRole: ItemRole;
  /** 菜单标价合计（分），**尚未核验** */
  menuPriceFen: number;
  composition: CompositionKind;
  /** 是否含需进一步选择的套餐 */
  needsFurtherSelection: boolean;
  tags: string[];
  categoryName?: string;
}

/* ------------------------------------------------------------------ *
 * 评分
 * ------------------------------------------------------------------ */

export interface ScoreBreakdown {
  /** 价格贴合度：省钱方案越低越好，均衡方案贴近目标价位，满足方案为次要项 */
  priceFit: number;
  /** 完整性：套餐 > 主食+配餐 > 主食+饮料 > 单主食 */
  completeness: number;
  /** 偏好命中率 */
  preference: number;
  /** 促销力度（原价与现价的差额比例） */
  value: number;
}

export interface ScoredCandidate {
  type: RecommendationType;
  candidate: Candidate;
  score: number;
  breakdown: ScoreBreakdown;
  matchedPreferences: string[];
}

/* ------------------------------------------------------------------ *
 * 请求 / 响应
 * ------------------------------------------------------------------ */

export const PREFERENCE_OPTIONS = ["汉堡", "鸡肉", "牛肉", "鱼", "辣"] as const;
export type Preference = (typeof PREFERENCE_OPTIONS)[number];

/**
 * 可用于「确定性排除」的标签白名单（任务 004）。
 *
 * 比 `PREFERENCE_OPTIONS` 多一个「猪肉」：排除场景下用户可能说「不要猪肉/培根」，
 * 而正向偏好里没有这个选项。
 *
 * ⚠️ 这些标签全部由**菜单名称关键词**推导（见 `filters.ts` 的 `TAG_RULES`），
 * 因此排除只能保证"名称里带这个词的不推荐"，**不能保证配料里绝对没有**——
 * 上游接口没有逐项配料/辣度字段。调用方必须把这条限制如实告知用户。
 */
export const AVOIDABLE_TAGS = ["汉堡", "鸡肉", "牛肉", "猪肉", "鱼", "辣"] as const;
export type AvoidableTag = (typeof AVOIDABLE_TAGS)[number];

export interface RecommendRequest {
  /** 单餐预算（分），默认 2500 = ¥25 */
  budgetFen: number;
  city: string;
  /** 商圈/地标关键词。上游 query-nearby-stores 在 searchType=2 时**必须**有 keyword */
  keyword?: string;
  storeCode: string;
  /** 用餐方式，第一阶段仅到店自提（1） */
  orderType: 1 | 2;
  beType: 1 | 2 | 5 | 6;
  preferences?: string[];
  /**
   * 用户**明确排除**的标签（任务 004）。
   *
   * 与 `preferences` 的区别很关键：偏好只影响打分（低分惩罚），
   * 而排除项走 `filterMenu` 的确定性过滤——命中即不进入候选，
   * 不存在"因为价格合适所以还是推荐给你"的可能。
   *
   * 判定依据仍然是菜单名称关键词，无法覆盖配料表（见 `AVOIDABLE_TAGS` 注释）。
   */
  avoidTags?: string[];
  excludeCategories?: string[];
  /** 返回几个方案，默认 3，最多 3 */
  maxResults?: number;
}

export interface RecommendedItem {
  code: string;
  name: string;
  role: ItemRole;
  categoryName?: string;
  quantity: number;
  /** 菜单标价（分） */
  menuPriceFen: number;
  /** 单件菜单价（分） */
  unitPriceFen: number;
  originalPriceFen?: number;
  onSale: boolean;
  needsFurtherSelection: boolean;
}

export interface Recommendation {
  type: RecommendationType;
  title: string;
  items: RecommendedItem[];
  /** 总价（分）：已核验时等于官方算价，未核验时等于菜单标价 */
  totalPriceFen: number;
  /** 菜单标价合计（分） */
  menuPriceFen: number;
  /** 官方算价（分），未核验为 null */
  verifiedPriceFen: number | null;
  /** 是否已通过 calculate-price 核验 */
  priceVerified: boolean;
  /** 菜单标价与官方算价不一致 */
  priceMismatch: boolean;
  /** 预算剩余（分）= 预算 - totalPriceFen */
  remainingFen: number;
  composition: CompositionKind;
  needsFurtherSelection: boolean;
  reason: string;
  highlights: string[];
  score: number;
  scoreBreakdown: ScoreBreakdown;
}

export interface RecommendationSource {
  provider: MealProviderId;
  storeCode: string;
  storeName: string;
  storeAddress?: string;
  orderType: number;
  beType: number;
  /** 菜单抓取时间（本地时钟，ISO） */
  fetchedAt: string;
  /** 上游业务时间 */
  upstreamDatetime?: string;
  traceId?: string;
  /** 本次真实调用过的上游工具 */
  toolsUsed: string[];
}

export const WARNING_CODES = [
  "STORE_NAME_UNAVAILABLE",
  "STORE_NOT_FOUND",
  "STORE_LOOKUP_FAILED",
  "STORE_CLOSED",
  "NO_CANDIDATE_IN_BUDGET",
  "INSUFFICIENT_CANDIDATES",
  "QUOTE_REJECTED_OVER_BUDGET",
  "QUOTE_FAILED",
  "QUOTE_LIMIT_REACHED",
  "NEEDS_FURTHER_SELECTION",
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

export interface RecommendWarning {
  code: WarningCode;
  message: string;
}

export interface RecommendStats {
  menuItemCount: number;
  anchorCount: number;
  /** 预算内候选数（核验前） */
  withinBudgetCount: number;
  /** 实际发起 calculate-price 的次数 */
  quotesUsed: number;
  /** 核验通过的候选数 */
  verifiedCount: number;
  /** 各类拒绝原因计数 */
  rejectionCounts: Record<string, number>;
  exclusionCounts: Partial<Record<ExclusionReason, number>>;
}

export interface RecommendResponse {
  success: true;
  budgetFen: number;
  recommendations: Recommendation[];
  source: RecommendationSource;
  stats: RecommendStats;
  warnings: RecommendWarning[];
  /** 无推荐时的原因说明 */
  emptyReason?: string;
  elapsedMs: number;
}

export const RECOMMEND_ERROR_CODES = [
  "INVALID_REQUEST",
  "MISSING_TOKEN",
  "MCP_TIMEOUT",
  "MCP_UNAVAILABLE",
  "MENU_UNAVAILABLE",
  "STORE_UNAVAILABLE",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type RecommendErrorCode = (typeof RECOMMEND_ERROR_CODES)[number];

export interface RecommendErrorBody {
  success: false;
  error: {
    code: RecommendErrorCode;
    message: string;
    retryable: boolean;
  };
}

/* ------------------------------------------------------------------ *
 * 依赖端口（便于单测注入假实现）
 * ------------------------------------------------------------------ */

/**
 * 推荐引擎只需要这三个只读能力。
 * `McdMealProvider` 结构上满足该接口，无需额外适配。
 */
export interface MenuPort {
  findStores(input: {
    city?: string;
    keyword?: string;
    beType?: 1 | 5;
    searchType?: 1 | 2;
  }): Promise<StoreRef[]>;
  getMenu(input: {
    storeCode: string;
    orderType?: 1 | 2;
    beType?: 1 | 2 | 5 | 6;
    beCode?: string;
    store?: StoreRef;
  }): Promise<MenuSnapshot>;
  quotePrice(input: {
    storeCode: string;
    items: Array<{ productCode: string; quantity: number }>;
    orderType?: 1 | 2;
    beType?: 1 | 2 | 5 | 6;
    beCode?: string;
    needTableware?: boolean;
  }): Promise<PriceQuote>;
}

export const DEFAULT_BUDGET_FEN = 2500;
export const DEFAULT_MAX_RESULTS = 3;
