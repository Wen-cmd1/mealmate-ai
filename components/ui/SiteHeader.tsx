import Link from "next/link";

import { McpStatusBadge } from "@/components/McpStatusBadge";
import { BrandLockup } from "./Brand";

/**
 * 全站页头（服务端组件，无状态）。
 *
 * 三个入口常驻：单餐决策 / 长期预算 / 演示。任务 005 §8 要求「切换预算模式保持合理导航」，
 * 所以导航在所有页面都保持一致，当前页高亮，移动端也能一眼看到自己在哪。
 *
 * MCP 连接状态放在这里而不是首屏正中：它属于「数据是否可信」的辅助信息，
 * 用户真正关心的是第一句话能不能直接问。
 */

const NAV = [
  { key: "home", href: "/", label: "单餐决策" },
  { key: "budget", href: "/budget", label: "长期预算" },
  { key: "demo", href: "/demo", label: "演示" },
] as const;

export function SiteHeader({ active }: { active: "home" | "budget" | "demo" }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-cream/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0 rounded-2xl" aria-label="饭搭子 AI 首页">
          <BrandLockup />
        </Link>

        <nav aria-label="主要导航" className="order-3 w-full sm:order-2 sm:w-auto">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => {
              const current = item.key === active;
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={`inline-flex items-center rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
                      current
                        ? "bg-brand-50 text-brand-700"
                        : "text-ink-500 hover:bg-white hover:text-ink-900"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto order-2 shrink-0 sm:order-3">
          <McpStatusBadge />
        </div>
      </div>
    </header>
  );
}
