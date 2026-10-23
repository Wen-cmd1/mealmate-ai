/**
 * 演示模式的数据源（任务 005 §9）。
 *
 * **这不是 mock，也不是生成的假数据**：这份响应来自一次真实的
 * `/api/ai/decide` 调用（规则解析 + 麦当劳 MCP + 官方算价），
 * 被原样冻结下来，用于在没有凭证的环境里演示完整界面。
 *
 * 三条纪律：
 * 1. 冻结后就**不再更新**——菜单会调价，所以页面必须写明「不是实时查询」；
 * 2. 演示模式与真实模式**完全隔离**：/demo 不发起任何网络请求，真实模式也不会回退到这里；
 * 3. 里面不含任何凭证（token / api key / base url），只有菜单与价格这类公开信息。
 */

import type { DecideResponse } from "@/lib/ai/types";

/** 演示入口的元信息（页面顶部必须展示其中至少三项） */
export const DEMO_META = {
  query: "今天中午只有 25 块，想吃鸡肉，不要太辣。",
  capturedAt: "2026-10-22T00:11:44+08:00",
  store: "麦当劳广州天源路餐厅（1400359）",
  toolCalls: ["query-nearby-stores", "query-meals", "calculate-price ×3"],
  note: "以下三份方案来自一次真实的门店查询与官方算价，被原样冻结。价格不会随菜单调价更新，也不代表你现在打开手机看到的门店价格。",
} as const;

export const DEMO_DECISION: DecideResponse = {
  "success": true,
  "mode": "RULE_FALLBACK",
  "ai": {
    "elapsedMs": 0,
    "fallbackReason": "未配置 AI_API_KEY"
  },
  "intent": {
    "mealType": "lunch",
    "budgetKind": "hard_cap",
    "budgetFen": 2500,
    "preferredFen": null,
    "remainingMentionFen": null,
    "historyTags": [],
    "preferences": [
      "鸡肉"
    ],
    "avoid": [
      "辣"
    ],
    "goal": "balanced",
    "userStates": [],
    "wantsLongTermBudget": null,
    "wantsCompleteMeal": false,
    "unsupportedConditions": [],
    "needsClarification": false,
    "clarifyingQuestions": [],
    "signals": [
      "排除「辣」←「不要太辣」",
      "硬上限「只有 25 块」",
      "餐次：午餐 ←「中午」",
      "偏好：鸡肉"
    ]
  },
  "understood": {
    "mealType": "lunch",
    "mealTypeLabel": "午餐",
    "budgetKind": "hard_cap",
    "budgetLabel": "¥25.00（你这次说的硬上限）",
    "preferences": [
      "鸡肉"
    ],
    "avoid": [
      "辣"
    ],
    "goal": "balanced",
    "goalLabel": "均衡选择",
    "userStates": [],
    "wantsCompleteMeal": false,
    "wantsLongTermBudget": null,
    "remainingMentionFen": null
  },
  "budget": {
    "appliedFen": 2500,
    "kind": "hard_cap",
    "source": "user_hard_cap",
    "mentionedFen": 2500,
    "preferredFen": null,
    "clampedByContext": false,
    "clampedByApiLimit": false,
    "hardCapFen": 2500,
    "explanation": "按你说的「不超过 ¥25.00」来找，超过这个数的方案不会被推荐。"
  },
  "recommendations": [
    {
      "recommendation": {
        "type": "balanced",
        "title": "均衡选择",
        "items": [
          {
            "code": "9900004835",
            "name": "麦乐鸡套餐",
            "role": "combo",
            "categoryName": "炸鸡",
            "quantity": 1,
            "menuPriceFen": 2500,
            "unitPriceFen": 2500,
            "originalPriceFen": 3750,
            "onSale": true,
            "needsFurtherSelection": false
          }
        ],
        "totalPriceFen": 2500,
        "menuPriceFen": 2500,
        "verifiedPriceFen": 2500,
        "priceVerified": true,
        "priceMismatch": false,
        "remainingFen": 0,
        "composition": "combo",
        "needsFurtherSelection": false,
        "reason": "¥25.00 的「麦乐鸡套餐」占预算 100%，形式为套餐；在「价格」与「餐品组成」之间取折中。注意：这里衡量的是价格与组成，不是营养——营养数据与菜单 SKU 尚无可靠关联字段。",
        "highlights": [
          "官方算价核验通过：¥25.00",
          "菜单标价与官方算价一致",
          "含促销商品，这些商品原价合计 ¥37.50",
          "未使用优惠券（本阶段禁止领券），因此这不是理论最低到手价"
        ],
        "score": 0.84,
        "scoreBreakdown": {
          "priceFit": 0.6666666666666667,
          "completeness": 1,
          "preference": 1,
          "value": 0.3333333333333333
        }
      },
      "impact": null,
      "fitNotes": [
        "按你「均衡选择」的目标优先挑的一份",
        "官方算价核验 ¥25.00，在 ¥25.00 的预算内",
        "按午餐场景给的方案",
        "已排除名称含「辣」的餐品（依据菜单名称，非配料表）"
      ],
      "primary": true
    },
    {
      "recommendation": {
        "type": "save",
        "title": "省钱优先",
        "items": [
          {
            "code": "9900016076",
            "name": "“我就喜欢”鸡薯双全盒",
            "role": "combo",
            "categoryName": "人气热卖",
            "quantity": 1,
            "menuPriceFen": 1590,
            "unitPriceFen": 1590,
            "originalPriceFen": 2850,
            "onSale": true,
            "needsFurtherSelection": false
          }
        ],
        "totalPriceFen": 1590,
        "menuPriceFen": 1590,
        "verifiedPriceFen": 1590,
        "priceVerified": true,
        "priceMismatch": false,
        "remainingFen": 910,
        "composition": "combo",
        "needsFurtherSelection": false,
        "reason": "¥15.90 的「“我就喜欢”鸡薯双全盒」是本次候选里已通过官方算价核验的最低完整正餐，对比 ¥25.00 的预算还剩 ¥9.10。",
        "highlights": [
          "官方算价核验通过：¥15.90",
          "菜单标价与官方算价一致",
          "含促销商品，这些商品原价合计 ¥28.50",
          "未使用优惠券（本阶段禁止领券），因此这不是理论最低到手价"
        ],
        "score": 0.4871831578947369,
        "scoreBreakdown": {
          "priceFit": 0.364,
          "completeness": 1,
          "preference": 1,
          "value": 0.4421052631578947
        }
      },
      "impact": null,
      "fitNotes": [
        "官方算价核验 ¥15.90，在 ¥25.00 的预算内",
        "按午餐场景给的方案",
        "已排除名称含「辣」的餐品（依据菜单名称，非配料表）"
      ],
      "primary": false
    },
    {
      "recommendation": {
        "type": "satisfy",
        "title": "满足优先",
        "items": [
          {
            "code": "521952",
            "name": "龙焰鸡腿堡",
            "role": "main",
            "categoryName": "鸡肉汉堡 /卷",
            "quantity": 1,
            "menuPriceFen": 1590,
            "unitPriceFen": 1590,
            "originalPriceFen": 2400,
            "onSale": true,
            "needsFurtherSelection": false
          },
          {
            "code": "6102",
            "name": "苹果片",
            "role": "side",
            "categoryName": "小食甜品 /其他",
            "quantity": 1,
            "menuPriceFen": 700,
            "unitPriceFen": 700,
            "onSale": false,
            "needsFurtherSelection": false
          }
        ],
        "totalPriceFen": 2290,
        "menuPriceFen": 2290,
        "verifiedPriceFen": 2290,
        "priceVerified": true,
        "priceMismatch": false,
        "remainingFen": 210,
        "composition": "main+side",
        "needsFurtherSelection": false,
        "reason": "¥22.90 的「龙焰鸡腿堡」命中你选的「鸡肉」偏好，且未超过 ¥25.00 的预算，还剩 ¥2.10。",
        "highlights": [
          "官方算价核验通过：¥22.90",
          "菜单标价与官方算价一致",
          "含促销商品，这些商品原价合计 ¥24.00",
          "共 2 件：龙焰鸡腿堡 + 苹果片",
          "未使用优惠券（本阶段禁止领券），因此这不是理论最低到手价"
        ],
        "score": 0.7412490322580645,
        "scoreBreakdown": {
          "priceFit": 0.08399999999999996,
          "completeness": 0.9,
          "preference": 1,
          "value": 0.26129032258064516
        }
      },
      "impact": null,
      "fitNotes": [
        "共 2 件：龙焰鸡腿堡 + 苹果片",
        "官方算价核验 ¥22.90，在 ¥25.00 的预算内",
        "按午餐场景给的方案",
        "已排除名称含「辣」的餐品（依据菜单名称，非配料表）"
      ],
      "primary": false
    }
  ],
  "priceVerification": {
    "quotesUsed": 3,
    "verifiedCount": 3,
    "allVerified": true
  },
  "clarification": {
    "needed": false,
    "questions": []
  },
  "caveats": [
    "「不吃辣」是按**菜单名称关键词**做的确定性过滤：名称里带这些词的餐品不会被推荐，也不会用\"打低分\"的方式蒙混过关。但麦当劳接口只提供菜品名称，没有逐项配料与辣度标注，系统**无法判断具体辣度**（\"不要辣\"和\"不要太辣\"在它这里没有区别，都按保守策略整类排除），因此**无法保证绝对不含辣**，点单时请再和门店确认一次。",
    "价格来自麦当劳官方 calculate-price 实时算价，实际支付以门店为准；本阶段不领券、不下单、不支付。",
    "本推荐是「预算 + 口味偏好」的匹配结果，不构成医疗、减重治疗或营养处方建议；本阶段营养数据与菜单 SKU 没有可靠关联，因此不宣称营养均衡。"
  ],
  "source": {
    "provider": "mcd-mcp",
    "storeCode": "1400359",
    "storeName": "麦当劳广州天源路餐厅",
    "storeAddress": "天源路5号",
    "orderType": 1,
    "beType": 1,
    "fetchedAt": "2026-10-21T16:11:43.927Z",
    "upstreamDatetime": "2026-10-22 00:11:44",
    "traceId": "d8aa72abdd816cacab146aea48a31c10",
    "toolsUsed": [
      "query-nearby-stores",
      "query-meals",
      "calculate-price"
    ]
  },
  "warnings": [
    {
      "code": "RULE_FALLBACK",
      "message": "服务端未配置大模型（AI_API_KEY），当前为规则解析模式：只支持预算、餐次、口味偏好、排除项等有限条件，不等同于大模型语义理解。"
    },
    {
      "code": "EXCLUSION_NOT_GUARANTEED",
      "message": "已按菜单名称确定性排除你不想吃的品类，但接口没有配料/辣度字段，无法保证绝对不含，请以门店实际为准。"
    }
  ],
  "recommendationWarnings": [],
  "elapsedMs": 1692
};
