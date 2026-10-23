"use client";

import { formatFen, formatFenSigned } from "@/lib/budget/money";
import type { MealImpact } from "@/lib/budget/types";

/**
 * Meal Impact 展示块（纯展示，不做任何计算）。
 *
 * 任务 005 把原来四个并排格子改成「吃这顿之前 → 之后」的对比：
 * 人读预算时真正想知道的是一句话——"花掉这 25 块，我后面每天还剩多少"。
 * 所以先给一句自然语言结论，再给前后对比，最后才是预测前提。
 *
 * 文案原则（任务 003 明确要求）：只陈述数字与前提，不做道德评价。
 * 所以这里不会出现「太贵」「省一点」这类词，负值也用 `-¥x` 平静地展示。
 */

function Box({
  title,
  remaining,
  daily,
  tone = "neutral",
  delta,
}: {
  title: string;
  remaining: string;
  daily: string;
  tone?: "neutral" | "after" | "bad";
  delta?: string;
}) {
  const boxClass =
    tone === "after"
      ? "border-brand-200 bg-brand-50/60"
      : tone === "bad"
        ? "border-red-200 bg-red-50/70"
        : "border-line bg-white";
  return (
    <div className={`rounded-2xl border px-3 py-2.5 ${boxClass}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">{title}</p>
      <p className="num mt-1 text-[17px] font-bold leading-none text-ink-900">{remaining}</p>
      <p className="mt-1 flex items-baseline gap-1 text-[10px] text-ink-500">
        <span>日均</span>
        <span className="num font-semibold text-ink-700">{daily}</span>
        {delta ? <span className="num ml-auto text-ink-400">{delta}</span> : null}
      </p>
    </div>
  );
}

export function ImpactSummary({
  impact,
  compact = false,
}: {
  impact: MealImpact;
  compact?: boolean;
}) {
  const afterTone = impact.remainingAfterFen < 0 ? "bad" : "after";
  const delta = impact.dailyDeltaFen;
  const days = impact.coversToday ? impact.daysAfterToday : impact.daysRemaining;

  const sentence =
    impact.afterDailyFen === null
      ? "这个周期已经没有可分摊的剩余天数，所以算不出「花完之后每天还能安排多少」。"
      : `如果花 ${formatFen(impact.plannedFen)}，接下来 ${days} 天平均每天还能安排 ${formatFen(
          Math.max(0, impact.afterDailyFen),
        )}。`;

  return (
    <div className={compact ? "space-y-2.5" : "space-y-3"}>
      <p className={`${compact ? "text-[11px]" : "text-[12px]"} leading-6 text-ink-700`}>
        {sentence}
        {impact.otherMealsTodayFen > 0 ? (
          <span className="text-ink-400">
            （已计入今天其它餐费 {formatFen(impact.otherMealsTodayFen)}）
          </span>
        ) : null}
      </p>

      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-1.5 sm:gap-2">
        <Box
          title="吃这顿之前"
          remaining={formatFenSigned(impact.remainingBeforeFen)}
          daily={impact.beforeDailyFen === null ? "—" : formatFenSigned(impact.beforeDailyFen)}
        />
        <div aria-hidden className="grid place-items-center px-0.5 text-ink-400">
          →
        </div>
        <Box
          title="吃这顿之后"
          remaining={formatFenSigned(impact.remainingAfterFen)}
          daily={impact.afterDailyFen === null ? "—" : formatFenSigned(impact.afterDailyFen)}
          tone={afterTone}
          delta={
            delta === null ? undefined : `${delta > 0 ? "+" : ""}${formatFenSigned(delta)}/天`
          }
        />
      </div>

      <p className="text-[11px] leading-5 text-ink-500">
        本次消费 <span className="num font-semibold text-ink-900">{formatFen(impact.plannedFen)}</span>
        {" · "}
        占剩余预算{" "}
        <span className="num font-semibold text-ink-900">
          {Math.round(impact.shareOfRemaining * 100)}%
        </span>
        {" · "}
        {impact.coversToday
          ? `按剩 ${impact.daysAfterToday} 个完整预算日摊`
          : `按剩 ${impact.daysRemaining} 天（含今天）摊`}
      </p>

      {delta !== null && delta > 0 ? (
        <p className="rounded-xl bg-cream-deep px-3 py-2 text-[11px] leading-5 text-ink-500">
          本次消费低于原日均，剩余预算摊到更少的天数上，日均因此被动抬高。
          这是「平均分摊」的算术结果，不代表可用预算变多。
        </p>
      ) : null}

      {impact.reserveTouchedFen > 0 ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
          这笔消费会动用预留 {formatFen(impact.reserveTouchedFen)}。
        </p>
      ) : null}

      {impact.overBudgetFen > 0 ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-[11px] leading-5 text-red-700">
          消费后超出预算 {formatFen(impact.overBudgetFen)}。
        </p>
      ) : null}

      {compact ? null : (
        <details className="rounded-xl bg-cream-deep px-3 py-2">
          <summary className="cursor-pointer select-none text-[11px] font-medium text-ink-700">
            预测前提与不确定性
          </summary>
          <ul className="mt-2 space-y-1 text-[11px] leading-5 text-ink-500">
            {impact.assumptions.map((item) => (
              <li key={item}>· {item}</li>
            ))}
            {impact.caveats.map((item) => (
              <li key={item} className="text-ink-400">
                · {item}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
