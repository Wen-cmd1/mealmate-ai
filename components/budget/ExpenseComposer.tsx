"use client";

import { useState } from "react";

import { defaultIdFactory } from "@/lib/budget/ledger";
import { isoToLocalDateTimeInput, localDateTimeToIso } from "@/lib/budget/period";
import { parseAmountInput } from "@/lib/budget/schema";
import { EXPENSE_STATUSES, EXPENSE_STATUS_LABELS, type ExpenseStatus } from "@/lib/budget/types";

/**
 * 手动记一笔餐费。
 *
 * 防重复提交做了两层：
 * 1. 每次提交带同一个 `requestId`（提交成功后换新的），账本按它幂等；
 * 2. 请求进行中按钮禁用，避免连点。
 * 因此双击 / 网络重试最多只落一条记录。
 */

export interface ExpenseDraft {
  amountFen: number;
  occurredAt: string;
  description: string;
  status: ExpenseStatus;
  requestId: string;
}

export function ExpenseComposer({
  defaultAmountFen,
  onError,
  onSubmit,
  disabled,
}: {
  defaultAmountFen?: number;
  onError: (message: string) => void;
  onSubmit: (draft: ExpenseDraft) => { ok: boolean; message?: string };
  disabled?: boolean;
}) {
  const [amountYuan, setAmountYuan] = useState(
    defaultAmountFen ? String(defaultAmountFen / 100) : "",
  );
  const [occurredAtLocal, setOccurredAtLocal] = useState(() => isoToLocalDateTimeInput(new Date().toISOString()));
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ExpenseStatus>("confirmed");
  const [requestId, setRequestId] = useState(() => defaultIdFactory());
  const [pending, setPending] = useState(false);

  const inputClass =
    "field py-2 text-[13px] disabled:bg-cream-deep";

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    const amount = parseAmountInput(amountYuan);
    if (!amount.ok || amount.fen === null) {
      onError(amount.message ?? "金额不合法");
      return;
    }
    if (amount.fen <= 0) {
      onError("金额需要大于 0");
      return;
    }
    const occurredAt = localDateTimeToIso(occurredAtLocal);
    if (!occurredAt) {
      onError("发生时间不合法");
      return;
    }

    setPending(true);
    const result = onSubmit({
      amountFen: amount.fen,
      occurredAt,
      description,
      status,
      requestId,
    });
    setPending(false);

    if (!result.ok) {
      onError(result.message ?? "保存失败");
      return;
    }
    // 成功后才换 key：失败的重复提交仍会被账本识别为同一条
    setRequestId(defaultIdFactory());
    setAmountYuan("");
    setDescription("");
  }

  return (
    <section className="surface p-5 sm:p-6">
      <header>
        <h2 className="text-[17px] font-semibold tracking-tight text-ink-900">手动记一笔</h2>
        <p className="mt-1 text-xs leading-5 text-ink-500">
          「已消费」会立刻扣减预算；「计划中」只做前瞻，不扣预算，之后可以一键确认。
        </p>
      </header>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-ink-600" htmlFor="expense-amount">
            金额（元）
          </label>
          <input
            id="expense-amount"
            inputMode="decimal"
            value={amountYuan}
            onChange={(event) => setAmountYuan(event.target.value)}
            placeholder="例如 24.5"
            disabled={disabled}
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-ink-600" htmlFor="expense-time">
            发生时间
          </label>
          <input
            id="expense-time"
            type="datetime-local"
            value={occurredAtLocal}
            onChange={(event) => setOccurredAtLocal(event.target.value)}
            disabled={disabled}
            className={inputClass}
          />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <label className="block text-xs font-medium text-ink-600" htmlFor="expense-desc">
            说明（可选）
          </label>
          <input
            id="expense-desc"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={80}
            placeholder="例如 午餐 · 麦辣鸡腿堡套餐"
            disabled={disabled}
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <span className="block text-xs font-medium text-ink-600">记录类型</span>
          <div className="flex gap-2">
            {EXPENSE_STATUSES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={status === option}
                onClick={() => setStatus(option)}
                disabled={disabled}
                className={`rounded-lg px-3 py-2 text-xs transition ${
                  status === option
                    ? "btn-primary text-white"
                    : "bg-cream-deep text-ink-600 hover:bg-brand-50"
                }`}
              >
                {EXPENSE_STATUS_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end">
          <button
            type="submit"
            disabled={disabled || pending}
            className="btn btn-primary h-11 w-full px-4 text-[14px]"
          >
            {pending ? "保存中…" : "记一笔"}
          </button>
        </div>
      </form>
    </section>
  );
}
