import { describe, expect, it } from "vitest";

import { networkError, readApiError, sanitizeDetail } from "@/lib/ui/api-error";

/**
 * 错误文案（任务 005 §8：易懂但不泄密）。
 *
 * 这里主要防两件事：
 * 1. 把上游的原始 message（可能带域名、traceId、内部枚举）直接铺给用户；
 * 2. 把所有错误都说成同一句"出错了"，用户不知道该重试还是该改条件。
 */

async function fromBody(body: unknown, status: number): Promise<Response> {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("错误码 → 人话", () => {
  it("限流：说清是频率问题，并且可重试", async () => {
    const friendly = await readApiError(
      await fromBody({ error: { code: "RATE_LIMITED", message: "请 32 秒后再试", retryable: true } }, 429),
    );
    expect(friendly.title).toContain("快");
    expect(friendly.hint).toContain("秒");
    expect(friendly.retryable).toBe(true);
    expect(friendly.code).toBe("RATE_LIMITED");
  });

  it("上游超时：明确说没拿到数据，并强调不用估算顶替", async () => {
    const friendly = await readApiError(
      await fromBody({ error: { code: "MCP_TIMEOUT", message: "调用麦当劳接口超时，请稍后重试" } }, 504),
    );
    expect(friendly.title).toContain("没赶上");
    expect(friendly.hint).toMatch(/超时|网络/);
    expect(friendly.hint).toContain("没有用任何猜测数据顶替");
  });

  it("缺凭证：说明是服务端配置问题，且不会用模拟数据", async () => {
    const friendly = await readApiError(
      await fromBody({ error: { code: "MISSING_TOKEN", message: "服务端未配置 MCD_MCP_TOKEN" } }, 503),
    );
    expect(friendly.title).toContain("凭证");
    expect(friendly.hint).toContain("不会用模拟数据");
    expect(friendly.retryable).toBe(false);
  });

  it("门店查不到：给具体的下一步（换商圈关键词）", async () => {
    const friendly = await readApiError(
      await fromBody({ error: { code: "STORE_UNAVAILABLE", message: "未找到门店" } }, 404),
    );
    expect(friendly.title).toContain("门店");
    expect(friendly.hint).toContain("商圈");
  });

  it("未知码按 HTTP 状态兜底，不会把所有错误都压成同一句", async () => {
    const server = await readApiError(await fromBody({ error: { code: "WHATEVER" } }, 500));
    const bad = await readApiError(await fromBody({ error: { code: "WHATEVER" } }, 400));
    expect(server.title).toContain("服务");
    expect(bad.title).toContain("输入");
    expect(server.title).not.toBe(bad.title);
  });

  it("非 JSON 响应也不抛错", async () => {
    const friendly = await readApiError(new Response("<html>502</html>", { status: 502 }));
    expect(friendly.title).toBeTruthy();
    expect(friendly.code).toBe("HTTP_502");
  });

  it("断网走单独一条文案，不与服务端错误混用", () => {
    const friendly = networkError();
    expect(friendly.title).toContain("网络");
    expect(friendly.code).toBe("NETWORK");
    expect(friendly.retryable).toBe(true);
  });
});

describe("脱敏", () => {
  it("抹掉 Bearer 与长串不透明字符", () => {
    const cleaned = sanitizeDetail("Authorization: Bearer abc.def-123456 failed, id=0123456789abcdef0123456789abcdef");
    expect(cleaned).not.toContain("abc.def-123456");
    expect(cleaned).not.toContain("0123456789abcdef0123456789abcdef");
  });

  it("超长描述被截断，避免整段内部日志铺到界面", () => {
    const long = "错误".repeat(200);
    const cleaned = sanitizeDetail(long);
    expect(cleaned.length).toBeLessThanOrEqual(121);
    expect(cleaned.endsWith("…")).toBe(true);
  });

  it("空值返回空串", () => {
    expect(sanitizeDetail(null)).toBe("");
    expect(sanitizeDetail(undefined)).toBe("");
    expect(sanitizeDetail("   ")).toBe("");
  });
});
