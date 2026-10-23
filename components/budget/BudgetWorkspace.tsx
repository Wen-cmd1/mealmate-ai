"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { computeBudgetSummary, createBudgetPlan, updateBudgetPlan } from "@/lib/budget/budget-engine";
import {
  addExpense,
  confirmExpense,
  createExpense,
  removeExpense,
  sortByOccurredAtDesc,
  updateExpense,
} from "@/lib/budget/ledger";
import { dateKeyOfInstant } from "@/lib/budget/period";
import type { BudgetState } from "@/lib/budget/storage";
import {
  clearBudgetState,
  deletePlan as deletePlanFromState,
  emptyBudgetState,
  getActivePlan,
  loadBudgetState,
  saveBudgetState,
  setActivePlan as setActivePlanInState,
  upsertPlan,
  withRecords,
  withSettings,
  type BudgetIssue,
  type BudgetSettings,
} from "@/lib/budget/storage";
import type { BudgetPlan, BudgetSummary, DateKey, ExpenseRecord } from "@/lib/budget/types";
import { Notice, NoticeList } from "@/components/ui/Notice";
import { BudgetOverview } from "./BudgetOverview";
import { BudgetRecommend, type RecordDraft } from "./BudgetRecommend";
import { ExpenseComposer, type ExpenseDraft } from "./ExpenseComposer";
import { ExpenseList } from "./ExpenseList";
import { MealImpactPanel } from "./MealImpactPanel";
import { PlanForm, type PlanDraft } from "./PlanForm";

/**
 * 长期预算工作台（状态中枢）。
 *
 * 数据流：localStorage ⇄ 本组件 state → 纯函数（period / ledger / engine）→ 子组件展示。
 * 没有任何服务端写入：换浏览器、清缓存都会丢数据，页面必须如实告知用户。
 *
 * SSR 一致性：首次渲染（服务端与客户端首帧）都渲染「读取中」骨架，
 * 真正访问 localStorage 只发生在 `useEffect` 里，因此不会出现 hydration mismatch。
 *
 * 任务 005 的排序调整：总览 → 单笔影响 → 记账 → 明细 → 推荐 → 计划 → 数据。
 * 原先把「手动记一笔」和 "Meal Impact" 左右并排放在总览下方，
 * 导致"还剩多少"和"记一笔"抢同一屏；现在先看余额，再决定要不要花钱。
 */

const MAX_ISSUES = 6;

function mergeIssues(current: BudgetIssue[], incoming: BudgetIssue[]): BudgetIssue[] {
  const seen = new Set(current.map((issue) => issue.kind));
  const merged = [...current];
  for (const issue of incoming) {
    if (!seen.has(issue.kind)) {
      seen.add(issue.kind);
      merged.push(issue);
    }
  }
  return merged.slice(0, MAX_ISSUES);
}

function recordDay(record: ExpenseRecord, timezone: string): DateKey | null {
  return dateKeyOfInstant(record.occurredAt, timezone);
}

export function BudgetWorkspace() {
  const [state, setState] = useState<BudgetState>(emptyBudgetState);
  const [hydrated, setHydrated] = useState(false);
  const [issues, setIssues] = useState<BudgetIssue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 1. 读本地数据（只在客户端执行一次）
  useEffect(() => {
    const loaded = loadBudgetState();
    setState(loaded.state);
    setIssues(loaded.issues);
    setHydrated(true);
  }, []);

  // 2. 任何变更都回写本地（失败不影响使用，只提示）
  useEffect(() => {
    if (!hydrated) return;
    const result = saveBudgetState(state);
    if (!result.ok && result.issue) {
      setIssues((current) => mergeIssues(current, [result.issue as BudgetIssue]));
    }
  }, [state, hydrated]);

  const plan = getActivePlan(state);

  const summary: BudgetSummary | null = useMemo(() => {
    if (!plan) return null;
    return computeBudgetSummary(plan, state.records);
  }, [plan, state.records]);

  const periodRecords = useMemo(() => {
    if (!plan) return [];
    const inPeriod = state.records.filter((record) => {
      if (record.planId !== plan.id) return false;
      const day = recordDay(record, plan.timezone);
      return day !== null && day >= plan.startDate && day <= plan.endDate;
    });
    return sortByOccurredAtDesc(inPeriod);
  }, [state.records, plan]);

  const handleSavePlan = useCallback(
    (draft: PlanDraft) => {
      setError(null);
      try {
        if (plan) {
          const updated = updateBudgetPlan(plan, {
            name: draft.name,
            totalFen: draft.totalFen,
            reserveFen: draft.reserveFen,
            startDate: draft.startDate,
            endDate: draft.endDate,
            timezone: draft.timezone,
            dailyMealCount: draft.dailyMealCount,
            ...(draft.defaultMealBudgetFen
              ? { defaultMealBudgetFen: draft.defaultMealBudgetFen }
              : { defaultMealBudgetFen: 0 }),
          });
          setState((current) => upsertPlan(current, updated));
          setNotice("预算计划已更新");
        } else {
          const { plan: created } = createBudgetPlan({
            name: draft.name,
            totalFen: draft.totalFen,
            reserveFen: draft.reserveFen,
            periodKind: draft.periodKind,
            anchorDate: draft.startDate,
            startDate: draft.startDate,
            endDate: draft.endDate,
            timezone: draft.timezone,
            dailyMealCount: draft.dailyMealCount,
            defaultMealBudgetFen: draft.defaultMealBudgetFen,
          });
          setState((current) => upsertPlan(current, created));
          setNotice("预算计划已创建");
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "保存预算计划失败");
      }
    },
    [plan],
  );

  const handleDeletePlan = useCallback(() => {
    if (!plan) return;
    const confirmed = window.confirm(
      `删除「${plan.name}」会同时删除该计划下的 ${state.records.filter((r) => r.planId === plan.id).length} 条消费记录，且无法恢复。确认删除？`,
    );
    if (!confirmed) return;
    setState((current) => deletePlanFromState(current, plan.id));
    setNotice("预算计划及其消费记录已删除");
  }, [plan, state.records]);

  const pushRecord = useCallback(
    (record: ExpenseRecord, source: "manual" | "recommendation") => {
      // 去重判断用当前快照算，避免把副作用藏在 setState 的 updater 里（StrictMode 会重复执行）
      const result = addExpense(state.records, record);
      setState((current) => withRecords(current, result.records));
      if (result.duplicate) setNotice("这条记录已经存在，未重复写入");
      else setNotice(source === "manual" ? "已记入账本" : "已记为已消费");
      return !result.duplicate;
    },
    [state.records],
  );

  const handleAddExpense = useCallback(
    (draft: ExpenseDraft): { ok: boolean; message?: string } => {
      if (!plan) return { ok: false, message: "请先创建预算计划" };
      setError(null);
      try {
        const record = createExpense({
          planId: plan.id,
          amountFen: draft.amountFen,
          occurredAt: draft.occurredAt,
          description: draft.description,
          source: "manual",
          status: draft.status,
          requestId: draft.requestId,
        });
        pushRecord(record, "manual");
        return { ok: true };
      } catch (caught) {
        return { ok: false, message: caught instanceof Error ? caught.message : "保存失败" };
      }
    },
    [plan, pushRecord],
  );

  const handleRecordRecommendation = useCallback(
    (draft: RecordDraft): { ok: boolean; message?: string } => {
      if (!plan) return { ok: false, message: "请先创建预算计划" };
      setError(null);
      try {
        const record = createExpense({
          planId: plan.id,
          amountFen: draft.amountFen,
          occurredAt: new Date().toISOString(),
          description: draft.description,
          source: "recommendation",
          status: "confirmed",
          relatedProductCode: draft.relatedProductCode,
          relatedRecommendationType: draft.relatedRecommendationType,
          requestId: draft.requestId,
        });
        pushRecord(record, "recommendation");
        return { ok: true };
      } catch (caught) {
        return { ok: false, message: caught instanceof Error ? caught.message : "写入账本失败" };
      }
    },
    [plan, pushRecord],
  );

  const handleUpdateAmount = useCallback((id: string, amountFen: number): boolean => {
    setError(null);
    try {
      setState((current) => {
        const result = updateExpense(current.records, id, { amountFen });
        if (!result.record) {
          setNotice("这条记录已不存在（可能已被删除）");
          return current;
        }
        return withRecords(current, result.records);
      });
      setNotice("金额已修改");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "修改失败");
      return false;
    }
  }, []);

  const handleRemove = useCallback((id: string) => {
    setState((current) => {
      const result = removeExpense(current.records, id);
      if (!result.removed) return current;
      return withRecords(current, result.records);
    });
    setNotice("记录已删除");
  }, []);

  const handleConfirmRecord = useCallback((id: string) => {
    setState((current) => {
      const result = confirmExpense(current.records, id);
      if (!result.record) return current;
      return withRecords(current, result.records);
    });
    setNotice("已确认为已消费，预算已扣减");
  }, []);

  const handleSettings = useCallback((patch: Partial<BudgetSettings>) => {
    setState((current) => withSettings(current, patch));
  }, []);

  const handleClearAll = useCallback(() => {
    const confirmed = window.confirm(
      "清除本地预算数据会删除所有预算计划与消费记录，且无法恢复。确认清除？",
    );
    if (!confirmed) return;
    const result = clearBudgetState();
    setState(emptyBudgetState());
    setIssues(result.ok ? [] : result.issue ? [result.issue] : []);
    setNotice(result.ok ? "本地预算数据已清除" : "本地存储不可用，已重置当前页面数据");
  }, []);

  if (!hydrated) {
    return (
      <div className="space-y-4" aria-live="polite">
        <div className="skeleton h-56" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="skeleton h-64" />
          <div className="skeleton h-64" />
        </div>
        <p className="text-center text-[11px] text-ink-400">正在读取本地预算数据…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 全局提示区：错误 / 提示 / 数据问题各自分组 */}
      {issues.length > 0 ? (
        <NoticeList
          tone="warn"
          title="本地数据提示"
          items={issues.map((issue) => issue.message)}
        />
      ) : null}

      {error ? (
        <Notice
          tone="error"
          role="alert"
          title="操作没有成功"
          action={
            <button
              type="button"
              onClick={() => setError(null)}
              className="btn btn-ghost px-3 py-1.5 text-[12px]"
            >
              知道了
            </button>
          }
        >
          {error}
        </Notice>
      ) : null}

      {notice ? (
        <Notice
          tone="good"
          role="status"
          title={notice}
          action={
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-[11px] text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline"
            >
              关闭
            </button>
          }
        />
      ) : null}

      {state.plans.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-600">
          <span>当前计划</span>
          <select
            aria-label="切换预算计划"
            value={state.activePlanId ?? ""}
            onChange={(event) => setState((current) => setActivePlanInState(current, event.target.value))}
            className="field w-auto py-1.5 text-[12px]"
          >
            {state.plans.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}（{candidate.startDate} ~ {candidate.endDate}）
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {!plan || !summary ? (
        <>
          <section className="surface p-5 sm:p-6">
            <p className="eyebrow">第一步</p>
            <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-ink-900">
              先设一个周期预算
            </h2>
            <p className="mt-1.5 max-w-2xl text-[12px] leading-6 text-ink-600">
              每周 / 每月 / 自定义一个总额，就可以开始记账、看日均余额，并让推荐按「剩余预算」出方案。
              数据只存在当前浏览器里，随时可以改或删。
            </p>
            <div className="mt-3 grid gap-1.5 text-[11px] leading-5 text-ink-500 sm:grid-cols-3">
              <span>① 填总额与周期</span>
              <span>② 记下每笔餐费（可以只记"计划中"）</span>
              <span>③ 看剩余天数与该吃多少钱一顿</span>
            </div>
          </section>
          <PlanForm plan={null} onSave={handleSavePlan} onError={setError} />
        </>
      ) : (
        <>
          <BudgetOverview plan={plan} summary={summary} />

          <div className="grid gap-4 lg:grid-cols-2">
            <MealImpactPanel summary={summary} />
            <ExpenseComposer
              defaultAmountFen={summary.dailyAllowanceFen ?? undefined}
              onError={setError}
              onSubmit={handleAddExpense}
            />
          </div>

          <ExpenseList
            records={periodRecords}
            timezone={plan.timezone}
            outOfPeriodCount={summary.outOfPeriodCount}
            onUpdateAmount={handleUpdateAmount}
            onRemove={handleRemove}
            onConfirm={handleConfirmRecord}
            onError={setError}
          />

          <BudgetRecommend
            plan={plan}
            summary={summary}
            settings={state.settings}
            onSettingsChange={handleSettings}
            onRecord={handleRecordRecommendation}
            onError={setError}
          />

          <PlanForm plan={plan} onSave={handleSavePlan} onDelete={handleDeletePlan} onError={setError} />

          <section className="surface border-red-100 p-5">
            <h2 className="text-[13px] font-semibold text-ink-900">本地数据</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-ink-500">
              预算计划与消费记录只保存在当前浏览器的 localStorage 中，没有云端同步、没有跨设备同步，
              也不会自动读银行账单。清理浏览器数据、换设备或使用隐私模式都可能造成记录丢失。
            </p>
            <button
              type="button"
              onClick={handleClearAll}
              className="mt-3 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-[12px] font-medium text-red-600 transition hover:bg-red-50"
            >
              清除本地预算数据
            </button>
          </section>
        </>
      )}
    </div>
  );
}
