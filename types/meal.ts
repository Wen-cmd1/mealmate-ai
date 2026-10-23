/**
 * 领域类型：餐品 / 门店 / 营养。
 *
 * 价格约定（全项目强制）：**一律使用整数「分」**。
 * 上游 `calculate-price` 本身就返回分；`query-meals` 返回元（字符串小数），
 * 必须在适配器边界完成一次转换，业务层不再接触元。
 */

/** 数据来源标识，用于将来接入其他餐饮数据源 */
export type MealProviderId = "mcd-mcp";

/** ISO 8601 时间戳字符串 */
export type IsoDateTime = string;

export interface StoreRef {
  /** 门店唯一编码，MCP 调用必填 */
  storeCode: string;
  storeName: string;
  address?: string;
  /** 距参考点距离（米），上游单位为米 */
  distanceMeters?: number;
  /** 门店是否营业中 */
  businessStatus?: boolean;
  businessStartTime?: string;
  businessEndTime?: string;
}

export interface MealSourceMeta {
  provider: MealProviderId;
  /** 本次数据抓取时间（本地时钟，ISO） */
  fetchedAt: IsoDateTime;
  /** 上游返回的业务时间（服务端时钟） */
  upstreamDatetime?: string;
  /** 上游 traceId，用于问题回溯 */
  traceId?: string;
  store: StoreRef;
}

/**
 * 营养成分。
 *
 * ⚠️ 当前 MCP 的 `list-nutrition-foods` 只返回 `productName`，
 * 与菜单 SKU 的 `code` 之间**没有可靠关联字段**，
 * 因此适配器一律输出 `null`，禁止用名称模糊匹配去"猜"营养数据。
 * 将来若上游补上 code，再把此字段填上。
 */
export interface NutritionInfo {
  energyKcal: number;
  energyKj?: number;
  proteinG?: number;
  fatG?: number;
  carbohydrateG?: number;
  sodiumMg?: number;
  calciumMg?: number;
  /** 数据来源说明，例如 "mcd-mcp:list-nutrition-foods" */
  source: string;
  /** 若为 match 结果，必须记录匹配依据；当前不允许 */
  matchBasis?: never;
}

export interface MealItem {
  /** 上游 SKU code，可直接用于 calculate-price 的 productCode */
  code: string;
  name: string;
  /** 现价（分），整数 */
  priceFen: number;
  /** 原价（分），等于现价时省略 */
  originalPriceFen?: number;
  /** 是否处于促销（originalPriceFen > priceFen） */
  onSale: boolean;
  categoryName?: string;
  imageUrl?: string;
  /** 上游促销标签，如 "随单购麦金卡优惠" */
  discountType?: string;
  /** 未取得可靠营养关联时为 null —— 不允许用名称猜测 */
  nutrition: NutritionInfo | null;
  source: MealSourceMeta;
}

export interface MenuCategory {
  name: string;
  /** 该分类下 SKU code 的顺序（与上游展示顺序一致） */
  codes: string[];
}

export interface MenuSnapshot {
  store: StoreRef;
  fetchedAt: IsoDateTime;
  categories: MenuCategory[];
  items: MealItem[];
  /** 用到的上游工具名，便于审计 */
  toolsUsed: string[];
}

export interface PriceQuoteLine {
  productCode: string;
  productName?: string;
  quantity: number;
  /** 单行原价小计（分） */
  originalSubtotalFen: number;
  /** 单行实付小计（分） */
  subtotalFen: number;
}

export interface PriceQuote {
  storeCode: string;
  orderType: 1 | 2;
  beType: 1 | 2 | 5 | 6;
  /** 商品原价合计（分） */
  productOriginalPriceFen: number;
  /** 商品现价合计（分，不含券） */
  productPriceFen: number;
  /** 优惠金额（分） */
  discountFen: number;
  /** 应付合计（分） */
  totalFen: number;
  lines: PriceQuoteLine[];
  fetchedAt: IsoDateTime;
  upstreamDatetime?: string;
  traceId?: string;
}
