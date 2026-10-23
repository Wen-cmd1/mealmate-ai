/**
 * POST /api/ai/decide （任务 004）
 *
 * 一句话 → 意图 → 真实菜单 → 官方算价 → 三个方案 → 预算影响。
 *
 * 这个路由**没有**任何写操作：不写账本、不建订单、不领券、不支付。
 * 它复用的是 `/api/recommend` 背后的同一个 `RecommendationEngine`，
 * 而不是另写一套评分与 MCP 调用（任务书明确要求不要复制）。
 *
 * 防护：
 * - 模型不可用时**不报错**，降级为规则解析（`mode: "RULE_FALLBACK"`）；
 * - 输入疑似注入时**根本不调用模型**；
 * - 进程内限流（默认 10 次/分钟/IP，比推荐接口更紧，因为一次请求可能多一次模型调用）；
 * - 整体 45s 兜底（模型 12s + 菜单与算价）；
 * - 错误统一脱敏，绝不返回 Key / stack / 上游 body。
 */

import { connection } from "next/server";

import { errorBody, json, toErrorResponse, withDeadline } from "@/lib/api/http";
import { checkRateLimit, clientKey } from "@/lib/api/rate-limit";
import { decide } from "@/lib/ai/decision-agent";
import { createLlmProvider } from "@/lib/ai/provider";
import { parseDecideRequest } from "@/lib/ai/request-schema";
import { AiError } from "@/lib/ai/types";
import { getMealProvider } from "@/lib/providers/meal-provider";

/** 每分钟最多 10 次（含一次可能的模型调用） */
const RATE_LIMIT = 10;
/** 整体上限：模型 12s + 门店/菜单/算价约 30s */
const OVERALL_DEADLINE_MS = 45_000;

export async function POST(request: Request): Promise<Response> {
  await connection();

  const limit = checkRateLimit(clientKey(request, "ai-decide"), { limit: RATE_LIMIT });
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

  const parsed = parseDecideRequest(body);
  if (!parsed.ok) {
    return json(
      { ...errorBody("INVALID_REQUEST", parsed.message, false), field: parsed.field },
      400,
    );
  }

  try {
    const result = await withDeadline(
      decide(parsed.value, {
        mealProvider: getMealProvider(),
        // 没有 AI_API_KEY 时返回 null → 规则降级，不抛错
        llmProvider: createLlmProvider(),
      }),
      OVERALL_DEADLINE_MS,
    );

    return json(result, 200, {
      "x-ratelimit-remaining": String(limit.remaining),
      "x-intent-mode": result.mode,
    });
  } catch (error) {
    if (error instanceof AiError) {
      const status = error.kind === "TEXT_TOO_LONG" ? 413 : 400;
      return json(errorBody("INVALID_REQUEST", error.message, false), status);
    }
    return toErrorResponse(error);
  }
}
