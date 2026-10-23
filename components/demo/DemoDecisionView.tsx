"use client";

import Link from "next/link";

import { DEMO_DECISION, DEMO_META } from "@/lib/demo/sample-decision";
import { AiRecommendationCard } from "@/components/ai/AiRecommendationCard";
import { IntentSummary } from "@/components/ai/IntentSummary";

/**
 * 演示模式视图（任务 005 §9）。
 *
 * 目的只有一个：**没有凭证的评审也能看到完整界面长什么样**。
 * 因此这里不发起任何网络请求，也不复用首页的交互组件（那些组件会打 API）。
 *
 * 与真实模式的隔离是硬的：
 * - 数据是构建期就固定的一份常量，运行时不查询、不刷新；
 * - 页面顶部与每张卡片都有「演示数据」标识，不冒充实时查询；
 * - 真实模式不会因为接口失败自动跳到这里（首页没有这段逻辑）。
 */

export function DemoDecisionView() {
  const result = DEMO_DECISION;
  const primary = result.recommendations.find((item) => item.primary) ?? result.recommendations[0];
  const alternatives = result.recommendations.filter((item) => item !== primary);

  return (
    <div className="space-y-4">
      {/* 演示数据横幅：整页最显眼的一块 */}
      <section
        role="note"
        aria-label="演示数据说明"
        className="rounded-[22px] border border-amber-300 bg-amber-50 p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-bold leading-none text-white">
            演示数据
          </span>
          <p className="text-[13px] font-semibold text-amber-900">这里不是实时查询，也不会下单</p>
        </div>
        <p className="mt-2 text-[12px] leading-6 text-amber-900/90">{DEMO_META.note}</p>
        <dl className="mt-2.5 grid gap-x-4 gap-y-1 text-[11px] leading-5 text-amber-900/80 sm:grid-cols-2">
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-medium">示例输入</dt>
            <dd className="min-w-0">「{DEMO_META.query}」</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-medium">门店</dt>
            <dd className="min-w-0">{DEMO_META.store}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-medium">冻结时间</dt>
            <dd className="min-w-0">
              {new Date(DEMO_META.capturedAt).toLocaleString("zh-CN", { hour12: false })}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-medium">当时调用的工具</dt>
            <dd className="min-w-0">{DEMO_META.toolCalls.join(" → ")}</dd>
          </div>
        </dl>
      </section>

      {/* 结果（复用真实模式同一套组件，保证视觉一致） */}
      <IntentSummary result={result} />

      {primary ? (
        <AiRecommendationCard
          item={primary}
          variant="primary"
          budgetFen={result.budget.appliedFen}
          storeName={result.source.storeName}
          storeCode={result.source.storeCode}
          storeAddress={result.source.storeAddress}
        />
      ) : null}

      {alternatives.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {alternatives.map((item) => (
            <AiRecommendationCard
              key={item.recommendation.type}
              item={item}
              variant="compact"
              budgetFen={result.budget.appliedFen}
              storeName={result.source.storeName}
              storeCode={result.source.storeCode}
              storeAddress={result.source.storeAddress}
            />
          ))}
        </div>
      ) : null}

      {/* 演示 / 真实 的差别与边界 */}
      <section className="surface p-5 sm:p-6">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">
          演示模式和真实模式差在哪
        </h2>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-6 text-ink-600">
          <li>
            · 演示：数据是固定常量，页面加载时<strong className="font-semibold text-ink-900">不联网</strong>
            ；真实：每次提问都实时查门店菜单并逐份算价。
          </li>
          <li>· 演示：不能改条件、不能重新查询；真实：可以反复调整预算与口味。</li>
          <li>· 演示：仍然只是只读展示；真实：同样不提供下单、支付、领券。</li>
          <li>
            · 真实模式如果接口失败，会明确报错并说明原因，
            <strong className="font-semibold text-ink-900">不会自动回退到这份演示数据</strong>。
          </li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/" className="btn btn-primary h-11 px-5 text-[14px]">
            去看真实模式 →
          </Link>
          <Link href="/budget" className="btn btn-ghost h-11 px-4 text-[13px]">
            长期预算页
          </Link>
        </div>
      </section>
    </div>
  );
}
