import type { ReactNode } from "react";

/**
 * 品牌标识（纯展示，无交互）。
 *
 * 用 SVG 画的「一碗热饭 + 两缕热气」，不引用任何官方商标 / 角色 / 图片，
 * 避免与麦当劳官方视觉产生身份混淆（任务 005 §3 明确要求）。
 */

export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-[0_10px_20px_-12px_rgba(222,90,43,0.95)]"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={Math.round(size * 0.62)}
        height={Math.round(size * 0.62)}
        fill="none"
        aria-hidden
      >
        <path
          d="M8.2 6.6c0-1.1 1-1.5 1-2.6M12 6.6c0-1.3 1.2-1.7 1.2-2.9M15.8 6.6c0-1.1 1-1.5 1-2.6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.75"
        />
        <path
          d="M3.2 10.6h17.6c0 4.6-3.9 8.3-8.8 8.3s-8.8-3.7-8.8-8.3Z"
          fill="currentColor"
          opacity="0.96"
        />
        <path d="M2.4 10.6h19.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function BrandLockup({
  subtitle,
  compact = false,
}: {
  subtitle?: string;
  compact?: boolean;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={compact ? 32 : 38} />
      <span className="flex flex-col leading-tight">
        <span className="text-[15px] font-bold tracking-tight text-ink-900">饭搭子 AI</span>
        <span className="text-[10px] font-medium tracking-[0.18em] text-ink-400">
          {subtitle ?? "MEALMATE"}
        </span>
      </span>
    </span>
  );
}

/** 小圆点状态（用于"实时数据"这类轻提示） */
export function StatusDot({ tone = "mint" }: { tone?: "mint" | "brand" | "muted" }) {
  const color =
    tone === "mint" ? "bg-mint-500" : tone === "brand" ? "bg-brand-500" : "bg-ink-400";
  return <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${color}`} />;
}

/** 通用标签（语义色） */
export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "mint" | "warn" | "muted";
}) {
  const className =
    tone === "brand"
      ? "border-brand-200 bg-brand-50 text-brand-700"
      : tone === "mint"
        ? "border-mint-100 bg-mint-50 text-mint-600"
        : tone === "warn"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : tone === "muted"
            ? "border-transparent bg-cream-deep text-ink-500"
            : "border-line bg-white text-ink-700";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] leading-none ${className}`}
    >
      {children}
    </span>
  );
}
