import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEMO_DECISION, DEMO_META } from "@/lib/demo/sample-decision";

/**
 * 演示模式（任务 005 §9）的守门测试。
 *
 * 演示数据最容易出的两个事故：
 * 1. 悄悄换成"现在查一次"，于是它不再是可复现的演示；
 * 2. 演示里混进凭证或伪造的核验状态，被当成真实结果汇报。
 * 这两件事都在这里钉死。
 */

const ROOT = path.resolve(__dirname, "../..");

describe("演示数据：结构与真实性标识", () => {
  it("是一份成功响应，且带满三份方案", () => {
    expect(DEMO_DECISION.success).toBe(true);
    expect(DEMO_DECISION.recommendations).toHaveLength(3);
  });

  it("三份方案都经过官方算价核验，且总价等于核验价", () => {
    for (const item of DEMO_DECISION.recommendations) {
      const rec = item.recommendation;
      expect(rec.priceVerified).toBe(true);
      expect(rec.verifiedPriceFen).not.toBeNull();
      expect(rec.totalPriceFen).toBe(rec.verifiedPriceFen);
    }
  });

  it("恰好有一个首选方案，其余为备选", () => {
    const primaries = DEMO_DECISION.recommendations.filter((item) => item.primary);
    expect(primaries).toHaveLength(1);
    expect(DEMO_DECISION.recommendations.filter((item) => !item.primary)).toHaveLength(2);
  });

  it("解析模式如实标注为规则解析（不冒充大模型）", () => {
    expect(DEMO_DECISION.mode).toBe("RULE_FALLBACK");
    expect(DEMO_DECISION.ai?.model).toBeUndefined();
    expect(DEMO_DECISION.ai?.fallbackReason).toBeTruthy();
  });

  it("元信息可追溯到一次具体查询（时间、门店、工具）", () => {
    expect(DEMO_META.store).toContain(String(DEMO_DECISION.source.storeCode));
    expect(DEMO_META.capturedAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(DEMO_META.capturedAt))).toBe(false);
    expect(DEMO_META.toolCalls.join(" ")).toContain("calculate-price");
    expect(DEMO_META.note).toMatch(/冻结|示例/);
  });
});

describe("演示数据：不含凭证", () => {
  it("序列化后不出现 token / key 的值与上游域名", () => {
    const serialized = JSON.stringify(DEMO_DECISION);
    expect(serialized).not.toMatch(/Bearer\s/i);
    // 变量名本身出现在"未配置大模型"的说明里是允许的（那是事实陈述），
    // 但绝不能出现"变量名 = 具体值"这种赋值形态
    expect(serialized).not.toMatch(/(AI_API_KEY|MCD_MCP_TOKEN|AI_BASE_URL)\s*[=:]\s*\S{6,}/i);
    expect(serialized).not.toMatch(/mcp\.mcd\.cn/);
    // 32 位以上的连续十六进制（token 常见形态）：traceId 这类 32 位十六进制是允许的，
    // 因此只拦 33 位以上，避免误伤真实 traceId
    expect(serialized).not.toMatch(/[A-Fa-f0-9]{33,}/);
  });

  it("演示数据文件本身没有读取环境变量的代码", () => {
    const source = fs.readFileSync(path.join(ROOT, "lib/demo/sample-decision.ts"), "utf8");
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/fetch\(/);
  });
});

describe("演示模式与真实模式物理隔离", () => {
  const demoPage = fs.readFileSync(path.join(ROOT, "app/demo/page.tsx"), "utf8");
  const demoView = fs.readFileSync(
    path.join(ROOT, "components/demo/DemoDecisionView.tsx"),
    "utf8",
  );

  it("/demo 不引用任何请求逻辑，也不会渲染首页的交互组件", () => {
    const combined = `${demoPage}\n${demoView}`;
    expect(combined).not.toMatch(/fetch\(/);
    expect(combined).not.toMatch(/NaturalLanguageDecision|SingleMealDecision|BudgetRecommend/);
    expect(combined).not.toMatch(/\/api\//);
  });

  it("/demo 页面显著标注「演示数据」", () => {
    expect(demoView).toContain("演示数据");
    expect(demoView).toContain("不是实时查询");
  });

  it("首页没有「真实查询失败就切演示」的自动回退逻辑", () => {
    const home = fs.readFileSync(path.join(ROOT, "app/page.tsx"), "utf8");
    const ask = fs.readFileSync(
      path.join(ROOT, "components/ai/NaturalLanguageDecision.tsx"),
      "utf8",
    );
    for (const source of [home, ask]) {
      expect(source).not.toMatch(/DEMO_DECISION|sample-decision/);
      expect(source).not.toMatch(/fallback.*demo/i);
    }
  });
});
