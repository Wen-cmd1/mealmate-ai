/**
 * 推荐结果 → 面向用户的决策响应（任务 004）。
 *
 * 这个文件只做三件事：**翻译、补充限制、标注来源**。
 *
 * 它不重新算价格、不重新打分、不生成新的餐品建议——那些都在
 * `lib/recommendation/*` 里做完了。这里唯一"新增"的信息是：
 *
 * - 把分数翻译成用户能看懂的理由（`fitNotes`）；
 * - 把**必须说清楚的限制**固化成 `caveats`（排除项只按名称判断、过敏原无法确认、
 *   默认预算、软预算语义、账本不会被改…）；
 * - 把预算影响接上（若用户授权提供了预算上下文）。
 *
 * ⚠️ 一条不可动摇的文案纪律：
 * 涉及排除项时**禁止**出现"绝对不含""保证不辣"这类断言。
 * 上游只给了菜单名称，没有配料表，系统没有能力做这种承诺。
 */

import { computeMealImpact } from "../budget/forecast";
import { formatFen, formatFenSigned } from "../budget/money";
import type { MealImpact } from "../budget/types";
import type { RecommendResponse, Recommendation, RecommendationType } from "../recommendation/types";
import {
  AI_BUDGET_MIN_FEN,
  BUDGET_SOURCE_LABELS,
  DECISION_GOAL_LABELS,
  MEAL_TYPE_LABELS,
  type AiImpactView,
  type AiMeta,
  type AiRecommendation,
  type AiWarning,
  type BudgetDecision,
  type DecideContext,
  type DecideResponse,
  type IntentParseMode,
  type ParsedIntent,
  type UnderstoodRequirement,
} from "./types";

/** 决策目标 → 首选的方案类型 */
export function primaryPlanType(intent: ParsedIntent): RecommendationType {
  // "想吃一顿完整的" 是比"满足口味"更强的结构约束，优先给均衡方案（它先挑组成完整的）
  if (intent.wantsCompleteMeal) return "balanced";
  switch (intent.goal) {
    case "save":
      return "save";
    case "satisfy":
      return "satisfy";
    default:
      return "balanced";
  }
}

/**
 * 排除项的固定免责说明。
 * 只要用户提了排除项就**必须**出现——这是对"无法确认配料"的诚实交代。
 */
export function exclusionCaveat(avoid: readonly string[]): string {
  const spicy = avoid.includes("辣");
  // 只有真的在排除"辣"时才谈辣度——否则这段会变成与本次无关的噪音
  const limit = spicy
    ? `但麦当劳接口只提供菜品名称，没有逐项配料与辣度标注，` +
      `系统**无法判断具体辣度**（"不要辣"和"不要太辣"在它这里没有区别，都按保守策略整类排除），` +
      `因此**无法保证绝对不含${avoid.join("、")}**，点单时请再和门店确认一次。`
    : `但麦当劳接口只提供菜品名称，没有逐项配料表，系统只能按名字判断，` +
      `因此**无法保证绝对不含${avoid.join("、")}**（名称里没写的配料它就看不到），点单时请再和门店确认一次。`;

  return (
    `「不吃${avoid.join("、")}」是按**菜单名称关键词**做的确定性过滤：` +
    `名称里带这些词的餐品不会被推荐，也不会用"打低分"的方式蒙混过关。` + limit
  );
}

export const ALLERGEN_CAVEAT =
  "过敏原：当前数据源没有可靠的过敏原字段，系统**无法确认**任何餐品是否含特定过敏原，不能保证食用安全。请直接向门店核实，不要仅依赖本推荐。";

export const MEDICAL_CAVEAT =
  "本推荐是「预算 + 口味偏好」的匹配结果，不构成医疗、减重治疗或营养处方建议；本阶段营养数据与菜单 SKU 没有可靠关联，因此不宣称营养均衡。";

export const PRICE_CAVEAT =
  "价格来自麦当劳官方 calculate-price 实时算价，实际支付以门店为准；本阶段不领券、不下单、不支付。";

export interface BuildResponseInput {
  intent: ParsedIntent;
  mode: IntentParseMode;
  ai: AiMeta | null;
  budget: BudgetDecision;
  recommend: RecommendResponse | null;
  context?: DecideContext;
  warnings: AiWarning[];
  /** 本次是否因为信息不足而没有发起真实查询 */
  blocked?: boolean;
  elapsedMs: number;
}

function buildUnderstood(intent: ParsedIntent, budget: BudgetDecision): UnderstoodRequirement {
  const budgetLabel =
    typeof budget.preferredFen === "number" && budget.hardCapFen !== null
      ? `${formatFen(budget.appliedFen)}（你期望的价位，硬上限 ${formatFen(budget.hardCapFen)}）`
      : intent.budgetKind === "unspecified" && budget.source === "default"
        ? "未指定（按默认预算）"
        : `${formatFen(budget.appliedFen)}（${BUDGET_SOURCE_LABELS[budget.source]}）`;

  return {
    mealType: intent.mealType,
    mealTypeLabel: MEAL_TYPE_LABELS[intent.mealType],
    budgetKind: intent.budgetKind,
    budgetLabel,
    preferences: intent.preferences,
    avoid: intent.avoid,
    goal: intent.goal,
    goalLabel: DECISION_GOAL_LABELS[intent.goal],
    userStates: intent.userStates,
    wantsCompleteMeal: intent.wantsCompleteMeal,
    wantsLongTermBudget: intent.wantsLongTermBudget,
    remainingMentionFen: intent.remainingMentionFen,
  };
}

function toImpactView(impact: MealImpact): AiImpactView {
  return {
    remainingBeforeFen: impact.remainingBeforeFen,
    remainingAfterFen: impact.remainingAfterFen,
    beforeDailyFen: impact.beforeDailyFen,
    afterDailyFen: impact.afterDailyFen,
    dailyDeltaFen: impact.dailyDeltaFen,
    reserveTouchedFen: impact.reserveTouchedFen,
    overBudgetFen: impact.overBudgetFen,
    assumptions: impact.assumptions,
  };
}

/** 由确定性规则生成"这份为什么符合你的需求"，不是模型自由发挥 */
function buildFitNotes(
  rec: Recommendation,
  intent: ParsedIntent,
  budget: BudgetDecision,
  primary: boolean,
): string[] {
  const notes: string[] = [];

  if (primary) {
    notes.push(`按你「${DECISION_GOAL_LABELS[intent.goal]}」的目标优先挑的一份`);
  }
  if (intent.wantsCompleteMeal && rec.composition === "combo") {
    notes.push("是套餐形式，比单点主食更接近「一顿完整的」");
  }
  if (rec.items.length > 1) {
    notes.push(`共 ${rec.items.length} 件：${rec.items.map((item) => item.name).join(" + ")}`);
  }
  if (rec.priceVerified) {
    notes.push(`官方算价核验 ${formatFen(rec.totalPriceFen)}，在 ${formatFen(budget.appliedFen)} 的预算内`);
  }
  if (intent.mealType !== "unspecified") {
    notes.push(`按${MEAL_TYPE_LABELS[intent.mealType]}场景给的方案`);
  }
  if (intent.avoid.length > 0) {
    notes.push(`已排除名称含「${intent.avoid.join("、")}」的餐品（依据菜单名称，非配料表）`);
  }
  if (rec.needsFurtherSelection) {
    notes.push("这份套餐的内容需要你在点单时选择，实际组成以门店为准");
  }

  return notes;
}

export function buildDecideResponse(input: BuildResponseInput): DecideResponse {
  const { intent, budget, recommend, context, mode, ai, warnings, blocked, elapsedMs } = input;

  const caveats: string[] = [];
  const localWarnings: AiWarning[] = [];
  const recommendationWarnings = recommend?.warnings ?? [];

  /* 预算相关说明 */
  if (budget.source === "default") {
    localWarnings.push({
      code: "BUDGET_DEFAULTED",
      message: `你没有说预算，本次按默认 ${formatFen(budget.appliedFen)} 来找；告诉我一个金额可以更准确。`,
    });
  }
  if (budget.clampedByContext) {
    localWarnings.push({
      code: "BUDGET_CLAMPED_BY_CONTEXT",
      message: `你说的金额超过了你设置的单餐上限，已按 ${formatFen(budget.appliedFen)} 来找，不会超出这个上限。`,
    });
  }
  // 用户说的金额低于平台下限时，不要把"已调整到 ¥5.00"摆在他面前——
  // 那会让人以为系统改了他的预算（实际是这次压根不查、不给推荐）
  const belowMinimum =
    budget.mentionedFen !== null && budget.mentionedFen < AI_BUDGET_MIN_FEN;
  if (budget.clampedByApiLimit && !belowMinimum) {
    localWarnings.push({
      code: "BUDGET_CLAMPED_BY_API_LIMIT",
      message: `预算已调整到接口允许的 ${formatFen(budget.appliedFen)}（¥5 ~ ¥200）。`,
    });
  }
  if (budget.kind === "soft_target") {
    localWarnings.push({
      code: "SOFT_BUDGET_NOTED",
      message: `「${formatFen(budget.mentionedFen ?? budget.appliedFen)} 左右」按期望价位处理：推荐不会超过这个数${
        budget.hardCapFen !== null ? `，也不超过你设的上限 ${formatFen(budget.hardCapFen)}` : ""
      }。`,
    });
  }

  /* 同一句话给了两个数（期望 20 左右 + 硬上限 25）：必须说清两个都在用 */
  if (typeof budget.preferredFen === "number") {
    localWarnings.push({
      code: "MIXED_BUDGET_NOTED",
      message: `你同时给了期望价位 ${formatFen(budget.preferredFen)} 和硬上限 ${formatFen(
        budget.hardCapFen ?? budget.mentionedFen ?? budget.appliedFen,
      )}：本次按期望价位找，硬上限仍然不可突破。`,
    });
  }

  /* 排除项免责 —— 只要提了就必须出现 */
  if (intent.avoid.length > 0) {
    caveats.push(exclusionCaveat(intent.avoid));
    localWarnings.push({
      code: "EXCLUSION_NOT_GUARANTEED",
      message:
        "已按菜单名称确定性排除你不想吃的品类，但接口没有配料/辣度字段，无法保证绝对不含，请以门店实际为准。",
    });
  }

  /* 过敏原 —— 无能为力就直说 */
  const allergenMentioned = intent.unsupportedConditions.some((item) => item.includes("过敏原"));
  if (allergenMentioned) {
    caveats.push(ALLERGEN_CAVEAT);
    localWarnings.push({
      code: "ALLERGEN_UNVERIFIED",
      message: "关于过敏原：系统没有可靠数据，无法确认，不能保证食用安全。",
    });
  }

  /* 账本：用户提到周期剩余金额时，明确说明"没有改你的账本" */
  if (intent.remainingMentionFen !== null) {
    const mentioned = formatFen(intent.remainingMentionFen);
    const ledgerRemaining = context?.budget?.remainingFen;
    const ledgerText =
      typeof ledgerRemaining === "number"
        ? `你本机账本里记录的周期剩余是 ${formatFenSigned(ledgerRemaining)}。`
        : "本次没有读取你的账本余额。";
    caveats.push(
      `你说「还剩 ${mentioned}」只是作为参考，系统**没有也不会**因此修改你的预算账本——` +
        `账本只能由你在预算页手动改。${ledgerText}`,
    );
    localWarnings.push({
      code: "LEDGER_UNTOUCHED",
      message: "你提到的剩余金额没有被写入账本，本次不会改动任何历史记录。",
    });
  }

  /* 用户提到"昨天/上次吃过什么"：必须说清这只是他这句话，不是系统读到的历史 */
  const historyTags = intent.historyTags ?? [];
  if (historyTags.length > 0) {
    caveats.push(
      `你说的「之前吃过 ${historyTags.join("、")}」是你**这一句话里提供的信息**：` +
        `系统没有你的历史用餐记录，也没有去读任何记录，只是按这句话帮你避开重复。`,
    );
    localWarnings.push({
      code: "HISTORY_NOT_RECORDED",
      message: `系统没有「${historyTags.join("、")}」的历史用餐记录，本次只使用你这句话里说明的信息，不会假装知道你以前吃过什么。`,
    });
  }

  /* 预算影响的边界说明：账本可能不完整，必须说"按已记录消费估算" */
  if (context?.budget?.authorized) {
    caveats.push(
      "预算影响是**根据你已记录的消费估算**的参考值：账本里只有你手动记过的消费，" +
        "如果有漏记，实际可用金额会比这里更少；账本数据只保存在你这个浏览器，不会上传到服务器。",
    );
    localWarnings.push({
      code: "LEDGER_ESTIMATED",
      message: "预算影响按你已记录的消费估算，不代表你的全部实际支出。",
    });
  }

  caveats.push(PRICE_CAVEAT, MEDICAL_CAVEAT);

  /* 推荐列表 */
  const planType = primaryPlanType(intent);
  const canComputeImpact =
    context?.budget?.authorized === true &&
    typeof context.budget.remainingFen === "number" &&
    typeof context.budget.daysRemaining === "number";

  const recommendations: AiRecommendation[] = (recommend?.recommendations ?? []).map((rec) => {
    let impact: AiImpactView | null = null;

    if (canComputeImpact && rec.verifiedPriceFen !== null) {
      const budgetContext = context?.budget;
      if (budgetContext && typeof budgetContext.remainingFen === "number" && typeof budgetContext.daysRemaining === "number") {
        const computed = computeMealImpact({
          remainingFen: budgetContext.remainingFen,
          daysRemaining: budgetContext.daysRemaining,
          plannedFen: rec.verifiedPriceFen,
          reserveFen: budgetContext.reserveFen ?? 0,
          mealsLeftToday: context?.mealsLeftToday ?? 1,
          // 用户没说"这是今天最后一餐"时，不替他把今天的额度花掉（沿用任务 003 的原则）
          assumeCoversToday:
            typeof context?.mealsLeftToday === "number" ? undefined : false,
        });
        impact = toImpactView(computed);
      }
    }

    if (!rec.priceVerified) {
      localWarnings.push({
        code: "PRICE_NOT_VERIFIED",
        message: "存在未通过官方算价核验的方案，价格仅供参照，不能当作实付金额。",
      });
    }

    return {
      recommendation: rec,
      impact,
      fitNotes: buildFitNotes(rec, intent, budget, rec.type === planType),
      primary: rec.type === planType,
    };
  });

  if (recommendations.length === 0) {
    localWarnings.push({
      code: "NO_RESULT",
      message: blocked
        ? blockedReason(intent)
        : "本次没有符合条件的推荐，系统不会用编造的餐品或价格填充结果。",
    });
  }

  if (intent.needsClarification && intent.clarifyingQuestions.length > 0) {
    localWarnings.push({
      code: "CLARIFICATION_NEEDED",
      message: "有需要你确认的信息，见下方问题；在你回答之前，系统不会替你猜。",
    });
  }

  const allWarnings = dedupeWarnings([...warnings, ...localWarnings]);

  return {
    success: true,
    mode,
    ai,
    intent,
    understood: buildUnderstood(intent, budget),
    budget,
    recommendations,
    priceVerification: {
      quotesUsed: recommend?.stats.quotesUsed ?? 0,
      verifiedCount: recommendations.filter((item) => item.recommendation.priceVerified).length,
      allVerified: recommendations.every((item) => item.recommendation.priceVerified),
    },
    clarification: {
      needed: intent.needsClarification && intent.clarifyingQuestions.length > 0,
      questions: intent.clarifyingQuestions,
    },
    caveats,
    source: recommend?.source ?? {
      provider: "mcd-mcp",
      storeCode: context?.storeCode ?? "",
      storeName: "",
      orderType: 1,
      beType: 1,
      fetchedAt: new Date().toISOString(),
      toolsUsed: [],
    },
    warnings: allWarnings,
    recommendationWarnings,
    emptyReason: blocked ? blockedReason(intent) : recommend?.emptyReason,
    elapsedMs,
  };
}

/**
 * 被拦下时的原因。
 * 「信息不足」和「钱太少」是两回事，不能都甩一句"补充信息"糊过去——
 * 后者必须说清"没有超过这个数的方案"，而不是悄悄按 ¥5 去找。
 */
function blockedReason(intent: ParsedIntent): string {
  const fen = intent.budgetFen;
  if (fen !== null && fen < AI_BUDGET_MIN_FEN) {
    return (
      `你说的 ${formatFen(fen)} 低于平台可查询的最低金额 ${formatFen(AI_BUDGET_MIN_FEN)}，` +
      `本次没有可推荐的方案；系统不会用超过这个数的餐品来凑数。`
    );
  }
  return "需要你先补充一点信息，系统不会靠猜测给推荐。";
}

function dedupeWarnings(list: readonly AiWarning[]): AiWarning[] {
  const seen = new Set<string>();
  const result: AiWarning[] = [];
  for (const warning of list) {
    if (seen.has(warning.code)) continue;
    seen.add(warning.code);
    result.push(warning);
  }
  return result;
}
