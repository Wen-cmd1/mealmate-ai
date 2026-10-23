/**
 * 单餐推荐 —— 过滤与候选构造（纯函数，不联网）。
 *
 * 设计核心：**"能不能算一顿饭"由餐品角色决定，而不是由价格决定。**
 * 任务书明确要求不能拿酱料、单品饮料、纪念品冒充完整正餐，
 * 所以这里先做角色分类，再谈预算。
 *
 * 分类依据全部是**名称/分类关键词**（商品品类词，不是营养推断），
 * 规则按顺序匹配、先命中先用，每条规则都记录 `reason` 方便排查误判。
 * 营养数据不参与任何判断（`MealItem.nutrition` 恒为 null）。
 */

import type { MealItem, MenuSnapshot } from "../../types/meal";
import type {
  Candidate,
  ClassifiedItem,
  ExclusionReason,
  ExcludedSample,
  FilterReport,
  ItemClassification,
  ItemRole,
} from "./types";

/* ------------------------------------------------------------------ *
 * 关键词表
 * ------------------------------------------------------------------ */

/** 非餐食：周边、玩具、纪念品 */
const MERCH_PATTERN = /(徽章|周边|毛绒|帽子|水手帽|按摩|痒痒挠|玩偶|玩具|盲盒|钥匙扣|贴纸|抱枕|帆布袋|T恤|马克杯|百宝袋)/;

/** 饮品关键词 */
const DRINK_PATTERN =
  /(可乐|雪碧|芬达|咖啡|拿铁|奶铁|美式|卡布奇诺|浓缩|阿芙佳朵|红茶|绿茶|果汁|纯悦|矿泉水|牛奶|燕麦奶|饮品|雪冰|可可|麦炫酷|柠柠|橙橙|气泡|冰爽一夏|黑巧)/;

/**
 * 出现这些"具体菜品"名词，说明它是一份饭而不是一杯饮料。
 *
 * 注意这里**不能**放 牛/鸡/鱼/猪 这类单字：真实菜单里「纯牛奶(盒装)」含「牛」，
 * 一旦把它当食物，就会被误判成 unknown 而不是 drink。
 */
const FOOD_HINT_PATTERN =
  /(汉堡|堡|巨无霸|麦香鸡|麦香鱼|卷|饭|意面|三明治|鸡块|鸡翅|鸡排|麦乐鸡|脆汁鸡|炸鸡|薯条|薯饼|玉米|派|冰淇淋|圆筒|新地|麦旋风)/;

/** 套餐/组合：这类 SKU 本身就是一份完整正餐 */
const COMBO_PATTERN =
  /(三件套|四件套|五件套|六件套|单人餐|双人餐|分享餐|亲子餐|乐园餐|套餐|随心配|随心选|任选|全盒|桶$|盒$|拼$)/;

/** 多人份：单餐决策场景应排除 */
const MULTI_PERSON_PATTERN = /(双人|亲子|分享餐|多人|全家|八件|7件|十翅|派对)/;

/** 套餐内容需用户进一步选择（组成未知，不得伪造明细） */
const NEEDS_SELECTION_PATTERN = /(随心选|任选|随心配|自选|DIY|单品精选|1\+1|口味自选|拼)/;

const DESSERT_PATTERN = /(冰淇淋|圆筒|新地|麦旋风|圣代|甜筒|雪糕|布丁|蛋糕|蛋挞|派$)/;

const SIDE_PATTERN =
  /(薯条|薯饼|玉米杯|苹果片|鸡块|麦乐鸡|鸡翅|V翅|鸡排|脆汁鸡|炸鸡|芝士条|扭扭薯|小食盘|拼盘|肉骨鸡|薯角|沙拉|蔬菜杯)/;

const MAIN_PATTERN = /(汉堡|堡|巨无霸|麦香鸡|麦香鱼|卷|饭|意面|三明治|帕尼尼)/;

/** 口味/品类标签关键词 → 标签名 */
const TAG_RULES: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "汉堡", pattern: /(汉堡|堡|巨无霸|麦香鸡|麦香鱼|三明治|卷)/ },
  { tag: "鸡肉", pattern: /(鸡)/ },
  { tag: "牛肉", pattern: /(牛|巨无霸|安格斯|吉士)/ },
  { tag: "鱼", pattern: /(鱼|鳕)/ },
  { tag: "辣", pattern: /(辣)/ },
  { tag: "猪肉", pattern: /(猪|培根)/ },
];

/* ------------------------------------------------------------------ *
 * 分类
 * ------------------------------------------------------------------ */

function collectTags(name: string): string[] {
  return TAG_RULES.filter((rule) => rule.pattern.test(name)).map((rule) => rule.tag);
}

/**
 * 给单个餐品判定角色。
 *
 * 顺序很重要（都是实测菜单里真实存在的名字，例如
 * 「薯条脆卜卜毛绒周边」必须先判成周边、「学生专享饮品随心选」必须先判成饮品）。
 */
export function classifyItem(item: Pick<MealItem, "name" | "categoryName">): ItemClassification {
  const name = item.name ?? "";
  const tags = collectTags(name);
  const base = { tags };

  if (MERCH_PATTERN.test(name)) {
    return { ...base, role: "merch", mealAnchor: false, needsFurtherSelection: false, reason: "命中周边/纪念品关键词" };
  }

  // 酱料：以「酱」结尾且不含任何食物主体词（避免把「蘸酱炸鸡」误判成酱料）
  if (/酱$/.test(name) && !FOOD_HINT_PATTERN.test(name)) {
    return { ...base, role: "sauce", mealAnchor: false, needsFurtherSelection: false, reason: "以「酱」结尾且无食物主体词" };
  }

  // 纯饮品：命中饮品词且没有任何食物主体词（如「学生专享饮品随心选」）
  if (DRINK_PATTERN.test(name) && !FOOD_HINT_PATTERN.test(name)) {
    return {
      ...base,
      role: "drink",
      mealAnchor: false,
      needsFurtherSelection: NEEDS_SELECTION_PATTERN.test(name),
      reason: "命中饮品词且无食物主体词",
    };
  }

  // 套餐/组合要先于主食品类判断，否则「汉堡开心乐园餐」会被当成单品汉堡
  if (COMBO_PATTERN.test(name)) {
    if (MULTI_PERSON_PATTERN.test(name)) {
      return {
        ...base,
        role: "combo",
        mealAnchor: false,
        needsFurtherSelection: true,
        reason: "组合餐，但为多人份，不符合单餐场景",
      };
    }
    return {
      ...base,
      role: "combo",
      mealAnchor: true,
      needsFurtherSelection: NEEDS_SELECTION_PATTERN.test(name),
      reason: "命中套餐/组合关键词",
    };
  }

  if (DESSERT_PATTERN.test(name)) {
    return { ...base, role: "dessert", mealAnchor: false, needsFurtherSelection: false, reason: "命中甜品关键词" };
  }

  if (SIDE_PATTERN.test(name)) {
    return { ...base, role: "side", mealAnchor: false, needsFurtherSelection: false, reason: "命中配餐/小食关键词" };
  }

  if (MAIN_PATTERN.test(name)) {
    return {
      ...base,
      role: "main",
      mealAnchor: true,
      needsFurtherSelection: NEEDS_SELECTION_PATTERN.test(name),
      reason: "命中主食关键词（堡/卷/饭/三明治）",
    };
  }

  return { ...base, role: "unknown", mealAnchor: false, needsFurtherSelection: false, reason: "未命中任何品类规则" };
}

const ROLE_EXCLUSION: Record<Exclude<ItemRole, "combo" | "main">, ExclusionReason> = {
  merch: "non_food",
  sauce: "sauce",
  drink: "drink_only",
  dessert: "dessert_only",
  side: "side_only",
  unknown: "unknown_role",
};

export interface FilterMenuOptions {
  excludeCategories?: string[];
  /**
   * 用户明确排除的标签（任务 004）。命中即**确定性剔除**，
   * 不是"打低分"——被排除的餐品不会进入候选池，任何评分都无法把它捞回来。
   *
   * 之所以放在分类阶段而不是评分阶段：任务书要求"不能只通过低分惩罚"，
   * 而且配餐/饮品加购项也要一起排除（否则"最便宜的配餐"可能正是被排除的那一个）。
   */
  excludeTags?: string[];
  /** 排除样例保留条数，默认 8 */
  sampleLimit?: number;
}

export interface FilteredMenu {
  /** 可作为正餐锚点的餐品（套餐 / 主食） */
  anchors: ClassifiedItem[];
  /** 只能作为加购项的餐品 */
  addons: {
    sides: MealItem[];
    drinks: MealItem[];
  };
  /** 全部餐品的分类结果，供测试与排查 */
  classified: ClassifiedItem[];
  report: FilterReport;
}

/** 分类 + 排除。注意：`exclusionCounts` 统计的是"不能作为正餐锚点"的原因。 */
export function filterMenu(items: readonly MealItem[], options: FilterMenuOptions = {}): FilteredMenu {
  const excludeCategories = (options.excludeCategories ?? [])
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0);
  const excludeTags = new Set(
    (options.excludeTags ?? []).map((t) => t.trim()).filter((t) => t.length > 0),
  );
  const sampleLimit = options.sampleLimit ?? 8;

  const anchors: ClassifiedItem[] = [];
  const sides: MealItem[] = [];
  const drinks: MealItem[] = [];
  const classified: ClassifiedItem[] = [];
  const exclusionCounts: Partial<Record<ExclusionReason, number>> = {};
  const excludedSamples: ExcludedSample[] = [];

  const bump = (reason: ExclusionReason) => {
    exclusionCounts[reason] = (exclusionCounts[reason] ?? 0) + 1;
  };
  const sample = (item: MealItem, reason: ExclusionReason) => {
    if (excludedSamples.length < sampleLimit) {
      excludedSamples.push({ code: item.code, name: item.name, reason });
    }
  };

  for (const item of items) {
    const cls = classifyItem(item);
    const record: ClassifiedItem = { ...cls, item };
    classified.push(record);

    const categoryName = (item.categoryName ?? "").toLowerCase();
    const categoryExcluded =
      excludeCategories.length > 0 &&
      excludeCategories.some((c) => categoryName.includes(c));

    if (categoryExcluded) {
      bump("excluded_category");
      sample(item, "excluded_category");
      continue;
    }

    // 用户明确排除的标签：确定性剔除，且发生在角色分流之前，
    // 保证被排除的餐品既不会成为正餐锚点，也不会变成"最便宜的加购项"。
    if (excludeTags.size > 0 && cls.tags.some((tag) => excludeTags.has(tag))) {
      bump("excluded_tag");
      sample(item, "excluded_tag");
      continue;
    }

    if (cls.mealAnchor) {
      anchors.push(record);
      continue;
    }

    // 配餐与饮品保留为"加购项"，但仍记为不可作锚点
    if (cls.role === "side") {
      sides.push(item);
      bump("side_only");
      sample(item, "side_only");
      continue;
    }
    if (cls.role === "drink") {
      drinks.push(item);
      bump("drink_only");
      sample(item, "drink_only");
      continue;
    }

    // 多人份套餐
    if (cls.role === "combo" && !cls.mealAnchor) {
      const reason: ExclusionReason = "multi_person";
      bump(reason);
      sample(item, reason);
      continue;
    }

    const reason = ROLE_EXCLUSION[cls.role as Exclude<ItemRole, "combo" | "main">] ?? "unknown_role";
    bump(reason);
    sample(item, reason);
  }

  // 加购项按价格升序，方便后面"主食 + 最便宜配餐/饮料"的构造
  sides.sort((a, b) => a.priceFen - b.priceFen);
  drinks.sort((a, b) => a.priceFen - b.priceFen);

  return {
    anchors,
    addons: { sides, drinks },
    classified,
    report: {
      menuItemCount: items.length,
      anchorCount: anchors.length,
      exclusionCounts,
      excludedSamples,
    },
  };
}

/* ------------------------------------------------------------------ *
 * 候选构造
 * ------------------------------------------------------------------ */

function makeCandidate(
  primary: ClassifiedItem,
  composition: Candidate["composition"],
  extra: MealItem[],
  needsFurtherSelection: boolean,
): Candidate {
  const all = [primary.item, ...extra];
  return {
    items: all,
    primaryCode: primary.item.code,
    primaryName: primary.item.name,
    primaryRole: primary.role,
    menuPriceFen: all.reduce((sum, item) => sum + item.priceFen, 0),
    composition,
    needsFurtherSelection,
    tags: [...new Set([...primary.tags, ...collectTags(extra.map((i) => i.name).join(" "))])],
    categoryName: primary.item.categoryName,
  };
}

export interface BuildCandidatesOptions {
  /** 是否构造"主食 + 配餐/饮料"组合，默认 true */
  includeAddons?: boolean;
  /** 候选上限，防止极端菜单把候选量放大，默认 400 */
  limit?: number;
}

/**
 * 由锚点餐品构造候选方案。
 *
 * 组合方式（顺序即优先级）：
 * 1. 套餐单独成餐（`combo`）
 * 2. 主食单独成餐（`main`）
 * 3. 主食 + 最便宜配餐（`main+side`）
 * 4. 主食 + 最便宜饮料（`main+drink`）
 *
 * 为什么不做全排列：预算决策只需要"最便宜的加购搭配"，
 * 全排列会让候选数爆炸，且对结果没有实质改善。
 */
export function buildCandidates(filtered: FilteredMenu, options: BuildCandidatesOptions = {}): Candidate[] {
  const includeAddons = options.includeAddons ?? true;
  const limit = options.limit ?? 400;
  const candidates: Candidate[] = [];

  const cheapestSide = filtered.addons.sides[0];
  const cheapestDrink = filtered.addons.drinks[0];

  for (const anchor of filtered.anchors) {
    if (anchor.role === "combo") {
      candidates.push(makeCandidate(anchor, "combo", [], anchor.needsFurtherSelection));
    } else {
      candidates.push(makeCandidate(anchor, "main", [], anchor.needsFurtherSelection));
    }
  }

  if (includeAddons) {
    for (const anchor of filtered.anchors) {
      if (anchor.role !== "main") continue;

      if (cheapestSide && cheapestSide.code !== anchor.item.code) {
        candidates.push(makeCandidate(anchor, "main+side", [cheapestSide], anchor.needsFurtherSelection));
      }
      if (cheapestDrink && cheapestDrink.code !== anchor.item.code) {
        candidates.push(makeCandidate(anchor, "main+drink", [cheapestDrink], anchor.needsFurtherSelection));
      }
    }
  }

  // 去重：同「主 SKU + 组成」只保留一份
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.composition}:${candidate.items.map((i) => i.code).join("+")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
    if (unique.length >= limit) break;
  }

  return unique;
}

/** 预算过滤（核验前，用菜单标价做粗筛） */
export function filterByBudget(candidates: readonly Candidate[], budgetFen: number): Candidate[] {
  return candidates.filter((c) => c.menuPriceFen <= budgetFen);
}

/** 单个餐品是否命中某个偏好 */
export function matchesPreference(tags: readonly string[], preference: string): boolean {
  return tags.includes(preference);
}

/** 计算候选的偏好命中列表 */
export function matchPreferences(candidate: Candidate, preferences: readonly string[]): string[] {
  if (preferences.length === 0) return [];
  return preferences.filter((p) => matchesPreference(candidate.tags, p));
}

/**
 * 从菜单里找出"最低价的完整正餐"，用于在无结果时给出可执行的解释
 * （例如"把预算提到 ¥14 就能吃到一份主食"）。
 */
export function findCheapestAnchorFen(filtered: FilteredMenu): number | null {
  const prices = filtered.anchors.map((a) => a.item.priceFen);
  return prices.length === 0 ? null : Math.min(...prices);
}

/** 便捷封装：直接从 MenuSnapshot 得到分类结果 */
export function filterMenuSnapshot(
  snapshot: MenuSnapshot,
  options?: FilterMenuOptions,
): FilteredMenu {
  return filterMenu(snapshot.items, options);
}
