"use client";

/**
 * 数据连接状态徽标。
 *
 * 为什么放在客户端组件里 fetch：
 * 首页本身是静态可渲染的，若在 Server Component 里直接连 MCP，
 * 构建期/预渲染阶段会去打真实网络，既慢又会让构建依赖外网。
 * 这里改成浏览器侧异步探测 `/api/health`，页面壳永远能秒开。
 *
 * 任务 005 只改视觉：从"技术参数展示"收敛成一句人话（实时数据是否连通），
 * 工具数量、延迟这类细节收进 title 与移动端隐藏的小字里，
 * 首屏不再被技术术语占位。文案里不出现 token / 域名 / 堆栈。
 */

import { useEffect, useState } from "react";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; toolCount: number; serverName?: string; serverVersion?: string; latencyMs: number }
  | { status: "down"; message: string; kind?: string };

interface HealthResponse {
  ok: boolean;
  mcp?: {
    connected?: boolean;
    toolCount?: number;
    serverName?: string;
    serverVersion?: string;
    latencyMs?: number;
    error?: { kind?: string; message?: string };
  };
}

/** 上游错误信息可能很长，也可能带内部标识；这里只取一句短描述 */
function shortReason(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim();
  if (/token/i.test(cleaned) && /not|missing|未配置|缺少/i.test(cleaned)) {
    return "服务端未配置数据凭证";
  }
  if (/timeout|timed out|aborted|超时/i.test(cleaned)) return "接口响应超时";
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|连接/i.test(cleaned)) return "无法连接上游服务";
  return cleaned.length > 24 ? `${cleaned.slice(0, 24)}…` : cleaned;
}

export function McpStatusBadge() {
  const [state, setState] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function probe() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const body = (await res.json()) as HealthResponse;

        if (cancelled) return;

        if (res.ok && body.ok && body.mcp?.connected) {
          setState({
            status: "ok",
            toolCount: body.mcp.toolCount ?? 0,
            serverName: body.mcp.serverName,
            serverVersion: body.mcp.serverVersion,
            latencyMs: body.mcp.latencyMs ?? 0,
          });
        } else {
          setState({
            status: "down",
            message: body.mcp?.error?.message ?? `健康检查返回 HTTP ${res.status}`,
            kind: body.mcp?.error?.kind,
          });
        }
      } catch (error) {
        if (cancelled) return;
        setState({
          status: "down",
          message: error instanceof Error ? error.message : "无法访问 /api/health",
        });
      }
    }

    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/70 px-2.5 py-1 text-[11px] text-ink-400">
        <span className="pulse-dot size-1.5 rounded-full bg-ink-400" />
        检测数据连接
      </span>
    );
  }

  if (state.status === "ok") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-mint-100 bg-mint-50 px-2.5 py-1 text-[11px] font-medium text-mint-600"
        title={`${state.serverName ?? "mcd-mcp"} v${state.serverVersion ?? "?"} · ${state.toolCount} 个只读工具 · ${state.latencyMs}ms`}
      >
        <span className="size-1.5 rounded-full bg-mint-500" />
        实时菜单已连接
        <span className="hidden text-mint-600/70 sm:inline">· {state.latencyMs}ms</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800"
      title={`${state.kind ? `[${state.kind}] ` : ""}${state.message}`}
    >
      <span className="size-1.5 rounded-full bg-amber-500" />
      数据未连通
      <span className="hidden text-amber-700/80 sm:inline">· {shortReason(state.message)}</span>
    </span>
  );
}
