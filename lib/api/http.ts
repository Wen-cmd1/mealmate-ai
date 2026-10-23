/**
 * API 路由共用的 HTTP 工具：统一响应格式、错误收敛、整体超时。
 *
 * 安全约定：
 * - 对外只返回**脱敏后**的错误信息；
 * - 绝不返回上游 stack、请求头、token；
 * - 所有响应带 `cache-control: no-store`（价格是实时数据）。
 */

import { RecommendationError } from "../recommendation/engine";
import { redactSecrets } from "../mcp/redact";
import type { RecommendErrorCode } from "../recommendation/types";

const NO_STORE = { "cache-control": "no-store" } as const;

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function errorBody(
  code: RecommendErrorCode,
  message: string,
  retryable: boolean,
): { success: false; error: { code: RecommendErrorCode; message: string; retryable: boolean } } {
  return { success: false, error: { code, message, retryable } };
}

function errorKind(error: unknown): string | undefined {
  const kind = (error as { kind?: unknown } | null)?.kind;
  return typeof kind === "string" ? kind : undefined;
}

/** 把任意异常收敛成可外发的 JSON 响应（不含 stack / 凭证） */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof RecommendationError) {
    return json(errorBody(error.code, error.message, error.retryable), error.httpStatus);
  }

  const kind = errorKind(error);
  if (kind === "MISSING_TOKEN") {
    return json(
      errorBody("MISSING_TOKEN", "服务端未配置 MCD_MCP_TOKEN，无法查询真实菜单（不会用模拟数据替代）", false),
      503,
    );
  }

  const raw = error instanceof Error ? error.message : String(error);
  const message = redactSecrets(raw);

  if (kind === "TIMEOUT" || /timeout|timed out|aborted/i.test(message)) {
    return json(errorBody("MCP_TIMEOUT", "调用麦当劳接口超时，请稍后重试", true), 504);
  }
  if (kind === "CONNECT_FAILED" || /ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message)) {
    return json(errorBody("MCP_UNAVAILABLE", "无法连接麦当劳 MCP 服务", true), 502);
  }

  // 兜底：不把内部细节透给浏览器
  return json(errorBody("INTERNAL", "服务内部错误，请稍后重试", true), 500);
}

/** 整体超时兜底：即使上游 SDK 的超时不生效，也不会让请求挂死 */
export async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RecommendationError("MCP_TIMEOUT", `请求超过 ${ms}ms 未完成，已中止`, 504, true));
    }, ms);
  });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
