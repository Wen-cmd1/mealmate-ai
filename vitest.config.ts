import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest 配置。
 * - environment=node：当前测试对象都是纯 TS 逻辑与 MCP 客户端，不需要 DOM；
 * - 不引入 React 测试库：任务 001 的页面只要求"能正常加载"，用构建 + 运行时验证。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    reporters: ["default"],
    // 集成测试要连真实 MCP，给足超时
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
