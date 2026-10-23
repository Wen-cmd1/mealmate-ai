import { beforeEach, describe, expect, it } from "vitest";

import { checkRateLimit, clientKey, resetRateLimit } from "@/lib/api/rate-limit";

/**
 * 限流测试。
 *
 * 说明局限：这是**进程内**限流，只验证单实例下的窗口行为，
 * 不代表多副本部署时能限住总量（生产应换成 Redis / 网关限流）。
 */

beforeEach(() => {
  resetRateLimit();
});

describe("滑动窗口限流", () => {
  it("额度内放行，超出后拒绝并给出重试等待", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) {
      const result = checkRateLimit("k", { limit: 3, windowMs: 60_000, now: now + i });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3 - i - 1);
    }

    const blocked = checkRateLimit("k", { limit: 3, windowMs: 60_000, now: now + 3 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("窗口滑过之后恢复", () => {
    const now = 1_000_000;
    checkRateLimit("k", { limit: 1, windowMs: 1_000, now });
    expect(checkRateLimit("k", { limit: 1, windowMs: 1_000, now: now + 500 }).allowed).toBe(false);
    expect(checkRateLimit("k", { limit: 1, windowMs: 1_000, now: now + 1_001 }).allowed).toBe(true);
  });

  it("不同键互不影响", () => {
    const now = 1_000_000;
    checkRateLimit("a", { limit: 1, windowMs: 60_000, now });
    expect(checkRateLimit("a", { limit: 1, windowMs: 60_000, now }).allowed).toBe(false);
    expect(checkRateLimit("b", { limit: 1, windowMs: 60_000, now }).allowed).toBe(true);
  });

  it("resetRateLimit 能清空计数", () => {
    const now = 1_000_000;
    checkRateLimit("a", { limit: 1, windowMs: 60_000, now });
    resetRateLimit();
    expect(checkRateLimit("a", { limit: 1, windowMs: 60_000, now }).allowed).toBe(true);
  });
});

describe("客户端标识", () => {
  it("取 x-forwarded-for 的第一段", () => {
    const request = new Request("http://localhost/api/recommend", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientKey(request, "recommend")).toBe("recommend:1.2.3.4");
  });

  it("回落到 x-real-ip，再回落到本地标记", () => {
    const withRealIp = new Request("http://localhost/api/recommend", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(clientKey(withRealIp)).toBe("default:9.9.9.9");

    const none = new Request("http://localhost/api/recommend");
    expect(clientKey(none)).toBe("default:local");
  });

  it("不同 scope 使用不同配额", () => {
    const request = new Request("http://localhost/x", {
      headers: { "x-forwarded-for": "1.1.1.1" },
    });
    expect(clientKey(request, "recommend")).not.toBe(clientKey(request, "stores"));
  });
});
