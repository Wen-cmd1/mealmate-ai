"use client";

import { formatFen, formatFenSigned } from "@/lib/budget/money";
import type { AiRecommendation } from "@/lib/ai/types";
import { Tag } from "@/components/ui/Brand";

/**
 * 单个推荐方案卡片（任务 002 建立，任务 005 重做视觉）。
 *
 * 显示顺序刻意固定为：**价格 → 组成 → 为什么推荐 → 这次预算与剩余 → 对预算的影响**。
 * 价格一定是已经过 `calculate-price` 核验的那个数（`totalPriceFen === verifiedPriceFen`），
 * 未核验的方案不会出现在这里（引擎保证），但卡片上仍然标注核验状态，
 * 让"已核验"这件事是可见的，而不是一句口头承诺。
 *
 * `variant="primary"` 是「符合本次主要目标」的首选方案：更宽、带品牌描边，
 * 桌面端拆成左右两栏（左=吃什么与为什么，右=钱的变化），避免一行文字铺满 1000px。
 * `variant="compact"` 是另外两份备选，信息不减，只是视觉权重更低。
 */

const TYPE_STYLE: Record<
  AiRecommendation["recommendation"]["type"],
  { label: string; tone: "mint" | "brand" | "neutral" }
> = {
  save: { label: "省钱优先", tone: "mint" },
  balanced: { label: "均衡选择", tone: "neutral" },
  satisfy: { label: "满足优先", tone: "brand" },
};

export function AiRecommendationCard({
  item,
  variant = "compact",
  budgetFen,
  storeName,
  storeCode,
  storeAddress,
  onAdjust,
}: {
  item: AiRecommendation;
  variant?: "primary" | "compact";
  /** 本次实际用于推荐的预算（分） */
  budgetFen: number;
  storeName?: string;
  storeCode?: string;
  storeAddress?: string;
  /** 演示模式下不传：卡片不出现"再调条件"按钮 */
  onAdjust?: () => void;
}) {
  const rec = item.recommendation;
  const impact = item.impact;
  const isPrimary = variant === "primary";
  const style = TYPE_STYLE[rec.type];

  return (
    <article
      className={`relative flex h-full flex-col overflow-hidden rounded-[22px] border bg-white ${
        isPrimary
          ? "border-brand-200 p-5 shadow-[0_2px_4px_rgba(42,33,28,0.05),0_24px_48px_-30px_rgba(222,90,43,0.6)] sm:p-6"
          : "border-line p-4 shadow-[0_1px_2px_rgba(42,33,28,0.04)] sm:p-5"
      }`}
    >
      {isPrimary ? (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-300 via-brand-500 to-brand-600"
        />
      ) : null}

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag tone={style.tone}>{style.label}</Tag>
            {isPrimary ? (
              <span className="inline-flex items-center rounded-full bg-brand-500 px-2 py-1 text-[10px] font-semibold leading-none text-white">
                按你说的首选
              </span>
            ) : null}
          </div>
          <h3
            className={`mt-2 font-semibold leading-snug text-ink-900 ${
              isPrimary ? "text-[17px] sm:text-lg" : "text-[15px]"
            }`}
          >
            {rec.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-400">
            {rec.priceVerified ? (
              <span className="inline-flex items-center gap-1 text-mint-600">
                <span aria-hidden className="size-1.5 rounded-full bg-mint-500" />
                官方算价已核验
              </span>
            ) : (
              <span className="text-amber-700">未核验（不能当作实付）</span>
            )}
            {rec.priceMismatch ? (
              <span className="text-amber-700">· 标价与算价不一致，已按算价</span>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p
            className={`num font-bold leading-none text-ink-900 ${
              isPrimary ? "text-3xl sm:text-[34px]" : "text-2xl"
            }`}
          >
            {formatFen(rec.totalPriceFen)}
          </p>
          <p className="mt-1 text-[10px] text-ink-400">官方核验价</p>
        </div>
      </header>

      <div
        className={
          isPrimary
            ? "mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]"
            : "mt-3 space-y-2.5"
        }
      >
        {/* 左栏：吃什么、为什么 */}
        <div className="min-w-0 space-y-2.5">
          <ul className={`space-y-1 ${isPrimary ? "text-[13px]" : "text-[12px]"} text-ink-700`}>
            {rec.items.map((line) => (
              <li key={line.code} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">
                  {line.name}
                  {line.needsFurtherSelection ? (
                    <span className="ml-1 text-[10px] text-amber-700">（内容待选）</span>
                  ) : null}
                </span>
                <span className="num shrink-0 text-ink-400">{formatFen(line.unitPriceFen)}</span>
              </li>
            ))}
          </ul>

          {rec.needsFurtherSelection ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
              点这份时还要在门店选套餐内容（饮料 / 小食等），最终价格以门店结算为准。
            </p>
          ) : null}

          <div className="rounded-xl bg-cream-deep px-3 py-2.5">
            <p className={`leading-6 text-ink-700 ${isPrimary ? "text-[13px]" : "text-[12px]"}`}>
              {rec.reason}
            </p>
          </div>

          {item.fitNotes.length > 0 ? (
            <ul className="space-y-0.5 text-[11px] leading-5 text-ink-500">
              {item.fitNotes.slice(0, isPrimary ? 4 : 2).map((note) => (
                <li key={note} className="flex gap-1.5">
                  <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-ink-400/60" />
                  <span className="min-w-0">{note}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* 右栏：钱的变化 */}
        <div
          className={
            isPrimary
              ? "flex min-w-0 flex-col gap-2 self-start rounded-2xl bg-cream-deep/60 p-3"
              : "space-y-2"
          }
        >
          {/* 本次预算与剩余：任务 005 §5 要求每张卡都能直接看到 */}
          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <div className="flex items-baseline gap-1">
              <dt className="text-ink-400">本次预算</dt>
              <dd className="num font-semibold text-ink-900">{formatFen(budgetFen)}</dd>
            </div>
            <div className="flex items-baseline gap-1">
              <dt className="text-ink-400">扣掉这份还剩</dt>
              <dd
                className={`num font-semibold ${
                  rec.remainingFen < 0 ? "text-red-600" : "text-ink-900"
                }`}
              >
                {formatFenSigned(rec.remainingFen)}
              </dd>
            </div>
          </dl>

          {impact ? (
            <div className="rounded-xl border border-line bg-white px-3 py-2 text-[11px] leading-5 text-ink-600">
              <p className="text-ink-700">
                吃这顿后余额{" "}
                <span
                  className={`num font-semibold ${
                    impact.remainingAfterFen < 0 ? "text-red-600" : "text-ink-900"
                  }`}
                >
                  {formatFenSigned(impact.remainingAfterFen)}
                </span>
                ，后续日均{" "}
                <span className="num font-semibold text-ink-900">
                  {impact.afterDailyFen === null ? "—" : formatFenSigned(impact.afterDailyFen)}
                </span>
              </p>
              <p className="text-ink-400">
                吃之前日均{" "}
                {impact.beforeDailyFen === null ? "—" : formatFenSigned(impact.beforeDailyFen)}
                {impact.reserveTouchedFen > 0 ? " · 会动用预留" : ""}
                <span className="ml-1">（按你已记录的消费估算）</span>
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5 pt-0.5">
            <p className="flex flex-wrap items-center gap-x-1.5 text-[10px] leading-4 text-ink-400">
              <span aria-hidden>门店</span>
              <span className="text-ink-500">
                {storeName ?? "—"}
                {storeCode ? `（${storeCode}）` : ""}
              </span>
              {storeAddress ? <span className="truncate">· {storeAddress}</span> : null}
            </p>
            {onAdjust ? (
              <button
                type="button"
                onClick={onAdjust}
                className="btn btn-ghost w-full px-3 py-2 text-[12px]"
              >
                按这份再调条件
              </button>
            ) : (
              <p className="rounded-xl bg-white px-3 py-2 text-[10px] leading-4 text-ink-400">
                演示模式：条件固定，不能重新查询
              </p>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
