import Link from "next/link";

import { NaturalLanguageDecision } from "@/components/ai/NaturalLanguageDecision";
import { SingleMealDecision } from "@/components/SingleMealDecision";
import { ModeCard } from "@/components/ModeCard";
import { SiteHeader } from "@/components/ui/SiteHeader";

/**
 * 首页（任务 005 视觉重设计）。
 *
 * 首屏只回答两个问题：
 * 1. 这是个什么东西 —— 「今天吃什么？一句话帮你决定。」
 * 2. 我现在能干什么 —— 一句话输入框 + 一个主按钮 + 四个快捷场景。
 *
 * 技术细节（架构、工具名、阶段说明）全部下沉到页面底部的折叠区：
 * 评审要看得到，但普通用户不该在第一屏被术语拦住。
 *
 * 页面壳依然静态可渲染：MCP 状态与推荐数据都在客户端异步获取，
 * 因此首屏不依赖外网，`next build` 也不会在构建期访问麦当劳接口。
 */
export default function Home() {
  return (
    <>
      <SiteHeader active="home" />

      <main
        id="main"
        className="page-glow mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pt-12 lg:px-8"
      >
        {/* ---------- 首屏 ---------- */}
        <section className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-[11px] font-medium text-brand-700">
            <span aria-hidden className="size-1.5 rounded-full bg-brand-500" />
            只读查询 · 官方价格核验 · 不下单不领券
          </span>

          <h1 className="mt-4 text-[30px] font-bold leading-[1.22] tracking-tight text-ink-900 sm:text-[42px] sm:leading-[1.16]">
            <span className="block sm:inline">今天吃什么？</span>{" "}
            <span className="block sm:inline">
              <span
                className="whitespace-nowrap px-0.5 text-brand-600"
                style={{
                  // 高亮笔效果：只染文字下半部分，不会像下划线那样穿过笔画
                  backgroundImage:
                    "linear-gradient(to top, var(--brand-100) 0 36%, transparent 36%)",
                }}
              >
                一句话
              </span>
              帮你决定。
            </span>
          </h1>

          <p className="mx-auto mt-4 max-w-xl text-[14px] leading-7 text-ink-600 sm:text-[15px]">
            按预算、口味和真实餐品价格，找到适合这一顿的选择。
          </p>
        </section>

        {/* ---------- 主入口 ---------- */}
        <div className="mt-7 sm:mt-9">
          <NaturalLanguageDecision />
        </div>

        <p className="mx-auto mt-3 flex max-w-3xl flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11px] leading-5 text-ink-400">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-mint-500" />
          菜单与价格来自麦当劳官方接口实时返回，每份方案都逐份调用官方算价核验。
          <span className="text-ink-500">查不到就说查不到，不用估算价格凑数。</span>
        </p>

        {/* ---------- 手动预算（次级入口） ---------- */}
        <section className="mt-12 sm:mt-16">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="eyebrow">另一种用法</p>
              <h2 className="mt-1 text-[17px] font-semibold tracking-tight text-ink-900">
                或者，自己给一个单餐预算
              </h2>
            </div>
            <p className="text-[12px] leading-5 text-ink-500">
              不想打字？直接说预算，同样出三份经过官方核价的正餐。
            </p>
          </div>
          <SingleMealDecision />
        </section>

        {/* ---------- 长期预算 / 演示 ---------- */}
        <section className="mt-12 grid gap-4 sm:mt-16 sm:grid-cols-2">
          <ModeCard
            eyebrow="也适合"
            title="这个月还能吃多少？"
            description="按周 / 按月设一个餐饮预算，记录已经花掉的餐费，看清剩余天数与后续日均，再用剩余预算去推荐今天这一顿。"
            status="available"
            statusText="可用"
            href="/budget"
            actionText="进入长期预算 →"
          />
          <ModeCard
            eyebrow="评审 / 演示"
            title="没有凭证也能看效果"
            description="演示模式使用一份冻结的示例数据（来自一次真实查询），全程标注「演示数据」，不连门店接口、不下单、不记账。"
            status="available"
            statusText="演示数据"
            href="/demo"
            actionText="查看演示 →"
          />
        </section>

        {/* ---------- 技术与边界说明（折叠） ---------- */}
        <details className="surface mt-12 px-5 py-4 sm:mt-16">
          <summary className="cursor-pointer select-none text-[13px] font-semibold text-ink-900">
            这个系统是怎么运转的，以及它明确做不到什么
          </summary>
          <div className="mt-4 space-y-4 text-[12px] leading-6 text-ink-600">
            <div>
              <p className="text-[12px] font-semibold text-ink-900">一句话之后发生了什么</p>
              <ol className="mt-1 space-y-1">
                <li>1. 先判断你想表达什么（预算、餐次、想吃什么、不吃什么、这一顿想要什么）——没把握时宁可追问，也不猜。</li>
                <li>
                  2. 用你选的门店查出这家店<strong className="font-semibold text-ink-900">当前</strong>的真实菜单。
                </li>
                <li>3. 挑出三份完整正餐（省钱 / 均衡 / 满足），逐份调用官方算价接口核对价格。</li>
                <li>4. 如实告诉你每一份的价格、组成、为什么推荐，以及这次没能确认的东西。</li>
              </ol>
            </div>

            <div>
              <p className="text-[12px] font-semibold text-ink-900">明确做不到的事</p>
              <ul className="mt-1 space-y-1">
                <li>· 不宣称营养均衡、不提供医疗或减重建议：营养数据与菜单 SKU 没有可靠关联字段。</li>
                <li>· 不保证过敏安全：接口没有配料表，「不吃某样」只能按菜名关键词做过滤，无法保证绝对不含。</li>
                <li>· 不领券、不下单、不支付：全部为只读查询，实际支付以门店为准。</li>
                <li>· 不假装记得你的饮食历史：系统没有历史订单数据，只用你这句话里自己说过的信息。</li>
              </ul>
            </div>

            <div>
              <p className="text-[12px] font-semibold text-ink-900">数据与隐私</p>
              <ul className="mt-1 space-y-1">
                <li>· 菜单、门店、价格全部来自麦当劳官方接口（只读），不做本地缓存冒充实时。</li>
                <li>· 长期预算与消费账本只存在你当前浏览器里，没有云端同步；不勾选就不会上传任何金额。</li>
                <li>· 意图解析可以选择接入大模型；未配置时以「规则解析」运行，界面会如实标注，不会冒充大模型。</li>
              </ul>
            </div>

            <div>
              <p className="text-[12px] font-semibold text-ink-900">版本</p>
              <p className="mt-1">
                v0.5.0 · 单餐决策（任务 002）＋ 长期预算（任务 003）＋ 自然语言决策（任务 004）＋ 视觉与交互重设计（任务 005）。
              </p>
            </div>
          </div>
        </details>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-6 text-[11px] leading-5 text-ink-400">
          <span>饭搭子 AI · MealMate AI · v0.5.0</span>
          <span>
            菜单与价格以麦当劳官方接口实时返回为准，实际支付以门店为准 ·{" "}
            <Link href="/demo" className="underline-offset-2 hover:text-brand-700 hover:underline">
              演示模式
            </Link>
          </span>
        </footer>
      </main>
    </>
  );
}
