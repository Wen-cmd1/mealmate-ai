/**
 * MCP 传输层与上游业务响应的类型定义。
 *
 * 上游 mcd-mcp 的每次 tools/call 都返回统一信封：
 *   { success, code, message, datetime, traceId, data }
 * 该信封位于 MCP CallToolResult.structuredContent 中。
 */

import type { IsoDateTime } from "./meal";

/** MCP 服务器连接配置（token 只允许来自服务端环境变量） */
export interface McpServerConfig {
  /** Streamable HTTP 端点，例如 https://mcp.mcd.cn */
  url: string;
  /** Bearer Token，严禁写入前端/仓库/日志 */
  token: string;
  /** 单次调用超时（毫秒） */
  timeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
}

/** 上游业务信封 */
export interface McdEnvelope<T> {
  success: boolean;
  code: number;
  message: string;
  datetime: IsoDateTime;
  traceId?: string;
  data: T;
}

/** MCP tools/list 中单个工具描述（只保留项目用到的字段） */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** 连接健康状态 */
export interface McpHealth {
  connected: boolean;
  serverUrl: string;
  /** 上游 serverInfo.name / version */
  serverName?: string;
  serverVersion?: string;
  protocolVersion?: string;
  /** tools/list 返回的工具数量 */
  toolCount: number;
  /** 期望存在但缺失的工具 */
  missingRequiredTools: string[];
  /** 连接 + tools/list 总耗时 */
  latencyMs: number;
  checkedAt: IsoDateTime;
}

/** 统一的、已脱敏的错误结构（可安全返回给前端） */
export interface SafeError {
  kind:
    | "MISSING_TOKEN"
    | "CONNECT_FAILED"
    | "TIMEOUT"
    | "TOOL_ERROR"
    | "UPSTREAM_BUSINESS_ERROR"
    | "BAD_RESPONSE"
    | "UNKNOWN";
  message: string;
  /** 上游业务码（若存在） */
  upstreamCode?: number;
  traceId?: string;
}

export const MCD_REQUIRED_TOOLS = [
  "query-nearby-stores",
  "query-meals",
  "calculate-price",
  "list-nutrition-foods",
  "query-my-coupons",
  "query-store-coupons",
  "available-coupons",
] as const;

export type McdRequiredTool = (typeof MCD_REQUIRED_TOOLS)[number];
