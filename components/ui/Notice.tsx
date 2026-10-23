import type { ReactNode } from "react";

/**
 * 提示块。
 *
 * 任务 005 §8 明确要求：不要把错误、风险、数据限制全挤在同一个大段落里。
 * 所以错误 / 告警 / 数据限制各自用不同的 tone 分组，但**都不折叠**——
 * 重要约束可以分组，不能被隐藏。
 */

const TONE: Record<
  "error" | "warn" | "info" | "good" | "neutral",
  { box: string; title: string; dot: string }
> = {
  error: {
    box: "border-red-200 bg-red-50/80",
    title: "text-red-800",
    dot: "bg-red-500",
  },
  warn: {
    box: "border-amber-200 bg-amber-50/80",
    title: "text-amber-900",
    dot: "bg-amber-500",
  },
  info: {
    box: "border-line bg-cream-deep",
    title: "text-ink-900",
    dot: "bg-brand-400",
  },
  good: {
    box: "border-mint-100 bg-mint-50/80",
    title: "text-mint-600",
    dot: "bg-mint-500",
  },
  neutral: {
    box: "border-line bg-white",
    title: "text-ink-900",
    dot: "bg-ink-400",
  },
};

export function Notice({
  tone = "info",
  title,
  children,
  action,
  role,
}: {
  tone?: "error" | "warn" | "info" | "good" | "neutral";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  role?: "alert" | "status";
}) {
  const style = TONE[tone];
  return (
    <div className={`rounded-2xl border px-4 py-3.5 ${style.box}`} role={role}>
      {title ? (
        <p className={`flex items-start gap-2 text-[13px] font-semibold ${style.title}`}>
          <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${style.dot}`} />
          <span className="min-w-0">{title}</span>
        </p>
      ) : null}
      {children ? (
        <div className={`text-[12px] leading-6 text-ink-700 ${title ? "mt-1.5 pl-3.5" : ""}`}>
          {children}
        </div>
      ) : null}
      {action ? <div className={`mt-2.5 ${title ? "pl-3.5" : ""}`}>{action}</div> : null}
    </div>
  );
}

/** 一组要点（用于告警 / 限制 / 前提） */
export function NoticeList({
  items,
  tone = "info",
  title,
  meta,
}: {
  items: readonly ReactNode[];
  tone?: "error" | "warn" | "info" | "neutral";
  title?: ReactNode;
  /** 右上角小字，例如条数 / 来源 */
  meta?: ReactNode;
}) {
  if (items.length === 0) return null;
  const style = TONE[tone];
  return (
    <div className={`rounded-2xl border px-4 py-3.5 ${style.box}`}>
      {title ? (
        <div className="flex items-start justify-between gap-3">
          <p className={`flex items-start gap-2 text-[13px] font-semibold ${style.title}`}>
            <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${style.dot}`} />
            <span className="min-w-0">{title}</span>
          </p>
          {meta ? <span className="shrink-0 text-[11px] text-ink-400">{meta}</span> : null}
        </div>
      ) : null}
      <ul className={`space-y-1.5 text-[12px] leading-6 text-ink-700 ${title ? "mt-2" : ""}`}>
        {items.map((item, index) => (
          <li key={index} className="flex gap-2">
            <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-ink-400/60" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 「**加粗**」→ <strong>：后端部分文案带 markdown 强调，直接铺出来会出现星号 */
export function Emphasis({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <strong key={index} className="font-semibold text-ink-900">
            {part}
          </strong>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
