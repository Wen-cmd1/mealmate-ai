import { describe, expect, it } from "vitest";

import { buildCandidates, filterMenu } from "@/lib/recommendation/filters";
import {
  BALANCED_TARGET_RATIO,
  COMPLETENESS_SCORES,
  PLAN_WEIGHTS,
  prioritizeComplete,
  priceFitScore,
  rankCandidates,
  scoreCandidate,
} from "@/lib/recommendation/scoring";
import type { Candidate } from "@/lib/recommendation/types";
import type { NutritionInfo } from "@/types/meal";
import { makeMenuItem, makeMenu } from "../helpers/fake-provider";

/**
 * 评分算法测试。
 *
 * 重点验证两件事：
 * 1. 三种方案的权重确实产生了不同的排序倾向；
 * 2. **营养数据完全不参与打分**（任务书要求：无可信关联时不得推断）。
 */

function candidateOf(items: Parameters<typeof makeMenuItem>[0][], composition: Candidate["composition"]): Candidate {
  const built = buildCandidates(filterMenu(makeMenu(items.map((i) => makeMenuItem(i))).items));
  const found = built.find((c) => c.composition === composition);
  if (!found) throw new Error(`没有构造出 ${composition} 候选`);
  return found;
}

const chickenBurger = candidateOf([{ code: "B1", name: "板烧鸡腿堡", priceFen: 2350 }], "main");
const beefBurger = candidateOf([{ code: "B2", name: "巨无霸", priceFen: 2550 }], "main");
const combo = candidateOf([{ code: "C1", name: "大堡口福三件套", priceFen: 2290 }], "combo");

describe("价格贴合度", () => {
  it("省钱方案：越便宜分越高", () => {
    expect(priceFitScore("save", 1000, 2500)).toBeGreaterThan(priceFitScore("save", 2000, 2500));
    expect(priceFitScore("save", 2500, 2500)).toBe(0);
  });

  it("均衡方案：越接近目标价位（预算的 75%）分越高", () => {
    const target = Math.round(2500 * BALANCED_TARGET_RATIO);
    expect(priceFitScore("balanced", target, 2500)).toBeCloseTo(1, 5);
    expect(priceFitScore("balanced", 1000, 2500)).toBeLessThan(priceFitScore("balanced", target, 2500));
    expect(priceFitScore("balanced", 2500, 2500)).toBeLessThan(
      priceFitScore("balanced", target, 2500),
    );
  });

  it("预算为 0 或非法时返回 0，不产生 NaN", () => {
    expect(priceFitScore("save", 100, 0)).toBe(0);
    expect(Number.isFinite(priceFitScore("balanced", 100, 0))).toBe(true);
  });
});

describe("餐品完整性", () => {
  it("套餐 > 主食+配餐 > 主食+饮料 > 单主食", () => {
    expect(COMPLETENESS_SCORES.combo).toBeGreaterThan(COMPLETENESS_SCORES["main+side"]);
    expect(COMPLETENESS_SCORES["main+side"]).toBeGreaterThan(COMPLETENESS_SCORES["main+drink"]);
    expect(COMPLETENESS_SCORES["main+drink"]).toBeGreaterThan(COMPLETENESS_SCORES.main);
  });

  it("均衡方案会把套餐排到单主食前面", () => {
    const filtered = filterMenu(
      makeMenu([
        makeMenuItem({ code: "B1", name: "板烧鸡腿堡", priceFen: 1875 }),
        makeMenuItem({ code: "C1", name: "大堡口福三件套", priceFen: 1875 }),
      ]).items,
    );
    const ranked = rankCandidates(buildCandidates(filtered), {
      type: "balanced",
      budgetFen: 2500,
    });
    expect(prioritizeComplete(ranked)[0].candidate.composition).toBe("combo");
  });
});

describe("偏好与权重", () => {
  it("同等条件下命中偏好的候选得分更高", () => {
    const withPref = scoreCandidate(chickenBurger, {
      type: "satisfy",
      budgetFen: 2500,
      preferences: ["鸡肉"],
    });
    const withoutPref = scoreCandidate(beefBurger, {
      type: "satisfy",
      budgetFen: 2500,
      preferences: ["鸡肉"],
    });
    expect(withPref.breakdown.preference).toBe(1);
    expect(withoutPref.breakdown.preference).toBe(0);
    expect(withPref.score).toBeGreaterThan(withoutPref.score);
  });

  it("未选偏好时该维度权重归零，且不会让所有候选同分", () => {
    const result = scoreCandidate(chickenBurger, { type: "save", budgetFen: 2500 });
    expect(result.breakdown.preference).toBe(0);
    expect(result.matchedPreferences).toEqual([]);

    const cheaper = candidateOf([{ code: "B3", name: "麦香鸡", priceFen: 1700 }], "main");
    const a = scoreCandidate(cheaper, { type: "save", budgetFen: 2500 });
    expect(a.score).not.toBe(result.score);
  });

  it("三种方案权重各自合计为 1", () => {
    for (const type of ["save", "balanced", "satisfy"] as const) {
      const w = PLAN_WEIGHTS[type];
      expect(w.priceFit + w.completeness + w.preference + w.value).toBeCloseTo(1, 5);
    }
  });

  it("省钱方案的偏好权重很小，价格是主导因素", () => {
    expect(PLAN_WEIGHTS.save.preference).toBeLessThanOrEqual(0.05);
    expect(PLAN_WEIGHTS.save.priceFit).toBeGreaterThan(0.7);
  });
});

describe("排序稳定性", () => {
  it("同分时按价格升序、再按 SKU 编码升序，结果与输入顺序无关", () => {
    const items = [
      makeMenuItem({ code: "B9", name: "巨无霸", priceFen: 2000 }),
      makeMenuItem({ code: "B1", name: "巨无霸", priceFen: 2000 }),
      makeMenuItem({ code: "B5", name: "巨无霸", priceFen: 1900 }),
    ];
    const candidates = buildCandidates(filterMenu(makeMenu(items).items));
    const forward = rankCandidates(candidates, { type: "save", budgetFen: 2500 }).map(
      (s) => s.candidate.primaryCode,
    );
    const backward = rankCandidates([...candidates].reverse(), {
      type: "save",
      budgetFen: 2500,
    }).map((s) => s.candidate.primaryCode);
    expect(forward).toEqual(backward);
    expect(forward[0]).toBe("B5"); // 最便宜
    expect(forward[1]).toBe("B1"); // 同价时编码更小
  });
});

describe("营养不参与打分", () => {
  it("即使强行塞入营养数据，得分也完全不变（当前 nutrition 恒为 null）", () => {
    const withNutrition = {
      ...chickenBurger,
      items: chickenBurger.items.map((item) => ({
        ...item,
        nutrition: {
          energyKcal: 999,
          proteinG: 50,
          fatG: 50,
          carbohydrateG: 50,
          source: "fake",
        } as NutritionInfo,
      })),
    };

    const plain = scoreCandidate(chickenBurger, {
      type: "balanced",
      budgetFen: 2500,
      preferences: ["鸡肉"],
    });
    const injected = scoreCandidate(withNutrition, {
      type: "balanced",
      budgetFen: 2500,
      preferences: ["鸡肉"],
    });

    expect(injected.score).toBe(plain.score);
    expect(Object.keys(plain.breakdown).sort()).toEqual([
      "completeness",
      "preference",
      "priceFit",
      "value",
    ]);
  });
});

describe("促销力度", () => {
  it("有原价差额时 value > 0，无促销时为 0", () => {
    const onSale = candidateOf(
      [{ code: "C1", name: "大堡口福三件套", priceFen: 1500, originalPriceFen: 3000 }],
      "combo",
    );
    const normal = candidateOf([{ code: "C2", name: "酥脆无双套餐", priceFen: 2000 }], "combo");

    expect(scoreCandidate(onSale, { type: "save", budgetFen: 2500 }).breakdown.value).toBeCloseTo(
      0.5,
      5,
    );
    expect(scoreCandidate(normal, { type: "save", budgetFen: 2500 }).breakdown.value).toBe(0);
  });

  it("套餐本身价格越高，不会因为组合件数多而被虚高评价", () => {
    const fancy = scoreCandidate(combo, { type: "save", budgetFen: 2500 });
    expect(fancy.score).toBeLessThan(1);
    expect(fancy.score).toBeGreaterThan(0);
  });
});
