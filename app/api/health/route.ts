/**
 * GET /api/health
 *
 * 用途：前端展示 MCP 连接状态 + 运维健康检查。
 * 安全：只返回工具数量、耗时、脱敏后的错误信息；**绝不返回 token**。
 *
 * 该路由强制动态执行（需要实时探测上游），不参与静态预渲染。
 */

import { connection } from "next/server";

import { McdMealProvider } from "@/lib/providers/meal-provider";
import { toSafeError } from "@/lib/mcp/client";

/**
 * 说明：项目开启了 next.config 的 `cacheComponents`，
 * 该模式下不允许使用 `export const dynamic` / `runtime` 路由段配置，
 * 改为在 handler 内 `await connection()` 显式声明"每次请求都动态执行"，
 * 确保构建期不会去连麦当劳接口。
 */
export async function GET(): Promise<Response> {
  await connection();

  const startedAt = Date.now();
  const provider = new McdMealProvider();

  try {
    const health = await provider.health();
    return Response.json(
      {
        ok: true,
        app: "mealmate-ai",
        stage: "task-001",
        provider: provider.id,
        mcp: health,
        elapsedMs: Date.now() - startedAt,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const safe = toSafeError(error);
    return Response.json(
      {
        ok: false,
        app: "mealmate-ai",
        stage: "task-001",
        provider: provider.id,
        mcp: {
          connected: false,
          error: safe,
          checkedAt: new Date().toISOString(),
        },
        elapsedMs: Date.now() - startedAt,
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
