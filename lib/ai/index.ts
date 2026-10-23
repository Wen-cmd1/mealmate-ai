/**
 * AI 模块统一导出（服务端入口）。
 *
 * ⚠️ 客户端组件只能引 `@/lib/ai/types`（纯类型 + 常量），
 * 不要引本文件——本文件会把 MCP / 模型调用带进客户端 import 图。
 */

export * from "./types";
export { parseIntent, parseIntentByRules, detectInjection, buildIntentMessages, INTENT_SYSTEM_PROMPT, parseChineseAmount } from "./parse-intent";
export {
  LLM_INTENT_KEYS,
  llmIntentSchema,
  normalizeLlmPayload,
  parseLlmIntent,
  SENSITIVE_KEYS,
  type LlmIntent,
} from "./intent-schema";
export { createLlmProvider, extractJsonObject, readAiConfig, type AiConfig, type LlmProvider } from "./provider";
export {
  decide,
  resolveBudget,
  sanitizeContext,
  validateText,
  type DecideDependencies,
} from "./decision-agent";
export {
  ALLERGEN_CAVEAT,
  buildDecideResponse,
  exclusionCaveat,
  MEDICAL_CAVEAT,
  PRICE_CAVEAT,
  primaryPlanType,
} from "./response-builder";
