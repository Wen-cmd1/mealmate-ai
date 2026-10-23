import { describe, expect, it } from "vitest";

import {
  McdAdapter,
  normalizeMeals,
  normalizeNutrition,
  normalizePriceQuote,
  normalizeStores,
} from "@/lib/mcp/mcd-adapter";
import type { RawMealsData, RawPriceData, RawStore } from "@/lib/mcp/mcd-adapter";
import { McdMcpClient, McpClientError } from "@/lib/mcp/client";
import type { McdEnvelope } from "@/types/mcp";

import mealsFixture from "../fixtures/query-meals-1400359.json";
import storesFixture from "../fixtures/query-nearby-stores-guangzhou.json";
import priceFixture from "../fixtures/calculate-price-1440.json";
import nutritionFixture from "../fixtures/list-nutrition-foods.json";

/**
 * 本测试的所有输入都来自 **2026-10-21 真实抓取**的 mcd-mcp 返回
 * （见 tests/fixtures/*.json 的 _note 字段），不是手写的假数据。
 */

const mealsData = mealsFixture.envelope.data as unknown as RawMealsData;
const priceData = priceFixture.envelope.data as unknown as RawPriceData;

const ctx = {
  store: { storeCode: "1400359", storeName: "麦当劳广州天源路餐厅", address: "天源路5号" },
  fetchedAt: "2026-10-21T12:34:00.000Z",
  upstreamDatetime: mealsFixture.envelope.datetime,
  traceId: mealsFixture.envelope.traceId,
  toolsUsed: ["query-meals"],
};

describe("菜单数据标准化（真实 fixture）", () => {
  const snapshot = normalizeMeals(mealsData, ctx);

  it("SKU 与分类数量与上游一致", () => {
    expect(snapshot.items).toHaveLength(123);
    expect(snapshot.categories).toHaveLength(15);
    expect(snapshot.items.length).toBe(Object.keys(mealsData.meals ?? {}).length);
  });

  it("同一 SKU 在多分类出现时只保留一份", () => {
    const codes = snapshot.items.map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("名称、编码、价格都被标准化", () => {
    const bigMac = snapshot.items.find((i) => i.code === "1100");
    expect(bigMac).toBeDefined();
    expect(bigMac?.name).toBe("巨无霸");
    // 上游 "25.5" 元 → 2550 分
    expect(bigMac?.priceFen).toBe(2550);
    expect(Number.isInteger(bigMac?.priceFen)).toBe(true);
  });

  it("促销品保留原价并标记 onSale", () => {
    // 真实数据："我就喜欢"鸡薯双全盒 15.9（原 28.5）
    const promo = snapshot.items.find((i) => i.code === "9900016076");
    expect(promo?.priceFen).toBe(1590);
    expect(promo?.originalPriceFen).toBe(2850);
    expect(promo?.onSale).toBe(true);
  });

  it("非促销品不产生 originalPriceFen", () => {
    const bigMac = snapshot.items.find((i) => i.code === "1100");
    expect(bigMac?.originalPriceFen).toBeUndefined();
    expect(bigMac?.onSale).toBe(false);
  });

  it("价格区间与实测一致（¥3.0 ~ ¥72.5）", () => {
    const prices = snapshot.items.map((i) => i.priceFen);
    expect(Math.min(...prices)).toBe(300);
    expect(Math.max(...prices)).toBe(7250);
  });

  it("保留数据来源、查询时间、门店与 traceId", () => {
    const item = snapshot.items[0];
    expect(item.source.provider).toBe("mcd-mcp");
    expect(item.source.fetchedAt).toBe(ctx.fetchedAt);
    expect(item.source.store.storeCode).toBe("1400359");
    expect(item.source.upstreamDatetime).toBe(mealsFixture.envelope.datetime);
    expect(item.source.traceId).toBe(mealsFixture.envelope.traceId);
    expect(snapshot.toolsUsed).toEqual(["query-meals"]);
  });

  it("营养数据一律为 null（不允许按名称猜测）", () => {
    expect(snapshot.items.every((item) => item.nutrition === null)).toBe(true);
  });
});

describe("门店数据标准化（真实 fixture）", () => {
  it("解析出 5 家门店并保留距离与营业状态", () => {
    const stores = normalizeStores(storesFixture.envelope.data as unknown as RawStore[]);
    expect(stores).toHaveLength(5);
    expect(stores[0].storeCode).toBe("1400359");
    expect(stores[0].storeName).toBe("麦当劳广州天源路餐厅");
    expect(stores[0].distanceMeters).toBeGreaterThanOrEqual(0);
    expect(typeof stores[0].businessStatus).toBe("boolean");
  });

  it("丢弃缺少 storeCode/storeName 的脏数据", () => {
    const stores = normalizeStores([
      { storeCode: "1", storeName: "A" },
      { storeName: "缺编码" },
      {},
    ] as RawStore[]);
    expect(stores).toHaveLength(1);
  });
});

describe("价格试算标准化（真实 fixture）", () => {
  const quote = normalizePriceQuote(priceData, {
    storeCode: "1400359",
    orderType: 1,
    beType: 1,
    fetchedAt: "2026-10-21T12:45:00.000Z",
    upstreamDatetime: priceFixture.envelope.datetime,
    traceId: priceFixture.envelope.traceId,
  });

  it("上游返回的整数分被原样保留，不做二次换算", () => {
    expect(quote.totalFen).toBe(2250);
    expect(quote.productPriceFen).toBe(2250);
    expect(quote.productOriginalPriceFen).toBe(2250);
    expect(quote.discountFen).toBe(0);
  });

  it("明细行与商品编码正确映射", () => {
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0].productCode).toBe("1440");
    expect(quote.lines[0].productName).toBe("麦辣鸡腿汉堡");
    expect(quote.lines[0].quantity).toBe(1);
    expect(quote.lines[0].subtotalFen).toBe(2250);
  });

  it("算价结果与菜单价一致（同一 SKU）", () => {
    const snapshot = normalizeMeals(mealsData, ctx);
    const menuItem = snapshot.items.find((i) => i.code === "1440");
    expect(menuItem?.priceFen).toBe(quote.totalFen);
  });

  it("上游若给出小数分（口径变更）必须立刻报错", () => {
    expect(() =>
      normalizePriceQuote({ price: 22.5 } as RawPriceData, {
        storeCode: "1400359",
        orderType: 1,
        beType: 1,
        fetchedAt: "2026-10-21T12:45:00.000Z",
      }),
    ).toThrow(/整数分/);
  });
});

describe("营养数据标准化", () => {
  it("只做字段映射，字段缺失时保持 undefined", () => {
    const records = normalizeNutrition([
      {
        productName: "中薯条",
        nutritionDescription: null,
        energyKj: 1210,
        energyKcal: 289,
        protein: 4,
        fat: 12,
        carbohydrate: 38,
        sodium: 165,
        calcium: 18,
      },
      { energyKcal: 100 },
    ]);
    expect(records).toHaveLength(1); // 缺 productName 的被丢弃
    expect(records[0]).toMatchObject({
      productName: "中薯条",
      energyKcal: 289,
      proteinG: 4,
      fatG: 12,
      sodiumMg: 165,
    });
  });

  it("能解析上游真实的紧凑表格字符串（160 条）", () => {
    const records = normalizeNutrition(nutritionFixture.envelope.data);
    expect(records).toHaveLength(160);

    const first = records[0];
    expect(first.productName).toBe("猪柳麦满分");
    expect(first.energyKcal).toBe(308);
    expect(first.energyKj).toBe(1288);
    expect(first.proteinG).toBe(16);
    expect(first.sodiumMg).toBe(781);
    expect(first.calciumMg).toBe(213);
  });

  it("null / 空串视为无数据，不填 0 冒充", () => {
    const text = "[2]{productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:\n  A产品,null,100,24,,3,4,,5";
    const records = normalizeNutrition(text);
    expect(records).toHaveLength(1);
    expect(records[0].energyKcal).toBe(24);
    expect(records[0].proteinG).toBeUndefined();
    expect(records[0].sodiumMg).toBeUndefined();
  });

  it("缺热量（energyKcal）的行被丢弃，避免给出假热量", () => {
    const text = "[1]{productName,nutritionDescription,energyKj,energyKcal,protein}:\n  B产品,null,100,null,5";
    expect(normalizeNutrition(text)).toHaveLength(0);
  });

  it("非法格式返回空数组，不抛错", () => {
    expect(normalizeNutrition("这不是表格")).toEqual([]);
    expect(normalizeNutrition(null)).toEqual([]);
    expect(normalizeNutrition({})).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 适配器的降级与错误处理（用桩客户端，不联网）
 * ------------------------------------------------------------------ */

class StubClient {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(private readonly responder: (name: string, args: Record<string, unknown>) => McdEnvelope<unknown>) {}

  callTool<T>(name: string, args: Record<string, unknown>): Promise<McdEnvelope<T>> {
    this.calls.push({ name, args });
    return Promise.resolve(this.responder(name, args) as McdEnvelope<T>);
  }
}

function adapterWith(stub: StubClient): McdAdapter {
  return new McdAdapter(stub as unknown as McdMcpClient);
}

const ok = <T>(data: T): McdEnvelope<T> => ({
  success: true,
  code: 200,
  message: "请求成功",
  datetime: "2026-10-21 20:43:57",
  traceId: "stub",
  data,
});

describe("适配器降级逻辑", () => {
  it("收藏门店为空（600050）且已给城市时，自动改用 searchType=2 重试", async () => {
    const stub = new StubClient((_name, args) => {
      if (args.searchType === 1) {
        return {
          success: false,
          code: 600050,
          message: "收藏餐厅列表为空，请您提供城市+关键词进行搜索",
          datetime: "2026-10-21 20:43:57",
          data: null,
        };
      }
      return ok(storesFixture.envelope.data);
    });

    const stores = await adapterWith(stub).findStores({ city: "广州市", keyword: "天河", searchType: 1 });

    expect(stores).toHaveLength(5);
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[1].args).toMatchObject({ searchType: 2, city: "广州市", keyword: "天河" });
  });

  it("业务失败且不可降级时抛 UPSTREAM_BUSINESS_ERROR，带上游 code 与 traceId", async () => {
    const stub = new StubClient(() => ({
      success: false,
      code: 600050,
      message: "收藏餐厅列表为空",
      datetime: "2026-10-21 20:43:57",
      traceId: "trace-abc",
      data: null,
    }));

    await expect(adapterWith(stub).findStores({ searchType: 1 })).rejects.toMatchObject({
      kind: "UPSTREAM_BUSINESS_ERROR",
      upstreamCode: 600050,
      traceId: "trace-abc",
    });
  });

  it("到店自取（beType=1）绝不向上游传 beCode", async () => {
    const stub = new StubClient(() => ok(mealsData));
    await adapterWith(stub).getMenu({ storeCode: "1400359", beType: 1, beCode: "SHOULD_NOT_PASS" });
    expect(stub.calls[0].args).not.toHaveProperty("beCode");
  });

  it("缺少 storeCode 直接报错，不发起调用", async () => {
    const stub = new StubClient(() => ok(mealsData));
    await expect(adapterWith(stub).getMenu({ storeCode: "" })).rejects.toBeInstanceOf(McpClientError);
    expect(stub.calls).toHaveLength(0);
  });
});
