import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * 根布局。
 *
 * 说明：脚手架默认使用 next/font/google 拉取 Geist 字体。
 * 本项目后续要在无外网的评审/离线环境跑 `next build`，
 * 构建期访问 Google Fonts 会让构建不稳定，因此改用系统字体栈（见 globals.css）。
 *
 * 任务 005 只把整体底色换成奶油白、文字换成暖调墨色，
 * 结构上仍保持「一个 html + 一个 body」的最小壳，不做全局状态。
 */

export const metadata: Metadata = {
  title: "饭搭子 AI · 今天吃什么，一句话帮你决定",
  description:
    "按预算、口味和真实餐品价格，找到适合这一顿的选择。菜单与价格来自麦当劳官方接口实时查询，每份方案都经官方算价核验。",
  applicationName: "MealMate AI · 饭搭子 AI",
};

export const viewport: Viewport = {
  themeColor: "#fff5ef",
  width: "device-width",
  initialScale: 1,
  // 允许缩放：不做「禁止缩放」那种以可访问性换布局的做法
  maximumScale: 5,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-cream text-ink-900">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-700 focus:shadow-lg"
        >
          跳到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
