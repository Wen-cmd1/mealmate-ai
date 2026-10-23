import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadLocalEnv } from "../helpers/env";

/**
 * 安全检查：
 * 1. 真实 token 不得出现在任何源码/文档/测试文件中；
 * 2. token 只能通过服务端环境变量读取，禁止 NEXT_PUBLIC_ 前缀；
 * 3. .env* 已在 .gitignore 中；
 * 4. .env.example 只放占位符；
 * 5. "use client" 组件不得引用服务端 MCP 模块。
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components", "lib", "types", "tests", "docs", "public"];
const SCAN_FILES = ["package.json", "README.md", "next.config.ts", "vitest.config.ts", "tsconfig.json"];
/** 允许存在密钥的文件（被 gitignore 覆盖） */
const SECRET_ALLOWED = new Set([".env", ".env.local", ".env.development.local"]);

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function allScannedFiles(): string[] {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  for (const f of SCAN_FILES) {
    const full = path.join(ROOT, f);
    if (fs.existsSync(full)) files.push(full);
  }
  // 根目录的 .env 系列单独处理
  for (const f of fs.readdirSync(ROOT)) {
    if (f.startsWith(".env")) files.push(path.join(ROOT, f));
  }
  return [...new Set(files)];
}

const BINARY_EXT = /\.(ico|png|jpe?g|gif|webp|svg|woff2?|ttf|zip|pdf)$/i;

describe("安全检查：Token 不落盘 / 不出前端", () => {
  loadLocalEnv();
  const token = process.env.MCD_MCP_TOKEN?.trim() ?? "";

  it("源码目录中不存在真实 token 明文（存在 token 时才执行）", () => {
    if (!token) {
      // 无 token 时该断言无法真正验证，明确跳过而不是假装通过
      expect(token).toBe("");
      return;
    }

    const offenders: string[] = [];
    for (const file of allScannedFiles()) {
      if (BINARY_EXT.test(file)) continue;
      if (SECRET_ALLOWED.has(path.basename(file))) continue;

      const content = fs.readFileSync(file, "utf8");
      if (content.includes(token)) offenders.push(path.relative(ROOT, file));
    }

    expect(offenders).toEqual([]);
  });

  it("不存在 NEXT_PUBLIC_ 形式的 token 变量（只认真实用法，不认文档措辞）", () => {
    const offenders: string[] = [];
    for (const file of allScannedFiles()) {
      if (BINARY_EXT.test(file)) continue;
      const content = fs.readFileSync(file, "utf8");

      // 代码里真正去读一个 NEXT_PUBLIC_*TOKEN，或者 .env 里真的定义了一个
      const usedInCode = /process\.env\.NEXT_PUBLIC_[A-Z0-9_]*TOKEN/i.test(content);
      const definedInEnv =
        /^\s*NEXT_PUBLIC_[A-Z0-9_]*TOKEN\s*=/im.test(content) &&
        (path.basename(file).startsWith(".env") || path.basename(file) === "next.config.ts");

      if (usedInCode || definedInEnv) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it("MCP 客户端只从服务端变量读取 token", () => {
    const clientSource = fs.readFileSync(path.join(ROOT, "lib/mcp/client.ts"), "utf8");
    expect(clientSource).toContain("process.env.MCD_MCP_TOKEN");
    // 不允许通过 process.env.NEXT_PUBLIC_* 读取任何凭证
    expect(clientSource).not.toMatch(/process\.env\.NEXT_PUBLIC_/);
  });

  it(".gitignore 覆盖 .env 系列文件", () => {
    const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.env\*?$/m);
  });

  it(".env.example 只包含占位符，不含真实 token", () => {
    const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    expect(example).toContain("MCD_MCP_TOKEN");
    if (token) {
      expect(example).not.toContain(token);
    }
    expect(example).toMatch(/MCD_MCP_TOKEN\s*=\s*$/m);
  });

  it("所有 use client 组件都不引用服务端 MCP 模块", () => {
    const clientFiles: string[] = [];
    for (const file of walk(ROOT)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      if (file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}.next${path.sep}`)) continue;
      const content = fs.readFileSync(file, "utf8");
      if (/^\s*["']use client["']/m.test(content)) clientFiles.push(file);
    }

    expect(clientFiles.length).toBeGreaterThan(0); // 至少 McpStatusBadge 是客户端组件

    const offenders = clientFiles.filter((file) => {
      const content = fs.readFileSync(file, "utf8");
      return /from\s+["']@?\/?lib\/mcp/.test(content) || /@modelcontextprotocol\/sdk/.test(content);
    });

    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  // 只有在"已构建 + 有 token"时才真正扫描浏览器产物，否则明确跳过
  const staticDir = path.join(ROOT, ".next/static");
  const hasBuild = fs.existsSync(staticDir);
  it.skipIf(!hasBuild || !token)("构建产物 .next/static 中不含 token 明文", () => {
    const offenders: string[] = [];
    for (const file of walk(staticDir)) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes(token)) offenders.push(path.relative(ROOT, file));
      if (/MCD_MCP_TOKEN|MCD_MCP_URL/.test(content)) offenders.push(`${path.relative(ROOT, file)} [env 变量名]`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("安全检查：任务 002 的推荐链路", () => {
  it("客户端组件只引用推荐类型，不引用引擎/过滤/评分/校验实现", () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, "components"))) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const content = fs.readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/m.test(content)) continue;
      if (/recommendation\/(engine|filters|scoring|explain|schema|index)/.test(content)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("API 路由没有把凭证写进响应体", () => {
    const routes = [
      "app/api/recommend/route.ts",
      "app/api/stores/route.ts",
      "app/api/health/route.ts",
    ];
    for (const route of routes) {
      const source = fs.readFileSync(path.join(ROOT, route), "utf8");
      expect(source).not.toMatch(/\btoken\s*:/i);
      expect(source).not.toMatch(/MCD_MCP_TOKEN\s*=/);
      // 不允许把请求头原样回显给浏览器
      expect(source).not.toMatch(/headers\.get\(["']authorization/i);
    }
  });

  it("推荐引擎只读取三个只读工具，不包含任何写操作工具名", () => {
    const source = fs.readFileSync(path.join(ROOT, "lib/recommendation/engine.ts"), "utf8");
    for (const forbidden of ["create-order", "mall-create-order", "auto-bind-coupons", "draw-lottery", "cancel-order"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

describe("安全检查：日志脱敏", () => {
  it("redactSecrets 会抹掉 Bearer 令牌", async () => {
    const { redactSecrets } = await import("@/lib/mcp/client");
    const fake = "Bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
    expect(redactSecrets(`请求失败：${fake}`)).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
    expect(redactSecrets(`请求失败：${fake}`)).toContain("Bearer ***");
  });

  it("toSafeError 不会把原始异常里的长令牌带出去", async () => {
    const { toSafeError } = await import("@/lib/mcp/client");
    const leaked = toSafeError(new Error("failed with token abcdefghijklmnopqrstuvwxyz012345"));
    expect(leaked.message).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
  });
});
