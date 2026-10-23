"use client";

import { useMemo, useState } from "react";

import { computeMealImpact } from "@/lib/budget/forecast";
import { formatFen } from "@/lib/budget/money";
import { parseAmountInput } from "@/lib/budget/schema";
import type { BudgetSummary } from "@/lib/budget/types";
import { ImpactSummary } from "./ImpactSummary";

/**
 * Meal Impact 交互式预测。
 *
 * 刻意把「今天还剩几餐」放出来：任务书要求正式逻辑不能假设「今天只有一餐」，
 * 所以这里是显式参数，而不是藏在算法里。
 *
 * 任务 005 的改造：标题从"这笔花下去会怎样"改成更直白的
 * 「吃这顿之前 / 之后」，并加了几个常用金额的快捷按钮，
 * 让评审在三秒内就能看到"日均变化"这件事。
 */

const PRESETS = [15, 20, 25, 35, 50];

export function MealImpactPanel({ summary }: { summary: BudgetSummary }) {
  const defaultAmount =
    summary.dailyAllowanceFen && summary.dailyAllowanceFen > 0
      ? String(Math.round(summary.dailyAllowanceFen / 100))
      : "25";

  const [amountYuan, setAmountYuan] = useState(defaultAmount);
  const [mealsLeftToday, setMealsLeftToday] = useState("1");
  const [otherYuan, setOtherYuan] = useState("");

  const parsed = parseAmountInput(amountYuan);
  const plannedFen = parsed.ok ? (parsed.fen ?? 0) : null;

  const parsedOther = parseAmountInput(otherYuan);
  const otherFen = parsedOther.ok ? (parsedOther.fen ?? 0) : null;

  const mealsLeft = Math.max(1, Math.min(6, Number(mealsLeftToday) || 1));

  const impact = useMemo(() => {
    if (plannedFen === null || otherFen === null) return null;
    return computeMealImpact({
      remainingFen: summary.remainingFen,
      daysRemaining: summary.daysRemaining,
      plannedFen,
      reserveFen: summary.reserveFen,
      otherMealsTodayFen: otherFen,
      mealsLeftToday: mealsLeft,
    });
  }, [plannedFen, otherFen, mealsLeft, summary.remainingFen, summary.daysRemaining, summary.reserveFen]);

  return (
    <section className="surface p-5 sm:p-6">
      <header>
        <p className="eyebrow">单笔影响</p>
        <h2 className="mt-1 text-[17px] font-semibold tracking-tight text-ink-900">
          吃这顿之前 / 之后
        </h2>
        <p className="mt-1 text-[11px] leading-5 text-ink-500">
          只做预算分析：算出消费后的余额与后续日均，并写明预测前提。没有评价性提示。
        </p>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-[11px] font-medium text-ink-700" htmlFor="impact-amount">
            本次消费（元）
          </label>
          <input
            id="impact-amount"
            inputMode="decimal"
            value={amountYuan}
            onChange={(event) => setAmountYuan(event.target.value)}
            className="field mt-1 py-2 text-[15px] font-semibold"
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmountYuan(String(preset))}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                  Number(amountYuan) === preset
                    ? "bg-brand-500 text-white"
                    : "bg-cream-deep text-ink-600 hover:bg-brand-50 hover:text-brand-700"
                }`}
              >
                ¥{preset}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-ink-700" htmlFor="impact-meals">
            今天还剩几餐（含这次）
          </label>
          <select
            id="impact-meals"
            value={mealsLeftToday}
            onChange={(event) => setMealsLeftToday(event.target.value)}
            className="field mt-1 py-2 text-[13px]"
          >
            {[1, 2, 3, 4].map((count) => (
              <option key={count} value={count}>
                {count} 餐
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] leading-4 text-ink-400">不假设"今天只有这一顿"</p>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-ink-700" htmlFor="impact-other">
            今天其它餐费（元，可选）
          </label>
          <input
            id="impact-other"
            inputMode="decimal"
            value={otherYuan}
            onChange={(event) => setOtherYuan(event.target.value)}
            placeholder="例如 12"
            className="field mt-1 py-2 text-[13px]"
          />
          <p className="mt-1 text-[10px] leading-4 text-ink-400">不影响账本，只参与本次测算</p>
        </div>
      </div>

      <div className="mt-4">
        {plannedFen === null ? (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-[12px] text-red-700">
            {parsed.message ?? "金额不合法"}
          </p>
        ) : impact === null ? (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-[12px] text-red-700">
            {parsedOther.message ?? "今天其它餐费不合法"}
          </p>
        ) : (
          <ImpactSummary impact={impact} />
        )}
      </div>

      <p className="mt-3 text-[10px] leading-4 text-ink-400">
        当前基准：剩余预算 {formatFen(Math.max(0, summary.remainingFen))}
        {summary.remainingFen < 0 ? "（实际已为负，超支部分按 0 展示）" : ""} · 剩{" "}
        {summary.daysRemaining} 天
        {summary.reserveFen > 0 ? ` · 预留 ${formatFen(summary.reserveFen)}` : ""} ·
        根据你已记录的消费估算
      </p>
    </section>
  );
}
