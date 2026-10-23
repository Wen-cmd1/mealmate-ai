import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 设计系统与导航一致性的守门测试（任务 005 §3 / §7 / §8）。
 *
 * 视觉规范是"软"的，但有几条必须被钉住：
 * 主色只能来自我们的品牌变量、不能被改成麦当劳官方红黄、
 * 焦点环与「减少动效」不能被删掉、三个页面必须共用同一套导航。
 */

const ROOT = path.resolve(__dirname, "../..");

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

describe("色彩与令牌", () => {
  const css = read("app/globals.css");

  it("主色 / 底色 / 点缀色都有单一来源", () => {
    for (const token of ["--brand-500", "--cream", "--cream-deep", "--mint-500", "--ink-900", "--line"]) {
      expect(css).toContain(token);
    }
  });

  it("颜色被映射进 Tailwind theme（组件里才能用 bg-brand-500 这类类名）", () => {
    for (const mapping of ["--color-brand-500", "--color-cream", "--color-mint-500", "--color-ink-900"]) {
      expect(css).toContain(mapping);
    }
  });

  it("没有使用麦当劳官方红黄作为品牌色（避免身份混淆）", () => {
    const normalized = css.toUpperCase();
    expect(normalized).not.toContain("#DA291C");
    expect(normalized).not.toContain("#FFC72C");
    expect(normalized).not.toContain("#FFBC0D");
  });

  it("保留键盘焦点环与「减少动效」适配", () => {
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion");
  });

  it("移动端不会被强制缩放锁定（不写 user-scalable=no）", () => {
    const layout = read("app/layout.tsx");
    expect(layout).not.toContain("user-scalable=no");
    expect(layout).not.toContain("maximumScale: 1");
  });
});

describe("导航一致性（§8 切换预算模式保持合理导航）", () => {
  const pages = ["app/page.tsx", "app/budget/page.tsx", "app/demo/page.tsx"];

  it("三个页面共用 SiteHeader，且各自高亮自己", () => {
    expect(read("components/ui/SiteHeader.tsx")).toContain("/budget");
    expect(read(pages[0])).toContain('<SiteHeader active="home" />');
    expect(read(pages[1])).toContain('<SiteHeader active="budget" />');
    expect(read(pages[2])).toContain('<SiteHeader active="demo" />');
  });

  it("每个页面都有可跳转的主内容锚点（无障碍跳过导航）", () => {
    for (const page of pages) {
      expect(read(page)).toContain('id="main"');
    }
    expect(read("app/layout.tsx")).toContain('href="#main"');
  });
});

describe("移动端适配（§7）", () => {
  it("首页主容器在 360px 下有左右内边距，不会贴边", () => {
    const home = read("app/page.tsx");
    expect(home).toMatch(/px-4[^"]*sm:px-6/);
  });

  it("结果区在窄屏是单列，宽屏才分栏", () => {
    const ask = read("components/ai/NaturalLanguageDecision.tsx");
    expect(ask).toContain("md:grid-cols-2");
    // 三份方案不是一上来就三栏（窄屏会被压扁）
    expect(ask).not.toContain("grid gap-3 lg:grid-cols-3");
  });

  it("主操作按钮在移动端是整行，桌面端收窄", () => {
    expect(read("components/ai/NaturalLanguageDecision.tsx")).toContain("w-full px-6 text-[15px] sm:w-auto");
  });
});
