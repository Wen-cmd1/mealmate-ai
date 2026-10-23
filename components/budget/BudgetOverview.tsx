"use client";

import { suggestMealBudget } from "@/lib/budget/budget-engine";
import { formatFen, formatFenSigned } from "@/lib/budget/money";
import { formatPeriodLabel } from "@/lib/budget/period";
import { BUDGET_HEALTH_LABELS, type BudgetPlan, type BudgetSummary } from "@/lib/budget/types";
import { ImpactSummary } from "./ImpactSummary";

/**
 * 本期预算总览（纯展示 + 一个派生建议值）。
 *
 * 所有金额都来自 `computeBudgetSummary`，这里不重复计算 ——
 * 一旦在这一层做二次运算，就会出现「总览和明细对不上」的经典问题。
 * 唯一的派生值是"今日建议单餐预算"，它直接调用 `suggestMealBudget`，
 * 与预算页推荐区用的是同一个函数，不另写一套。
 *
 * 任务 005 §6 的信息层级：**剩余预算 > 今日建议 > 剩余天数 > 消费进度**，
 * 其余数字（总额、已花、预留、计划中）收进下方明细，不再平铺 7 个格子。
 */

const HEALTH_STYLE: Record<BudgetSummary["health"], string> = {
  ok: "border-mint-100 bg-mint-50 text-mint-600",
  ahead: "border-amber-200 bg-amber-50 text-amber-800",
  tight: "border-amber-200 bg-amber-50 text-amber-800",
  over: "border-red-200 bg-red-50 text-red-700",
  ended: "border-line bg-cream-deep text-ink-500",
  empty: "border-line bg-cream-deep text-ink-500",
};

function Tile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "bad" | "brand" | "muted";
}) {
  const valueClass =
    tone === "bad"
      ? "text-red-600"
      : tone === "brand"
        ? "text-brand-700"
        : tone === "muted"
          ? "text-ink-500"
          : "text-ink-900";
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[11px] leading-4 text-ink-400">{label}</p>
      <p className={`num mt-0.5 text-[18px] font-semibold leading-tight ${valueClass}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] leading-3 text-ink-400">{hint}</p> : null}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] text-ink-400">{label}</dt>
      <dd className="num text-[12px] font-medium text-ink-700">{value}</dd>
    </div>
  );
}

export function BudgetOverview({ plan, summary }: { plan: BudgetPlan; summary: BudgetSummary }) {
  const spentPercent = Math.round(summary.consumedRatio * 100);
  const timePercent = Math.min(100, Math.round(summary.progressRatio * 100));

  const suggestion = suggestMealBudget(summary, {
    dailyMealCount: plan.dailyMealCount,
    defaultMealBudgetFen: plan.defaultMealBudgetFen,
  });

  return (
    <section className="surface overflow-hidden">
      {/* 英雄区：本周期还剩多少 */}
      <div className="bg-gradient-to-br from-brand-50 via-white to-cream p-5 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="eyebrow">当前周期</p>
            <h2 className="mt-1 truncate text-[17px] font-semibold tracking-tight text-ink-900">
              {plan.name}
            </h2>
            <p className="mt-0.5 text-[11px] leading-4 text-ink-500">
              {formatPeriodLabel(summary.startDate, summary.endDate)} · 剩余 {summary.daysRemaining} 天
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${HEALTH_STYLE[summary.health]}`}
          >
            {BUDGET_HEALTH_LABELS[summary.health]}
          </span>
        </header>

        <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
          <p className="text-[11px] font-medium text-ink-500">本周期还剩</p>
          <p
            className={`num text-[38px] font-bold leading-none tracking-tight sm:text-[46px] ${
              summary.remainingFen < 0 ? "text-red-600" : "text-ink-900"
            }`}
          >
            {formatFenSigned(summary.remainingFen)}
          </p>
          {summary.overBudgetFen > 0 ? (
            <p className="num rounded-full bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700">
              已超支 {formatFen(summary.overBudgetFen)}
            </p>
          ) : null}
        </div>

        <p className="mt-1.5 text-[11px] leading-4 text-ink-400">
          根据你已记录的 {summary.confirmedCount} 笔消费估算（预算 {formatFen(summary.totalFen)} − 已花{" "}
          {formatFen(summary.spentFen)}）。漏记的话，实际剩余会比这个数更少。
        </p>

        {/* 消费进度条：实心 = 已花，竖线 = 时间进度 */}
        <div className="mt-3">
          <div
            className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/80 ring-1 ring-line"
            role="img"
            aria-label={`消费进度 ${spentPercent}%，时间已过 ${timePercent}%`}
          >
            <div
              className={`h-full rounded-full ${
                summary.remainingFen < 0 ? "bg-red-500" : "bg-gradient-to-r from-brand-400 to-brand-600"
              }`}
              style={{ width: `${Math.min(100, Math.max(0, spentPercent))}%` }}
            />
            <span
              aria-hidden
              className="absolute inset-y-0 w-0.5 bg-ink-700/50"
              style={{ left: `${timePercent}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-ink-400">
            <span>已花 {spentPercent}%</span>
            <span>时间已过 {timePercent}%</span>
          </div>
        </div>
      </div>

      {/* 四个关键数字 */}
      <div className="grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-4">
        <Tile
          label="今日建议单餐预算"
          value={suggestion.suggestedFen === null ? "—" : formatFen(suggestion.suggestedFen)}
          hint={
            suggestion.suggestedFen === null
              ? suggestion.blockedReason
              : `按每天 ${plan.dailyMealCount} 餐摊`
          }
          tone="brand"
        />
        <Tile
          label="剩余预算天数"
          value={`${summary.daysRemaining} 天`}
          hint={`周期共 ${summary.daysTotal} 天，已过 ${summary.daysElapsed} 天`}
        />
        <Tile
          label="消费进度"
          value={`${spentPercent}%`}
          hint={`时间进度 ${timePercent}%`}
          tone={spentPercent > timePercent + 15 ? "bad" : "neutral"}
        />
        <Tile
          label="后续日均可用"
          value={summary.dailyAllowanceFen === null ? "—" : formatFen(summary.dailyAllowanceFen)}
          hint={summary.dailyAllowanceFen === null ? "周期已结束" : "含预留金额"}
          tone={summary.dailyAllowanceFen === 0 ? "bad" : "neutral"}
        />
      </div>

      <div className="space-y-3 p-5 sm:p-6">
        {/* 明细：不抢主数字的注意力，但一个都不少 */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          <Line label="预算总额" value={formatFen(summary.totalFen)} />
          <Line label="预留金额" value={formatFen(summary.reserveFen)} />
          <Line label="可自由支配" value={formatFenSigned(summary.disposableFen)} />
          <Line label="计划中（未扣减）" value={formatFen(summary.plannedFen)} />
          <Line label="计划笔数" value={`${summary.plannedCount} 笔`} />
          <Line label="已确认笔数" value={`${summary.confirmedCount} 笔`} />
        </dl>

        <details className="rounded-xl bg-cream-deep px-4 py-3">
          <summary className="cursor-pointer select-none text-[12px] font-medium text-ink-700">
            计划支出（{summary.plannedCount} 笔）对未来预算的影响
          </summary>
          <div className="mt-3">
            {summary.plannedCount === 0 ? (
              <p className="text-[11px] leading-5 text-ink-500">
                目前没有「计划中」的记录。计划只在你的账本里做前瞻，不会扣减已花预算。
              </p>
            ) : (
              <ImpactSummary impact={summary.plannedImpact} compact />
            )}
          </div>
        </details>

        {summary.warnings.length > 0 ? (
          <ul className="space-y-1 rounded-xl bg-amber-50 px-4 py-3 text-[11px] leading-5 text-amber-800 ring-1 ring-amber-200">
            {summary.warnings.map((warning) => (
              <li key={`${warning.code}-${warning.message}`}>
                {warning.message}
                <span className="ml-1 text-[10px] text-ink-400">[{warning.code}]</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
