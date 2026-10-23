/**
 * 餐品数据源抽象（Provider）。
 *
 * 当前只有麦当劳一个数据源（`mcd-mcp`）。抽这一层的目的是：
 * 将来接入第二家餐饮数据源时，推荐/预算逻辑不需要改，只新增一个 Provider 实现。
 *
 * 约定：Provider 只暴露**只读**能力；下单/领券等写操作不在本层。
 */

import { McdAdapter } from "../mcp/mcd-adapter";
import type { GetMenuInput, QuotePriceInput, FindStoresInput } from "../mcp/mcd-adapter";
import type { MealProviderId, MenuSnapshot, PriceQuote, StoreRef } from "../../types/meal";
import type { McpHealth } from "../../types/mcp";

export interface MealProviderCapabilities {
  stores: boolean;
  menu: boolean;
  priceQuote: boolean;
  /** 营养数据与菜单 SKU 缺少可靠关联字段，故当前为 false */
  nutritionJoin: boolean;
  /** 优惠券读取：任务 001 未纳入范围 */
  coupons: boolean;
}

export interface MealProvider {
  readonly id: MealProviderId;
  readonly displayName: string;
  readonly capabilities: MealProviderCapabilities;
  health(): Promise<McpHealth>;
  findStores(input?: FindStoresInput): Promise<StoreRef[]>;
  getMenu(input: GetMenuInput & { store?: StoreRef }): Promise<MenuSnapshot>;
  quotePrice(input: QuotePriceInput): Promise<PriceQuote>;
}

export class McdMealProvider implements MealProvider {
  readonly id = "mcd-mcp" as const;
  readonly displayName = "麦当劳（mcd-mcp）";
  readonly capabilities: MealProviderCapabilities = {
    stores: true,
    menu: true,
    priceQuote: true,
    nutritionJoin: false,
    coupons: false,
  };

  private readonly adapter: McdAdapter;

  constructor(adapter?: McdAdapter) {
    this.adapter = adapter ?? McdAdapter.fromEnv();
  }

  health(): Promise<McpHealth> {
    return this.adapter.health();
  }

  findStores(input: FindStoresInput = {}): Promise<StoreRef[]> {
    return this.adapter.findStores(input);
  }

  async getMenu(input: GetMenuInput & { store?: StoreRef }): Promise<MenuSnapshot> {
    const snapshot = await this.adapter.getMenu(input);
    // query-meals 不返回门店名，若调用方已有门店信息则回填，保证来源可追溯
    if (input.store) {
      return { ...snapshot, store: { ...input.store, storeCode: input.storeCode } };
    }
    return snapshot;
  }

  quotePrice(input: QuotePriceInput): Promise<PriceQuote> {
    return this.adapter.quotePrice(input);
  }

  close(): Promise<void> {
    return this.adapter.close();
  }
}

/**
 * Provider 工厂。通过 `MEAL_PROVIDER` 环境变量切换数据源，
 * 目前只实现 `mcd-mcp`。
 */
export function getMealProvider(id: string | undefined = process.env.MEAL_PROVIDER): MealProvider {
  switch (id) {
    case undefined:
    case "":
    case "mcd-mcp":
      return new McdMealProvider();
    default:
      throw new Error(`暂不支持的餐品数据源：${id}`);
  }
}
