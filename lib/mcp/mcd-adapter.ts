/**
 * McDonald's MCP → 领域模型 适配器。
 *
 * 职责边界：
 * 1. 只调用**只读**工具（query-nearby-stores / query-meals / calculate-price / list-nutrition-foods）；
 * 2. 严格按 `tools/list` 的真实契约传参，不做任何猜测；
 * 3. 在边界处完成"元 → 分"的归一化，业务层永远只见整数分；
 * 4. 保留来源信息（provider / fetchedAt / upstreamDatetime / traceId / 门店）。
 *
 * 禁止事项（任务书明确要求）：
 * - 不调用 create-order / mall-create-order / auto-bind-coupons 等写操作；
 * - 不用餐品名称去模糊匹配营养记录（`nutrition` 一律为 null）。
 */

import { yuanToFen, assertFen } from "../budget/money";
import { McdMcpClient, McpClientError } from "./client";
import { MCD_REQUIRED_TOOLS } from "../../types/mcp";
import type { McdEnvelope, McpHealth, McpToolDescriptor } from "../../types/mcp";
import type {
  MealItem,
  MenuSnapshot,
  NutritionInfo,
  PriceQuote,
  PriceQuoteLine,
  StoreRef,
} from "../../types/meal";

/* ------------------------------------------------------------------ *
 * 上游原始载荷类型（严格按实测返回结构声明，仅用于解析）
 * ------------------------------------------------------------------ */

export interface RawStore {
  storeCode?: string;
  storeName?: string;
  address?: string;
  distance?: number;
  businessStatus?: boolean;
  businessStartTime?: string;
  businessEndTime?: string;
}

export interface RawMealEntry {
  code?: string;
  tags?: string[];
}

export interface RawMealMeta {
  name?: string;
  image?: string;
  /** 元，字符串，如 "25.5" */
  currentPrice?: string;
  /** 元，字符串 */
  originalPrice?: string;
  discountType?: string;
  canWithOrder?: boolean;
}

export interface RawMealsData {
  categories?: Array<{ name?: string; meals?: RawMealEntry[] }>;
  meals?: Record<string, RawMealMeta>;
}

export interface RawPriceLine {
  productCode?: string;
  productName?: string;
  quantity?: number;
  originalSubtotal?: number;
  subtotal?: number;
}

export interface RawPriceData {
  productOriginalPrice?: number;
  productPrice?: number;
  originalPrice?: number;
  discount?: number;
  price?: number;
  productList?: RawPriceLine[];
  takeWayList?: Array<{ code?: string; title?: string; subtitle?: string }>;
}

/** 独立的营养记录（未与菜单 SKU 关联） */
export interface NutritionRecord {
  productName: string;
  energyKcal: number;
  energyKj?: number;
  proteinG?: number;
  fatG?: number;
  carbohydrateG?: number;
  sodiumMg?: number;
  calciumMg?: number;
}

/* ------------------------------------------------------------------ *
 * 纯函数归一化（便于单元测试，不依赖网络）
 * ------------------------------------------------------------------ */

/** 业务失败统一抛错，附带上游 code / traceId */
function assertEnvelope<T>(env: McdEnvelope<T>, tool: string): T {
  if (!env.success) {
    throw new McpClientError({
      kind: "UPSTREAM_BUSINESS_ERROR",
      message: `上游返回业务失败（${tool}）：${env.message || "未提供原因"}`,
      upstreamCode: env.code,
      traceId: env.traceId,
    });
  }
  return env.data;
}

/** 门店列表归一化。注意：`query-nearby-stores` 的数组直接在 `data` 上（实测）。 */
export function normalizeStores(data: unknown): StoreRef[] {
  const list = Array.isArray(data)
    ? (data as RawStore[])
    : Array.isArray((data as { data?: RawStore[] } | null)?.data)
      ? ((data as { data: RawStore[] }).data)
      : [];

  return list
    .filter((s): s is RawStore & { storeCode: string; storeName: string } =>
      Boolean(s?.storeCode && s?.storeName),
    )
    .map((s) => ({
      storeCode: s.storeCode,
      storeName: s.storeName,
      address: s.address,
      distanceMeters: typeof s.distance === "number" ? s.distance : undefined,
      businessStatus: s.businessStatus,
      businessStartTime: s.businessStartTime,
      businessEndTime: s.businessEndTime,
    }));
}

/**
 * 菜单归一化。
 *
 * - SKU 去重：同一 code 可能出现在多个分类里，`items` 只保留一份，分类里保留顺序；
 * - 价格：`currentPrice`/`originalPrice` 是**元字符串**，此处转整数分；
 * - 营养：一律 null（缺少可靠关联字段，见 types/meal.ts 说明）。
 */
export function normalizeMeals(
  data: RawMealsData,
  context: {
    store: StoreRef;
    fetchedAt: string;
    upstreamDatetime?: string;
    traceId?: string;
    toolsUsed: string[];
  },
): MenuSnapshot {
  const metaByCode = data.meals ?? {};
  const source = {
    provider: "mcd-mcp" as const,
    fetchedAt: context.fetchedAt,
    upstreamDatetime: context.upstreamDatetime,
    traceId: context.traceId,
    store: context.store,
  };

  const itemsByCode = new Map<string, MealItem>();
  const categories = (data.categories ?? []).map((category) => {
    const codes: string[] = [];

    for (const entry of category.meals ?? []) {
      const code = entry?.code;
      if (!code) continue;

      // 分类内去重（同一分类下重复出现的情况理论上不该有，防御性处理）
      if (!codes.includes(code)) codes.push(code);

      if (itemsByCode.has(code)) continue;

      const meta = metaByCode[code];
      if (!meta) continue;

      const priceFen = meta.currentPrice ? yuanToFen(meta.currentPrice) : undefined;
      if (priceFen === undefined) continue; // 无价格无法参与预算计算，直接丢弃

      const originalFen = meta.originalPrice ? yuanToFen(meta.originalPrice) : priceFen;
      const nutrition: NutritionInfo | null = null;

      itemsByCode.set(code, {
        code,
        name: meta.name?.trim() || `未命名商品 ${code}`,
        priceFen,
        originalPriceFen: originalFen > priceFen ? originalFen : undefined,
        onSale: originalFen > priceFen,
        categoryName: category.name?.replace(/\s+/g, " ").trim(),
        imageUrl: meta.image,
        discountType: meta.discountType,
        nutrition,
        source,
      });
    }

    return { name: (category.name ?? "未分类").replace(/\s+/g, " ").trim(), codes };
  });

  return {
    store: context.store,
    fetchedAt: context.fetchedAt,
    categories,
    items: [...itemsByCode.values()],
    toolsUsed: context.toolsUsed,
  };
}

/**
 * 价格试算归一化。
 * 上游金额本身就是**整数分**，这里只做口径断言，不做元/分转换。
 */
export function normalizePriceQuote(
  data: RawPriceData,
  context: {
    storeCode: string;
    orderType: 1 | 2;
    beType: 1 | 2 | 5 | 6;
    fetchedAt: string;
    upstreamDatetime?: string;
    traceId?: string;
  },
): PriceQuote {
  const totalFen = data.price ?? 0;
  assertFen(totalFen, "应付合计");

  const lines: PriceQuoteLine[] = (data.productList ?? []).map((line) => {
    const subtotalFen = line.subtotal ?? 0;
    assertFen(subtotalFen, `商品 ${line.productCode ?? "?"} 小计`);
    return {
      productCode: line.productCode ?? "",
      productName: line.productName,
      quantity: line.quantity ?? 1,
      originalSubtotalFen: line.originalSubtotal ?? subtotalFen,
      subtotalFen,
    };
  });

  const productPriceFen = data.productPrice ?? totalFen;
  const discountFen = data.discount ?? 0;
  assertFen(productPriceFen, "商品现价合计");
  assertFen(discountFen, "优惠金额");

  return {
    storeCode: context.storeCode,
    orderType: context.orderType,
    beType: context.beType,
    productOriginalPriceFen: data.productOriginalPrice ?? productPriceFen,
    productPriceFen,
    discountFen,
    totalFen,
    lines,
    fetchedAt: context.fetchedAt,
    upstreamDatetime: context.upstreamDatetime,
    traceId: context.traceId,
  };
}

/**
 * 营养数据归一化：只做字段映射，**不与菜单 SKU 做任何匹配**。
 *
 * 上游实测返回的不是数组，而是一段**紧凑表格字符串**：
 *
 * ```text
 * [160]{productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:
 *   猪柳麦满分,null,1288,308,16,16,24,781,213
 *   ...
 * ```
 *
 * 所以这里解析表头 + 逐行切分。`null` 与空串都视为"无数据"（undefined），
 * 绝不填 0 冒充真实值。若上游哪天改成数组，也会走数组分支兼容。
 */
export function normalizeNutrition(data: unknown): NutritionRecord[] {
  if (Array.isArray(data)) return normalizeNutritionArray(data);
  if (typeof data === "string") return parseNutritionTable(data);
  return [];
}

const NUTRITION_FIELD_MAP: Record<string, keyof NutritionRecord> = {
  productName: "productName",
  energyKj: "energyKj",
  energyKcal: "energyKcal",
  protein: "proteinG",
  fat: "fatG",
  carbohydrate: "carbohydrateG",
  sodium: "sodiumMg",
  calcium: "calciumMg",
};

/** 解析 `[N]{列头}:` + 每行逗号分隔的紧凑表格 */
export function parseNutritionTable(text: string): NutritionRecord[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const headerMatch = /^\s*\[\d+\]\s*\{(.+)\}\s*:?\s*$/.exec(lines[0]);
  if (!headerMatch) return [];

  const columns = headerMatch[1].split(",").map((c) => c.trim());
  const records: NutritionRecord[] = [];

  for (const line of lines.slice(1)) {
    const cells = splitCells(line.trim(), columns.length);
    if (!cells) continue;

    const nameIndex = columns.indexOf("productName");
    const name = nameIndex >= 0 ? cells[nameIndex] : "";
    if (!name || name === "null") continue;

    const record: NutritionRecord = { productName: name, energyKcal: 0 };
    let hasEnergy = false;

    columns.forEach((column, index) => {
      const field = NUTRITION_FIELD_MAP[column];
      if (!field || field === "productName") return;

      const value = toNullableNumber(cells[index]);
      if (value === undefined) return;

      if (field === "energyKcal") hasEnergy = true;
      (record as unknown as Record<string, unknown>)[field] = value;
    });

    // energyKcal 是必填字段（类型上如此），缺失则跳过这条，避免给出假热量
    if (!hasEnergy) continue;
    records.push(record);
  }

  return records;
}

/**
 * 按列数切分一行。
 * 若某个名称里含逗号导致字段数超出，则把多出来的部分并回 productName，
 * 保证数值列不错位。
 */
function splitCells(line: string, columnCount: number): string[] | null {
  const cells = line.split(",").map((c) => c.trim());
  if (cells.length === columnCount) return cells;
  if (cells.length < columnCount) return null;

  const overflow = cells.length - columnCount;
  const merged = [...cells.slice(0, overflow + 1)].join(",");
  return [merged, ...cells.slice(overflow + 1)];
}

function toNullableNumber(cell: string | undefined): number | undefined {
  if (cell === undefined) return undefined;
  const text = cell.trim();
  if (text === "" || text === "null" || text === "NULL") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function normalizeNutritionArray(data: unknown[]): NutritionRecord[] {
  return data
    .map((row) => row as Record<string, unknown>)
    .filter((row) => typeof row.productName === "string")
    .map((row) => ({
      productName: row.productName as string,
      energyKcal: Number(row.energyKcal ?? 0),
      energyKj: row.energyKj == null ? undefined : Number(row.energyKj),
      proteinG: row.protein == null ? undefined : Number(row.protein),
      fatG: row.fat == null ? undefined : Number(row.fat),
      carbohydrateG: row.carbohydrate == null ? undefined : Number(row.carbohydrate),
      sodiumMg: row.sodium == null ? undefined : Number(row.sodium),
      calciumMg: row.calcium == null ? undefined : Number(row.calcium),
    }));
}

/* ------------------------------------------------------------------ *
 * 适配器
 * ------------------------------------------------------------------ */

export interface FindStoresInput {
  city?: string;
  keyword?: string;
  /** 1 = 到店自提，5 = 得来速 */
  beType?: 1 | 5;
  /** 1 = 收藏餐厅，2 = 按城市/关键词搜索 */
  searchType?: 1 | 2;
}

export interface GetMenuInput {
  storeCode: string;
  orderType?: 1 | 2;
  beType?: 1 | 2 | 5 | 6;
  beCode?: string;
}

export interface QuotePriceInput {
  storeCode: string;
  items: Array<{ productCode: string; quantity: number }>;
  orderType?: 1 | 2;
  beType?: 1 | 2 | 5 | 6;
  beCode?: string;
  needTableware?: boolean;
}

export class McdAdapter {
  constructor(private readonly client: McdMcpClient) {}

  static fromEnv(): McdAdapter {
    return new McdAdapter(McdMcpClient.fromEnv());
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    return this.client.listTools();
  }

  /** 连接健康检查：连接 + tools/list + 必需工具校验 */
  async health(): Promise<McpHealth> {
    const startedAt = Date.now();
    const tools = await this.listTools();
    const names = new Set(tools.map((t) => t.name));
    const info = this.client.serverInfo;

    return {
      connected: true,
      serverUrl: this.client.targetHost,
      serverName: info.name,
      serverVersion: info.version,
      toolCount: tools.length,
      missingRequiredTools: MCD_REQUIRED_TOOLS.filter((t) => !names.has(t)),
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * 查询门店。
   *
   * 实测行为：`searchType=1`（收藏门店）在无收藏时返回业务失败 600050，
   * 因此在已提供 city/keyword 时自动降级为 `searchType=2` 重试一次。
   */
  async findStores(input: FindStoresInput = {}): Promise<StoreRef[]> {
    const searchType = input.searchType ?? (input.city || input.keyword ? 2 : 1);
    const args: Record<string, unknown> = {
      beType: input.beType ?? 1,
      searchType,
    };
    // 契约要求：searchType=2 时必须带城市；keyword 可选
    if (input.city) args.city = input.city;
    if (input.keyword) args.keyword = input.keyword;

    const env = await this.client.callTool<unknown>("query-nearby-stores", args);

    if (!env.success) {
      const canRetry =
        searchType === 1 && (input.city || input.keyword) && env.code === 600050;
      if (canRetry) {
        const retryEnv = await this.client.callTool<unknown>("query-nearby-stores", {
          beType: args.beType,
          searchType: 2,
          city: input.city,
          keyword: input.keyword,
        });
        return normalizeStores(assertEnvelope(retryEnv, "query-nearby-stores"));
      }
      assertEnvelope(env, "query-nearby-stores");
    }

    return normalizeStores(env.data);
  }

  /** 按门店查询菜单并归一化 */
  async getMenu(input: GetMenuInput): Promise<MenuSnapshot> {
    if (!input.storeCode) {
      throw new McpClientError({ kind: "TOOL_ERROR", message: "storeCode 不能为空" });
    }

    const orderType = input.orderType ?? 1;
    const beType = input.beType ?? 1;

    const args: Record<string, unknown> = {
      storeCode: input.storeCode,
      orderType,
      beType,
    };
    // 契约：到店自取(beType=1) 不允许传 beCode，传了上游会报错
    if (beType !== 1 && input.beCode) args.beCode = input.beCode;

    const env = await this.client.callTool<RawMealsData>("query-meals", args);
    const data = assertEnvelope(env, "query-meals");

    const now = new Date().toISOString();
    const store: StoreRef = { storeCode: input.storeCode, storeName: "" };
    const snapshot = normalizeMeals(data, {
      store,
      fetchedAt: now,
      upstreamDatetime: env.datetime,
      traceId: env.traceId,
      toolsUsed: ["query-meals"],
    });

    // 门店名由调用方回填（query-meals 不返回门店名称）
    return snapshot;
  }

  /** 价格试算（只读，不会下单） */
  async quotePrice(input: QuotePriceInput): Promise<PriceQuote> {
    if (!input.items?.length) {
      throw new McpClientError({ kind: "TOOL_ERROR", message: "items 不能为空" });
    }

    const orderType = input.orderType ?? 1;
    const beType = input.beType ?? 1;

    const args: Record<string, unknown> = {
      storeCode: input.storeCode,
      orderType,
      beType,
      needTableware: input.needTableware ?? false,
      items: input.items.map((item) => ({
        productCode: item.productCode,
        quantity: item.quantity,
      })),
    };
    if (beType !== 1 && input.beCode) args.beCode = input.beCode;

    const env = await this.client.callTool<RawPriceData>("calculate-price", args);
    const data = assertEnvelope(env, "calculate-price");

    return normalizePriceQuote(data, {
      storeCode: input.storeCode,
      orderType,
      beType,
      fetchedAt: new Date().toISOString(),
      upstreamDatetime: env.datetime,
      traceId: env.traceId,
    });
  }

  /** 营养数据（独立口径，不与 SKU 关联） */
  async listNutrition(): Promise<NutritionRecord[]> {
    const env = await this.client.callTool<unknown>("list-nutrition-foods", {});
    return normalizeNutrition(assertEnvelope(env, "list-nutrition-foods"));
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
