/**
 * 请求校验（Zod）。
 *
 * 校验目标不只是"类型对不对"，更是**限制攻击面**：
 * - 预算有上下界，避免 1 分钱或 20 万元这种无意义/滥用请求；
 * - 第一阶段只允许「到店自提」（orderType=1 / beType=1），其他用餐方式直接拒绝，
 *   避免把用户带进未验证的链路（外送/得来速需要 beCode，本期没有实现）；
 * - 偏好只接受白名单，防止把任意字符串塞进推荐逻辑；
 * - `.strict()` 拒绝未知字段，避免调用方以为某个字段生效了。
 */

import { z } from "zod";

import { DEFAULT_BUDGET_FEN, AVOIDABLE_TAGS, PREFERENCE_OPTIONS, type RecommendRequest } from "./types";

/** 预算下限 ¥5：再低连一份小食都买不到，属于无意义请求 */
export const BUDGET_MIN_FEN = 500;
/** 预算上限 ¥200：单餐决策场景的合理上界 */
export const BUDGET_MAX_FEN = 20_000;

const DEFAULT_CITY = "广州市";

/** 整数 + 区间校验（用 refine 以兼容 Zod 各版本的消息参数差异） */
function intInRange(min: number, max: number, label: string) {
  return z
    .number()
    .refine((value) => Number.isInteger(value) && value >= min && value <= max, {
      message: `${label}必须是 ${min}~${max} 之间的整数`,
    });
}

const onlyToStore = (label: string) =>
  z.number().refine((value) => value === 1, {
    message: `${label}只支持 1（到店自提）；外送/得来速/团餐本期未接入`,
  });

export const recommendRequestSchema = z
  .object({
    budgetFen: intInRange(BUDGET_MIN_FEN, BUDGET_MAX_FEN, "预算（分）").default(DEFAULT_BUDGET_FEN),
    city: z.string().trim().min(1, "城市不能为空").max(20, "城市名过长").default(DEFAULT_CITY),
    keyword: z.string().trim().max(30, "商圈关键词过长").optional(),
    storeCode: z
      .string()
      .trim()
      .regex(/^\d{3,12}$/, "storeCode 必须是 3~12 位数字（麦当劳门店编码）"),
    orderType: onlyToStore("orderType").default(1),
    beType: onlyToStore("beType").default(1),
    preferences: z
      .array(z.enum(PREFERENCE_OPTIONS, { message: `偏好只支持：${PREFERENCE_OPTIONS.join("、")}` }))
      .max(5, "偏好最多选 5 个")
      .optional(),
    avoidTags: z
      .array(z.enum(AVOIDABLE_TAGS, { message: `排除项只支持：${AVOIDABLE_TAGS.join("、")}` }))
      .max(6, "排除项最多 6 个")
      .optional(),
    excludeCategories: z
      .array(z.string().trim().min(1).max(20))
      .max(10, "最多排除 10 个分类")
      .optional(),
    maxResults: intInRange(1, 3, "推荐数量").optional(),
  })
  .strict();

export type ParsedRecommendRequest = z.infer<typeof recommendRequestSchema>;

export type ParseRecommendResult =
  | { ok: true; value: RecommendRequest }
  | { ok: false; message: string; field: string };

/** 把 Zod 的第一条 issue 转成中文可读提示 */
export function parseRecommendRequest(input: unknown): ParseRecommendResult {
  const result = recommendRequestSchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data as RecommendRequest };
  }

  const issue = result.error.issues[0];
  const field = issue?.path.length ? issue.path.join(".") : "body";
  const message = issue?.message ?? "请求参数不合法";
  return { ok: false, message, field };
}
