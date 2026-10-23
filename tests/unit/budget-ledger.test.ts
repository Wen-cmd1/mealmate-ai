import { beforeEach, describe, expect, it } from "vitest";

import {
  addExpense,
  confirmExpense,
  createExpense,
  dedupeById,
  removeExpense,
  scopeRecords,
  sortByOccurredAtDesc,
  sumByStatus,
  updateExpense,
  validateExpenseAmount,
  type CreateExpenseInput,
} from "@/lib/budget/ledger";
import type { ExpenseRecord } from "@/lib/budget/types";

/** 任务 003：账本（计划 / 已确认隔离、幂等、修改删除、周期归属） */

let seq = 0;
const idFactory = () => `rec-${++seq}`;
const NOW = new Date("2026-10-21T04:00:00.000Z");

beforeEach(() => {
  seq = 0;
});

function make(overrides: Partial<CreateExpenseInput> = {}): ExpenseRecord {
  return createExpense({
    planId: "plan-1",
    amountFen: 2450,
    occurredAt: "2026-10-20T04:30:00.000Z",
    description: "午餐",
    status: "confirmed",
    now: NOW,
    idFactory,
    ...overrides,
  });
}

describe("金额校验", () => {
  it("拒绝负数、小数与超大金额", () => {
    expect(validateExpenseAmount(2450).ok).toBe(true);
    expect(validateExpenseAmount(0).ok).toBe(true);
    expect(validateExpenseAmount(-1).ok).toBe(false);
    expect(validateExpenseAmount(24.5).ok).toBe(false);
    expect(validateExpenseAmount(Number.NaN).ok).toBe(false);
    expect(validateExpenseAmount(100_000_01).ok).toBe(false);
  });

  it("createExpense 遇到非法金额直接抛错（不静默写脏数据）", () => {
    expect(() => make({ amountFen: -100 })).toThrow(/金额/);
    expect(() => make({ amountFen: 12.5 })).toThrow(/整数/);
    expect(() => make({ occurredAt: "not-a-date" })).toThrow(/时间/);
  });

  it("默认状态是 confirmed，默认来源是 manual", () => {
    const record = make();
    expect(record.status).toBe("confirmed");
    expect(record.source).toBe("manual");
    expect(record.createdAt).toBe(NOW.toISOString());
  });
});

describe("计划消费与已确认消费隔离", () => {
  it("sumByStatus 只统计对应状态", () => {
    const records = [
      make({ amountFen: 1000, status: "confirmed" }),
      make({ amountFen: 2000, status: "confirmed" }),
      make({ amountFen: 5000, status: "planned" }),
    ];
    expect(sumByStatus(records, "confirmed")).toBe(3000);
    expect(sumByStatus(records, "planned")).toBe(5000);
  });

  it("planned 改成 confirmed 后进入已消费统计", () => {
    const planned = make({ amountFen: 3000, status: "planned" });
    const confirmed = confirmExpense([planned], planned.id, NOW);
    expect(confirmed.record?.status).toBe("confirmed");
    expect(sumByStatus(confirmed.records, "confirmed")).toBe(3000);
    expect(sumByStatus(confirmed.records, "planned")).toBe(0);
  });
});

describe("重复提交", () => {
  it("同一 requestId 幂等：第二次不写入", () => {
    const first = make({ requestId: "req-abc" });
    const added = addExpense([], first);
    expect(added.duplicate).toBe(false);

    const retry = make({ requestId: "req-abc" });
    const again = addExpense(added.records, retry);
    expect(again.duplicate).toBe(true);
    expect(again.records).toHaveLength(1);
    expect(again.record.id).toBe(first.id);
  });

  it("没有 requestId 时，10 秒内内容完全相同视为重复", () => {
    const first = make();
    const added = addExpense([], first);

    const sameContent = make({
      occurredAt: first.occurredAt,
      now: new Date(NOW.getTime() + 5_000),
    });
    const again = addExpense(added.records, sameContent);
    expect(again.duplicate).toBe(true);
    expect(again.records).toHaveLength(1);
  });

  it("超过 10 秒的相同内容算两笔（用户确实又吃了一顿）", () => {
    const first = make();
    const added = addExpense([], first);

    const later = make({
      occurredAt: first.occurredAt,
      now: new Date(NOW.getTime() + 60_000),
    });
    const again = addExpense(added.records, later);
    expect(again.duplicate).toBe(false);
    expect(again.records).toHaveLength(2);
  });

  it("force 可以跳过内容去重", () => {
    const first = make();
    const added = addExpense([], first);
    const again = addExpense(added.records, make(), { force: true });
    expect(again.duplicate).toBe(false);
    expect(again.records).toHaveLength(2);
  });

  it("不同计划下相同的 requestId 不会互相吞掉", () => {
    const a = make({ planId: "plan-A", requestId: "req-x" });
    const b = make({ planId: "plan-B", requestId: "req-x" });
    const added = addExpense(addExpense([], a).records, b);
    expect(added.records).toHaveLength(2);
  });
});

describe("修改与删除", () => {
  it("改金额会刷新 updatedAt 并保留 createdAt", () => {
    const record = make();
    const result = updateExpense([record], record.id, { amountFen: 3000 }, new Date("2026-10-22T00:00:00Z"));
    expect(result.record?.amountFen).toBe(3000);
    expect(result.record?.createdAt).toBe(record.createdAt);
    expect(result.record?.updatedAt).toBe("2026-10-22T00:00:00.000Z");
  });

  it("改成非法金额抛错", () => {
    const record = make();
    expect(() => updateExpense([record], record.id, { amountFen: -5 })).toThrow(/金额/);
  });

  it("修改不存在的记录返回 null 而不是抛错", () => {
    const result = updateExpense([], "missing", { amountFen: 100 });
    expect(result.record).toBeNull();
    expect(result.records).toEqual([]);
  });

  it("删除记录", () => {
    const record = make();
    const result = removeExpense([record], record.id);
    expect(result.removed?.id).toBe(record.id);
    expect(result.records).toHaveLength(0);
    expect(removeExpense([], "missing").removed).toBeNull();
  });
});

describe("周期归属（按计划时区判定「哪一天」）", () => {
  const scope = {
    planId: "plan-1",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    timezone: "Asia/Shanghai",
  };

  it("东八区 11-01 凌晨的记录不属于 10 月周期", () => {
    const record = make({ occurredAt: "2026-10-31T16:30:00.000Z" }); // = 11-01 00:30 +08:00
    const result = scopeRecords([record], scope);
    expect(result.inPeriod).toHaveLength(0);
    expect(result.outOfPeriod).toHaveLength(1);
  });

  it("同一时刻按 UTC 判定会落回 10-31", () => {
    const record = make({ occurredAt: "2026-10-31T16:30:00.000Z" });
    const result = scopeRecords([record], { ...scope, timezone: "UTC" });
    expect(result.inPeriod).toHaveLength(1);
  });

  it("其它计划的记录完全不计入", () => {
    const record = make({ planId: "plan-2" });
    const result = scopeRecords([record], scope);
    expect(result.inPeriod).toHaveLength(0);
    expect(result.outOfPeriod).toHaveLength(0);
  });

  it("时间不可解析的记录单独归类，不混进周期外", () => {
    const record = make();
    const broken = { ...record, id: "broken", occurredAt: "garbage" };
    const result = scopeRecords([broken], scope);
    expect(result.invalid).toHaveLength(1);
    expect(result.outOfPeriod).toHaveLength(0);
  });
});

describe("排序与去重", () => {
  it("按发生时间倒序，同日按创建时间倒序", () => {
    const older = make({ occurredAt: "2026-10-19T04:00:00.000Z" });
    const newer = make({ occurredAt: "2026-10-21T04:00:00.000Z" });
    const sorted = sortByOccurredAtDesc([older, newer]);
    expect(sorted[0].id).toBe(newer.id);
    expect(sorted[1].id).toBe(older.id);
  });

  it("同 id 保留 updatedAt 最新的一条", () => {
    const base = make();
    const stale = { ...base, amountFen: 1000, updatedAt: "2026-10-21T00:00:00.000Z" };
    const fresh = { ...base, amountFen: 2000, updatedAt: "2026-10-21T06:00:00.000Z" };
    const deduped = dedupeById([stale, fresh]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].amountFen).toBe(2000);
  });
});
