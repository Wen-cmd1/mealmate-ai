/**
 * 单餐推荐 —— 可解释性文案生成（纯函数）。
 *
 * 原则：
 * 1. **只陈述可核验的事实**（价格、算价结果、组成件数、是否促销）；
 * 2. **不宣称营养/健康**（营养与 SKU 无可信关联，见 ADR-003）；
 * 3. 不宣称"最便宜/最好吃"这类无法证明的绝对判断——除了
 *    "本次候选里已核验的最低完整正餐"这种可以对照候选集合验证的表述。
 */

import { formatFen } from "../budget/money";
import type { Candidate, RecommendationType } from "./types";

export const COMPOSITION_LABELS: Record<Candidate["composition"], string> = {
  combo: "套餐",
  main: "单点主食",
  "main+side": "主食 + 配餐",
  "main+drink": "主食 + 饮料",
};

export interface ExplainInput {
  type: RecommendationType;
  candidate: Candidate;
  budgetFen: number;
  /** 官方算价（分），必填——未核验的候选不会进入解释环节 */
  verifiedPriceFen: number;
  menuPriceFen: number;
  matchedPreferences: string[];
  requestedPreferences: string[];
  priceMismatch: boolean;
  /** 该候选是否为"同类候选里已核验的最低完整正餐" */
  isCheapestVerified?: boolean;
}

export interface Explanation {
  reason: string;
  highlights: string[];
}

/** 金额展示：统一交给 formatFen，避免各处自己拼 "¥" */
function money(fen: number): string {
  return formatFen(fen);
}

function percent(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

export function buildExplanation(input: ExplainInput): Explanation {
  const {
    type,
    candidate,
    budgetFen,
    verifiedPriceFen,
    menuPriceFen,
    matchedPreferences,
    requestedPreferences,
    priceMismatch,
    isCheapestVerified,
  } = input;

  const price = money(verifiedPriceFen);
  const remaining = budgetFen - verifiedPriceFen;
  const remainingText =
    remaining > 0 ? `还剩 ${money(remaining)}` : "刚好用满预算";
  const composition = COMPOSITION_LABELS[candidate.composition];
  const name = `「${candidate.primaryName}」`;

  let reason: string;

  switch (type) {
    case "save": {
      const prefix = isCheapestVerified
        ? `${price} 的${name}是本次候选里已通过官方算价核验的最低完整正餐`
        : `${price} 的${name}是预算内较省的一份完整正餐`;
      reason = `${prefix}，对比 ${money(budgetFen)} 的预算${remainingText}。`;
      break;
    }
    case "balanced": {
      reason =
        `${price} 的${name}占预算 ${percent(verifiedPriceFen, budgetFen)}，形式为${composition}；` +
        `在「价格」与「餐品组成」之间取折中。` +
        `注意：这里衡量的是价格与组成，不是营养——营养数据与菜单 SKU 尚无可靠关联字段。`;
      break;
    }
    case "satisfy": {
      if (matchedPreferences.length > 0) {
        reason =
          `${price} 的${name}命中你选的「${matchedPreferences.join("、")}」偏好，` +
          `且未超过 ${money(budgetFen)} 的预算，${remainingText}。`;
      } else {
        reason =
          `本次候选里没有同时命中你选的「${requestedPreferences.join("、")}」且在预算内的餐品；` +
          `${price} 的${name}是${composition}里最接近的一份，${remainingText}。`;
      }
      break;
    }
  }

  if (input.candidate.needsFurtherSelection) {
    reason += "该套餐内容需在点餐时选择，实际组成以门店为准。";
  }

  const highlights: string[] = [];
  highlights.push(`官方算价核验通过：${price}`);

  if (priceMismatch) {
    highlights.push(`菜单标价 ${money(menuPriceFen)} 与官方算价 ${price} 不一致，已按算价计入预算`);
  } else {
    highlights.push("菜单标价与官方算价一致");
  }

  const onSaleItems = candidate.items.filter((item) => item.onSale && item.originalPriceFen);
  if (onSaleItems.length > 0) {
    const originalTotal = onSaleItems.reduce(
      (sum, item) => sum + (item.originalPriceFen ?? item.priceFen),
      0,
    );
    highlights.push(`含促销商品，这些商品原价合计 ${money(originalTotal)}`);
  }

  if (candidate.items.length > 1) {
    highlights.push(`共 ${candidate.items.length} 件：${candidate.items.map((i) => i.name).join(" + ")}`);
  }

  if (input.candidate.needsFurtherSelection) {
    highlights.push("套餐内容可自选，实际组成需在点餐时确认");
  }

  highlights.push("未使用优惠券（本阶段禁止领券），因此这不是理论最低到手价");

  return { reason, highlights };
}

/** 没有推荐时，给出可执行的解释 */
export function buildEmptyReason(input: {
  budgetFen: number;
  menuItemCount: number;
  anchorCount: number;
  withinBudgetCount: number;
  cheapestAnchorFen: number | null;
  verifiedCount: number;
  /** 因为用户排除项被确定性剔除的餐品数（任务 004） */
  excludedByTagCount?: number;
  excludedTags?: readonly string[];
}): string {
  const budget = formatFen(input.budgetFen);

  if (input.menuItemCount === 0) {
    return "该门店当前没有返回任何在售餐品（可能是门店已打烊或该用餐方式暂不支持）。";
  }
  if (input.anchorCount === 0) {
    // 排除项本身可能就是"没有正餐"的原因，必须说清楚，否则用户会以为是门店没菜
    if ((input.excludedByTagCount ?? 0) > 0 && input.excludedTags?.length) {
      return (
        `按你排除的「${input.excludedTags.join("、")}」过滤后，该门店没有剩下可作为正餐的套餐或主食。` +
        "可以放宽一个排除条件，或换一家门店再试。"
      );
    }
    return "该门店当前菜单里没有识别到可作为正餐的套餐或主食，只有饮品/小食/周边，因此不给推荐。";
  }
  if (input.withinBudgetCount === 0) {
    const cheapest =
      input.cheapestAnchorFen === null ? "" : `本店最低一份正餐为 ${formatFen(input.cheapestAnchorFen)}。`;
    return `预算 ${budget} 内没有找到完整正餐。${cheapest}酱料、单点饮料、配件不算一顿饭，不会被凑数推荐。`;
  }
  if (input.verifiedCount === 0) {
    return `预算 ${budget} 内的候选在官方算价校验后全部超预算或无法下单，因此没有给推荐。`;
  }
  return `预算 ${budget} 内符合条件的推荐不足，已按实际数量返回。`;
}
