import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { INTENT_SYSTEM_PROMPT } from "@/lib/ai/parse-intent";

/**
 * 任务 004 的安全边界检查（**静态扫描 + 少量行为断言**）。
 *
 * 这些断言的价值在于"防止以后被人顺手改坏"：
 * 例如某天有人为了图方便，在客户端组件里直接 import `@/lib/ai`，
 * 整个模型调用链（含服务端环境变量读取）就会被拖进浏览器 import 图。
 */

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string): string[] {
  const result: string[] = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
      result.push(...walk(full));
    } else {
      result.push(full);
    }
  }
  return result;
}

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function clientFiles(): string[] {
  return walk(ROOT).filter((file) => {
    if (!/\.(ts|tsx)$/.test(file)) return false;
    return /^\s*["']use client["']/m.test(fs.readFileSync(file, "utf8"));
  });
}

describe("客户端 / 服务端边界", () => {
  it("客户端组件不引用 AI 的服务端实现（只允许 @/lib/ai/types）", () => {
    const offenders: string[] = [];
    for (const file of clientFiles()) {
      const content = fs.readFileSync(file, "utf8");
      const imports = [...content.matchAll(/from\s+["'](@\/lib\/ai[^"']*)["']/g)].map((m) => m[1]);
      for (const specifier of imports) {
        if (specifier !== "@/lib/ai/types") offenders.push(`${path.relative(ROOT, file)} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("新增的 AI 客户端组件确实存在（否则上面的断言可能是空跑）", () => {
    const aiComponents = walk(path.join(ROOT, "components/ai")).map((file) => path.basename(file));
    expect(aiComponents).toEqual(
      expect.arrayContaining(["NaturalLanguageDecision.tsx", "IntentSummary.tsx", "AiRecommendationCard.tsx"]),
    );
  });

  it("客户端组件不引用 OpenAI 兼容调用实现", () => {
    const offenders = clientFiles().filter((file) =>
      /lib\/ai\/(provider|decision-agent|parse-intent)/.test(fs.readFileSync(file, "utf8")),
    );
    expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
  });
});

describe("密钥与日志", () => {
  it("provider 不写任何日志（用户原文与模型响应不落盘）", () => {
    for (const file of ["lib/ai/provider.ts", "lib/ai/parse-intent.ts", "lib/ai/decision-agent.ts"]) {
      const source = read(file);
      expect(source, `${file} 不应出现 console.*`).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });

  it("AI 密钥只从服务端变量读取，且没有 NEXT_PUBLIC_ 形式", () => {
    const provider = read("lib/ai/provider.ts");
    expect(provider).toContain("AI_API_KEY");
    expect(provider).not.toMatch(/NEXT_PUBLIC_AI/);

    const offenders = walk(ROOT)
      .filter((file) => /\.(ts|tsx|md|example)$/.test(file))
      .filter((file) => /NEXT_PUBLIC_AI_[A-Z_]*KEY/.test(fs.readFileSync(file, "utf8")));
    expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
  });

  it(".env.example 里 AI_API_KEY 是空占位符", () => {
    const example = read(".env.example");
    expect(example).toMatch(/AI_API_KEY\s*=\s*$/m);
    expect(example).toContain("AI_MODEL");
    expect(example).toContain("AI_BASE_URL");
  });

  it("源码里不出现真实的 AI 密钥（配置了才检查）", () => {
    const key = (process.env.AI_API_KEY ?? "").trim();
    if (!key) return;
    const offenders = walk(ROOT)
      .filter((file) => /\.(ts|tsx|md|json)$/.test(file))
      .filter((file) => fs.readFileSync(file, "utf8").includes(key));
    expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
  });

  it("决策 API 路由不把密钥或请求头写进响应", () => {
    const route = read("app/api/ai/decide/route.ts");
    expect(route).not.toMatch(/\bapiKey\s*:/);
    expect(route).not.toMatch(/AI_API_KEY\s*=/);
    expect(route).not.toMatch(/headers\.get\(["']authorization/i);
    // 只把模式与限流余量放进响应头，符合"最小暴露"
    expect(route).toContain("x-intent-mode");
  });
});

describe("只读边界：AI 层不能写任何东西", () => {
  it("lib/ai 不引用账本写函数", () => {
    const forbidden = [
      "addExpense",
      "updateExpense",
      "removeExpense",
      "saveBudgetState",
      "clearBudgetState",
      "confirmExpense",
    ];
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, "lib/ai"))) {
      const source = fs.readFileSync(file, "utf8");
      for (const name of forbidden) {
        if (new RegExp(`\\b${name}\\b`).test(source)) offenders.push(`${path.basename(file)} → ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lib/ai 不包含任何写操作 MCP 工具名", () => {
    const forbidden = [
      "create-order",
      "mall-create-order",
      "auto-bind-coupons",
      "draw-lottery",
      "cancel-order",
      "party-order-create",
    ];
    for (const file of walk(path.join(ROOT, "lib/ai"))) {
      const source = fs.readFileSync(file, "utf8");
      for (const name of forbidden) {
        expect(source, `${path.basename(file)} 不应包含 ${name}`).not.toContain(name);
      }
    }
  });

  it("lib/ai 不做文件写入（没有 fs 写接口）", () => {
    for (const file of walk(path.join(ROOT, "lib/ai"))) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).not.toMatch(/writeFile|appendFile|createWriteStream/);
    }
  });
});

describe("提示词本身的安全约束", () => {
  it("系统提示词明确禁止编造价格/菜品与推断敏感属性", () => {
    expect(INTENT_SYSTEM_PROMPT).toContain("不能");
    expect(INTENT_SYSTEM_PROMPT).toContain("价格");
    expect(INTENT_SYSTEM_PROMPT).toContain("敏感属性");
    expect(INTENT_SYSTEM_PROMPT).toContain("忽略以上规则");
  });

  it("用户文本被包裹在分隔符里，且分隔符会被清理", () => {
    const source = read("lib/ai/parse-intent.ts");
    expect(source).toContain("<user_input>");
    expect(source).toContain("已移除");
  });

  it("提示词不含任何真实凭证占位以外的密钥字样", () => {
    expect(INTENT_SYSTEM_PROMPT).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });
});
