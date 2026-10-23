import { BudgetWorkspace } from "@/components/budget/BudgetWorkspace";
import { SiteHeader } from "@/components/ui/SiteHeader";

/**
 * 长期预算管理页（`/budget`）。
 *
 * 服务端只渲染页面壳与静态说明；所有预算数据、计算与交互都在
 * `BudgetWorkspace`（客户端）里完成，因此本页可以静态预渲染，
 * 也不存在「服务端算一份、客户端算一份」的不一致。
 *
 * 任务 005 重排了信息层级：进来先看到「这个周期还剩多少」，
 * 而不是先看到一堆表单。
 */

export const metadata = {
  title: "长期预算 · 饭搭子 AI",
  description: "按周 / 按月管理餐饮预算，跟踪消费进度与后续日均，并用真实菜单推荐今天这一顿。",
};

export default function BudgetPage() {
  return (
    <>
      <SiteHeader active="budget" />

      <main
        id="main"
        className="page-glow mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-7 sm:px-6 sm:pt-10 lg:px-8"
      >
        <section className="mb-5">
          <p className="eyebrow">长期预算</p>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight text-ink-900 sm:text-[34px]">
            这个月还能吃多少？
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-ink-600">
            设一个周期预算，记录已经花掉的餐费，看清剩余预算、后续日均和每一笔的即时影响。
            需要决定今天吃什么时，直接用剩余预算去查真实菜单。
          </p>
          <p className="mt-2 inline-flex max-w-2xl items-start gap-1.5 rounded-xl bg-cream-deep px-3 py-2 text-[11px] leading-5 text-ink-500">
            <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
            <span>
              数据只保存在当前浏览器（localStorage），<strong className="font-semibold text-ink-700">没有云端同步</strong>
              ；清理浏览器数据或换设备可能造成记录丢失。本页不接支付、不创建订单，推荐查询全部是只读接口。
            </span>
          </p>
        </section>

        <BudgetWorkspace />

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-6 text-[11px] leading-5 text-ink-400">
          <span>饭搭子 AI · MealMate AI · v0.5.0</span>
          <span>金额以「分」为最小单位 · 餐品价格以麦当劳官方接口实时返回为准，实际支付以门店为准</span>
        </footer>
      </main>
    </>
  );
}
