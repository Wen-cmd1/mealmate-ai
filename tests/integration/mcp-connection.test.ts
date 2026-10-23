import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasMcpToken, loadLocalEnv } from "../helpers/env";

/**
 * 真实 MCP 连接集成测试。
 *
 * 只有在提供 `MCD_MCP_TOKEN` 时才执行；否则整组 **skip**（报告里记 NOT RUN），
 * 绝不用 mock 数据冒充真实调用结果。
 */

loadLocalEnv();

const enabled = hasMcpToken();
const describeIf = enabled ? describe : describe.skip;

describeIf("真实 MCP 连接（mcd-mcp）", () => {
  // 动态 import：没有 token 时连模块都不需要加载
  let adapter: import("@/lib/mcp/mcd-adapter").McdAdapter;
  let health: import("@/types/mcp").McpHealth;
  let storeCode = "";
  let menu: import("@/types/meal").MenuSnapshot;

  beforeAll(async () => {
    const { McdAdapter } = await import("@/lib/mcp/mcd-adapter");
    adapter = McdAdapter.fromEnv();
    health = await adapter.health();
  }, 60_000);

  afterAll(async () => {
    await adapter?.close();
  });

  it("可以完成 initialize 握手并拿到 serverInfo", () => {
    expect(health.connected).toBe(true);
    expect(health.serverName).toBeTruthy();
    expect(health.toolCount).toBeGreaterThan(0);
  });

  it("tools/list 返回 35 个工具且必需的只读工具齐全", () => {
    expect(health.toolCount).toBe(35);
    expect(health.missingRequiredTools).toEqual([]);
  });

  it("query-nearby-stores 能查到真实门店", async () => {
    const stores = await adapter.findStores({ city: "广州市", keyword: "天河", searchType: 2 });
    expect(stores.length).toBeGreaterThan(0);
    expect(stores[0].storeCode).toMatch(/^\d+$/);
    storeCode = stores[0].storeCode;
  }, 60_000);

  it("query-meals 返回真实菜单，且价格已归一化为整数分", async () => {
    menu = await adapter.getMenu({ storeCode });
    expect(menu.items.length).toBeGreaterThan(50);
    expect(menu.categories.length).toBeGreaterThan(5);
    expect(menu.items.every((i) => Number.isInteger(i.priceFen))).toBe(true);
    expect(menu.items.every((i) => i.nutrition === null)).toBe(true);
    expect(menu.toolsUsed).toContain("query-meals");
    // 上游服务端时间必须被保留下来，便于审计
    expect(menu.items[0].source.upstreamDatetime).toBeTruthy();
  }, 60_000);

  it("calculate-price 对菜单内 SKU 的报价与菜单标价一致", async () => {
    const target = [...menu.items].sort((a, b) => a.priceFen - b.priceFen)[0];
    const quote = await adapter.quotePrice({
      storeCode,
      items: [{ productCode: target.code, quantity: 1 }],
      orderType: 1,
      beType: 1,
    });

    expect(quote.totalFen).toBe(target.priceFen);
    expect(Number.isInteger(quote.totalFen)).toBe(true);
    expect(quote.lines[0].productCode).toBe(target.code);
  }, 60_000);

  it("list-nutrition-foods 返回独立营养记录（不与 SKU 关联）", async () => {
    const records = await adapter.listNutrition();
    expect(records.length).toBeGreaterThan(100);
    expect(records[0].productName).toBeTruthy();
    expect(Number.isFinite(records[0].energyKcal)).toBe(true);
  }, 60_000);
});

describe.runIf(!enabled)("未配置 token", () => {
  it("集成测试被跳过（horseman: 无 MCD_MCP_TOKEN，未验证真实调用）", () => {
    // 这条测试的意义是把 NOT RUN 的原因写进测试输出
    expect(enabled).toBe(false);
  });
});
