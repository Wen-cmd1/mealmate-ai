import { describe, expect, it } from "vitest";

import { createExpense } from "@/lib/budget/ledger";
import { parseAmountInput } from "@/lib/budget/schema";
import { createBudgetPlan } from "@/lib/budget/budget-engine";
import {
  BUDGET_STORE_KEY,
  BUDGET_STORE_VERSION,
  clearBudgetState,
  emptyBudgetState,
  loadBudgetState,
  parseBudgetStore,
  saveBudgetState,
  serializeBudgetStore,
  upsertPlan,
  deletePlan,
  withRecords,
  type BudgetState,
  type StorageLike,
} from "@/lib/budget/storage";

/**
 * 任务 003：本地存储（版本号、损坏处理、逐条容错、禁用存储）
 *
 * 这里用假的 `StorageLike`，不依赖 jsdom，也不会污染真实浏览器存储。
 */

const NOW = new Date("2026-10-21T04:00:00.000Z");

function makePlan(id = "plan-1") {
  const { plan } = createBudgetPlan({
    name: "10 月餐饮",
    totalFen: 90_000,
    periodKind: "month",
    anchorDate: "2026-10-15",
    timezone: "Asia/Shanghai",
    now: NOW,
    idFactory: () => id,
  });
  return plan;
}

function makeRecord(planId = "plan-1", id = "rec-1") {
  return createExpense({
    planId,
    amountFen: 2_450,
    occurredAt: "2026-10-20T04:30:00.000Z",
    description: "午餐",
    now: NOW,
    idFactory: () => id,
  });
}

function makeState(): BudgetState {
  return withRecords(
    upsertPlan(emptyBudgetState(), makePlan()),
    [makeRecord()],
  );
}

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? (data[key] as string) : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

describe("序列化往返", () => {
  it("写入后读回内容一致", () => {
    const state = makeState();
    const parsed = parseBudgetStore(serializeBudgetStore(state, NOW));
    expect(parsed.ok).toBe(true);
    expect(parsed.issues).toEqual([]);
    expect(parsed.state.plans).toHaveLength(1);
    expect(parsed.state.records).toHaveLength(1);
    expect(parsed.state.activePlanId).toBe("plan-1");
    expect(parsed.state.records[0]?.amountFen).toBe(2_450);
  });

  it("带版本号，且序列化结果不含任何凭证字段", () => {
    const raw = serializeBudgetStore(makeState(), NOW);
    const envelope = JSON.parse(raw) as Record<string, unknown>;
    expect(envelope.version).toBe(BUDGET_STORE_VERSION);

    const lowered = raw.toLowerCase();
    for (const banned of ["token", "authorization", "bearer", "password", "secret"]) {
      expect(lowered).not.toContain(banned);
    }
  });

  it("空字符串按「没有数据」处理，不算损坏", () => {
    expect(parseBudgetStore("").ok).toBe(true);
    expect(parseBudgetStore(null).state.plans).toEqual([]);
    expect(parseBudgetStore(undefined).ok).toBe(true);
  });
});

describe("损坏数据", () => {
  it("非法 JSON：返回空账本 + 明确 issue，不抛错", () => {
    const result = parseBudgetStore("{not-json");
    expect(result.ok).toBe(false);
    expect(result.state.plans).toEqual([]);
    expect(result.issues[0]?.kind).toBe("corrupt_json");
  });

  it("结构不是对象或缺少必要字段", () => {
    expect(parseBudgetStore("[]").issues[0]?.kind).toBe("corrupt_json");
    expect(parseBudgetStore('"hello"').issues[0]?.kind).toBe("corrupt_json");
    expect(parseBudgetStore("{}").issues[0]?.kind).toBe("corrupt_json");
  });

  it("版本不匹配：拒绝解析，宁可空账本也不算错钱", () => {
    const future = parseBudgetStore(JSON.stringify({ version: 99, plans: [], records: [] }));
    expect(future.ok).toBe(false);
    expect(future.issues[0]?.kind).toBe("unsupported_version");

    const past = parseBudgetStore(JSON.stringify({ version: 0, plans: [], records: [] }));
    expect(past.issues[0]?.kind).toBe("unsupported_version");
  });

  it("单条计划坏了只丢那一条", () => {
    const good = makePlan();
    const raw = JSON.stringify({
      version: BUDGET_STORE_VERSION,
      plans: [good, { id: "broken" }],
      records: [],
      activePlanId: null,
    });
    const result = parseBudgetStore(raw);
    expect(result.ok).toBe(true);
    expect(result.state.plans).toHaveLength(1);
    expect(result.issues.some((issue) => issue.kind === "invalid_plan")).toBe(true);
  });

  it("单条记录坏了只丢那一条", () => {
    const good = makeRecord();
    const raw = JSON.stringify({
      version: BUDGET_STORE_VERSION,
      plans: [makePlan()],
      records: [good, { id: "broken", amountFen: "很多钱" }],
    });
    const result = parseBudgetStore(raw);
    expect(result.state.records).toHaveLength(1);
    expect(result.issues.some((issue) => issue.kind === "invalid_record")).toBe(true);
  });

  it("记录金额是负数 / 时间不可解析 → 丢弃", () => {
    const good = makeRecord();
    const raw = JSON.stringify({
      version: BUDGET_STORE_VERSION,
      plans: [makePlan()],
      records: [
        good,
        { ...good, id: "neg", amountFen: -100 },
        { ...good, id: "bad-time", occurredAt: "yesterday" },
      ],
    });
    const result = parseBudgetStore(raw);
    expect(result.state.records.map((r) => r.id)).toEqual(["rec-1"]);
  });

  it("重复计划 id 只保留第一条", () => {
    const plan = makePlan();
    const raw = JSON.stringify({
      version: BUDGET_STORE_VERSION,
      plans: [plan, { ...plan, name: "重复的" }],
      records: [],
    });
    const result = parseBudgetStore(raw);
    expect(result.state.plans).toHaveLength(1);
    expect(result.state.plans[0]?.name).toBe("10 月餐饮");
    expect(result.issues.some((issue) => issue.kind === "duplicate_plan_id")).toBe(true);
  });

  it("重复记录 id 保留 updatedAt 最新的一条", () => {
    const record = makeRecord();
    const raw = JSON.stringify({
      version: BUDGET_STORE_VERSION,
      plans: [makePlan()],
      records: [
        { ...record, amountFen: 1_000, updatedAt: "2026-10-21T00:00:00.000Z" },
        { ...record, amountFen: 2_000, updatedAt: "2026-10-21T08:00:00.000Z" },
      ],
    });
    const result = parseBudgetStore(raw);
    expect(result.state.records).toHaveLength(1);
    expect(result.state.records[0]?.amountFen).toBe(2_000);
  });

  it("指向不存在计划的记录被跳过并提示", () => {
    const raw = JSON.stringify({
      version: BUDGET_STORE_VERSION,
      plans: [makePlan()],
      records: [makeRecord("plan-ghost", "rec-ghost")],
    });
    const result = parseBudgetStore(raw);
    expect(result.state.records).toHaveLength(0);
    expect(result.issues.some((issue) => issue.kind === "dangling_record")).toBe(true);
  });

  it("activePlanId 失效时回落到第一个计划", () => {
    const raw = JSON.stringify({
      version: BUDGET_STORE_VERSION,
      plans: [makePlan()],
      records: [],
      activePlanId: "plan-deleted",
    });
    expect(parseBudgetStore(raw).state.activePlanId).toBe("plan-1");
  });

  it("settings 不合法时回落到默认值", () => {
    const raw = JSON.stringify({
      version: BUDGET_STORE_VERSION,
      plans: [],
      records: [],
      settings: { city: 123 },
    });
    const result = parseBudgetStore(raw);
    expect(result.state.settings.city).toBe("广州市");
    expect(result.state.settings.keyword).toBe("天河");
  });
});

describe("浏览器存储读写", () => {
  it("正常读写与清除", () => {
    const storage = fakeStorage();
    expect(saveBudgetState(makeState(), storage).ok).toBe(true);
    expect(storage.data[BUDGET_STORE_KEY]).toBeTruthy();

    const loaded = loadBudgetState(storage);
    expect(loaded.ok).toBe(true);
    expect(loaded.state.records).toHaveLength(1);

    expect(clearBudgetState(storage).ok).toBe(true);
    expect(storage.getItem(BUDGET_STORE_KEY)).toBeNull();
  });

  it("存储不可用（隐私模式 / SSR）：退化为内存态并提示", () => {
    const loaded = loadBudgetState(null);
    expect(loaded.ok).toBe(false);
    expect(loaded.issues[0]?.kind).toBe("storage_unavailable");
    expect(loaded.state.plans).toEqual([]);

    const saved = saveBudgetState(makeState(), null);
    expect(saved.ok).toBe(false);
    expect(saved.issue?.kind).toBe("storage_unavailable");
  });

  it("写入抛错（配额满）时不崩溃", () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    const result = saveBudgetState(makeState(), storage);
    expect(result.ok).toBe(false);
    expect(result.issue?.kind).toBe("write_failed");
  });

  it("读取抛错时返回空账本 + read_failed", () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const result = loadBudgetState(storage);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.kind).toBe("read_failed");
  });
});

describe("状态变换", () => {
  it("删除计划会级联删除其记录，并切换 activePlanId", () => {
    const state = makeState();
    const after = deletePlan(state, "plan-1");
    expect(after.plans).toHaveLength(0);
    expect(after.records).toHaveLength(0);
    expect(after.activePlanId).toBeNull();
  });

  it("upsert 已存在的计划不会重复添加", () => {
    const state = makeState();
    const after = upsertPlan(state, { ...makePlan(), name: "改名了" });
    expect(after.plans).toHaveLength(1);
    expect(after.plans[0]?.name).toBe("改名了");
  });
});

describe("金额输入解析（元 → 分）", () => {
  it("常见输入", () => {
    expect(parseAmountInput("25").fen).toBe(2_500);
    expect(parseAmountInput("25.5").fen).toBe(2_550);
    expect(parseAmountInput("25.50").fen).toBe(2_550);
    expect(parseAmountInput("0.01").fen).toBe(1);
    expect(parseAmountInput("").fen).toBe(0);
    expect(parseAmountInput(" 12.30 ").fen).toBe(1_230);
  });

  it("拒绝负数、科学计数法、带符号与超范围", () => {
    expect(parseAmountInput("-5").ok).toBe(false);
    expect(parseAmountInput("1e3").ok).toBe(false);
    expect(parseAmountInput("¥25").ok).toBe(false);
    expect(parseAmountInput("abc").ok).toBe(false);
    expect(parseAmountInput("999999999").ok).toBe(false);
  });

  it("三位小数按四舍五入到分", () => {
    expect(parseAmountInput("1.005").fen).toBe(101);
    expect(parseAmountInput("1.004").fen).toBe(100);
  });
});
