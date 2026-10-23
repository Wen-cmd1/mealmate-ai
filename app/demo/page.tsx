import { DemoDecisionView } from "@/components/demo/DemoDecisionView";
import { SiteHeader } from "@/components/ui/SiteHeader";

/**
 * 演示模式（`/demo`）。
 *
 * 为什么单独一条路由而不是首页的 `?demo=1`：
 * 查询参数容易被误当成"真实模式的一个状态"，而这里需要的是**物理隔离**——
 * 这条路由不 import 任何 fetch 逻辑，也不引入首页的交互组件，
 * 从代码依赖上就保证了它不可能触发真实查询或写操作。
 *
 * 页面是纯静态的（数据是构建期常量），`next build` 不需要外网。
 */

export const metadata = {
  title: "演示模式 · 饭搭子 AI",
  description:
    "使用一次真实查询冻结下来的示例数据，展示饭搭子 AI 的完整结果界面。演示数据，不是实时查询。",
};

export default function DemoPage() {
  return (
    <>
      <SiteHeader active="demo" />

      <main
        id="main"
        className="page-glow mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-7 sm:px-6 sm:pt-10 lg:px-8"
      >
        <section className="mb-5">
          <p className="eyebrow">演示模式</p>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight text-ink-900 sm:text-[34px]">
            完整界面长什么样
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-ink-600">
            这里展示的是「一句话 → 三份方案」的完整结果界面。数据来自一次真实的门店查询与官方算价，
            被原样冻结成示例，因此无需任何凭证即可查看。
            <span className="font-medium text-ink-900">它不代表现在的门店价格。</span>
          </p>
        </section>

        <DemoDecisionView />

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-6 text-[11px] leading-5 text-ink-400">
          <span>饭搭子 AI · MealMate AI · v0.5.0 · 演示数据</span>
          <span>演示模式不发起任何真实查询，也不提供下单、支付、领券</span>
        </footer>
      </main>
    </>
  );
}
