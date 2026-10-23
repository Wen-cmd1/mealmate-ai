/**
 * 单餐推荐 —— 评分算法（纯函数）。
 *
 * 三种方案用**同一组评分维度、不同权重**，保证可解释、可调参、可测试：
 *
 * | 维度 | 含义 |
 * |---|---|
 * | `priceFit` | 价格贴合度。省钱方案"越低越好"，均衡方案"贴近目标价位"，满足方案为次要项 |
 * | `completeness` | 餐品完整性：套餐 > 主食+配餐 > 主食+饮料 > 单主食 |
 * | `preference` | 用户偏好命中率 |
 * | `value` | 促销力度（原价与现价的差额比例） |
 *
 * ⚠️ 这里**没有营养维度**：`list-nutrition-foods` 与菜单 SKU 之间缺少可靠关联键，
 * 任何"热量/营养"打分都会变成猜测。所以本阶段的"均衡"只代表
 * **价格与餐品组成之间的折中**，不代表营养均衡。
 */

import { matchPreferences } from "./filters";
import type { Candidate, RecommendationType, ScoreBreakdown, ScoredCandidate } from "./types";

/**
 * 各方案维度的权重（合计为 1）。
 *
 * 权重是**实测调出来的**，不是拍脑袋：
 * - `save` 的偏好权重必须很小（0.02）。最初给 0.10 时，实测结果是
 *   「¥15.90 鸡薯双全盒（命中鸡肉偏好）」压过了「¥13.90 随心配」，
 *   一个叫"省钱优先"的方案反而多花 2 元，与方案语义冲突；
 * - `balanced` 提高完整性权重，否则会退化成"又一个省钱方案"；
 * - `satisfy` 以偏好为主（0.52），价格只作为不超预算的约束。
 */
export const PLAN_WEIGHTS: Record<RecommendationType, ScoreBreakdown> = {
  save: { priceFit: 0.78, completeness: 0.17, preference: 0.02, value: 0.03 },
  balanced: { priceFit: 0.32, completeness: 0.45, preference: 0.15, value: 0.08 },
  satisfy: { priceFit: 0.18, completeness: 0.2, preference: 0.52, value: 0.1 },
};

/**
 * 均衡方案的目标价位：预算的 75%。
 *
 * 直觉：既然叫"均衡"，就应该比"省钱"吃得好一点（用掉七八成预算），
 * 但不能顶满，否则没有余量、也容易和"满足优先"撞车。
 */
export const BALANCED_TARGET_RATIO = 0.75;

/** 餐品完整性得分 */
export const COMPLETENESS_SCORES: Record<Candidate["composition"], number> = {
  combo: 1,
  "main+side": 0.9,
  "main+drink": 0.8,
  main: 0.55,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 价格贴合度 */
export function priceFitScore(
  type: RecommendationType,
  priceFen: number,
  budgetFen: number,
): number {
  if (budgetFen <= 0 || priceFen < 0) return 0;

  if (type === "balanced") {
    const target = budgetFen * BALANCED_TARGET_RATIO;
    if (target <= 0) return 0;
    return clamp01(1 - Math.abs(priceFen - target) / target);
  }

  // save / satisfy：越便宜越高（satisfy 中该项权重很低）
  return clamp01(1 - priceFen / budgetFen);
}

/** 促销力度 */
export function valueScore(candidate: Candidate): number {
  let original = 0;
  let current = 0;
  for (const item of candidate.items) {
    current += item.priceFen;
    original += item.originalPriceFen ?? item.priceFen;
  }
  if (original <= 0 || original <= current) return 0;
  return clamp01((original - current) / original);
}

export interface ScoreOptions {
  type: RecommendationType;
  budgetFen: number;
  preferences?: readonly string[];
}

/**
 * 给单个候选打分。
 *
 * 当用户没有选任何偏好时，`preference` 维度权重归零并**重新归一化**其余权重，
 * 避免"平均 0.5 分"这种既不加分也不减分、却稀释了真实差异的做法。
 */
export function scoreCandidate(candidate: Candidate, options: ScoreOptions): ScoredCandidate {
  const preferences = options.preferences ?? [];
  const matchedPreferences = matchPreferences(candidate, preferences);

  const breakdown: ScoreBreakdown = {
    priceFit: priceFitScore(options.type, candidate.menuPriceFen, options.budgetFen),
    completeness: COMPLETENESS_SCORES[candidate.composition],
    preference: preferences.length === 0 ? 0 : matchedPreferences.length / preferences.length,
    value: valueScore(candidate),
  };

  const weights: ScoreBreakdown = { ...PLAN_WEIGHTS[options.type] };
  if (preferences.length === 0) weights.preference = 0;

  const weightSum =
    weights.priceFit + weights.completeness + weights.preference + weights.value;
  const divisor = weightSum > 0 ? weightSum : 1;

  const score =
    (breakdown.priceFit * weights.priceFit +
      breakdown.completeness * weights.completeness +
      breakdown.preference * weights.preference +
      breakdown.value * weights.value) /
    divisor;

  return { type: options.type, candidate, score, breakdown, matchedPreferences };
}

/**
 * 排序：分数降序 → 价格升序 → SKU 编码升序。
 * 后两级保证结果稳定（同样分数不会因为输入顺序不同而抖动）。
 */
export function rankCandidates(
  candidates: readonly Candidate[],
  options: ScoreOptions,
): ScoredCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(candidate, options))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.candidate.menuPriceFen !== b.candidate.menuPriceFen) {
        return a.candidate.menuPriceFen - b.candidate.menuPriceFen;
      }
      return a.candidate.primaryCode.localeCompare(b.candidate.primaryCode);
    });
}

/** 视为"组成完整"的候选（套餐、主食+配餐/饮料） */
const COMPLETE_THRESHOLD = 0.8;

/**
 * 稳定地把"组成完整"的候选排到前面，其余保持原顺序。
 *
 * 用在「均衡选择」上：如果只靠权重，实测会退化成"又一个便宜的单个汉堡"，
 * 而"均衡"至少要有一份套餐或主食+配餐 —— 先把它们试完，再退回到单主食。
 */
export function prioritizeComplete(list: readonly ScoredCandidate[]): ScoredCandidate[] {
  const complete: ScoredCandidate[] = [];
  const rest: ScoredCandidate[] = [];
  for (const item of list) {
    if (COMPLETENESS_SCORES[item.candidate.composition] >= COMPLETE_THRESHOLD) complete.push(item);
    else rest.push(item);
  }
  return [...complete, ...rest];
}
