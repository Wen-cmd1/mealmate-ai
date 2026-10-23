/**
 * 敏感信息脱敏（无外部依赖，可被服务端任意模块安全引用）。
 *
 * 单独成文件的原因：`lib/mcp/client.ts` 会连带加载 MCP SDK，
 * 而推荐引擎只需要脱敏能力，不应该因此被绑定到 SDK 上。
 */

/** 屏蔽形如 `Bearer xxx`、28 位以上令牌串的敏感片段。 */
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/\-]+=*/gi, "Bearer ***")
    .replace(/\b[A-Za-z0-9]{28,}\b/g, "***");
}
