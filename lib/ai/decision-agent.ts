/**
 * AI 决策 Agent —— 编排层（任务 004）。
 *
 * 一句话概括分工：
 * **大模型只负责"听懂"，确定性算法负责"算清"，麦当劳 MCP 负责"真实"。**
 *
 * 执行链路（每一步都可单独测试）：
 *   1. 文本与上下文校验（长度、门店编码、预算上下文数值范围——用户数据一律不可信）
 *   2. 意图解析（LLM → Zod 校验 → 失败降级到规则；含提示注入前置拦截）
 *   3. 预算裁决（硬上限 / 软偏好 / 计划建议 / 默认值，且**永不突破用户硬上限**）
 *   4. 复用任务 002 的 `RecommendationEngine`（不复制评分与 MCP 调用）
 *   5. 组装响应（预算影响、可解释理由、必须展示的限制）
 *
 * 不做的事（写在这里是为了以后不被"顺手加进去"）：
 * - 不写账本、不改预算、不删记录 —— 本模块**没有**任何写入口；
 * - 不调用下单/支付/领券工具 —— `RecommendationEngine` 只有三个只读能力；
 * - 不因为模型说了什么就相信什么 —— 价格与菜单只来自 MCP。
 */

import { RecommendationEngine, RecommendationError } from "../recommendation/engine";
import type { MenuPort, RecommendResponse } from "../recommendation/types";
import { parseIntent } from "./parse-intent";
import type { LlmProvider } from "./provider";
import { buildDecideResponse, primaryPlanType } from "./response-builder";
import {
  AI_BUDGET_MAX_FEN,
  AI_BUDGET_MIN_FEN,
  AI_DEFAULT_BUDGET_FEN,
  AiError,
  BUDGET_SOURCE_LABELS,
  MAX_TEXT_CHARS,
  type AiWarning,
  type BudgetDecision,
  type BudgetSource,
  type DecideContext,
  type DecideInput,
  type DecideResponse,
  type ParsedIntent,
} from "./types";

const STORE_CODE_PATTERN = /^\d{3,12}$/;

export interface DecideDependencies {
  /** 真实数据源（测试可注入假实现） */
  mealProvider: MenuPort;
  /** null / undefined 表示未配置模型，走规则降级 */
  llmProvider?: LlmProvider | null;
  /** 覆盖推荐引擎（测试用） */
  engine?: RecommendationEngine;
  /** 模型超时覆盖 */
  aiTimeoutMs?: number;
}

/* ------------------------------------------------------------------ *
 * 输入校验
 * ------------------------------------------------------------------ */

/**
 * 校验用户文本。超长直接拒绝而不是截断——
 * 截断会让"后半句的硬上限"被悄悄丢掉，那是最危险的一种静默失真。
 */
export function validateText(text: unknown): string {
  if (typeof text !== "string") {
    throw new AiError("INVALID_REQUEST", "请输入一句话描述你的用餐需求");
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new AiError("INVALID_REQUEST", "输入不能为空");
  }
  if (trimmed.length > MAX_TEXT_CHARS) {
    throw new AiError("TEXT_TOO_LONG", `输入最多 ${MAX_TEXT_CHARS} 个字，请精简后再试`);
  }
  return trimmed;
}

function clampInt(value: unknown, min: number, max: number): number | undefined {
  // 只接受**整数**：3.5 天 / "300" 这类值一律丢弃，不做四舍五入（那等于替用户编数据）
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

/**
 * 预算上下文是**用户从本机带上来的数据**，按不可信输入处理：
 * 越界或非整数的字段直接丢弃（并在告警里说明），不报错、不信任。
 */
export function sanitizeContext(
  raw: DecideContext | undefined,
  warnings: AiWarning[],
): DecideContext | undefined {
  if (!raw) return undefined;

  if (typeof raw.storeCode !== "string" || !STORE_CODE_PATTERN.test(raw.storeCode.trim())) {
    throw new AiError("INVALID_REQUEST", "需要先选择一个有效的门店（门店编码必须是 3~12 位数字）");
  }

  const city = typeof raw.city === "string" && raw.city.trim().length > 0 ? raw.city.trim().slice(0, 20) : "广州市";
  const keyword =
    typeof raw.keyword === "string" && raw.keyword.trim().length > 0
      ? raw.keyword.trim().slice(0, 30)
      : undefined;

  const context: DecideContext = {
    city,
    keyword,
    storeCode: raw.storeCode.trim(),
    orderType: 1,
    beType: 1,
  };

  if (Array.isArray(raw.preferences) && raw.preferences.length > 0) {
    context.preferences = raw.preferences.slice(0, 4);
  }
  if (Array.isArray(raw.avoid) && raw.avoid.length > 0) {
    context.avoid = raw.avoid.slice(0, 4);
  }

  const mealsLeft = clampInt(raw.mealsLeftToday, 1, 4);
  if (mealsLeft !== undefined) context.mealsLeftToday = mealsLeft;

  if (raw.budget && raw.budget.authorized === true) {
    const hardCapFen = clampInt(raw.budget.hardCapFen, AI_BUDGET_MIN_FEN, AI_BUDGET_MAX_FEN);
    const suggestedMealBudgetFen = clampInt(
      raw.budget.suggestedMealBudgetFen,
      AI_BUDGET_MIN_FEN,
      AI_BUDGET_MAX_FEN,
    );
    const remainingFen = clampInt(raw.budget.remainingFen, -1_000_000, 10_000_000);
    const daysRemaining = clampInt(raw.budget.daysRemaining, 0, 400);
    const reserveFen = clampInt(raw.budget.reserveFen, 0, 10_000_000);

    context.budget = {
      authorized: true,
      hardCapFen,
      suggestedMealBudgetFen,
      remainingFen,
      daysRemaining,
      reserveFen,
      planName: typeof raw.budget.planName === "string" ? raw.budget.planName.slice(0, 40) : undefined,
    };

    const dropped =
      (raw.budget.hardCapFen !== undefined && hardCapFen === undefined) ||
      (raw.budget.remainingFen !== undefined && remainingFen === undefined);
    if (dropped) {
      warnings.push({
        code: "BUDGET_CLAMPED_BY_CONTEXT",
        message: "你带来的部分预算数值超出合理范围，已被忽略，只使用通过校验的部分。",
      });
    }
  }

  return context;
}

/* ------------------------------------------------------------------ *
 * 预算裁决
 * ------------------------------------------------------------------ */

/**
 * 决定"这一顿按多少钱找"。
 *
 * 优先级：用户这次说的金额 > 长期预算推算的建议值 > 上下文硬上限 > 默认值。
 * 无论走哪条路，最后都会被用户已设的硬上限与接口区间夹一遍。
 *
 * ⚠️ 关键安全点：用户这次说的金额**只能被下调，不能被上调**。
 * 换句话说，模型或界面永远无法把用户的硬上限改大。
 */
export function resolveBudget(intent: ParsedIntent, context?: DecideContext): BudgetDecision {
  const contextCap = context?.budget?.hardCapFen ?? null;
  const suggestion = context?.budget?.suggestedMealBudgetFen ?? null;
  const mentioned = intent.budgetFen;
  /** 同一句里另给的期望价位（「20 元左右」+「不超过 25」时才有值） */
  const preferred = intent.preferredFen ?? null;

  let appliedFen: number;
  let source: BudgetSource;
  let clampedByContext = false;
  let clampedByApiLimit = false;

  if (mentioned !== null) {
    // 双重金额：按期望价位找，硬上限另外留着兜底
    appliedFen = preferred !== null ? Math.min(preferred, mentioned) : mentioned;
    source = intent.budgetKind === "hard_cap" ? "user_hard_cap" : "user_soft_target";
    if (contextCap !== null && appliedFen > contextCap) {
      appliedFen = contextCap;
      clampedByContext = true;
    }
  } else if (suggestion !== null) {
    appliedFen = suggestion;
    source = "plan_suggestion";
    if (contextCap !== null && appliedFen > contextCap) {
      appliedFen = contextCap;
      clampedByContext = true;
    }
  } else if (contextCap !== null) {
    appliedFen = contextCap;
    source = "context_hard_cap";
  } else {
    appliedFen = AI_DEFAULT_BUDGET_FEN;
    source = "default";
  }

  if (appliedFen > AI_BUDGET_MAX_FEN) {
    appliedFen = AI_BUDGET_MAX_FEN;
    clampedByApiLimit = true;
  }
  if (appliedFen < AI_BUDGET_MIN_FEN) {
    appliedFen = AI_BUDGET_MIN_FEN;
    clampedByApiLimit = true;
  }

  /**
   * 硬上限 = 用户原话里那个"不可突破"的数。
   *
   * 注意不能直接用 `appliedFen`：双重金额时 applied 是期望价位（更小，故意选小的），
   * 低于接口下限时 applied 会被上调到 ¥5——这两种情况下拿 applied 当硬上限
   * 都会把用户的原话改掉，所以这里单独算，并取上下文上限中更严的一个。
   */
  const hardCapFen =
    intent.budgetKind === "hard_cap" && mentioned !== null
      ? Math.min(mentioned, contextCap ?? mentioned)
      : contextCap;

  const amount = (fen: number) => `¥${(fen / 100).toFixed(2)}`;
  const tooLowForApi = mentioned !== null && mentioned < AI_BUDGET_MIN_FEN;
  let explanation: string;

  if (tooLowForApi) {
    // 不能把用户的 ¥3 说成"按 ¥5 来找"——那是替他改了预算
    explanation =
      `你说的 ${amount(mentioned)} 低于平台可查询的最低金额 ${amount(AI_BUDGET_MIN_FEN)}，` +
      `本次不发起查询，也不会给你超过 ${amount(mentioned)} 的推荐。`;
  } else if (preferred !== null && mentioned !== null) {
    explanation =
      `你同时说了「${amount(preferred)} 左右」和硬上限 ${amount(mentioned)}：` +
      `按 ${amount(appliedFen)} 左右来找，任何方案都不会超过 ${amount(mentioned)}。`;
  } else if (clampedByContext) {
    explanation = `你说的 ${amount(mentioned ?? appliedFen)} 超过了你设置的单餐上限 ${amount(appliedFen)}，已按上限来找。`;
  } else if (source === "user_hard_cap") {
    explanation = `按你说的「不超过 ${amount(appliedFen)}」来找，超过这个数的方案不会被推荐。`;
  } else if (source === "user_soft_target") {
    explanation = `按你说的「${amount(appliedFen)} 左右」来找，推荐不会超过这个数。`;
  } else if (source === "plan_suggestion") {
    explanation = `按你长期预算推算的建议单餐 ${amount(appliedFen)} 来找（${BUDGET_SOURCE_LABELS[source]}）。`;
  } else if (source === "context_hard_cap") {
    explanation = `按你设置的单餐上限 ${amount(appliedFen)} 来找。`;
  } else {
    explanation = `你没说预算，本次按默认 ${amount(appliedFen)} 来找。`;
  }

  return {
    appliedFen,
    kind: intent.budgetKind,
    source,
    mentionedFen: mentioned,
    preferredFen: preferred,
    clampedByContext,
    clampedByApiLimit,
    hardCapFen,
    explanation,
  };
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

export async function decide(
  input: DecideInput,
  deps: DecideDependencies,
): Promise<DecideResponse> {
  const startedAt = Date.now();
  const warnings: AiWarning[] = [];

  const text = validateText(input.text);
  const context = sanitizeContext(input.context, warnings);

  // 1. 意图
  const parsed = await parseIntent(text, {
    provider: deps.llmProvider ?? null,
    timeoutMs: deps.aiTimeoutMs,
  });
  warnings.push(...parsed.warnings);

  const intent = parsed.intent;

  // 2. 界面上的口味偏好/排除项作为"用户已确认的条件"合并进来（排除项优先）
  if (context?.preferences?.length) {
    for (const tag of context.preferences) {
      if (!intent.preferences.includes(tag) && !intent.avoid.includes(tag)) {
        intent.preferences.push(tag);
      }
    }
  }
  if (context?.avoid?.length) {
    for (const tag of context.avoid) {
      if (!intent.avoid.includes(tag)) intent.avoid.push(tag);
    }
    intent.preferences = intent.preferences.filter((tag) => !intent.avoid.includes(tag));
  }

  // 3. 预算
  const budget = resolveBudget(intent, context);

  // 4. 信息不足时不查真实菜单 —— 不猜、不编
  const usable =
    intent.budgetFen !== null ||
    intent.preferences.length > 0 ||
    intent.avoid.length > 0 ||
    intent.mealType !== "unspecified" ||
    intent.wantsCompleteMeal;
  const tooLow = intent.budgetFen !== null && intent.budgetFen < AI_BUDGET_MIN_FEN;
  const blocked =
    tooLow || (intent.needsClarification && intent.clarifyingQuestions.length > 0 && !usable);

  if (blocked) {
    return buildDecideResponse({
      intent,
      mode: parsed.mode,
      ai: parsed.ai,
      budget,
      recommend: null,
      context,
      warnings,
      blocked: true,
      elapsedMs: Date.now() - startedAt,
    });
  }

  // 5. 复用任务 002 的推荐引擎（同一套过滤/评分/算价）
  if (!context?.storeCode) {
    throw new AiError("INVALID_REQUEST", "需要先选择一个门店，才能查询真实菜单与价格");
  }

  const engine = deps.engine ?? new RecommendationEngine({ provider: deps.mealProvider });

  let recommend: RecommendResponse;
  try {
    recommend = await engine.recommend({
      budgetFen: budget.appliedFen,
      city: context.city,
      keyword: context.keyword,
      storeCode: context.storeCode,
      orderType: 1,
      beType: 1,
      preferences: intent.preferences.length > 0 ? [...intent.preferences] : undefined,
      // 排除项走确定性过滤（filters.ts 的 excludeTags），不是打分惩罚
      avoidTags: intent.avoid.length > 0 ? [...intent.avoid] : undefined,
      maxResults: 3,
    });
  } catch (error) {
    if (error instanceof RecommendationError) throw error;
    throw new RecommendationError("INTERNAL", "推荐引擎执行失败，请稍后重试", 500, true);
  }

  // 6. 组装
  const response = buildDecideResponse({
    intent,
    mode: parsed.mode,
    ai: parsed.ai,
    budget,
    recommend,
    context,
    warnings,
    elapsedMs: Date.now() - startedAt,
  });

  // 首选方案按目标重排到最前（返回顺序稳定，便于缓存与对比）
  const primaryType = primaryPlanType(intent);
  const ordered = [...response.recommendations].sort((a, b) => {
    const rank = (type: string) => (type === primaryType ? 0 : 1);
    return rank(a.recommendation.type) - rank(b.recommendation.type);
  });

  return { ...response, recommendations: ordered };
}
