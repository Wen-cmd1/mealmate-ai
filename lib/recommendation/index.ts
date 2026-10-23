/**
 * 推荐模块统一导出（服务端入口）。
 *
 * ⚠️ 客户端组件请直接从 `@/lib/recommendation/types` 引类型，
 * 不要引本文件——本文件会把引擎实现一起带进 import 图。
 */

export * from "./types";
export {
  buildCandidates,
  classifyItem,
  filterByBudget,
  filterMenu,
  filterMenuSnapshot,
  findCheapestAnchorFen,
  matchPreferences,
} from "./filters";
export {
  BALANCED_TARGET_RATIO,
  COMPLETENESS_SCORES,
  PLAN_WEIGHTS,
  priceFitScore,
  prioritizeComplete,
  rankCandidates,
  scoreCandidate,
  valueScore,
} from "./scoring";
export { buildEmptyReason, buildExplanation, COMPOSITION_LABELS } from "./explain";
export {
  createRecommendationEngine,
  RecommendationEngine,
  RecommendationError,
  type EngineOptions,
} from "./engine";
export { parseRecommendRequest, recommendRequestSchema, type ParseRecommendResult } from "./schema";
