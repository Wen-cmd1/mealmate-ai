import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLlmProvider,
  extractJsonObject,
  readAiConfig,
} from "@/lib/ai/provider";
import { AiError } from "@/lib/ai/types";

/**
 * Provider 测试（**不联网**，fetch 全部注入）。
 *
 * 关注四件事：配置读取不泄密、超时、HTTP 错误、宽松 JSON 提取。
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe("配置读取", () => {
  it("没有 AI_API_KEY 时 disabled，并给出可读原因", () => {
    const config = readAiConfig(env());
    expect(config.enabled).toBe(false);
    expect(config.reason).toContain("AI_API_KEY");
  });

  it("配置齐全时 enabled，且不返回 Key 本身", () => {
    const config = readAiConfig(
      env({
        AI_API_KEY: "sk-test-secret-value",
        AI_BASE_URL: "https://api.example.com/v1",
        AI_MODEL: "my-model",
      }),
    );

    expect(config.enabled).toBe(true);
    expect(config.model).toBe("my-model");
    expect(config.host).toBe("api.example.com");
    // 整个配置对象里不能出现 Key 明文
    expect(JSON.stringify(config)).not.toContain("sk-test-secret-value");
  });

  it("超时配置越界时回落到默认值", () => {
    expect(readAiConfig(env({ AI_API_KEY: "k", AI_TIMEOUT_MS: "999999" })).timeoutMs).toBe(12_000);
    expect(readAiConfig(env({ AI_API_KEY: "k", AI_TIMEOUT_MS: "500" })).timeoutMs).toBe(12_000);
    expect(readAiConfig(env({ AI_API_KEY: "k", AI_TIMEOUT_MS: "8000" })).timeoutMs).toBe(8_000);
  });

  it("没有 Key 时不创建 Provider（调用方据此降级）", () => {
    expect(createLlmProvider({ env: env() })).toBeNull();
  });
});

describe("调用行为", () => {
  it("成功调用会带上 Bearer 头，并解析出文本与 usage", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: '{"budgetYuan":20,"budgetKind":"hard_cap"}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      }),
    ) as unknown as typeof fetch;

    const provider = createLlmProvider({
      env: env({ AI_API_KEY: "sk-secret", AI_MODEL: "m1", AI_BASE_URL: "https://api.example.com/v1" }),
      fetchImpl,
    });

    expect(provider).not.toBeNull();
    const completion = await provider!.complete([{ role: "user", content: "hi" }]);

    expect(completion.text).toContain("budgetYuan");
    expect(completion.usage?.totalTokens).toBe(150);

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-secret");
  });

  it("HTTP 错误抛 AiError，且不把上游 body 透出来", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("upstream leaked sk-secret-abc", { status: 500 }),
    ) as unknown as typeof fetch;

    const provider = createLlmProvider({
      env: env({ AI_API_KEY: "sk-secret-abc" }),
      fetchImpl,
    })!;

    await expect(provider.complete([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      kind: "HTTP_ERROR",
    });

    try {
      await provider.complete([{ role: "user", content: "hi" }]);
    } catch (error) {
      expect(error).toBeInstanceOf(AiError);
      expect((error as Error).message).not.toContain("sk-secret-abc");
    }
  });

  it("超时抛 TIMEOUT（AbortSignal 生效）", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    ) as unknown as typeof fetch;

    const provider = createLlmProvider({
      env: env({ AI_API_KEY: "k", AI_TIMEOUT_MS: "1000" }),
      fetchImpl,
    })!;

    await expect(
      provider.complete([{ role: "user", content: "hi" }], { timeoutMs: 50 }),
    ).rejects.toMatchObject({ kind: "TIMEOUT" });
  });

  it("响应里没有 choices 时抛 INVALID_RESPONSE", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "nope" })) as unknown as typeof fetch;
    const provider = createLlmProvider({ env: env({ AI_API_KEY: "k" }), fetchImpl })!;

    await expect(provider.complete([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      kind: "INVALID_RESPONSE",
    });
  });
});

describe("JSON 提取：不依赖模型规矩输出", () => {
  it("处理 ```json 围栏", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("处理前后多余文字", () => {
    expect(extractJsonObject('好的，结果是：{"a":1} 希望有帮助')).toEqual({ a: 1 });
  });

  it("处理字符串里含大括号", () => {
    expect(extractJsonObject('{"note":"含 } 和 { 的说明","a":2}')).toEqual({
      note: "含 } 和 { 的说明",
      a: 2,
    });
  });

  it("完全没有 JSON 时抛 INVALID_RESPONSE", () => {
    expect(() => extractJsonObject("今天吃鸡吧")).toThrowError(AiError);
  });

  it("JSON 不完整时抛 INVALID_RESPONSE", () => {
    expect(() => extractJsonObject('{"a":1')).toThrowError(AiError);
  });
});
