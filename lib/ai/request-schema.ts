/**
 * `POST /api/ai/decide` 的请求校验（任务 004）。
 *
 * 这个 Schema 的作用不只是"检查类型"，而是**划定攻击面**：
 *
 * - `text` 有长度上下限：太短没信息，太长直接拒绝（不截断，避免丢掉硬上限）；
 * - `context.budget.authorized` 必须是字面量 `true` —— 没有显式授权就当没提供；
 * - 预算数值有区间：用户从浏览器带来的数字被视为**不可信输入**；
 * - 门店编码必须是 3~12 位数字，城市/关键词有长度上限；
 * - `preferences` / `avoid` 只接受白名单标签，杜绝把任意字符串塞进过滤逻辑；
 * - `.strict()` 拒绝未知字段，避免调用方以为某个字段生效了；
 * - 用餐方式仍然只允许到店自提（1），与 `/api/recommend` 保持一致。
 */

import { z } from "zod";

import {
  AI_BUDGET_MAX_FEN,
  AI_BUDGET_MIN_FEN,
  AI_FOOD_TAGS,
  MAX_TEXT_CHARS,
  type DecideInput,
} from "./types";

function intInRange(min: number, max: number, label: string) {
  return z.number().refine((value) => Number.isInteger(value) && value >= min && value <= max, {
    message: `${label}必须是 ${min}~${max} 之间的整数`,
  });
}

const foodTag = z.enum(AI_FOOD_TAGS, {
  message: `只支持这些标签：${AI_FOOD_TAGS.join("、")}`,
});

const budgetContextSchema = z
  .object({
    /** 必须显式授权；这不是"默认同意" */
    authorized: z.literal(true, {
      message: "使用预算上下文必须显式授权（authorized: true）",
    }),
    hardCapFen: intInRange(AI_BUDGET_MIN_FEN, AI_BUDGET_MAX_FEN, "单餐上限（分）").optional(),
    suggestedMealBudgetFen: intInRange(
      AI_BUDGET_MIN_FEN,
      AI_BUDGET_MAX_FEN,
      "建议单餐预算（分）",
    ).optional(),
    remainingFen: intInRange(-1_000_000, 10_000_000, "周期剩余（分）").optional(),
    daysRemaining: intInRange(0, 400, "剩余天数").optional(),
    reserveFen: intInRange(0, 10_000_000, "预留金额（分）").optional(),
    planName: z.string().trim().max(40, "计划名过长").optional(),
  })
  .strict();

const decideContextSchema = z
  .object({
    city: z.string().trim().min(1, "城市不能为空").max(20, "城市名过长").default("广州市"),
    keyword: z.string().trim().max(30, "商圈关键词过长").optional(),
    storeCode: z
      .string()
      .trim()
      .regex(/^\d{3,12}$/, "storeCode 必须是 3~12 位数字（麦当劳门店编码）"),
    orderType: z.literal(1, { message: "目前只支持 1（到店自提）" }).default(1),
    beType: z.literal(1, { message: "目前只支持 1（到店自提）" }).default(1),
    preferences: z.array(foodTag).max(4, "偏好最多选 4 个").optional(),
    avoid: z.array(foodTag).max(4, "排除项最多 4 个").optional(),
    mealsLeftToday: intInRange(1, 4, "今天剩余餐次").optional(),
    budget: budgetContextSchema.optional(),
  })
  .strict();

export const decideRequestSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, "请输入一句话描述你的用餐需求")
      .max(MAX_TEXT_CHARS, `输入最多 ${MAX_TEXT_CHARS} 个字`),
    context: decideContextSchema.optional(),
  })
  .strict();

export type ParsedDecideRequest = z.infer<typeof decideRequestSchema>;

export type ParseDecideResult =
  | { ok: true; value: DecideInput }
  | { ok: false; message: string; field: string };

export function parseDecideRequest(input: unknown): ParseDecideResult {
  const result = decideRequestSchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data as DecideInput };
  }
  const issue = result.error.issues[0];
  const field = issue?.path.length ? issue.path.join(".") : "body";
  return { ok: false, message: issue?.message ?? "请求参数不合法", field };
}
