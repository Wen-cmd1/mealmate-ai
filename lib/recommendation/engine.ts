/**
 * 单餐推荐 —— 流程编排（任务 002 核心）。
 *
 * 真实调用顺序（每一步都是**只读**）：
 *   1. `query-nearby-stores`  反查门店名（可选，失败不致命，只降级并告警）
 *   2. `query-meals`          取该门店当前菜单 → 归一化为 MealItem
 *   3. 分类过滤               剔除周边/酱料/单点饮料/甜品/多人餐等非正餐
 *   4. 构造候选               套餐 / 单点主食 / 主食+配餐 / 主食+饮料
 *   5. 预算粗筛               用菜单标价过滤（仅用于减少算价调用）
 *   6. `calculate-price`      对最终候选**逐个**核验真实应付金额
 *   7. 超预算即剔除，继续下一个候选；核验失败也跳过
 *   8. 三个方案尽量使用不同主 SKU，不足就返回实际数量，绝不凑数
 *
 * 关键约束：
 * - 绝不用「菜单标价」冒充「官方算价」；`priceVerified` 为 true 才有资格被推荐；
 * - 上游算价单位是**分**，与菜单标的「元」不同，转换只发生在适配器边界；
 * - 营养数据不参与打分（无可靠关联键）。
 */

import { redactSecrets } from "../mcp/redact";
import { buildExplanation, buildEmptyReason } from "./explain";
import {
  buildCandidates,
  classifyItem,
  filterByBudget,
  filterMenu,
  findCheapestAnchorFen,
} from "./filters";
import { prioritizeComplete, rankCandidates } from "./scoring";
import {
  DEFAULT_MAX_RESULTS,
  PLAN_TITLES,
  PLAN_TYPES,
  type Candidate,
  type MenuPort,
  type RecommendErrorCode,
  type RecommendRequest,
  type RecommendResponse,
  type RecommendStats,
  type Recommendation,
  type RecommendationSource,
  type RecommendationType,
  type RecommendWarning,
  type RecommendedItem,
  type ScoredCandidate,
} from "./types";
import type { MenuSnapshot, PriceQuote, StoreRef } from "../../types/meal";

/* ------------------------------------------------------------------ *
 * 错误
 * ------------------------------------------------------------------ */

export class RecommendationError extends Error {
  constructor(
    readonly code: RecommendErrorCode,
    message: string,
    readonly httpStatus: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "RecommendationError";
  }
}

/** 上游错误对象上的 `kind`（McpClientError / McpClientError 兼容），做鸭子类型判断以免耦合 SDK */
function errorKind(error: unknown): string | undefined {
  const kind = (error as { kind?: unknown } | null)?.kind;
  return typeof kind === "string" ? kind : undefined;
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw);
}

/** 这类错误说明上游整体不可用，继续尝试别的候选没有意义 */
function isFatalError(error: unknown): boolean {
  const kind = errorKind(error);
  if (kind === "MISSING_TOKEN" || kind === "TIMEOUT" || kind === "CONNECT_FAILED") return true;
  return /timeout|timed out|aborted|ECONNREFUSED|ENOTFOUND/i.test(errorMessage(error));
}

function toRecommendationError(error: unknown, fallback: RecommendErrorCode): RecommendationError {
  if (error instanceof RecommendationError) return error;

  const kind = errorKind(error);
  const message = errorMessage(error);

  if (kind === "MISSING_TOKEN") {
    return new RecommendationError(
      "MISSING_TOKEN",
      "服务端未配置 MCD_MCP_TOKEN，无法查询真实菜单（不会用模拟数据替代）",
      503,
    );
  }
  if (kind === "TIMEOUT" || /timeout|timed out|aborted/i.test(message)) {
    return new RecommendationError("MCP_TIMEOUT", "调用麦当劳接口超时，请稍后重试", 504, true);
  }
  if (kind === "CONNECT_FAILED" || /ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message)) {
    return new RecommendationError("MCP_UNAVAILABLE", "无法连接麦当劳 MCP 服务", 502, true);
  }

  return new RecommendationError(fallback, `麦当劳接口调用失败：${message}`, 502, true);
}

/* ------------------------------------------------------------------ *
 * 告警去重
 * ------------------------------------------------------------------ */

const MAX_WARNINGS_PER_CODE = 2;

function pushWarning(list: RecommendWarning[], warning: RecommendWarning): void {
  const count = list.filter((w) => w.code === warning.code).length;
  if (count < MAX_WARNINGS_PER_CODE) list.push(warning);
}

/* ------------------------------------------------------------------ *
 * 引擎
 * ------------------------------------------------------------------ */

export interface EngineOptions {
  provider: MenuPort;
  /** 整次请求最多发起多少次 calculate-price，默认 12（3 方案 × 4 候选） */
  maxQuotes?: number;
  /** 每个方案最多核验几个候选 */
  maxCandidatesPerPlan?: number;
  /** 是否构造「主食 + 配餐/饮料」候选，默认 true */
  includeAddons?: boolean;
}

interface Pick {
  type: RecommendationType;
  scored: ScoredCandidate;
  quote: PriceQuote;
}

const DEFAULT_MAX_QUOTES = 12;

export class RecommendationEngine {
  private readonly provider: MenuPort;
  private readonly maxQuotes: number;
  private readonly maxCandidatesPerPlan: number;
  private readonly includeAddons: boolean;

  constructor(options: EngineOptions) {
    this.provider = options.provider;
    this.maxQuotes = options.maxQuotes ?? DEFAULT_MAX_QUOTES;
    this.maxCandidatesPerPlan = options.maxCandidatesPerPlan ?? 4;
    this.includeAddons = options.includeAddons ?? true;
  }

  async recommend(request: RecommendRequest): Promise<RecommendResponse> {
    const startedAt = Date.now();
    const warnings: RecommendWarning[] = [];
    const toolsUsed = new Set<string>();
    const budgetFen = request.budgetFen;
    const maxResults = Math.max(1, Math.min(request.maxResults ?? DEFAULT_MAX_RESULTS, 3));

    // 1. 门店（失败不致命：storeCode 由调用方给出，门店名只影响展示）
    const store = await this.resolveStore(request, warnings);
    if (store.storeName) toolsUsed.add("query-nearby-stores");

    // 2. 菜单（致命：没有菜单就无法推荐）
    let menu: MenuSnapshot;
    try {
      menu = await this.provider.getMenu({
        storeCode: request.storeCode,
        orderType: request.orderType,
        beType: request.beType,
        store,
      });
      toolsUsed.add("query-meals");
    } catch (error) {
      throw toRecommendationError(error, "MENU_UNAVAILABLE");
    }

    // 3-5. 分类过滤 → 候选 → 预算粗筛
    // `avoidTags` 在这里就生效：用户明确排除的口味不会被推荐，也不参与算价。
    const filtered = filterMenu(menu.items, {
      excludeCategories: request.excludeCategories,
      excludeTags: request.avoidTags,
    });
    const candidates = buildCandidates(filtered, { includeAddons: this.includeAddons });
    const withinBudget = filterByBudget(candidates, budgetFen);
    const cheapestAnchorFen = findCheapestAnchorFen(filtered);

    // 6-8. 逐个官方核验 + 三方案去重
    const selection = await this.selectAndVerify({
      request,
      candidates: withinBudget,
      maxResults,
      warnings,
      toolsUsed,
    });

    const recommendations = this.materialize(selection.picks, {
      budgetFen,
      request,
      verifiedTotals: selection.verifiedTotals,
    });

    const source: RecommendationSource = {
      provider: "mcd-mcp",
      storeCode: request.storeCode,
      storeName: store.storeName,
      storeAddress: store.address,
      orderType: request.orderType,
      beType: request.beType,
      fetchedAt: menu.fetchedAt,
      upstreamDatetime: menu.items[0]?.source.upstreamDatetime,
      traceId: menu.items[0]?.source.traceId,
      toolsUsed: [...toolsUsed],
    };

    const stats: RecommendStats = {
      menuItemCount: filtered.report.menuItemCount,
      anchorCount: filtered.report.anchorCount,
      withinBudgetCount: withinBudget.length,
      quotesUsed: selection.quotesUsed,
      verifiedCount: selection.verifiedTotals.length,
      rejectionCounts: selection.rejectionCounts,
      exclusionCounts: filtered.report.exclusionCounts,
    };

    if (recommendations.some((r) => r.needsFurtherSelection)) {
      pushWarning(warnings, {
        code: "NEEDS_FURTHER_SELECTION",
        message: "部分推荐是「可自选内容」的套餐，实际组成需在点餐时确认，价格已按官方算价核验",
      });
    }

    const response: RecommendResponse = {
      success: true,
      budgetFen,
      recommendations,
      source,
      stats,
      warnings,
      elapsedMs: Date.now() - startedAt,
    };

    if (recommendations.length === 0) {
      response.emptyReason = buildEmptyReason({
        budgetFen,
        menuItemCount: filtered.report.menuItemCount,
        anchorCount: filtered.report.anchorCount,
        withinBudgetCount: withinBudget.length,
        cheapestAnchorFen,
        verifiedCount: selection.verifiedTotals.length,
        excludedByTagCount: filtered.report.exclusionCounts.excluded_tag ?? 0,
        excludedTags: request.avoidTags,
      });
    } else if (recommendations.length < maxResults) {
      pushWarning(warnings, {
        code: "INSUFFICIENT_CANDIDATES",
        message: `预算内只找到 ${recommendations.length} 份符合条件的完整正餐，已按实际数量返回，不做凑数`,
      });
    }

    return response;
  }

  /* ---------------------------------------------------------------- *
   * 门店
   * ---------------------------------------------------------------- */

  private async resolveStore(
    request: RecommendRequest,
    warnings: RecommendWarning[],
  ): Promise<StoreRef> {
    const fallback: StoreRef = { storeCode: request.storeCode, storeName: "" };

    const keyword = request.keyword?.trim();
    if (!keyword) {
      pushWarning(warnings, {
        code: "STORE_NAME_UNAVAILABLE",
        message: "未提供商圈关键词，无法反查门店名（上游查门店必须同时有 city 与 keyword），已仅用门店编码继续",
      });
      return fallback;
    }

    // query-nearby-stores 的 beType 只支持 1(到店) / 5(得来速)
    const storeBeType: 1 | 5 | undefined =
      request.beType === 1 ? 1 : request.beType === 5 ? 5 : undefined;
    if (!storeBeType) {
      pushWarning(warnings, {
        code: "STORE_NOT_FOUND",
        message: `用餐方式 beType=${request.beType} 不支持按商圈反查门店，已仅用门店编码继续`,
      });
      return fallback;
    }

    try {
      const stores = await this.provider.findStores({
        city: request.city,
        keyword,
        beType: storeBeType,
        searchType: 2,
      });
      const hit = stores.find((s) => s.storeCode === request.storeCode);
      if (!hit) {
        pushWarning(warnings, {
          code: "STORE_NOT_FOUND",
          message: `在「${request.city} ${keyword}」的查询结果里没有找到门店 ${request.storeCode}，已仅用门店编码继续`,
        });
        return fallback;
      }
      if (hit.businessStatus === false) {
        pushWarning(warnings, {
          code: "STORE_CLOSED",
          message: `门店「${hit.storeName}」当前显示为休息中，菜单可能不完整`,
        });
      }
      return hit;
    } catch (error) {
      if (isFatalError(error)) throw toRecommendationError(error, "STORE_UNAVAILABLE");
      pushWarning(warnings, {
        code: "STORE_LOOKUP_FAILED",
        message: `门店查询失败（${errorMessage(error)}），已仅用门店编码继续，不影响菜单与价格核验`,
      });
      return fallback;
    }
  }

  /* ---------------------------------------------------------------- *
   * 核验与选样
   * ---------------------------------------------------------------- */

  private async selectAndVerify(input: {
    request: RecommendRequest;
    candidates: readonly Candidate[];
    maxResults: number;
    warnings: RecommendWarning[];
    toolsUsed: Set<string>;
  }): Promise<{
    picks: Pick[];
    quotesUsed: number;
    verifiedTotals: number[];
    rejectionCounts: Record<string, number>;
  }> {
    const { request, candidates, maxResults, warnings, toolsUsed } = input;

    const picks: Pick[] = [];
    const verifiedTotals: number[] = [];
    const rejectionCounts: Record<string, number> = {};
    const usedPrimary = new Set<string>();
    const usedCategories = new Set<string>();

    let quotesUsed = 0;
    const planQuota = Math.max(1, Math.ceil(this.maxQuotes / PLAN_TYPES.length));

    if (candidates.length === 0) {
      pushWarning(warnings, {
        code: "NO_CANDIDATE_IN_BUDGET",
        message: `预算 ${request.budgetFen} 分内没有任何可作为完整正餐的候选，未发起算价调用`,
      });
    }

    const reject = (reason: string) => {
      rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + 1;
    };

    for (const type of PLAN_TYPES) {
      if (picks.length >= maxResults) break;

      const rankedRaw = rankCandidates(candidates, {
        type,
        budgetFen: request.budgetFen,
        preferences: request.preferences,
      });
      // 均衡方案先试"组成完整"的候选，避免退化成"又一个便宜的单个汉堡"
      const ranked = type === "balanced" ? prioritizeComplete(rankedRaw) : rankedRaw;

      let planQuotes = 0;
      let picked = false;

      // pass 0：先尝试与已选方案不同分类的候选；pass 1：放宽分类限制
      for (const pass of [0, 1] as const) {
        if (picked) break;

        for (const scored of ranked) {
          if (picked) break;
          if (planQuotes >= planQuota) break;
          if (planQuotes >= this.maxCandidatesPerPlan) break;

          const candidate = scored.candidate;
          // 三种方案尽量使用不同 SKU：主 SKU 复用直接跳过（不消耗算价次数）
          if (usedPrimary.has(candidate.primaryCode)) continue;
          if (pass === 0 && candidate.categoryName && usedCategories.has(candidate.categoryName)) {
            continue;
          }

          let quote: PriceQuote;
          planQuotes += 1;
          quotesUsed += 1;
          toolsUsed.add("calculate-price");

          try {
            quote = await this.provider.quotePrice({
              storeCode: request.storeCode,
              orderType: request.orderType,
              beType: request.beType,
              needTableware: false,
              items: candidate.items.map((item) => ({ productCode: item.code, quantity: 1 })),
            });
          } catch (error) {
            if (isFatalError(error)) throw toRecommendationError(error, "MCP_UNAVAILABLE");
            reject("quote_failed");
            pushWarning(warnings, {
              code: "QUOTE_FAILED",
              message: `「${candidate.primaryName}」官方算价失败，已跳过该候选（${errorMessage(error)}）`,
            });
            continue;
          }

          if (!Number.isInteger(quote.totalFen) || quote.totalFen <= 0) {
            reject("quote_invalid");
            continue;
          }

          if (quote.totalFen > request.budgetFen) {
            reject("over_budget");
            pushWarning(warnings, {
              code: "QUOTE_REJECTED_OVER_BUDGET",
              message:
                `「${candidate.primaryName}」菜单标价 ${candidate.menuPriceFen} 分，` +
                `官方算价 ${quote.totalFen} 分，已超预算，按算价剔除`,
            });
            continue;
          }

          picks.push({ type, scored, quote });
          verifiedTotals.push(quote.totalFen);
          usedPrimary.add(candidate.primaryCode);
          if (candidate.categoryName) usedCategories.add(candidate.categoryName);
          picked = true;
        }
      }
      // 未选到方案时不单独告警：由响应级的 INSUFFICIENT_CANDIDATES / emptyReason 统一说明，
      // 避免同一个原因在 warnings 里重复三遍。
    }

    if (quotesUsed >= this.maxQuotes) {
      pushWarning(warnings, {
        code: "QUOTE_LIMIT_REACHED",
        message: `已达到单次请求的算价调用上限（${this.maxQuotes} 次），未继续核验更多候选`,
      });
    }

    return { picks, quotesUsed, verifiedTotals, rejectionCounts };
  }

  /* ---------------------------------------------------------------- *
   * 组装响应
   * ---------------------------------------------------------------- */

  private materialize(
    picks: readonly Pick[],
    context: { budgetFen: number; request: RecommendRequest; verifiedTotals: readonly number[] },
  ): Recommendation[] {
    const minVerified =
      context.verifiedTotals.length > 0 ? Math.min(...context.verifiedTotals) : Number.POSITIVE_INFINITY;

    return picks.map((pick) => {
      const { candidate, matchedPreferences, score, breakdown } = pick.scored;
      const verifiedPriceFen = pick.quote.totalFen;
      const menuPriceFen = candidate.menuPriceFen;
      const priceMismatch = verifiedPriceFen !== menuPriceFen;

      const explanation = buildExplanation({
        type: pick.type,
        candidate,
        budgetFen: context.budgetFen,
        verifiedPriceFen,
        menuPriceFen,
        matchedPreferences,
        requestedPreferences: context.request.preferences ?? [],
        priceMismatch,
        isCheapestVerified: pick.type === "save" && verifiedPriceFen === minVerified,
      });

      const items: RecommendedItem[] = candidate.items.map((item) => {
        const cls = classifyItem(item);
        return {
          code: item.code,
          name: item.name,
          role: cls.role,
          categoryName: item.categoryName,
          quantity: 1,
          menuPriceFen: item.priceFen,
          unitPriceFen: item.priceFen,
          originalPriceFen: item.originalPriceFen,
          onSale: item.onSale,
          needsFurtherSelection: candidate.needsFurtherSelection && item.code === candidate.primaryCode,
        };
      });

      return {
        type: pick.type,
        title: PLAN_TITLES[pick.type],
        items,
        totalPriceFen: verifiedPriceFen,
        menuPriceFen,
        verifiedPriceFen,
        priceVerified: true,
        priceMismatch,
        remainingFen: context.budgetFen - verifiedPriceFen,
        composition: candidate.composition,
        needsFurtherSelection: candidate.needsFurtherSelection,
        reason: explanation.reason,
        highlights: explanation.highlights,
        score,
        scoreBreakdown: breakdown,
      } satisfies Recommendation;
    });
  }
}

/** 便捷构造：用真实 Provider 建引擎 */
export function createRecommendationEngine(provider: MenuPort, options?: Partial<EngineOptions>) {
  return new RecommendationEngine({ provider, ...options });
}
