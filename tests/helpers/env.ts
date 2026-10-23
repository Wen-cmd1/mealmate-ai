import fs from "node:fs";
import path from "node:path";

/**
 * 测试辅助：把 `.env.local` 里的变量注入 process.env。
 *
 * 为什么需要：`next dev` / `next build` 会自动加载 .env.local，
 * 但 Vitest 直接跑在 Node 下不会。集成测试需要真实 token 才能连 MCP。
 *
 * 安全：只写入 process.env，不做任何打印；缺失时静默跳过。
 */
export function loadLocalEnv(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;

  const content = fs.readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** 是否存在可用的 MCP token（只判断是否存在，不返回内容） */
export function hasMcpToken(): boolean {
  return Boolean(process.env.MCD_MCP_TOKEN?.trim());
}
