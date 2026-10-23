/**
 * LLM Provider 抽象（任务 004）。
 *
 * 目标：**不与任何一家模型供应商强绑定**。默认走 OpenAI 兼容的
 * `POST {AI_BASE_URL}/chat/completions`，但业务层只依赖 `LlmProvider` 接口，
 * 换供应商只需要换一个实现，不需要改 `decision-agent.ts`。
 *
 * 几条硬性约定：
 *
 * - **密钥只在服务端**：`AI_API_KEY` 只在这里被读取，并且只写进请求头。
 *   `readAiConfig()` 对外只暴露 `enabled / model / host`，永远不暴露 Key。
 * - **不依赖供应商的结构化输出能力**：不发 `response_format`（除非显式开启
 *   `AI_JSON_MODE=1` 且确认供应商支持），改为在文本里要求 JSON + 本地容错解析。
 * - **不写日志**：本模块没有 console 调用。用户原文与模型响应都不会被落盘。
 * - **超时必须有**：默认 12s，可用 `AI_TIMEOUT_MS` 覆盖；超时抛
 *   `AiError("TIMEOUT")`，由上层降级到规则解析。
 */

import { AiError, type AiUsage } from "./types";

export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmCompletion {
  text: string;
  model: string;
  usage?: AiUsage;
  elapsedMs: number;
}

export interface LlmProvider {
  readonly model: string;
  complete(messages: readonly LlmMessage[], options?: { timeoutMs?: number }): Promise<LlmCompletion>;
}

export interface AiConfig {
  enabled: boolean;
  model?: string;
  /** 只暴露主机名，便于排查"连的是哪家"，不暴露完整 URL 上的查询串/凭证 */
  host?: string;
  timeoutMs: number;
  /** 未启用时的原因（面向用户，不含任何凭证信息） */
  reason?: string;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 12_000;

function pickEnv(env: NodeJS.ProcessEnv, key: string): string {
  return (env[key] ?? "").trim();
}

/** 读取配置（只读，不校验连通性） */
export function readAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const apiKey = pickEnv(env, "AI_API_KEY");
  const baseUrl = pickEnv(env, "AI_BASE_URL") || DEFAULT_BASE_URL;
  const model = pickEnv(env, "AI_MODEL") || DEFAULT_MODEL;
  const rawTimeout = Number(pickEnv(env, "AI_TIMEOUT_MS"));
  const timeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout >= 1_000 && rawTimeout <= 60_000
      ? Math.round(rawTimeout)
      : DEFAULT_TIMEOUT_MS;

  let host: string | undefined;
  try {
    host = new URL(baseUrl).host;
  } catch {
    host = undefined;
  }

  if (!apiKey) {
    return {
      enabled: false,
      timeoutMs,
      model,
      host,
      reason: "服务端未配置 AI_API_KEY，已切换到规则解析模式（只支持有限的条件识别）",
    };
  }

  return { enabled: true, model, host, timeoutMs };
}

/** 拼接 chat/completions 端点；允许 `AI_BASE_URL` 直接给到完整端点 */
function resolveEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

/**
 * 从模型返回的文本里抠出第一个完整的 JSON 对象。
 *
 * 为什么不用 `JSON.parse(text)`：真实模型经常套 ```json 围栏、
 * 前后加一句"好的，这是结果："。这里做的是**保守**提取——
 * 只取第一个 `{` 到与之配对的 `}`，字符串与转义都正确处理。
 */
export function extractJsonObject(text: string): unknown {
  const cleaned = text
    .replace(/^\uFEFF/, "")
    .replace(/```(?:json|JSON)?/g, "")
    .replace(/```/g, "");

  const start = cleaned.indexOf("{");
  if (start === -1) throw new AiError("INVALID_RESPONSE", "模型没有返回 JSON 对象");

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < cleaned.length; index += 1) {
    const char = cleaned[index] as string;

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const slice = cleaned.slice(start, index + 1);
        try {
          return JSON.parse(slice);
        } catch {
          throw new AiError("INVALID_RESPONSE", "模型返回的 JSON 无法解析");
        }
      }
    }
  }

  throw new AiError("INVALID_RESPONSE", "模型返回的 JSON 不完整");
}

/** 兼容 content 为字符串或 parts 数组两种返回形态 */
function readContent(payload: unknown): string {
  const choices = (payload as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new AiError("INVALID_RESPONSE", "模型响应里没有 choices");
  }
  const message = (choices[0] as { message?: { content?: unknown } })?.message;
  const content = message?.content;

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : ((part as { text?: string })?.text ?? "")))
      .join("");
  }
  throw new AiError("INVALID_RESPONSE", "模型响应里没有可读文本");
}

function readUsage(payload: unknown): AiUsage | undefined {
  const usage = (payload as { usage?: Record<string, unknown> })?.usage;
  if (!usage || typeof usage !== "object") return undefined;

  const num = (key: string): number | undefined => {
    const value = usage[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };

  const result: AiUsage = {};
  const prompt = num("prompt_tokens") ?? num("input_tokens");
  const completion = num("completion_tokens") ?? num("output_tokens");
  const total = num("total_tokens");
  if (prompt !== undefined) result.promptTokens = prompt;
  if (completion !== undefined) result.completionTokens = completion;
  if (total !== undefined) result.totalTokens = total;
  else if (prompt !== undefined && completion !== undefined) result.totalTokens = prompt + completion;

  return Object.keys(result).length > 0 ? result : undefined;
}

export interface CreateProviderOptions {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

/**
 * 按环境变量创建 Provider；没有 `AI_API_KEY` 时返回 `null`
 * （调用方据此进入规则降级，而不是报错）。
 */
export function createLlmProvider(options: CreateProviderOptions = {}): LlmProvider | null {
  const env = options.env ?? process.env;
  const config = readAiConfig(env);
  if (!config.enabled) return null;

  const apiKey = pickEnv(env, "AI_API_KEY");
  const endpoint = resolveEndpoint(pickEnv(env, "AI_BASE_URL") || DEFAULT_BASE_URL);
  const model = config.model ?? DEFAULT_MODEL;
  const jsonMode = pickEnv(env, "AI_JSON_MODE") === "1";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    model,

    async complete(messages, callOptions) {
      const timeoutMs = callOptions?.timeoutMs ?? config.timeoutMs;
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const body: Record<string, unknown> = {
        model,
        messages: messages.map((message) => ({ role: message.role, content: message.content })),
        temperature: 0,
        max_tokens: 500,
        stream: false,
      };
      // 显式开关：只有确认供应商支持时才发，避免"假设所有模型都支持结构化输出"
      if (jsonMode) body.response_format = { type: "json_object" };

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          // 只取状态码，不把上游 body 透出来（可能回显请求内容）
          throw new AiError("HTTP_ERROR", `模型服务返回 HTTP ${response.status}`);
        }

        const payload: unknown = await response.json();
        const text = readContent(payload);

        return {
          text,
          model,
          usage: readUsage(payload),
          elapsedMs: Date.now() - startedAt,
        };
      } catch (error) {
        if (error instanceof AiError) throw error;
        if ((error as { name?: string })?.name === "AbortError") {
          throw new AiError("TIMEOUT", `模型调用超过 ${timeoutMs}ms 未返回，已中止`);
        }
        throw new AiError("HTTP_ERROR", "调用模型服务失败");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
