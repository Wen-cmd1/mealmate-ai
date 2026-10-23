import { describe, expect, it } from "vitest";

import { resolveBudget, sanitizeContext, validateText } from "@/lib/ai/decision-agent";
import { parseIntentByRules } from "@/lib/ai/parse-intent";
import { AiError, type AiWarning, type DecideContext } from "@/lib/ai/types";

/**
 * 预算裁决测试。
 *
 * 这是任务 004 里最容易被"顺手写错"的一段逻辑，所以单独测：
 * - 硬上限 / 软偏好 / 计划建议 / 默认值 四种来源；
 * - 用户这次说的金额**只能被下调**，永远不会把已设的硬上限改大；
 * - 接口区间（¥5~¥200）兜底。
 */

function intentOf(text: string) {
  return parseIntentByRules(text).intent;
}

function contextWith(hardCapFen?: number, suggestedMealBudgetFen?: number): DecideContext {
  return {
    city: "广州市",
    keyword: "天河",
    storeCode: "1400359",
    orderType: 1,
    beType: 1,
    budget: { authorized: true, hardCapFen, suggestedMealBudgetFen },
  };
}

describe("预算来源", () => {
  it("用户说硬上限 → 用它，并标记为硬上限", () => {
    const decision = resolveBudget(intentOf("最多 20 块"));
    expect(decision.appliedFen).toBe(2000);
    expect(decision.source).toBe("user_hard_cap");
    expect(decision.kind).toBe("hard_cap");
    expect(decision.hardCapFen).toBe(2000);
  });

  it("用户说「20 元左右」→ 软偏好，且不会超过上下文硬上限", () => {
    const decision = resolveBudget(intentOf("20 元左右"));
    expect(decision.source).toBe("user_soft_target");
    expect(decision.hardCapFen).toBeNull();

    const clamped = resolveBudget(intentOf("50 元左右"), contextWith(2500));
    expect(clamped.appliedFen).toBe(2500);
    expect(clamped.clampedByContext).toBe(true);
    expect(clamped.hardCapFen).toBe(2500);
  });

  it("用户没提金额时，优先用长期预算推算的建议值", () => {
    const decision = resolveBudget(intentOf("想吃鸡肉"), contextWith(3000, 1800));
    expect(decision.appliedFen).toBe(1800);
    expect(decision.source).toBe("plan_suggestion");
  });

  it("没有建议值但有硬上限时用硬上限", () => {
    const decision = resolveBudget(intentOf("想吃鸡肉"), contextWith(2200));
    expect(decision.appliedFen).toBe(2200);
    expect(decision.source).toBe("context_hard_cap");
  });

  it("什么都没有时用默认预算，并说明是默认值", () => {
    const decision = resolveBudget(intentOf("想吃鸡肉"));
    expect(decision.appliedFen).toBe(2500);
    expect(decision.source).toBe("default");
    expect(decision.explanation).toContain("默认");
  });
});

describe("硬上限不可被突破", () => {
  it("用户说 50 元但已设上限 25 元 → 只能按 25 元找", () => {
    const decision = resolveBudget(intentOf("我只有 50 元"), contextWith(2500));
    expect(decision.appliedFen).toBe(2500);
    expect(decision.clampedByContext).toBe(true);
    expect(decision.explanation).toContain("超过");
  });

  it("建议值也不会超过硬上限", () => {
    const decision = resolveBudget(intentOf("想吃鸡肉"), contextWith(2000, 9000));
    expect(decision.appliedFen).toBe(2000);
    expect(decision.clampedByContext).toBe(true);
  });

  it("超过接口上限时下调到 ¥200 并标记", () => {
    const decision = resolveBudget(intentOf("最多 500 块"));
    expect(decision.appliedFen).toBe(20_000);
    expect(decision.clampedByApiLimit).toBe(true);
  });

  it("低于接口下限时上调到 ¥5（是否真要推荐由上层决定）", () => {
    const decision = resolveBudget(intentOf("我只有 3 元"));
    expect(decision.appliedFen).toBe(500);
    expect(decision.clampedByApiLimit).toBe(true);
    // 用户原话的金额保留，便于在界面上说明"你说的 3 元买不到"
    expect(decision.mentionedFen).toBe(300);
  });
});

describe("上下文清洗：用户带来的数字不可信", () => {
  function collect() {
    const warnings: AiWarning[] = [];
    return { warnings, run: (raw: DecideContext | undefined) => sanitizeContext(raw, warnings) };
  }

  it("门店编码非法时直接拒绝", () => {
    const { run } = collect();
    expect(() => run({ ...contextWith(), storeCode: "abc" })).toThrowError(AiError);
    expect(() => run({ ...contextWith(), storeCode: "" })).toThrowError(AiError);
  });

  it("越界的预算数值被丢弃，并给出告警", () => {
    const { warnings, run } = collect();
    const context = run({
      ...contextWith(),
      budget: { authorized: true, hardCapFen: 999_999, remainingFen: -999_999_999 },
    });

    expect(context?.budget?.authorized).toBe(true);
    expect(context?.budget?.hardCapFen).toBeUndefined();
    expect(context?.budget?.remainingFen).toBeUndefined();
    expect(warnings.some((w) => w.code === "BUDGET_CLAMPED_BY_CONTEXT")).toBe(true);
  });

  it("没有 authorized: true 时完全不采纳预算", () => {
    const { run } = collect();
    const context = run({
      ...contextWith(),
      budget: { authorized: false, remainingFen: 100 } as unknown as DecideContext["budget"],
    });
    expect(context?.budget).toBeUndefined();
  });

  it("小数、字符串、负数天数都被丢弃", () => {
    const { run } = collect();
    const context = run({
      ...contextWith(),
      mealsLeftToday: "2" as unknown as number,
      budget: {
        authorized: true,
        daysRemaining: 3.5,
        remainingFen: "300" as unknown as number,
      },
    });
    expect(context?.mealsLeftToday).toBeUndefined();
    expect(context?.budget?.daysRemaining).toBeUndefined();
    expect(context?.budget?.remainingFen).toBeUndefined();
  });

  it("城市与关键词被截断到安全长度", () => {
    const { run } = collect();
    const context = run({
      ...contextWith(),
      city: "很".repeat(40),
      keyword: "长".repeat(60),
    });
    expect(context?.city.length).toBeLessThanOrEqual(20);
    expect((context?.keyword ?? "").length).toBeLessThanOrEqual(30);
  });
});

describe("文本校验", () => {
  it("空输入被拒绝", () => {
    expect(() => validateText("   ")).toThrowError(AiError);
    expect(() => validateText(123 as unknown as string)).toThrowError(AiError);
  });

  it("超长输入直接拒绝（不截断，避免丢掉后半句的硬上限）", () => {
    expect(() => validateText("吃".repeat(501))).toThrowError(AiError);
    try {
      validateText("吃".repeat(501));
    } catch (error) {
      expect((error as AiError).kind).toBe("TEXT_TOO_LONG");
      expect((error as Error).message).toContain("500");
    }
  });

  it("正常输入被 trim 后返回", () => {
    expect(validateText("  想吃鸡肉  ")).toBe("想吃鸡肉");
  });
});
