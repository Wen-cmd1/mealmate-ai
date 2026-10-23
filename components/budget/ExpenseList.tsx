"use client";

import { useState } from "react";

import { formatFen } from "@/lib/budget/money";
import { dateKeyOfInstant } from "@/lib/budget/period";
import { parseAmountInput } from "@/lib/budget/schema";
import {
  EXPENSE_SOURCE_LABELS,
  EXPENSE_STATUS_LABELS,
  type ExpenseRecord,
} from "@/lib/budget/types";

/**
 * 近期消费记录。
 *
 * 每条记录都可以改金额、改状态、删除 —— 任务 003 明确要求用户能修改和删除自己的记录。
 * 「哪一天」按计划的时区判定，与浏览器时区无关，所以日期直接从 `timezone` 换算。
 */

function formatTime(record: ExpenseRecord, timezone: string): string {
  const day = dateKeyOfInstant(record.occurredAt, timezone) ?? "日期异常";
  try {
    const time = new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(record.occurredAt));
    return `${day} ${time}`;
  } catch {
    return day;
  }
}

export function ExpenseList({
  records,
  timezone,
  outOfPeriodCount,
  onUpdateAmount,
  onRemove,
  onConfirm,
  onError,
}: {
  records: readonly ExpenseRecord[];
  timezone: string;
  outOfPeriodCount: number;
  onUpdateAmount: (id: string, amountFen: number) => boolean;
  onRemove: (id: string) => void;
  onConfirm: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  function startEdit(record: ExpenseRecord) {
    setEditingId(record.id);
    setEditValue(String(record.amountFen / 100));
  }

  function submitEdit(record: ExpenseRecord) {
    const parsed = parseAmountInput(editValue);
    if (!parsed.ok || parsed.fen === null || parsed.fen <= 0) {
      onError(parsed.message ?? "金额需要大于 0");
      return;
    }
    if (onUpdateAmount(record.id, parsed.fen)) {
      setEditingId(null);
      setEditValue("");
    }
  }

  return (
    <section className="surface p-5 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-ink-900">近期消费记录</h2>
          <p className="mt-1 text-xs leading-5 text-ink-500">
            本周期内共 {records.length} 条（按发生时间倒序）。
            {outOfPeriodCount > 0
              ? `另有 ${outOfPeriodCount} 条不在本周期，未计入统计。`
              : ""}
          </p>
        </div>
      </header>

      {records.length === 0 ? (
        <p className="mt-4 rounded-xl bg-cream-deep px-4 py-6 text-center text-sm text-ink-500">
          还没有任何记录。用上面的「手动记一笔」开始记账，或从下面的推荐直接记为已消费。
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {records.map((record) => {
            const isEditing = editingId === record.id;
            return (
              <li key={record.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {record.description || "未填写说明"}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        record.status === "confirmed"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {EXPENSE_STATUS_LABELS[record.status]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-400">
                    {formatTime(record, timezone)} · {EXPENSE_SOURCE_LABELS[record.source]}
                    {record.relatedRecommendationType ? ` · ${record.relatedRecommendationType}` : ""}
                  </p>
                </div>

                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <input
                      aria-label="修改金额"
                      inputMode="decimal"
                      value={editValue}
                      onChange={(event) => setEditValue(event.target.value)}
                      className="w-20 rounded-lg border border-line px-2 py-1 text-sm tabular-nums outline-none "
                    />
                    <button
                      type="button"
                      onClick={() => submitEdit(record)}
                      className="rounded-lg bg-brand-600 px-2 py-1 text-[11px] text-white hover:bg-brand-500"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-md border border-line px-2 py-1 text-xs text-ink-600"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <p className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-ink-900">
                    {formatFen(record.amountFen)}
                  </p>
                )}

                <div className="flex shrink-0 items-center gap-1">
                  {record.status === "planned" ? (
                    <button
                      type="button"
                      onClick={() => onConfirm(record.id)}
                      className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                    >
                      确认为已消费
                    </button>
                  ) : null}
                  {isEditing ? null : (
                    <button
                      type="button"
                      onClick={() => startEdit(record)}
                      className="rounded-md border border-line px-2 py-1 text-xs text-ink-600 hover:bg-cream-deep"
                    >
                      改金额
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove(record.id)}
                    className="rounded-md border border-line px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    删除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
