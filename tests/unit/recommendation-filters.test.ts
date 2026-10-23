import { describe, expect, it } from "vitest";

import {
  buildCandidates,
  classifyItem,
  filterByBudget,
  filterMenu,
  findCheapestAnchorFen,
  matchPreferences,
} from "@/lib/recommendation/filters";
import { buildFixtureMenu, makeMenuItem, makeMenu } from "../helpers/fake-provider";

/**
 * 过滤与分类测试。
 *
 * 分类用例全部取自**真实菜单里的商品名**（2026-10-21 抓取），
 * 因为误判恰恰发生在这些"名字很像"的地方：
 * 「蘸酱炸鸡」不是酱、「薯条脆卜卜毛绒周边」不是薯条、
 * 「学生专享饮品随心选」不是套餐。
 */

describe("餐品角色分类", () => {
  const cases: Array<{ name: string; role: string; anchor: boolean }> = [
    { name: "韩式烟熏芝士风味酱", role: "sauce", anchor: false },
    { name: "蘸酱炸鸡", role: "side", anchor: false },
    { name: "蘸酱麦麦脆汁鸡", role: "side", anchor: false },
    { name: "麦当劳联名徽章", role: "merch", anchor: false },
    { name: "薯条脆卜卜毛绒周边", role: "merch", anchor: false },
    { name: "“葱不求人“按摩捶痒痒挠", role: "merch", anchor: false },
    { name: "旋旋水手帽", role: "merch", anchor: false },
    { name: "如意百宝袋", role: "merch", anchor: false },
    { name: "可乐", role: "drink", anchor: false },
    { name: "麦咖啡™美式", role: "drink", anchor: false },
    { name: "纯牛奶(盒装)", role: "drink", anchor: false },
    { name: "学生专享饮品随心选", role: "drink", anchor: false },
    { name: "圆筒冰淇淋", role: "dessert", anchor: false },
    { name: "蓝莓爆爆珠麦旋风", role: "dessert", anchor: false },
    { name: "薯条", role: "side", anchor: false },
    { name: "麦乐鸡", role: "side", anchor: false },
    { name: "那么大鸡排（椒盐风味）", role: "side", anchor: false },
    { name: "巨无霸", role: "main", anchor: true },
    { name: "麦香鸡", role: "main", anchor: true },
    { name: "麦香鱼", role: "main", anchor: true },
    { name: "板烧鸡腿堡", role: "main", anchor: true },
    { name: "牛肉堡单品精选", role: "main", anchor: true },
    { name: "大堡口福三件套", role: "combo", anchor: true },
    { name: "“我就喜欢”鸡薯双全盒", role: "combo", anchor: true },
    { name: "汉堡开心乐园餐", role: "combo", anchor: true },
    { name: "酥脆无双套餐", role: "combo", anchor: true },
  ];

  for (const item of cases) {
    it(`「${item.name}」→ ${item.role}`, () => {
      const result = classifyItem({ name: item.name });
      expect(result.role).toBe(item.role);
      expect(result.mealAnchor).toBe(item.anchor);
    });
  }

  it("可自选内容的套餐会被标记为需要进一步选择", () => {
    for (const name of ["人气经典随心配", "精选超值随心配", "人气超值四件套随心选", "堡堡随心拼（7件任选）", "牛肉堡单品精选"]) {
      expect(classifyItem({ name }).needsFurtherSelection).toBe(true);
    }
    expect(classifyItem({ name: "大堡口福三件套" }).needsFurtherSelection).toBe(false);
  });

  it("多人份套餐不能作为单餐锚点", () => {
    const shared = classifyItem({ name: "全明星双人分享餐八件套" });
    expect(shared.role).toBe("combo");
    expect(shared.mealAnchor).toBe(false);
    expect(classifyItem({ name: "开心亲子双人餐" }).mealAnchor).toBe(false);
  });

  it("偏好标签从品类词推导，不涉及营养", () => {
    expect(classifyItem({ name: "板烧鸡腿堡" }).tags).toContain("鸡肉");
    expect(classifyItem({ name: "巨无霸" }).tags).toContain("牛肉");
    expect(classifyItem({ name: "麦辣鸡腿汉堡" }).tags).toContain("辣");
    expect(classifyItem({ name: "双层深海鳕鱼堡" }).tags).toContain("鱼");
  });
});

describe("菜单过滤（真实菜单 fixture）", () => {
  const menu = buildFixtureMenu();
  const filtered = filterMenu(menu.items);

  it("识别出足够的正餐锚点，并把周边/酱料/饮品全部排除在锚点之外", () => {
    expect(filtered.report.menuItemCount).toBeGreaterThan(100);
    expect(filtered.report.anchorCount).toBeGreaterThan(50);

    for (const anchor of filtered.anchors) {
      expect(["combo", "main"]).toContain(anchor.role);
      expect(anchor.item.name).not.toMatch(/徽章|毛绒|周边|风味酱|^可乐$/);
    }
  });

  it("排除计数与实际菜单一致，且每个被排除项都有原因", () => {
    const counts = filtered.report.exclusionCounts;
    const excludedTotal = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);

    expect(excludedTotal).toBe(filtered.report.menuItemCount - filtered.report.anchorCount);
    expect(counts.non_food).toBeGreaterThanOrEqual(4);
    expect(counts.sauce).toBeGreaterThanOrEqual(1);
    expect(counts.drink_only).toBeGreaterThanOrEqual(10);
    expect(counts.side_only).toBeGreaterThanOrEqual(10);
    expect(filtered.report.excludedSamples.length).toBeGreaterThan(0);
    expect(filtered.report.excludedSamples[0].reason).toBeTruthy();
  });

  it("排除分类生效（按分类名包含匹配）", () => {
    const withoutChicken = filterMenu(menu.items, { excludeCategories: ["鸡肉汉堡"] });
    const before = filtered.anchors.length;
    expect(withoutChicken.anchors.length).toBeLessThan(before);
    expect(withoutChicken.report.exclusionCounts.excluded_category).toBeGreaterThan(0);
    expect(
      withoutChicken.anchors.every((a) => !(a.item.categoryName ?? "").includes("鸡肉汉堡")),
    ).toBe(true);
  });

  it("配餐与饮品被保留为加购项，并按价格升序", () => {
    expect(filtered.addons.sides.length).toBeGreaterThan(0);
    expect(filtered.addons.drinks.length).toBeGreaterThan(0);
    const sidePrices = filtered.addons.sides.map((i) => i.priceFen);
    expect([...sidePrices].sort((a, b) => a - b)).toEqual(sidePrices);
  });

  it("能算出最低价正餐，用于无结果时给出可执行提示", () => {
    const cheapest = findCheapestAnchorFen(filtered);
    expect(cheapest).not.toBeNull();
    expect(cheapest).toBeLessThan(2000);
  });
});

describe("候选构造", () => {
  const filtered = filterMenu(
    makeMenu([
      makeMenuItem({ code: "B1", name: "板烧鸡腿堡", priceFen: 2350 }),
      makeMenuItem({ code: "S1", name: "薯条", priceFen: 1350 }),
      makeMenuItem({ code: "D1", name: "可乐", priceFen: 950 }),
      makeMenuItem({ code: "C1", name: "大堡口福三件套", priceFen: 2290 }),
    ]).items,
  );

  const candidates = buildCandidates(filtered);

  it("套餐单独成餐，主食还会额外生成「+配餐」「+饮料」组合", () => {
    const shapes = candidates.map((c) => `${c.composition}:${c.items.map((i) => i.code).join("+")}`);
    expect(shapes).toContain("combo:C1");
    expect(shapes).toContain("main:B1");
    expect(shapes).toContain("main+side:B1+S1");
    expect(shapes).toContain("main+drink:B1+D1");
    expect(candidates).toHaveLength(4);
  });

  it("组合候选的价格是各件之和（整数分）", () => {
    const withSide = candidates.find((c) => c.composition === "main+side");
    expect(withSide?.menuPriceFen).toBe(2350 + 1350);
    expect(Number.isInteger(withSide?.menuPriceFen)).toBe(true);
  });

  it("预算过滤按分比较，边界包含等于", () => {
    expect(filterByBudget(candidates, 2290).map((c) => c.primaryCode)).toContain("C1");
    expect(filterByBudget(candidates, 2289).map((c) => c.primaryCode)).not.toContain("C1");
  });

  it("偏好命中按标签交集计算", () => {
    const main = candidates.find((c) => c.composition === "main");
    expect(main).toBeDefined();
    expect(matchPreferences(main!, ["鸡肉"])).toEqual(["鸡肉"]);
    expect(matchPreferences(main!, ["牛肉"])).toEqual([]);
    expect(matchPreferences(main!, [])).toEqual([]);
  });
});
