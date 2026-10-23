"use client";

import { formatFen } from "@/lib/budget/money";
import type { Recommendation } from "@/lib/recommendation/types";
import { Tag } from "@/components/ui/Brand";

/**
 * 单条推荐卡片（任务 002 建立，任务 005 重做视觉）。
 *
 * 只展示后端已经核验过的字段（`totalPriceFen` / `priceVerified` / `reason`），
 * 不在这里做任何价格计算或"营养"推断。
 */

const TYPE_STYLE: Record<
  Recommendation["type"],
  { tone: "mint" | "neutral" | "brand"; hint: string }
> = {
  save: { tone: "mint", hint: "价格最低" },
  balanced: { tone: "neutral", hint: "价格与组成折中" },
  satisfy: { tone: "brand", hint: "贴合你的偏好" },
};

export function RecommendationCard({ rec }: { rec: Recommendation }) {
  const style = TYPE_STYLE[rec.type];

  return (
    <article className="flex h-full flex-col rounded-[20px] border border-line bg-white p-4 shadow-[0_1px_2px_rgba(42,33,28,0.04)]">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Tag tone={style.tone}>{rec.title}</Tag>
          <p className="mt-1.5 text-[10px] text-ink-400">{style.hint}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-xl font-bold leading-none text-ink-900">
            {formatFen(rec.totalPriceFen)}
          </p>
          <p
            className={`mt-1 text-[10px] ${rec.priceVerified ? "text-mint-600" : "text-amber-700"}`}
          >
            {rec.priceVerified ? "官方核验价" : "未核验"}
          </p>
        </div>
      </header>

      <ul className="mt-3 space-y-1.5">
        {rec.items.map((item) => (
          <li key={item.code} className="flex items-start justify-between gap-2 text-[12px]">
            <div className="min-w-0">
              <p className="truncate font-medium text-ink-900">{item.name}</p>
              <p className="text-[10px] text-ink-400">
                {item.needsFurtherSelection ? "点餐时需选内容" : (item.categoryName ?? "未分类")}
              </p>
            </div>
            <span className="num shrink-0 text-ink-600">{formatFen(item.unitPriceFen)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 rounded-xl bg-cream-deep px-3 py-2 text-[11px] leading-5 text-ink-700">
        {rec.reason}
      </p>

      {rec.highlights.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[11px] leading-5 text-ink-500">
          {rec.highlights.slice(0, 2).map((highlight) => (
            <li key={highlight} className="flex gap-1.5">
              <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-ink-400/60" />
              <span className="min-w-0">{highlight}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-line pt-2.5 text-[11px] text-ink-500">
        <span>
          扣掉这份还剩{" "}
          <span className="num font-semibold text-ink-900">{formatFen(rec.remainingFen)}</span>
        </span>
        {rec.priceMismatch ? (
          <span className="text-amber-700">标价与算价不一致，已按算价</span>
        ) : (
          <span className="text-ink-400">标价与算价一致</span>
        )}
      </footer>
    </article>
  );
}
