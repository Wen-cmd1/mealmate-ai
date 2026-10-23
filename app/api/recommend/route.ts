/**
 * POST /api/recommend
 *
 * 单餐预算推荐的唯一入口。全程只读，不会创建订单/领券/支付。
 *
 * 防护措施：
 * - Zod 白名单校验 + 预算区间限制；
 * - 进程内滑动窗口限流（按 IP，默认 20 次/分钟）；
 * - 整体 30s 超时兜底（上游单次调用另有 SDK 超时）；
 * - 错误统一脱敏，不返回 stack/token。
 *
 * 说明：项目开启了 `cacheComponents`，不允许 `export const dynamic`，
 * 因此用 `await connection()` 声明每次请求动态执行。
 */

import { connection } from "next/server";

import { errorBody, json, toErrorResponse, withDeadline } from "@/lib/api/http";
import { checkRateLimit, clientKey } from "@/lib/api/rate-limit";
import { getMealProvider } from "@/lib/providers/meal-provider";
import { RecommendationEngine } from "@/lib/recommendation/engine";
import { parseRecommendRequest } from "@/lib/recommendation/schema";

/** 每分钟最多 20 次推荐请求 */
const RATE_LIMIT = 20;
/** 单次请求的整体上限（含门店查询 + 菜单 + 最多 12 次算价） */
const OVERALL_DEADLINE_MS = 30_000;

export async function POST(request: Request): Promise<Response> {
  await connection();

  const limit = checkRateLimit(clientKey(request, "recommend"), { limit: RATE_LIMIT });
  if (!limit.allowed) {
    return json(
      errorBody("RATE_LIMITED", `请求过于频繁，请 ${limit.retryAfterSec} 秒后再试`, true),
      429,
      { "retry-after": String(limit.retryAfterSec) },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(errorBody("INVALID_REQUEST", "请求体不是合法 JSON", false), 400);
  }

  const parsed = parseRecommendRequest(body);
  if (!parsed.ok) {
    return json(
      { ...errorBody("INVALID_REQUEST", parsed.message, false), field: parsed.field },
      400,
    );
  }

  try {
    const provider = getMealProvider();
    const engine = new RecommendationEngine({ provider });
    const result = await withDeadline(engine.recommend(parsed.value), OVERALL_DEADLINE_MS);

    return json(result, 200, { "x-ratelimit-remaining": String(limit.remaining) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
