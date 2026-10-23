"use client";

import { useEffect, useMemo, useState } from "react";

import { formatPeriodLabel, derivePeriodDates, todayKey } from "@/lib/budget/period";
import { parseAmountInput } from "@/lib/budget/schema";
import { PERIOD_KIND_LABELS, PERIOD_KINDS, type BudgetPlan, type DateKey, type PeriodKind } from "@/lib/budget/types";

/**
 * 预算计划表单（新建 / 编辑共用）。
 *
 * 只负责「把输入收敛成一份合法草稿」，不做保存。
 * 周期不是手填两个日期就完事：选「每周 / 每月」时由锚点日期自动推算起止，
 * 避免用户填出「10-01 ~ 09-30」这种跨年错序。
 */

export interface PlanDraft {
  name: string;
  totalFen: number;
  reserveFen: number;
  periodKind: PeriodKind;
  startDate: DateKey;
  endDate: DateKey;
  timezone: string;
  dailyMealCount: number;
  defaultMealBudgetFen?: number;
}

const TIMEZONE_OPTIONS = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "UTC",
  "Europe/London",
  "America/New_York",
];

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  } catch {
    return "Asia/Shanghai";
  }
}

export function PlanForm({
  plan,
  onSave,
  onDelete,
  onError,
}: {
  plan: BudgetPlan | null;
  onSave: (draft: PlanDraft) => void;
  onDelete?: () => void;
  onError: (message: string) => void;
}) {
  const fallbackTimezone = useMemo(browserTimezone, []);
  const [open, setOpen] = useState(plan === null);

  const [name, setName] = useState(plan?.name ?? "每月餐饮预算");
  const [totalYuan, setTotalYuan] = useState(plan ? String(plan.totalFen / 100) : "900");
  const [reserveYuan, setReserveYuan] = useState(plan ? String(plan.reserveFen / 100) : "0");
  const [periodKind, setPeriodKind] = useState<PeriodKind>(plan?.periodKind ?? "month");
  const [anchor, setAnchor] = useState<DateKey>(
    plan?.startDate ?? todayKey(fallbackTimezone),
  );
  const [startDate, setStartDate] = useState<DateKey>(plan?.startDate ?? todayKey(fallbackTimezone));
  const [endDate, setEndDate] = useState<DateKey>(plan?.endDate ?? todayKey(fallbackTimezone));
  const [timezone, setTimezone] = useState(plan?.timezone ?? fallbackTimezone);
  const [dailyMealCount, setDailyMealCount] = useState(String(plan?.dailyMealCount ?? 3));
  const [defaultMealYuan, setDefaultMealYuan] = useState(
    plan?.defaultMealBudgetFen ? String(plan.defaultMealBudgetFen / 100) : "",
  );

  // 计划变了（切换计划 / 新建后）→ 重置表单
  useEffect(() => {
    setOpen(plan === null);
    setName(plan?.name ?? "每月餐饮预算");
    setTotalYuan(plan ? String(plan.totalFen / 100) : "900");
    setReserveYuan(plan ? String(plan.reserveFen / 100) : "0");
    setPeriodKind(plan?.periodKind ?? "month");
    setAnchor(plan?.startDate ?? todayKey(fallbackTimezone));
    setStartDate(plan?.startDate ?? todayKey(fallbackTimezone));
    setEndDate(plan?.endDate ?? todayKey(fallbackTimezone));
    setTimezone(plan?.timezone ?? fallbackTimezone);
    setDailyMealCount(String(plan?.dailyMealCount ?? 3));
    setDefaultMealYuan(plan?.defaultMealBudgetFen ? String(plan.defaultMealBudgetFen / 100) : "");
  }, [plan, fallbackTimezone]);

  const preview = useMemo(() => {
    if (periodKind === "custom") {
      if (startDate > endDate) return null;
      return `${startDate} ~ ${endDate}`;
    }
    const derived = derivePeriodDates(periodKind, anchor);
    return formatPeriodLabel(derived.startDate, derived.endDate);
  }, [periodKind, anchor, startDate, endDate]);

  const timezoneOptions = useMemo(
    () => Array.from(new Set([fallbackTimezone, ...TIMEZONE_OPTIONS])),
    [fallbackTimezone],
  );

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const total = parseAmountInput(totalYuan);
    if (!total.ok || total.fen === null) {
      onError(total.message ?? "预算金额不合法");
      return;
    }
    const reserve = parseAmountInput(reserveYuan);
    if (!reserve.ok || reserve.fen === null) {
      onError(reserve.message ?? "预留金额不合法");
      return;
    }
    const defaultMeal: { ok: boolean; fen: number | null; message?: string } =
      defaultMealYuan.trim() === "" ? { ok: true, fen: null } : parseAmountInput(defaultMealYuan);
    if (!defaultMeal.ok) {
      onError(defaultMeal.message ?? "常用单餐预算不合法");
      return;
    }

    const meals = Number(dailyMealCount);
    if (!Number.isInteger(meals) || meals < 1 || meals > 6) {
      onError("每日用餐次数需要是 1~6 的整数");
      return;
    }

    if (total.fen <= 0) {
      onError("预算总额需要大于 0（若只想占位，请填一个正数）");
      return;
    }

    const range =
      periodKind === "custom"
        ? { startDate, endDate }
        : derivePeriodDates(periodKind, anchor);

    if (range.startDate > range.endDate) {
      onError("结束日期不能早于开始日期");
      return;
    }

    onSave({
      name: name.trim() || "餐饮预算",
      totalFen: total.fen,
      reserveFen: reserve.fen,
      periodKind,
      startDate: range.startDate,
      endDate: range.endDate,
      timezone,
      dailyMealCount: meals,
      ...(defaultMeal.fen && defaultMeal.fen > 0
        ? { defaultMealBudgetFen: defaultMeal.fen }
        : {}),
    });
  }

  const inputClass =
    "field num py-2 text-[13px]";
  const labelClass = "block text-xs font-medium text-ink-600";

  return (
    <section className="surface p-5 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-ink-900">
            {plan ? "预算计划设置" : "创建预算计划"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-ink-500">
            金额一律按「分」参与计算，界面显示为元；日期按所选时区判定「哪一天」。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {plan ? (
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-600 hover:bg-cream-deep"
            >
              {open ? "收起" : "编辑"}
            </button>
          ) : null}
          {plan && onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
            >
              删除计划
            </button>
          ) : null}
        </div>
      </header>

      {open ? (
        <form onSubmit={handleSubmit} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <label className={labelClass} htmlFor="plan-name">
              计划名称
            </label>
            <input
              id="plan-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <label className={labelClass} htmlFor="plan-total">
              预算总额（元）
            </label>
            <input
              id="plan-total"
              inputMode="decimal"
              value={totalYuan}
              onChange={(event) => setTotalYuan(event.target.value)}
              className={inputClass}
              placeholder="900"
            />
          </div>

          <div className="space-y-1">
            <label className={labelClass} htmlFor="plan-reserve">
              希望预留（元）
            </label>
            <input
              id="plan-reserve"
              inputMode="decimal"
              value={reserveYuan}
              onChange={(event) => setReserveYuan(event.target.value)}
              className={inputClass}
              placeholder="0"
            />
            <p className="text-[11px] leading-4 text-ink-400">
              预留不算「已花」，但会从可支配金额里扣掉。
            </p>
          </div>

          <div className="space-y-1">
            <label className={labelClass} htmlFor="plan-period">
              预算周期
            </label>
            <select
              id="plan-period"
              value={periodKind}
              onChange={(event) => setPeriodKind(event.target.value as PeriodKind)}
              className={inputClass}
            >
              {PERIOD_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {PERIOD_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className={labelClass} htmlFor="plan-anchor">
              {periodKind === "week" ? "所在周（任选一天）" : periodKind === "month" ? "所在月份（任选一天）" : "开始日期"}
            </label>
            {periodKind === "custom" ? (
              <div className="flex items-center gap-2">
                <input
                  aria-label="开始日期"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className={inputClass}
                />
                <span className="text-xs text-ink-400">至</span>
                <input
                  aria-label="结束日期"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className={inputClass}
                />
              </div>
            ) : (
              <input
                id="plan-anchor"
                type="date"
                value={anchor}
                onChange={(event) => setAnchor(event.target.value)}
                className={inputClass}
              />
            )}
            <p className="text-[11px] leading-4 text-ink-400">
              {preview ? `周期预览：${preview}` : "结束日期不能早于开始日期"}
            </p>
          </div>

          <div className="space-y-1">
            <label className={labelClass} htmlFor="plan-timezone">
              时区
            </label>
            <select
              id="plan-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className={inputClass}
            >
              {timezoneOptions.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className={labelClass} htmlFor="plan-meals">
              每日用餐次数（用于估算）
            </label>
            <input
              id="plan-meals"
              inputMode="numeric"
              value={dailyMealCount}
              onChange={(event) => setDailyMealCount(event.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <label className={labelClass} htmlFor="plan-default-meal">
              常用单餐预算（元，可选）
            </label>
            <input
              id="plan-default-meal"
              inputMode="decimal"
              value={defaultMealYuan}
              onChange={(event) => setDefaultMealYuan(event.target.value)}
              className={inputClass}
              placeholder="例如 25"
            />
            <p className="text-[11px] leading-4 text-ink-400">
              作为「建议单餐预算」的上限，不影响已记录金额。
            </p>
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="btn btn-primary h-11 w-full px-5 text-[14px] sm:w-auto"
            >
              {plan ? "保存修改" : "创建计划"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
