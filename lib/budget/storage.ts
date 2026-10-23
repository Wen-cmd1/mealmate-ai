/**
 * 本地持久化（localStorage）。
 *
 * 本阶段**没有后端、没有账号、没有云同步**：数据只存在当前浏览器的 localStorage 里，
 * 换设备、换浏览器、清理站点数据都会丢。页面必须把这句话原样告诉用户，
 * 不能宣称「自动同步」。
 *
 * 设计要点：
 * 1. **带版本号**：`{ version: 1, ... }`，读到不认识的版本就拒绝解析（宁可空账本，也不要算错钱）。
 * 2. **逐条校验**：一条计划/记录坏了只丢那一条，并生成 issue 让 UI 告诉用户，而不是整份重置。
 * 3. **禁用存储可用**：隐私模式 / 站点数据被禁时，`localStorage` 访问会抛异常，
 *    这里全部包 try/catch，退化为「内存态可用、刷新即丢」并明确提示。
 * 4. **SSR 安全**：所有 `window` 访问都在函数内部且判空，模块加载时不做任何 IO。
 * 5. **不写 token**：本模块只认 `BudgetPlan / ExpenseRecord / BudgetSettings`，
 *    结构上没有地方放凭证，测试里也有一条断言守着。
 */

import { dedupeById } from "./ledger";
import { budgetEnvelopeSchema, budgetSettingsSchema, parseStoredPlan, parseStoredRecord } from "./schema";
import type { BudgetPlan, ExpenseRecord } from "./types";

export const BUDGET_STORE_KEY = "mealmate.budget.v1";
export const BUDGET_STORE_VERSION = 1;

export interface BudgetSettings {
  city: string;
  keyword: string;
  storeCode: string;
  storeName?: string;
}

export interface BudgetState {
  plans: BudgetPlan[];
  records: ExpenseRecord[];
  activePlanId: string | null;
  settings: BudgetSettings;
}

export type BudgetIssueKind =
  | "corrupt_json"
  | "unsupported_version"
  | "invalid_plan"
  | "invalid_record"
  | "duplicate_plan_id"
  | "dangling_record"
  | "storage_unavailable"
  | "read_failed"
  | "write_failed"
  | "clear_failed";

export interface BudgetIssue {
  kind: BudgetIssueKind;
  message: string;
}

export interface LoadResult {
  state: BudgetState;
  issues: BudgetIssue[];
  /** 是否成功读到了一份可用的数据（空账本也算成功；读失败/损坏为 false） */
  ok: boolean;
}

export const DEFAULT_SETTINGS: BudgetSettings = {
  city: "广州市",
  keyword: "天河",
  storeCode: "",
};

export function emptyBudgetState(): BudgetState {
  return { plans: [], records: [], activePlanId: null, settings: { ...DEFAULT_SETTINGS } };
}

/** 最小存储接口，便于单测注入假实现（不需要 jsdom） */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/* ------------------------------------------------------------------ *
 * 解析 / 序列化
 * ------------------------------------------------------------------ */

export function parseBudgetStore(raw: string | null | undefined): LoadResult {
  const issues: BudgetIssue[] = [];

  if (raw === null || raw === undefined || raw.trim() === "") {
    return { state: emptyBudgetState(), issues, ok: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    issues.push({
      kind: "corrupt_json",
      message: "本地预算数据不是合法 JSON（可能被手动修改或写入中断），已忽略这份数据",
    });
    return { state: emptyBudgetState(), issues, ok: false };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    issues.push({ kind: "corrupt_json", message: "本地预算数据结构异常，已忽略" });
    return { state: emptyBudgetState(), issues, ok: false };
  }

  const envelope = budgetEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    issues.push({ kind: "corrupt_json", message: "本地预算数据缺少必要字段，已忽略" });
    return { state: emptyBudgetState(), issues, ok: false };
  }

  if (envelope.data.version !== BUDGET_STORE_VERSION) {
    issues.push({
      kind: "unsupported_version",
      message:
        envelope.data.version > BUDGET_STORE_VERSION
          ? `本地数据版本（v${envelope.data.version}）高于当前程序支持的 v${BUDGET_STORE_VERSION}，为避免算错金额已停止读取`
          : `本地数据版本（v${envelope.data.version}）已过时，无法自动迁移，已停止读取`,
    });
    return { state: emptyBudgetState(), issues, ok: false };
  }

  const plans: BudgetPlan[] = [];
  const seenPlanIds = new Set<string>();
  for (const item of envelope.data.plans) {
    const plan = parseStoredPlan(item);
    if (!plan) {
      issues.push({ kind: "invalid_plan", message: "有 1 条预算计划格式不合法，已跳过" });
      continue;
    }
    if (seenPlanIds.has(plan.id)) {
      issues.push({ kind: "duplicate_plan_id", message: `预算计划 ${plan.id} 重复，已保留第一条` });
      continue;
    }
    seenPlanIds.add(plan.id);
    plans.push(plan);
  }

  const records: ExpenseRecord[] = [];
  let dangling = 0;
  for (const item of envelope.data.records) {
    const record = parseStoredRecord(item);
    if (!record) {
      issues.push({ kind: "invalid_record", message: "有 1 条消费记录格式不合法，已跳过" });
      continue;
    }
    if (!seenPlanIds.has(record.planId)) {
      dangling += 1;
      continue;
    }
    records.push(record);
  }
  if (dangling > 0) {
    issues.push({
      kind: "dangling_record",
      message: `有 ${dangling} 条消费记录指向不存在的预算计划，已跳过`,
    });
  }

  const settingsParsed = budgetSettingsSchema.safeParse(
    envelope.data.settings ?? DEFAULT_SETTINGS,
  );
  const settings: BudgetSettings = settingsParsed.success
    ? (settingsParsed.data as BudgetSettings)
    : { ...DEFAULT_SETTINGS };

  const dedupedRecords = dedupeById(records);
  if (dedupedRecords.length !== records.length) {
    issues.push({
      kind: "invalid_record",
      message: `有 ${records.length - dedupedRecords.length} 条重复 id 的消费记录，已按更新时间保留最新一条`,
    });
  }

  const activeFromStore = envelope.data.activePlanId ?? null;
  const activePlanId =
    activeFromStore && plans.some((plan) => plan.id === activeFromStore)
      ? activeFromStore
      : (plans[0]?.id ?? null);

  return {
    state: { plans, records: dedupedRecords, activePlanId, settings },
    issues,
    ok: true,
  };
}

export function serializeBudgetStore(state: BudgetState, now: Date = new Date()): string {
  return JSON.stringify({
    version: BUDGET_STORE_VERSION,
    savedAt: now.toISOString(),
    activePlanId: state.activePlanId,
    plans: state.plans,
    records: state.records,
    settings: state.settings,
  });
}

/* ------------------------------------------------------------------ *
 * 浏览器存储
 * ------------------------------------------------------------------ */

/** 取一个可用的 localStorage；SSR、隐私模式、被禁用时返回 null */
export function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    if (!storage) return null;
    const probeKey = "__mealmate_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

export function loadBudgetState(storage: StorageLike | null = getBrowserStorage()): LoadResult {
  if (!storage) {
    return {
      state: emptyBudgetState(),
      issues: [
        {
          kind: "storage_unavailable",
          message: "当前浏览器禁用了本地存储（或处于隐私模式），本次记录只保存在内存中，刷新后会丢失",
        },
      ],
      ok: false,
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(BUDGET_STORE_KEY);
  } catch {
    return {
      state: emptyBudgetState(),
      issues: [{ kind: "read_failed", message: "读取本地预算数据失败，已从空账本开始" }],
      ok: false,
    };
  }

  return parseBudgetStore(raw);
}

export interface SaveResult {
  ok: boolean;
  issue?: BudgetIssue;
}

export function saveBudgetState(
  state: BudgetState,
  storage: StorageLike | null = getBrowserStorage(),
): SaveResult {
  if (!storage) {
    return {
      ok: false,
      issue: {
        kind: "storage_unavailable",
        message: "浏览器禁用了本地存储，本次修改无法持久化（刷新后会丢失）",
      },
    };
  }
  try {
    storage.setItem(BUDGET_STORE_KEY, serializeBudgetStore(state));
    return { ok: true };
  } catch {
    // 配额超限 / 被策略拦截
    return {
      ok: false,
      issue: { kind: "write_failed", message: "写入本地预算数据失败（可能是存储空间已满）" },
    };
  }
}

export function clearBudgetState(
  storage: StorageLike | null = getBrowserStorage(),
): SaveResult {
  if (!storage) {
    return {
      ok: false,
      issue: { kind: "storage_unavailable", message: "浏览器禁用了本地存储，无需清理" },
    };
  }
  try {
    storage.removeItem(BUDGET_STORE_KEY);
    return { ok: true };
  } catch {
    return { ok: false, issue: { kind: "clear_failed", message: "清除本地预算数据失败" } };
  }
}

/* ------------------------------------------------------------------ *
 * 纯状态变换（不碰存储，便于单测与乐观更新）
 * ------------------------------------------------------------------ */

export function getActivePlan(state: BudgetState): BudgetPlan | null {
  if (!state.activePlanId) return null;
  return state.plans.find((plan) => plan.id === state.activePlanId) ?? null;
}

export function upsertPlan(state: BudgetState, plan: BudgetPlan): BudgetState {
  const exists = state.plans.some((candidate) => candidate.id === plan.id);
  const plans = exists
    ? state.plans.map((candidate) => (candidate.id === plan.id ? plan : candidate))
    : [...state.plans, plan];

  return {
    ...state,
    plans,
    activePlanId: state.activePlanId ?? plan.id,
  };
}

/** 删除计划时**级联删除**其消费记录（否则记录会成为孤儿，永远算不进任何周期） */
export function deletePlan(state: BudgetState, planId: string): BudgetState {
  const plans = state.plans.filter((plan) => plan.id !== planId);
  const records = state.records.filter((record) => record.planId !== planId);
  const activePlanId =
    state.activePlanId === planId ? (plans[0]?.id ?? null) : state.activePlanId;
  return { ...state, plans, records, activePlanId };
}

export function setActivePlan(state: BudgetState, planId: string): BudgetState {
  if (!state.plans.some((plan) => plan.id === planId)) return state;
  return { ...state, activePlanId: planId };
}

export function withRecords(state: BudgetState, records: ExpenseRecord[]): BudgetState {
  return { ...state, records };
}

export function withSettings(state: BudgetState, settings: Partial<BudgetSettings>): BudgetState {
  return { ...state, settings: { ...state.settings, ...settings } };
}
