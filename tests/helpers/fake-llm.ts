import type { LlmCompletion, LlmMessage, LlmProvider } from "@/lib/ai/provider";

/**
 * 单测用的假 LLM Provider。
 *
 * 只模拟"调用模型"这一层：返回固定文本 / 抛错 / 延迟。
 * 不模拟任何业务判断——意图解析与降级逻辑必须由被测代码自己完成。
 */

export interface FakeLlm extends LlmProvider {
  /** 每次调用收到的 messages，便于断言"到底有没有把输入发给模型" */
  calls: LlmMessage[][];
}

export type FakeReply =
  | string
  | Record<string, unknown>
  | (() => Promise<string>)
  | (() => string);

export function createFakeLlm(reply: FakeReply, options: { model?: string } = {}): FakeLlm {
  const calls: LlmMessage[][] = [];

  return {
    model: options.model ?? "fake-model",
    calls,

    async complete(messages): Promise<LlmCompletion> {
      calls.push(messages.map((message) => ({ ...message })));
      const startedAt = Date.now();

      let text: string;
      if (typeof reply === "function") {
        text = await reply();
      } else if (typeof reply === "string") {
        text = reply;
      } else {
        text = JSON.stringify(reply);
      }

      return {
        text,
        model: options.model ?? "fake-model",
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        elapsedMs: Date.now() - startedAt,
      };
    },
  };
}

/** 造一个"总会抛错"的 Provider（模拟超时/网络失败） */
export function createFailingLlm(error: unknown): FakeLlm {
  const calls: LlmMessage[][] = [];
  return {
    model: "failing-model",
    calls,
    async complete(messages) {
      calls.push(messages.map((message) => ({ ...message })));
      throw error;
    },
  };
}
