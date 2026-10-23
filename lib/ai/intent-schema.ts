/**
 * 大模型输出的 Schema 校验层（任务 004）。
 *
 * 设计要点：
 *
 * 1. **白名单字段**：只接受 `LLM_INTENT_KEYS` 里的键。模型多输出的键一律丢弃，
 *    并记入 `ignoredFields`——如果模型擅自输出「过敏史」「疾病」「收入」这类属性，
 *    它连进入业务层的机会都没有，同时留下可审计的痕迹。
 *
 * 2. **显式类型归一化**：不依赖供应商的结构化输出（`response_format` / JSON mode），
 *    因为"不得假设所有模型都支持相同能力"。改为在本地做保守归一化：
 *    数字字符串 → 数字、`"true"` → 布尔，其余保持原值交给 Zod 判错。
 *
 * 3. **失败即降级**：任何一处不合法都返回 `ok: false`，由 `parse-intent.ts`
 *    切换到规则解析，绝不"猜一个接近的值"继续跑。
 */

import { z } from "zod";

import {
  AI_FOOD_TAGS,
  BUDGET_KINDS,
  DECISION_GOALS,
  MEAL_TYPES,
  USER_STATES,
} from "./types";

/** 允许模型输出的字段全集（其余一律 strip） */
export const LLM_INTENT_KEYS = [
  "mealType",
  "budgetKind",
  "budgetYuan",
  "remainingMentionYuan",
  "preferences",
  "avoid",
  "goal",
  "userStates",
  "wantsLongTermBudget",
  "wantsCompleteMeal",
  "needsClarification",
  "clarifyingQuestions",
  "unsupportedConditions",
] as const;

/** 明确拒绝的敏感属性键名（命中即记入 ignoredFields，仅用于审计提示） */
export const SENSITIVE_KEYS = [
  "allergy",
  "allergies",
  "allergen",
  "disease",
  "illness",
  "diagnosis",
  "income",
  "salary",
  "religion",
  "race",
  "ethnicity",
  "gender",
  "age",
  "weight",
  "bmi",
  "medication",
  "过敏",
  "疾病",
  "收入",
] as const;

/** 金额上限（元）：超过这个数必然是解析错误，不是真实预算 */
const MAX_YUAN = 10_000;

function toNumber(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[¥￥元块钱左右上下约\s]/g, "");
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
  }
  return value;
}

function toBoolean(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

export interface NormalizedPayload {
  value: Record<string, unknown>;
  /** 被丢弃的非白名单字段名 */
  ignoredFields: string[];
}

/**
 * 把模型返回的任意对象归一化成一个"只含白名单键 + 已做基础类型转换"的对象。
 * 非对象输入原样返回，交给 Zod 判错。
 */
export function normalizeLlmPayload(raw: unknown): NormalizedPayload {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { value: {}, ignoredFields: [] };
  }

  const source = raw as Record<string, unknown>;
  const allowed = new Set<string>(LLM_INTENT_KEYS);
  const value: Record<string, unknown> = {};
  const ignoredFields: string[] = [];

  for (const [key, rawValue] of Object.entries(source)) {
    if (!allowed.has(key)) {
      ignoredFields.push(key);
      continue;
    }
    if (rawValue === undefined) continue;

    switch (key) {
      case "budgetYuan":
      case "remainingMentionYuan":
        value[key] = toNumber(rawValue);
        break;
      case "wantsLongTermBudget":
      case "wantsCompleteMeal":
      case "needsClarification":
        value[key] = toBoolean(rawValue);
        break;
      default:
        value[key] = rawValue;
    }
  }

  return { value, ignoredFields };
}

const shortText = (max: number) => z.string().trim().min(1).max(max);

/**
 * 模型输出的目标结构。
 *
 * 所有字段都是"可以缺省"的：模型少给字段是可接受的（走默认值），
 * 但**给了错值**不可接受（直接判失败并降级）。
 */
export const llmIntentSchema = z.object({
  mealType: z.enum(MEAL_TYPES).default("unspecified"),
  budgetKind: z.enum(BUDGET_KINDS).default("unspecified"),
  budgetYuan: z.number().finite().min(0).max(MAX_YUAN).nullable().default(null),
  remainingMentionYuan: z.number().finite().min(0).max(MAX_YUAN).nullable().default(null),
  preferences: z.array(z.enum(AI_FOOD_TAGS)).max(4).default([]),
  avoid: z.array(z.enum(AI_FOOD_TAGS)).max(4).default([]),
  goal: z.enum(DECISION_GOALS).default("balanced"),
  userStates: z.array(z.enum(USER_STATES)).max(3).default([]),
  wantsLongTermBudget: z.boolean().nullable().default(null),
  wantsCompleteMeal: z.boolean().default(false),
  needsClarification: z.boolean().default(false),
  clarifyingQuestions: z.array(shortText(60)).max(3).default([]),
  unsupportedConditions: z.array(shortText(40)).max(3).default([]),
});

export type LlmIntent = z.infer<typeof llmIntentSchema>;

export type ParseLlmIntentResult =
  | { ok: true; value: LlmIntent; ignoredFields: string[] }
  | { ok: false; reason: string };

/** 校验模型输出；失败时返回**不含模型原文**的原因（避免把用户数据带进日志/响应） */
export function parseLlmIntent(raw: unknown): ParseLlmIntentResult {
  // 非对象（字符串 / 数组 / null）绝不当成"空意图"放行——那等于替模型猜
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "模型返回的不是 JSON 对象" };
  }

  const { value, ignoredFields } = normalizeLlmPayload(raw);
  const result = llmIntentSchema.safeParse(value);

  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length ? issue.path.join(".") : "(root)";
    return { ok: false, reason: `模型输出字段 ${field} 不符合约定结构` };
  }

  return { ok: true, value: result.data, ignoredFields };
}
