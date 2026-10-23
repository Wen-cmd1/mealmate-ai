/**
 * 消费账本 —— 纯函数。
 *
 * 三条硬规则：
 * 1. **推荐结果不进账本**。只有用户显式「记为已消费」才产生一条 `confirmed` 记录。
 * 2. **`planned` 不扣预算**。默认只有 `confirmed` 参与「已花金额」；
 *    `planned` 只用于「如果按计划花掉会怎样」的前瞻分析。
 * 3. **重复提交只落一条**。同一 `requestId` 幂等；没有 requestId 时，
 *    10 秒内内容完全相同的提交也视为重复（覆盖双击与网络重试）。
 *
 * 本文件不访问浏览器 API，也不依赖 React，可以被单测直接调用。
 */

import { assertFen } from "./money";
import { dateKeyOfInstant } from "./period";
import type { DateKey, ExpenseRecord, ExpenseSource, ExpenseStatus, IsoDateTime } from "./types";

/** 内容去重的时间窗（毫秒） */
export const DEDUPE_WINDOW_MS = 10_000;

export type IdFactory = () => string;

export const defaultIdFactory: IdFactory = () => {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export interface CreateExpenseInput {
  planId: string;
  amountFen: number;
  occurredAt: IsoDateTime;
  description?: string;
  source?: ExpenseSource;
  status?: ExpenseStatus;
  relatedProductCode?: string;
  relatedRecommendationType?: string;
  requestId?: string;
  /** 便于测试注入固定时间 */
  now?: Date;
  idFactory?: IdFactory;
}

export interface ExpenseValidation {
  ok: boolean;
  issues: string[];
}

/** 校验一条消费记录的**业务输入**（不含 id/时间戳） */
export function validateExpenseAmount(amountFen: unknown): ExpenseValidation {
  const issues: string[] = [];
  if (typeof amountFen !== "number" || !Number.isFinite(amountFen)) {
    issues.push("金额必须是数字");
  } else if (!Number.isInteger(amountFen)) {
    issues.push("金额必须是整数分（先在展示层把元换算成分）");
  } else if (amountFen < 0) {
    issues.push("金额不能为负数");
  } else if (amountFen > 100_000_00) {
    // ¥100,000 —— 单笔餐饮记录的合理上界，防止误输入
    issues.push("单笔金额超出合理范围（> ¥100000）");
  }
  return { ok: issues.length === 0, issues };
}

export function createExpense(input: CreateExpenseInput): ExpenseRecord {
  const validation = validateExpenseAmount(input.amountFen);
  if (!validation.ok) {
    throw new RangeError(`消费记录不合法：${validation.issues.join("；")}`);
  }
  if (!input.planId) throw new RangeError("消费记录必须归属某个预算计划");

  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new RangeError(`发生时间不合法："${input.occurredAt}"`);
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  return {
    id: (input.idFactory ?? defaultIdFactory)(),
    planId: input.planId,
    amountFen: input.amountFen,
    occurredAt: occurredAt.toISOString(),
    description: (input.description ?? "").trim().slice(0, 80),
    source: input.source ?? "manual",
    status: input.status ?? "confirmed",
    ...(input.relatedProductCode ? { relatedProductCode: input.relatedProductCode } : {}),
    ...(input.relatedRecommendationType
      ? { relatedRecommendationType: input.relatedRecommendationType }
      : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/** 内容签名：金额 + 时间 + 描述 + 状态 + 计划 */
export function expenseSignature(record: ExpenseRecord): string {
  return [
    record.planId,
    record.amountFen,
    record.occurredAt,
    record.description.trim(),
    record.status,
  ].join("|");
}

export interface AddExpenseResult {
  records: ExpenseRecord[];
  record: ExpenseRecord;
  /** 命中幂等/内容去重，未写入新记录 */
  duplicate: boolean;
}

/**
 * 追加一条记录。
 * - 有 `requestId` 且已存在同值记录 → 直接返回已有记录（幂等）
 * - 无 `requestId` 但内容完全相同且创建时间在 10 秒内 → 视为重复
 * - `options.force` 可跳过内容去重（用户明确要记两笔一样的）
 */
export function addExpense(
  records: readonly ExpenseRecord[],
  record: ExpenseRecord,
  options: { force?: boolean } = {},
): AddExpenseResult {
  if (record.requestId) {
    const existing = records.find(
      (candidate) => candidate.requestId === record.requestId && candidate.planId === record.planId,
    );
    if (existing) return { records: [...records], record: existing, duplicate: true };
  }

  if (!options.force) {
    const signature = expenseSignature(record);
    const createdAt = new Date(record.createdAt).getTime();
    const duplicate = records.find((candidate) => {
      if (expenseSignature(candidate) !== signature) return false;
      const existingAt = new Date(candidate.createdAt).getTime();
      return Math.abs(createdAt - existingAt) <= DEDUPE_WINDOW_MS;
    });
    if (duplicate) return { records: [...records], record: duplicate, duplicate: true };
  }

  return { records: [...records, record], record, duplicate: false };
}

export interface UpdateExpensePatch {
  amountFen?: number;
  occurredAt?: IsoDateTime;
  description?: string;
  status?: ExpenseStatus;
  source?: ExpenseSource;
  relatedProductCode?: string;
}

export interface UpdateExpenseResult {
  records: ExpenseRecord[];
  record: ExpenseRecord | null;
}

/** 修改一条记录；找不到返回 `record: null`（不抛错，UI 只需提示"记录已不存在"） */
export function updateExpense(
  records: readonly ExpenseRecord[],
  id: string,
  patch: UpdateExpensePatch,
  now: Date = new Date(),
): UpdateExpenseResult {
  const index = records.findIndex((candidate) => candidate.id === id);
  if (index < 0) return { records: [...records], record: null };

  const current = records[index] as ExpenseRecord;
  const next: ExpenseRecord = { ...current };

  if (patch.amountFen !== undefined) {
    const validation = validateExpenseAmount(patch.amountFen);
    if (!validation.ok) throw new RangeError(`消费记录不合法：${validation.issues.join("；")}`);
    next.amountFen = patch.amountFen;
  }
  if (patch.occurredAt !== undefined) {
    const occurred = new Date(patch.occurredAt);
    if (Number.isNaN(occurred.getTime())) throw new RangeError("发生时间不合法");
    next.occurredAt = occurred.toISOString();
  }
  if (patch.description !== undefined) next.description = patch.description.trim().slice(0, 80);
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.source !== undefined) next.source = patch.source;
  if (patch.relatedProductCode !== undefined) {
    if (patch.relatedProductCode) next.relatedProductCode = patch.relatedProductCode;
    else delete next.relatedProductCode;
  }
  next.updatedAt = now.toISOString();

  const updated = [...records];
  updated[index] = next;
  return { records: updated, record: next };
}

export interface RemoveExpenseResult {
  records: ExpenseRecord[];
  removed: ExpenseRecord | null;
}

export function removeExpense(
  records: readonly ExpenseRecord[],
  id: string,
): RemoveExpenseResult {
  const removed = records.find((candidate) => candidate.id === id) ?? null;
  if (!removed) return { records: [...records], removed: null };
  return { records: records.filter((candidate) => candidate.id !== id), removed };
}

/** 前端「确认为已消费」：把 planned 改成 confirmed */
export function confirmExpense(
  records: readonly ExpenseRecord[],
  id: string,
  now: Date = new Date(),
): UpdateExpenseResult {
  return updateExpense(records, id, { status: "confirmed" }, now);
}

/* ------------------------------------------------------------------ *
 * 查询 / 汇总
 * ------------------------------------------------------------------ */

export interface PeriodScope {
  planId: string;
  startDate: DateKey;
  endDate: DateKey;
  timezone: string;
}

export interface ScopedRecords {
  /** 计入本周期的记录（按其日历时区判定） */
  inPeriod: ExpenseRecord[];
  /** 不计入本周期的记录（日期在周期外） */
  outOfPeriod: ExpenseRecord[];
  /** 时间无法解析、被丢弃的记录 */
  invalid: ExpenseRecord[];
}

/**
 * 按计划 + 周期筛选记录。
 *
 * 「哪一天」由 `dateKeyOfInstant(occurredAt, timezone)` 决定：
 * 例如 `2026-10-31T23:30:00+08:00` 在 `Asia/Shanghai` 下属于 10-31，
 * 而同一时刻在 `UTC` 下是 10-31 15:30，仍然是 10-31；
 * 但 `2026-11-01T03:00:00+08:00` 在 UTC 下会落到 10-31 —— 时区选错就会漏记。
 */
export function scopeRecords(
  records: readonly ExpenseRecord[],
  scope: PeriodScope,
): ScopedRecords {
  const inPeriod: ExpenseRecord[] = [];
  const outOfPeriod: ExpenseRecord[] = [];
  const invalid: ExpenseRecord[] = [];

  for (const record of records) {
    if (record.planId !== scope.planId) continue;

    const day = dateKeyOfInstant(record.occurredAt, scope.timezone);
    if (!day) {
      invalid.push(record);
      continue;
    }
    if (day >= scope.startDate && day <= scope.endDate) inPeriod.push(record);
    else outOfPeriod.push(record);
  }

  return { inPeriod, outOfPeriod, invalid };
}

export function sumAmountFen(records: readonly ExpenseRecord[]): number {
  return records.reduce((total, record) => {
    assertFen(record.amountFen, `记录 ${record.id} 的金额`);
    return total + record.amountFen;
  }, 0);
}

export function sumByStatus(records: readonly ExpenseRecord[], status: ExpenseStatus): number {
  return sumAmountFen(records.filter((record) => record.status === status));
}

/** 按发生时间倒序（同日按创建时间倒序，保证稳定） */
export function sortByOccurredAtDesc(records: readonly ExpenseRecord[]): ExpenseRecord[] {
  return [...records].sort((a, b) => {
    const diff = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
    if (diff !== 0) return diff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/** 读取 storage 时按 id 去重，保留 `updatedAt` 最新的一条 */
export function dedupeById(records: readonly ExpenseRecord[]): ExpenseRecord[] {
  const byId = new Map<string, ExpenseRecord>();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (!existing) {
      byId.set(record.id, record);
      continue;
    }
    const existingAt = new Date(existing.updatedAt).getTime();
    const nextAt = new Date(record.updatedAt).getTime();
    if (Number.isFinite(nextAt) && (!Number.isFinite(existingAt) || nextAt >= existingAt)) {
      byId.set(record.id, record);
    }
  }
  return [...byId.values()];
}
