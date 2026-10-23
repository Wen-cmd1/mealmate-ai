/**
 * 预算数据的校验（Zod）。
 *
 * 用途有两个，边界很清楚：
 * 1. **storage 读取**：localStorage 里的字符串可能被用户手动改过、被其他版本写过、
 *    或写到一半被中断。这里的策略是「**逐条宽进、坏一条只丢一条**」，
 *    绝不让一条脏数据把整份账本判死刑。
 * 2. **表单输入**：把「元」文本解析成整数分，并给出可读的中文错误。
 *
 * 注意：这里**不校验**业务合理性（比如预留 > 总额），那属于引擎的告警范畴，
 * 应当被展示而不是被拒收 —— 用户有权保存一个"有问题"的计划，然后看到问题提示。
 */

import { z } from "zod";

import { isValidDateKey, isValidTimeZone } from "./period";
import {
  EXPENSE_SOURCES,
  EXPENSE_STATUSES,
  PERIOD_KINDS,
  type BudgetPlan,
  type ExpenseRecord,
} from "./types";
import { yuanToFen } from "./money";

const MAX_FEN = 100_000_00; // ¥100,000

const dateKeySchema = z
  .string()
  .refine((value) => isValidDateKey(value), { message: "日期必须是合法的 YYYY-MM-DD" });

const instantSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "时间戳无法解析",
});

const timezoneSchema = z
  .string()
  .refine((value) => isValidTimeZone(value), { message: "时区必须是合法的 IANA 时区" });

export const budgetPlanSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(40),
    totalFen: z.number().int().min(0).max(MAX_FEN),
    reserveFen: z.number().int().min(0).max(MAX_FEN).default(0),
    startDate: dateKeySchema,
    endDate: dateKeySchema,
    timezone: timezoneSchema,
    periodKind: z.enum(PERIOD_KINDS).default("month"),
    dailyMealCount: z.number().int().min(1).max(6).default(3),
    defaultMealBudgetFen: z.number().int().min(0).max(MAX_FEN).optional(),
    createdAt: z.string().min(1).max(40),
    updatedAt: z.string().min(1).max(40),
  })
  .superRefine((plan, ctx) => {
    if (plan.startDate > plan.endDate) {
      ctx.addIssue({ code: "custom", message: "结束日期不能早于开始日期", path: ["endDate"] });
    }
  });

export const expenseRecordSchema = z.object({
  id: z.string().min(1).max(64),
  planId: z.string().min(1).max(64),
  amountFen: z.number().int().min(0).max(MAX_FEN),
  occurredAt: instantSchema,
  description: z.string().max(80).default(""),
  source: z.enum(EXPENSE_SOURCES).default("manual"),
  status: z.enum(EXPENSE_STATUSES).default("confirmed"),
  relatedProductCode: z.string().max(40).optional(),
  relatedRecommendationType: z.string().max(20).optional(),
  requestId: z.string().max(64).optional(),
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
});

export const budgetSettingsSchema = z.object({
  city: z.string().min(1).max(20).default("广州市"),
  keyword: z.string().max(30).default("天河"),
  storeCode: z.string().max(12).default(""),
  storeName: z.string().max(60).optional(),
});

/** storage 的外层信封：只校验结构，条目留给上面逐条校验 */
export const budgetEnvelopeSchema = z.object({
  version: z.number().int(),
  savedAt: z.string().optional(),
  activePlanId: z.string().nullable().optional(),
  plans: z.array(z.unknown()).default([]),
  records: z.array(z.unknown()).default([]),
  settings: z.unknown().optional(),
});

export type ParsedBudgetPlan = z.infer<typeof budgetPlanSchema>;
export type ParsedExpenseRecord = z.infer<typeof expenseRecordSchema>;

/** 校验单条计划；返回 null 表示不可用 */
export function parseStoredPlan(value: unknown): BudgetPlan | null {
  const result = budgetPlanSchema.safeParse(value);
  return result.success ? (result.data as BudgetPlan) : null;
}

export function parseStoredRecord(value: unknown): ExpenseRecord | null {
  const result = expenseRecordSchema.safeParse(value);
  return result.success ? (result.data as ExpenseRecord) : null;
}

/* ------------------------------------------------------------------ *
 * 表单：元 → 分
 * ------------------------------------------------------------------ */

export interface AmountParseResult {
  ok: boolean;
  fen: number | null;
  message?: string;
}

/**
 * 解析用户输入的「元」金额。
 * - 空字符串按 0 处理（调用方决定 0 是否合法）
 * - 最多两位小数，超过部分四舍五入（与 `yuanToFen` 保持一致）
 * - 不接受负数、`NaN`、`Infinity`、科学计数法
 */
export function parseAmountInput(input: string): AmountParseResult {
  const text = input.trim();
  if (text === "") return { ok: true, fen: 0 };

  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { ok: false, fen: null, message: "请输入不含符号的金额，例如 25 或 25.50" };
  }

  let fen: number;
  try {
    fen = yuanToFen(text);
  } catch {
    return { ok: false, fen: null, message: "金额格式不正确" };
  }

  if (!Number.isInteger(fen) || fen < 0) {
    return { ok: false, fen: null, message: "金额必须是非负数" };
  }
  if (fen > MAX_FEN) {
    return { ok: false, fen: null, message: "金额超出合理范围" };
  }
  return { ok: true, fen };
}
