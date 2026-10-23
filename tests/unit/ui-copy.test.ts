import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 界面文案与结构的守门测试（任务 005 §4 / §5 / §11）。
 *
 * 视觉重写最容易顺手改坏的是**承诺**：
 * 把"规则解析"改成"AI 正在思考"，把"无法保证不含"改成"绝对不含"，
 * 或者在客户端组件里读环境变量。这些都不是类型系统能拦住的，用静态断言兜住。
 */

const ROOT = path.resolve(__dirname, "../..");

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function walk(dir: string): string[] {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const child = path.join(full, entry.name);
    if (entry.isDirectory()) out.push(...walk(path.relative(ROOT, child)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path.relative(ROOT, child));
  }
  return out;
}

describe("首页第一屏（§4）", () => {
  const home = read("app/page.tsx");
  const ask = read("components/ai/NaturalLanguageDecision.tsx");

  it("主标题、副标题与主按钮都在（标题被高亮标签切成了三段）", () => {
    expect(home).toContain("今天吃什么？");
    expect(home).toContain("帮你决定。");
    expect(home).toContain("按预算、口味和真实餐品价格，找到适合这一顿的选择。");
    expect(ask).toContain("帮我选这一顿");
  });

  it("输入框提示语是任务书给的那一句", () => {
    expect(ask).toContain("比如：今天只有 25 元，想吃鸡肉，不要太辣。");
  });

  it("四个快捷场景齐全", () => {
    for (const label of ["20 元以内吃什么", "今天想省钱", "想吃点好的", "换个口味"]) {
      expect(ask).toContain(label);
    }
  });

  it("首屏有真实数据来源说明，且不堆技术术语", () => {
    expect(home).toContain("麦当劳官方接口实时返回");
    // 首屏（JSX 开头到自然语言输入区之前）不该出现工具名与 traceId 这类术语
    const jsxStart = home.indexOf("return (");
    const firstScreen = home.slice(jsxStart, home.indexOf("<NaturalLanguageDecision />"));
    expect(firstScreen.length).toBeGreaterThan(0);
    expect(firstScreen).not.toMatch(/query-meals|calculate-price|traceId|MCP/);
  });

  it("手动预算入口排在自然语言入口之后", () => {
    const nl = home.indexOf("<NaturalLanguageDecision />");
    const manual = home.indexOf("<SingleMealDecision />");
    expect(nl).toBeGreaterThan(-1);
    expect(manual).toBeGreaterThan(nl);
  });
});

describe("结果区文案（§5）", () => {
  const card = read("components/ai/AiRecommendationCard.tsx");
  const intent = read("components/ai/IntentSummary.tsx");

  it("卡片包含预算、剩余、门店、核验状态、需选内容五个要素", () => {
    expect(card).toContain("本次预算");
    expect(card).toContain("扣掉这份还剩");
    expect(card).toContain("官方算价已核验");
    expect(card).toContain("点这份时还要在门店选套餐内容");
    expect(card).toContain("门店");
    expect(card).toContain("官方核验价");
  });

  it("规则解析模式用中性描述，不出现「正在使用大模型」这类误导文案", () => {
    const misleading = [/正在使用大模型/, /AI\s*正在思考/, /大模型已理解/, /智能大脑/];
    for (const source of [card, intent, read("components/ai/NaturalLanguageDecision.tsx")]) {
      for (const pattern of misleading) {
        expect(pattern.test(source)).toBe(false);
      }
    }
    expect(intent).toContain("INTENT_PARSE_MODE_LABELS");
  });

  it("规则模式下必须给出「为什么不是大模型解析」的解释入口", () => {
    expect(intent).toContain("为什么不是大模型解析");
    expect(intent).toContain("不等同于大模型的语义理解");
  });

  it("排除条件的数据限制写在结果里，而不是藏进折叠区", () => {
    expect(intent).toContain("不能保证绝对不含");
    expect(read("components/ai/NaturalLanguageDecision.tsx")).toContain("数据边界与前提");
  });

  it("全站不出现「绝对不含 / 保证不含」这类绝对承诺", () => {
    const files = [...walk("components"), ...walk("app")];
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const match of source.matchAll(/绝对不含|保证不含|百分之百不含/g)) {
        const before = source.slice(Math.max(0, match.index - 8), match.index);
        if (!before.includes("无法") && !before.includes("不能")) {
          offenders.push(`${file}: …${before}${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("隐私与凭证（§11）", () => {
  const clientFiles = [...walk("components"), ...walk("app")].filter((file) =>
    /^\s*["']use client["']/m.test(fs.readFileSync(path.join(ROOT, file), "utf8")),
  );

  it("客户端组件不引用任何凭证相关的环境变量", () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      const source = fs.readFileSync(path.join(ROOT, file), "utf8");
      if (/AI_API_KEY|MCD_MCP_TOKEN|AI_BASE_URL/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("客户端组件不直接调用 MCP 地址或上游域名", () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      const source = fs.readFileSync(path.join(ROOT, file), "utf8");
      if (/mcp\.mcd\.cn/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("首页与预算页都声明「不自动记账」或「不下单」", () => {
    expect(read("components/ai/NaturalLanguageDecision.tsx")).toContain("不会自动记账");
    expect(read("app/budget/page.tsx")).toContain("不创建订单");
  });
});
