import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 入口卡片。
 *
 * 传入 `href` 时整张卡变成链接；不传则维持占位样式（保留给后续未实现的模式）。
 * 任务 005 换成新视觉：奶油白底、悬停时轻微上浮与描边变暖，右下角用箭头暗示可点。
 */

export interface ModeCardProps {
  title: string;
  description: string;
  eyebrow: string;
  status: "available" | "planned";
  statusText: string;
  icon?: ReactNode;
  /** 有值则整张卡可点击 */
  href?: string;
  /** 卡片底部的行动提示 */
  actionText?: string;
}

export function ModeCard({
  title,
  description,
  eyebrow,
  status,
  statusText,
  icon,
  href,
  actionText,
}: ModeCardProps) {
  const isAvailable = status === "available";

  const body = (
    <div
      className={[
        "group flex h-full flex-col justify-between gap-4 rounded-[22px] border p-5 transition sm:p-6",
        isAvailable
          ? "border-line bg-white shadow-[0_1px_2px_rgba(42,33,28,0.04)] hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_18px_36px_-24px_rgba(222,90,43,0.45)]"
          : "border-dashed border-line bg-cream-deep/60",
      ].join(" ")}
    >
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <span className="eyebrow">{eyebrow}</span>
          <span
            className={[
              "rounded-full px-2 py-1 text-[10px] font-medium leading-none",
              isAvailable ? "bg-brand-50 text-brand-700" : "border border-line text-ink-500",
            ].join(" ")}
          >
            {statusText}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {icon ? (
            <span aria-hidden className="text-lg">
              {icon}
            </span>
          ) : null}
          <h3 className="text-[16px] font-semibold tracking-tight text-ink-900">{title}</h3>
        </div>

        <p className="text-[12px] leading-6 text-ink-600">{description}</p>
      </div>

      <div
        className={`flex items-center justify-between text-[12px] ${
          isAvailable ? "font-semibold text-brand-700" : "text-ink-400"
        }`}
      >
        <span>{actionText ?? (isAvailable ? "进入" : "占位入口，暂不提供功能")}</span>
        {isAvailable ? (
          <span
            aria-hidden
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          >
            →
          </span>
        ) : null}
      </div>
    </div>
  );

  if (!href) return body;

  return (
    <Link
      href={href}
      className="block h-full rounded-[22px] outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
    >
      {body}
    </Link>
  );
}
