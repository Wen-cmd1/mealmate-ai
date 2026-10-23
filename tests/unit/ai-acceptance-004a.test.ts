import { describe, expect, it } from "vitest";

import { decide, resolveBudget } from "@/lib/ai/decision-agent";
import { parseIntentByRules } from "@/lib/ai/parse-intent";
import type { DecideContext } from "@/lib/ai/types";
import { createFakeProvider } from "../helpers/fake-provider";

/**
 * 任务 004-A 验收时发现的问题 → 回归锁。
 *
 * 这里每一条都对应一次**真实验收跑出来的错误行为**，不是假设出来的场景：
 *
 * A. `不想吃昨天吃过的汉堡，换个口味` 被解析成「想吃汉堡」，
 *    推荐里真的出现了「汉堡开心乐园餐」——否定被读反，最严重的一类错误。
 * B. `预算 20 元左右，但绝对不能超过 25 元` 只留下了 25，把"期望 20"吞掉了。
 * C. `我只有 3 块钱` 在响应里被说成"按 ¥5.00 来找"，等于替用户改了预算。
 * D. 用户说"昨天吃了汉堡"时，没有说明系统并没有他的历史记录。
 * E. 提供预算上下文时，没有说明账本可能漏记、影响只是"按已记录消费估算"。
 * F. 排除项免责没有说明"无法判断具体辣度、按保守策略整类排除"。
 */

const STORE = {
  city: "广州市",
  keyword: "天河",
  storeCode: "1400359",
  orderType: 1 as const,
  beType: 1 as const,
};

function ctx(overrides: Partial<DecideContext> = {}): DecideContext {
  return { ...STORE, ...overrides };
}

function ruleIntent(text: string) {
  return parseIntentByRules(text).intent;
}

function joinedNames(result: Awaited<ReturnType<typeof decide>>): string {
  return result.recommendations
    .flatMap((item) => item.recommendation.items.map((line) => line.name))
    .join(" ");
}

describe("A. 否定条件不能被读反（验收实测缺陷）", () => {
  it("「不想吃昨天吃过的汉堡，换个口味」→ 汉堡必须进排除，不能进偏好", () => {
    const intent = ruleIntent("不想吃昨天吃过的汉堡，换个口味");

    expect(intent.avoid).toContain("汉堡");
    expect(intent.preferences).not.toContain("汉堡");
  });

  it("真实菜单下，这条输入给出的推荐里不能出现任何名称含「汉堡」的餐品", async () => {
    const result = await decide(
      { text: "不想吃昨天吃过的汉堡，换个口味", context: ctx() },
      { mealProvider: createFakeProvider() },
    );

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(joinedNames(result)).not.toContain("汉堡");
  });

  it("否定词与品类之间插了别的词也算排除（这是原来的漏排点）", () => {
    expect(ruleIntent("不想吃昨天吃过的汉堡").avoid).toContain("汉堡");
    expect(ruleIntent("不要前天点过的鸡腿").avoid).toContain("鸡肉");
    expect(ruleIntent("受不了上次买的辣翅").avoid).toContain("辣");
  });

  it("否定窗口不能跨逗号/空白，否则会把用户想要的东西也排除掉", () => {
    const intent = ruleIntent("不想吃汉堡，想吃鸡肉");
    expect(intent.avoid).toContain("汉堡");
    expect(intent.preferences).toContain("鸡肉");

    // 逗号分隔
    const spaced = ruleIntent("我今天不想吃汉堡 想来点鸡肉");
    expect(spaced.avoid).not.toContain("鸡肉");
    expect(spaced.preferences).toContain("鸡肉");
  });
});

describe("B. 期望价位与硬上限必须同时保留（验收实测缺陷）", () => {
  it("「预算 20 元左右，但绝对不能超过 25 元」→ 期望 20 + 硬上限 25", () => {
    const intent = ruleIntent("预算 20 元左右，但绝对不能超过 25 元");

    expect(intent.budgetKind).toBe("hard_cap");
    expect(intent.budgetFen).toBe(2500);
    expect(intent.preferredFen).toBe(2000);
  });

  it("预算裁决：按期望价位找，硬上限另外保留", () => {
    const decision = resolveBudget(ruleIntent("预算 20 元左右，但绝对不能超过 25 元"));

    expect(decision.appliedFen).toBe(2000);
    expect(decision.hardCapFen).toBe(2500);
    expect(decision.preferredFen).toBe(2000);
    expect(decision.explanation).toContain("20.00");
    expect(decision.explanation).toContain("25.00");
  });

  it("推荐结果既不超过期望价位，也不超过硬上限，并给出说明", async () => {
    const result = await decide(
      { text: "预算 20 元左右，但绝对不能超过 25 元", context: ctx() },
      { mealProvider: createFakeProvider() },
    );

    expect(result.recommendations.length).toBeGreaterThan(0);
    for (const item of result.recommendations) {
      expect(item.recommendation.totalPriceFen).toBeLessThanOrEqual(2000);
    }
    expect(result.warnings.some((w) => w.code === "MIXED_BUDGET_NOTED")).toBe(true);
    expect(result.understood.budgetLabel).toContain("25.00");
  });

  it("只说硬上限时不会凭空造出期望价位", () => {
    const intent = ruleIntent("最多 25 块，想吃鸡肉");
    expect(intent.preferredFen).toBeNull();
    expect(resolveBudget(intent).preferredFen).toBeNull();
  });

  it("期望价位大于硬上限时不采纳（那不叫期望，那就是矛盾）", () => {
    const intent = ruleIntent("大概 30 元左右，但不超过 20 元");
    expect(intent.preferredFen).toBeNull();
    expect(resolveBudget(intent).hardCapFen).toBe(2000);
  });
});

describe("C. 钱不够时不能把用户说的金额悄悄改大（验收实测缺陷）", () => {
  it("「我只有 3 块钱」→ 硬上限仍是 ¥3.00，说明里必须点明低于平台最低金额", () => {
    const decision = resolveBudget(ruleIntent("我只有 3 块钱，能吃什么？"));

    expect(decision.mentionedFen).toBe(300);
    expect(decision.hardCapFen).toBe(300);
    expect(decision.explanation).toContain("3.00");
    expect(decision.explanation).toContain("低于");
  });

  it("端到端：不发起查询、不给任何推荐，且原因说清是「钱不够」而不是「信息不足」", async () => {
    const result = await decide(
      { text: "我只有 3 块钱，能吃什么？", context: ctx() },
      { mealProvider: createFakeProvider() },
    );

    expect(result.recommendations).toEqual([]);
    expect(result.emptyReason ?? "").toContain("低于");
    expect(result.emptyReason ?? "").toContain("3.00");
    expect(result.source.toolsUsed).toEqual([]);
    // 不能再甩一句"预算已调整到 ¥5.00"——那等于替用户改了预算
    expect(result.warnings.some((w) => w.code === "BUDGET_CLAMPED_BY_API_LIMIT")).toBe(false);
  });
});

describe("D. 不假装拥有饮食历史（四.2）", () => {
  it("用户提到昨天吃过什么时，必须声明系统没有历史记录", async () => {
    const result = await decide(
      { text: "不想吃昨天吃过的汉堡，换个口味", context: ctx() },
      { mealProvider: createFakeProvider() },
    );

    expect(result.intent.historyTags).toContain("汉堡");
    const copy = [...result.caveats, ...result.warnings.map((w) => w.message)].join(" ");
    expect(copy).toContain("没有你的历史用餐记录");
    expect(result.warnings.some((w) => w.code === "HISTORY_NOT_RECORDED")).toBe(true);
  });

  it("响应里不得出现「根据你的历史（记录/订单）」这类未发生的读取", async () => {
    const result = await decide(
      { text: "不想吃昨天吃过的汉堡，换个口味", context: ctx() },
      { mealProvider: createFakeProvider() },
    );

    const copy = JSON.stringify(result);
    expect(copy).not.toMatch(/根据你的历史(记录|订单|消费)/);
    expect(copy).not.toMatch(/你的历史订单/);
  });

  it("用户没提历史时不会冒出历史相关的说明", async () => {
    const result = await decide({ text: "想吃鸡肉，最多 25 块", context: ctx() }, { mealProvider: createFakeProvider() });

    expect(result.intent.historyTags ?? []).toEqual([]);
    expect(result.warnings.some((w) => w.code === "HISTORY_NOT_RECORDED")).toBe(false);
  });
});

describe("E. 账本不完整必须说「按已记录消费估算」（四.3）", () => {
  it("授权预算上下文时，明确说明账本可能漏记", async () => {
    const result = await decide(
      {
        text: "这个月吃饭还剩 300 块，今天想省点",
        context: ctx({
          budget: { authorized: true, remainingFen: 82540, daysRemaining: 11, hardCapFen: 3000 },
        }),
      },
      { mealProvider: createFakeProvider() },
    );

    const copy = result.caveats.join(" ");
    expect(copy).toContain("根据你已记录的消费估算");
    expect(copy).toContain("漏记");
    expect(result.warnings.some((w) => w.code === "LEDGER_ESTIMATED")).toBe(true);
  });

  it("没提供预算上下文时不出现账本推算说明", async () => {
    const result = await decide({ text: "想吃鸡肉", context: ctx() }, { mealProvider: createFakeProvider() });

    expect(result.caveats.join(" ")).not.toContain("根据你已记录的消费估算");
    expect(result.warnings.some((w) => w.code === "LEDGER_ESTIMATED")).toBe(false);
  });

  it("用户口头说的「还剩 300」不会覆盖账本，也不会被当成单餐预算", async () => {
    const result = await decide(
      { text: "这个月吃饭还剩 300 块，今天想省点", context: ctx() },
      { mealProvider: createFakeProvider() },
    );

    expect(result.intent.remainingMentionFen).toBe(30000);
    expect(result.budget.appliedFen).toBe(2500);
    expect(result.budget.source).toBe("default");
    expect(result.warnings.some((w) => w.code === "LEDGER_UNTOUCHED")).toBe(true);
  });
});

describe("F. 辣度：只承诺「按名称排除」，不宣称理解具体辣度（四.1）", () => {
  it("排除免责里必须写明无法判断辣度、采取保守整类排除", async () => {
    const result = await decide(
      { text: "不要太辣，想吃鸡肉", context: ctx() },
      { mealProvider: createFakeProvider() },
    );

    const copy = result.caveats.join(" ");
    expect(copy).toContain("无法判断具体辣度");
    expect(copy).toContain("保守");
    expect(result.warnings.some((w) => w.code === "EXCLUSION_NOT_GUARANTEED")).toBe(true);
  });

  it("「不要太辣」与「不吃辣」都按整类排除处理，并且不出现绝对化承诺", async () => {
    const mild = await decide({ text: "不要太辣", context: ctx() }, { mealProvider: createFakeProvider() });
    const none = await decide({ text: "不吃辣", context: ctx() }, { mealProvider: createFakeProvider() });

    expect(mild.intent.avoid).toContain("辣");
    expect(none.intent.avoid).toContain("辣");
    // 标签层面不区分程度，但文案必须承认这一点
    expect(mild.caveats.join(" ")).toContain("没有区别");

    const allCopy = [...mild.caveats, ...mild.warnings.map((w) => w.message), ...mild.recommendations.flatMap((r) => r.fitNotes)].join(" ");
    const stripped = allCopy.replaceAll("无法保证绝对不含", "").replaceAll("不能保证绝对不含", "");
    expect(stripped).not.toMatch(/绝对不含|保证不含|百分之百不含|100%\s*不含/);
  });
});
