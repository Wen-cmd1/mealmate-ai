/**
 * McDonald's MCP（Streamable HTTP）最小客户端。
 *
 * 设计要点：
 * - 仅使用 **官方 MCP SDK**（@modelcontextprotocol/sdk）的 Client + StreamableHTTPClientTransport；
 * - Token 只从服务端环境变量 `MCD_MCP_TOKEN` 读取，绝不进入前端 bundle；
 * - 所有对外抛出的错误都经过脱敏（SafeError），日志里不会出现 token；
 * - 连接与每次调用都有超时保护（SDK 自带 timeout + 本地兜底 race）。
 *
 * ⚠️ 本文件只能在 Node 运行时（服务端）被引用，不要在 "use client" 组件里 import。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type {
  McdEnvelope,
  McpServerConfig,
  McpToolDescriptor,
  SafeError,
} from "../../types/mcp";
import { redactSecrets } from "./redact";

// 保持既有引用路径可用（security 测试与适配器都从本模块取）
export { redactSecrets } from "./redact";

export const DEFAULT_MCP_URL = "https://mcp.mcd.cn";
export const DEFAULT_TIMEOUT_MS = 20_000;

/** 脱敏后的 MCP 错误。message 可直接展示给前端。 */
export class McpClientError extends Error {
  readonly kind: SafeError["kind"];
  readonly upstreamCode?: number;
  readonly traceId?: string;

  constructor(safe: SafeError) {
    super(safe.message);
    this.name = "McpClientError";
    this.kind = safe.kind;
    this.upstreamCode = safe.upstreamCode;
    this.traceId = safe.traceId;
  }

  toSafeError(): SafeError {
    return {
      kind: this.kind,
      message: this.message,
      upstreamCode: this.upstreamCode,
      traceId: this.traceId,
    };
  }
}

/** 把任意异常收敛成可安全外发的结构，并抹掉 token 痕迹。 */
export function toSafeError(error: unknown): SafeError {
  if (error instanceof McpClientError) return error.toSafeError();
  const raw = error instanceof Error ? error.message : String(error);
  return { kind: "UNKNOWN", message: redactSecrets(raw) };
}

/** 从文本中截取第一个 `{ ... }` 片段（上游 text content 会夹杂说明文字）。 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

interface McpCallResultLike {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export class McdMcpClient {
  private readonly config: McpServerConfig;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  constructor(config: McpServerConfig) {
    if (!config.url) throw new McpClientError({ kind: "CONNECT_FAILED", message: "MCP 端点未配置" });
    if (!config.token) {
      throw new McpClientError({
        kind: "MISSING_TOKEN",
        message: "缺少 MCD_MCP_TOKEN 环境变量，MCP 调用不可用",
      });
    }
    this.config = config;
  }

  /**
   * 读取服务端环境变量构造客户端。
   * 注意：`MCD_MCP_*` 没有 NEXT_PUBLIC_ 前缀，Next.js 不会把它注入客户端 bundle。
   */
  static fromEnv(): McdMcpClient {
    const token = process.env.MCD_MCP_TOKEN?.trim();
    if (!token) {
      throw new McpClientError({
        kind: "MISSING_TOKEN",
        message: "缺少 MCD_MCP_TOKEN 环境变量，MCP 调用不可用",
      });
    }
    return new McdMcpClient({
      url: process.env.MCD_MCP_URL?.trim() || DEFAULT_MCP_URL,
      token,
      timeoutMs: Number(process.env.MCD_MCP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
      clientName: "mealmate-ai",
      clientVersion: "0.1.0",
    });
  }

  /** 仅用于日志/健康检查展示，不含凭证 */
  get targetHost(): string {
    try {
      return new URL(this.config.url).host;
    } catch {
      return this.config.url;
    }
  }

  get timeoutMs(): number {
    return this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** 建立连接（MCP initialize 握手） */
  async connect(): Promise<void> {
    if (this.client) return;

    const transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
      requestInit: {
        // 认证方式：Authorization: Bearer <token>（已实测该端点只认这个头）
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: "application/json, text/event-stream",
        },
      },
    });

    const client = new Client(
      {
        name: this.config.clientName ?? "mealmate-ai",
        version: this.config.clientVersion ?? "0.1.0",
      },
      { capabilities: {} },
    );

    try {
      await this.withTimeout(client.connect(transport), "连接 MCP 服务超时");
    } catch (error) {
      // 连接失败时清掉半成品，避免后续误用
      this.client = null;
      this.transport = null;
      throw this.normalize(error, "CONNECT_FAILED");
    }

    this.client = client;
    this.transport = transport;
  }

  /** 上游 serverInfo（需已连接） */
  get serverInfo(): { name?: string; version?: string } {
    const v = this.client?.getServerVersion();
    return { name: v?.name, version: v?.version };
  }

  /** tools/list */
  async listTools(): Promise<McpToolDescriptor[]> {
    const client = await this.ensureClient();
    try {
      const result = await this.withTimeout(
        client.listTools(undefined, { timeout: this.timeoutMs }),
        "获取工具列表超时",
      );
      return (result.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    } catch (error) {
      throw this.normalize(error, "TOOL_ERROR");
    }
  }

  /**
   * tools/call，返回上游业务信封。
   *
   * 说明：业务失败（`success: false`）不在这里抛错，交由适配器判断——
   * 因为像"收藏门店为空"这类情况需要由上层降级处理（改用城市+关键词搜索）。
   */
  async callTool<T>(
    name: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<McdEnvelope<T>> {
    const client = await this.ensureClient();
    const timeout = options?.timeoutMs ?? this.timeoutMs;

    let raw: McpCallResultLike;
    try {
      raw = (await this.withTimeout(
        client.callTool({ name, arguments: args }, undefined, { timeout }),
        `调用工具 ${name} 超时`,
        timeout,
      )) as McpCallResultLike;
    } catch (error) {
      throw this.normalize(error, "TOOL_ERROR");
    }

    if (raw.isError) {
      const text = (raw.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join(" ");
      throw new McpClientError({
        kind: "TOOL_ERROR",
        message: redactSecrets(`工具 ${name} 返回错误：${text || "未知错误"}`),
      });
    }

    return this.extractEnvelope<T>(name, raw);
  }

  async close(): Promise<void> {
    try {
      await this.transport?.close();
    } catch {
      // 关闭失败不影响主流程
    } finally {
      this.client = null;
      this.transport = null;
    }
  }

  private async ensureClient(): Promise<Client> {
    if (!this.client) await this.connect();
    if (!this.client) {
      throw new McpClientError({ kind: "CONNECT_FAILED", message: "MCP 连接未建立" });
    }
    return this.client;
  }

  /** 从 CallToolResult 中取出业务信封（优先 structuredContent） */
  private extractEnvelope<T>(tool: string, raw: McpCallResultLike): McdEnvelope<T> {
    const sc = raw.structuredContent;
    if (sc && typeof sc === "object" && "success" in (sc as Record<string, unknown>)) {
      return sc as McdEnvelope<T>;
    }

    for (const part of raw.content ?? []) {
      if (part.type !== "text" || !part.text) continue;
      const json = extractJsonObject(part.text);
      if (!json) continue;
      try {
        const parsed: unknown = JSON.parse(json);
        if (parsed && typeof parsed === "object" && "success" in (parsed as Record<string, unknown>)) {
          return parsed as McdEnvelope<T>;
        }
      } catch {
        // 继续尝试下一段
      }
    }

    throw new McpClientError({
      kind: "BAD_RESPONSE",
      message: `工具 ${tool} 的返回结构无法解析（缺少 success 信封）`,
    });
  }

  /** 本地兜底超时：即使 SDK 的 timeout 未生效也不会挂死 */
  private async withTimeout<R>(promise: Promise<R>, message: string, ms?: number): Promise<R> {
    const timeout = ms ?? this.timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new McpClientError({ kind: "TIMEOUT", message }));
      }, timeout);
    });
    try {
      return await Promise.race([promise, guard]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private normalize(error: unknown, fallbackKind: SafeError["kind"]): McpClientError {
    if (error instanceof McpClientError) return error;
    const raw = error instanceof Error ? error.message : String(error);
    const message = redactSecrets(raw);
    const kind = /timeout|timed out|aborted/i.test(message) ? "TIMEOUT" : fallbackKind;
    return new McpClientError({ kind, message });
  }
}

/**
 * 进程内复用同一个客户端（避免每次请求都重新握手）。
 * 挂在 globalThis 上以兼容 Next.js 开发模式的模块热替换。
 */
const globalKey = Symbol.for("mealmate.mcd.client");

export function getMcdClient(): McdMcpClient {
  const store = globalThis as unknown as Record<symbol, McdMcpClient | undefined>;
  const existing = store[globalKey];
  if (existing) return existing;
  const created = McdMcpClient.fromEnv();
  store[globalKey] = created;
  return created;
}

export function resetMcdClient(): void {
  const store = globalThis as unknown as Record<symbol, McdMcpClient | undefined>;
  store[globalKey] = undefined;
}
