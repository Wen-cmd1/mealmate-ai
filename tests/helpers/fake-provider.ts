import mealsFixture from "../fixtures/query-meals-1400359.json";
import { normalizeMeals, type RawMealsData } from "@/lib/mcp/mcd-adapter";
import type { MealItem, MenuSnapshot, PriceQuote, StoreRef } from "@/types/meal";
import type { MenuPort } from "@/lib/recommendation/types";

/**
 * 单测用的假 Provider。
 *
 * 默认菜单来自 `tests/fixtures/query-meals-1400359.json`（**真实抓取**的上游返回），
 * 所以分类/评分/过滤逻辑是针对真实菜单结构验证的，不是手写假数据。
 * 只有需要构造极端场景（算价不一致、候选不足、超时）时才覆盖默认行为。
 */

export const FIXTURE_STORE: StoreRef = {
  storeCode: "1400359",
  storeName: "麦当劳广州天源路餐厅",
  address: "天源路5号",
  businessStatus: true,
};

interface FixtureEnvelope {
  data: RawMealsData;
  datetime?: string;
  traceId?: string;
}

/** 把真实 fixture 归一化成 MenuSnapshot */
export function buildFixtureMenu(): MenuSnapshot {
  const envelope = (mealsFixture as { envelope: FixtureEnvelope }).envelope;
  return normalizeMeals(envelope.data, {
    store: FIXTURE_STORE,
    fetchedAt: "2026-10-21T13:31:00.000Z",
    upstreamDatetime: envelope.datetime,
    traceId: envelope.traceId,
    toolsUsed: ["query-meals"],
  });
}

/** 构造单条餐品（用于合成小菜单） */
export function makeMenuItem(input: {
  code: string;
  name: string;
  priceFen: number;
  categoryName?: string;
  originalPriceFen?: number;
}): MealItem {
  return {
    code: input.code,
    name: input.name,
    priceFen: input.priceFen,
    originalPriceFen: input.originalPriceFen,
    onSale: (input.originalPriceFen ?? input.priceFen) > input.priceFen,
    categoryName: input.categoryName ?? "测试分类",
    nutrition: null,
    source: {
      provider: "mcd-mcp",
      fetchedAt: "2026-10-21T13:31:00.000Z",
      store: FIXTURE_STORE,
    },
  };
}

/** 构造合成菜单 */
export function makeMenu(items: MealItem[]): MenuSnapshot {
  return {
    store: FIXTURE_STORE,
    fetchedAt: "2026-10-21T13:31:00.000Z",
    categories: [{ name: "测试分类", codes: items.map((i) => i.code) }],
    items,
    toolsUsed: ["query-meals"],
  };
}

export interface FakeProviderOptions {
  menu?: MenuSnapshot;
  stores?: StoreRef[];
  findStoresError?: unknown;
  getMenuError?: unknown;
  quoteError?: unknown;
  /** 自定义报价，默认 = 菜单标价合计 */
  quote?: (items: Array<{ productCode: string; quantity: number }>) => PriceQuote | Promise<PriceQuote>;
}

export interface FakeProvider extends MenuPort {
  calls: { findStores: number; getMenu: number; quotePrice: number };
  quotedCodes: string[][];
}

export function createFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const menu = options.menu ?? buildFixtureMenu();
  const byCode = new Map(menu.items.map((item) => [item.code, item]));

  const calls = { findStores: 0, getMenu: 0, quotePrice: 0 };
  const quotedCodes: string[][] = [];

  const menuTotal = (items: Array<{ productCode: string; quantity: number }>): number =>
    items.reduce((sum, line) => sum + (byCode.get(line.productCode)?.priceFen ?? 0) * line.quantity, 0);

  const provider: FakeProvider = {
    calls,
    quotedCodes,

    async findStores() {
      calls.findStores += 1;
      if (options.findStoresError) throw options.findStoresError;
      return (
        options.stores ?? [
          {
            storeCode: FIXTURE_STORE.storeCode,
            storeName: FIXTURE_STORE.storeName,
            address: FIXTURE_STORE.address,
            businessStatus: FIXTURE_STORE.businessStatus,
          },
        ]
      );
    },

    async getMenu() {
      calls.getMenu += 1;
      if (options.getMenuError) throw options.getMenuError;
      return menu;
    },

    async quotePrice(input) {
      calls.quotePrice += 1;
      quotedCodes.push(input.items.map((line) => line.productCode));
      if (options.quoteError) throw options.quoteError;
      if (options.quote) return options.quote(input.items);

      const totalFen = menuTotal(input.items);
      return {
        storeCode: input.storeCode,
        orderType: 1,
        beType: 1,
        productOriginalPriceFen: totalFen,
        productPriceFen: totalFen,
        discountFen: 0,
        totalFen,
        lines: input.items.map((line) => {
          const item = byCode.get(line.productCode);
          const subtotal = (item?.priceFen ?? 0) * line.quantity;
          return {
            productCode: line.productCode,
            productName: item?.name,
            quantity: line.quantity,
            originalSubtotalFen: subtotal,
            subtotalFen: subtotal,
          };
        }),
        fetchedAt: "2026-10-21T13:31:05.000Z",
      };
    },
  };

  return provider;
}

/** 造一个"上游超时"的错误对象（与 McpClientError 的 kind 对齐，但不依赖 SDK） */
export function timeoutError(): { kind: string; message: string } {
  return { kind: "TIMEOUT", message: "调用工具 query-meals 超时" };
}

/** 造一个"上游业务错误" */
export function toolError(message = "工具调用失败"): { kind: string; message: string } {
  return { kind: "TOOL_ERROR", message };
}

export { menuTotalOf };
function menuTotalOf(items: Array<{ productCode: string; quantity: number }>, menu: MenuSnapshot): number {
  const byCode = new Map(menu.items.map((item) => [item.code, item]));
  return items.reduce((sum, line) => sum + (byCode.get(line.productCode)?.priceFen ?? 0) * line.quantity, 0);
}

/** 按指定总价造一个 PriceQuote（用于模拟"算价与标价不一致"） */
export function makeQuote(
  menu: MenuSnapshot,
  items: Array<{ productCode: string; quantity: number }>,
  totalFen: number,
): PriceQuote {
  return {
    storeCode: menu.store.storeCode,
    orderType: 1,
    beType: 1,
    productOriginalPriceFen: totalFen,
    productPriceFen: totalFen,
    discountFen: 0,
    totalFen,
    lines: items.map((line) => ({
      productCode: line.productCode,
      productName: menu.items.find((i) => i.code === line.productCode)?.name,
      quantity: line.quantity,
      originalSubtotalFen: menuTotalOf([line], menu),
      subtotalFen: menuTotalOf([line], menu),
    })),
    fetchedAt: "2026-10-21T13:31:05.000Z",
  };
}
