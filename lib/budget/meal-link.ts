/**
 * 推荐 → 账本 的桥接规则。
 *
 * 只做一件事：把「一条已核验的推荐」翻译成「一条待用户确认的消费草稿」。
 * 它**不写账本**，也不扣预算 —— 是否记账由用户在界面上显式确认。
 *
 * 三条不可让步的规则：
 * 1. 只有 `priceVerified === true` 且 `verifiedPriceFen` 有值时才预填金额；
 *    未核验的推荐一律要求用户自己填实付金额，绝不用菜单标价顶上。
 * 2. `needsFurtherSelection === true`（随心选/1+1/任选类套餐）时，
 *    官方算价只是「起价」，实际组成未定 → 不预填，必须由用户确认实付。
 * 3. 推荐价 ≠ 实付价是常态（券、门店活动、加料），所以金额字段始终可编辑。
 */

import type { Recommendation } from "../recommendation/types";

export interface RecommendationExpenseDraft {
  /** 预填金额（分）；null 表示必须由用户输入 */
  amountFen: number | null;
  /** 是否必须由用户确认/输入实际金额 */
  requiresUserAmount: boolean;
  description: string;
  relatedProductCode?: string;
  relatedRecommendationType?: string;
  /** 给用户看的说明（为什么金额是空的） */
  note?: string;
}

export function draftExpenseFromRecommendation(rec: Recommendation): RecommendationExpenseDraft {
  const description = rec.items
    .map((item) => item.name)
    .join(" + ")
    .slice(0, 80);

  const base = {
    description: description || `${rec.title}（推荐套餐）`,
    relatedProductCode: rec.items[0]?.code,
    relatedRecommendationType: rec.type,
  } satisfies Omit<RecommendationExpenseDraft, "amountFen" | "requiresUserAmount" | "note">;

  if (!rec.priceVerified || rec.verifiedPriceFen === null) {
    return {
      ...base,
      amountFen: null,
      requiresUserAmount: true,
      note: "这条推荐没有通过官方算价核验，请填写你的实际支付金额",
    };
  }

  if (rec.needsFurtherSelection) {
    return {
      ...base,
      amountFen: null,
      requiresUserAmount: true,
      note: "该套餐内容需要在点餐时选择，算价只是起价，请填写你的实际支付金额",
    };
  }

  return {
    ...base,
    amountFen: rec.verifiedPriceFen,
    requiresUserAmount: false,
    note: "已按官方算价预填，若实际支付不同请直接修改",
  };
}
