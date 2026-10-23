# MCP 接入说明（麦当劳 mcd-mcp）

本文记录**实测**得到的接口契约，供后续任务直接引用，避免再猜参数。

- 端点：`https://mcp.mcd.cn`（根路径。`/mcp`、`/sse`、`/message` 均返回 404）
- 传输：Streamable HTTP
- 协议版本：`2024-11-05`
- `serverInfo`：`{ name: "mcd-mcp", version: "1.0.0" }`
- 工具总数：**35**
- 鉴权：`Authorization: Bearer <token>`

## 1. 鉴权踩坑记录

| 请求头组合 | 结果 |
|---|---|
| 只带 `Authorization: <token>`（无 Bearer 前缀） | `403`，`{"code":"400003","msg":"校验鉴权authToken必填!"}` |
| 只带 `authToken: <token>` | `403`，`{"code":"0001","msg":"系统错误"}` |
| `Authorization: Bearer <token>` | `200` ✅ |

结论：**必须带 `Bearer ` 前缀**。上游报错文案提到 `authToken`，容易误导成"需要额外加 authToken 头"，
实际加上 Bearer 即可（同时带两个也能通过，但没有必要）。

另外，POST 时建议带 `Accept: application/json, text/event-stream`，与 Streamable HTTP 规范一致。

## 2. 统一响应信封

每次 `tools/call` 的业务数据都在 `CallToolResult.structuredContent` 里：

```json
{
  "success": true,
  "code": 200,
  "message": "请求成功",
  "datetime": "2026-10-21 20:43:57",
  "traceId": "12807e2c54b708c275b3e860d2673f8f",
  "data": { }
}
```

- `success: false` 表示**业务失败**（HTTP 仍是 200），例如 `600050 收藏餐厅列表为空`；
- `datetime` 是**上游服务端时间**，已保存在 `MealSourceMeta.upstreamDatetime`；
- `traceId` 用于回溯，已保存在 `MealSourceMeta.traceId`。

`lib/mcp/client.ts` 优先读 `structuredContent`；若拿不到则从 `content[].text` 中截取第一个
`{...}` 片段解析（上游 text 里会混入给 LLM 看的说明文字）。

## 3. 已接入工具的入参契约

### query-nearby-stores

| 参数 | 必填 | 取值 |
|---|---|---|
| `beType` | 是 | `1` 到店自提 / `5` 得来速 |
| `searchType` | 是 | `1` 收藏门店 / `2` 按城市+关键词搜索 |
| `city` | 条件 | `searchType=2` 时必填 |
| `keyword` | **条件** | **`searchType=2` 时也必填**（见下方实测） |

**返回**：`data` **直接是数组**（不是 `data.data`），字段：
`storeCode, storeName, address, distance(米), businessStatus, businessStartTime, businessEndTime,
longitude, latitude, reservation, reservationTimeOptions`

**两个坑（均为实测）**：

1. `searchType=1` 在账号无收藏时返回业务失败 `600050`。适配器已实现"有 city/keyword 时自动降级为
   `searchType=2` 重试一次"。
2. **只给 `city` 不给 `keyword` 会直接失败**：`600058 城市名或者关键词不能为空`。
   `"广州市"` 与 `"广州"` 都一样失败，`keyword` 单独给（不带 city）同样失败——
   也就是说这个接口实际要求 **city + keyword 同时存在**。
   任务 002 的 `/api/stores` 因此把 `keyword` 设成必填，并在提示里写明原因。

### query-meals

| 参数 | 必填 | 说明 |
|---|---|---|
| `storeCode` | 是 | 门店编码 |
| `orderType` | 是 | `1` 到店 / `2` 外送 |
| `beType` | 是 | `1/2/5/6` |
| `beCode` | 条件 | 到店自取(`beType=1`)**禁止传**；得来速/外送/团餐必传 |
| `reservationDate` | 否 | `yyyy-MM-dd HH:mm`，仅预约场景 |

**返回**：

```json
{
  "categories": [{ "name": "人气热卖", "meals": [{ "code": "9900016076", "tags": ["..."] }] }],
  "meals": {
    "1100": { "name": "巨无霸", "image": "https://...", "currentPrice": "25.5",
              "originalPrice": "25.5", "canWithOrder": false }
  }
}
```

- 价格是**元字符串**（`"25.5"`），需 `yuanToFen()` 转分；
- 同一 `code` 可能出现在多个分类中（如"人气热卖"与"鸡肉汉堡"），归一化时按 code 去重；
- 分类名里可能带换行（`"鸡肉汉堡\n/卷"`），已归一化为单空格；
- 不返回门店名称。

### calculate-price

| 参数 | 必填 | 说明 |
|---|---|---|
| `storeCode` / `orderType` / `beType` | 是 | 同上 |
| `items[]` | 是 | `{ productCode, quantity }`，quantity ≥ 1 |
| `needTableware` | 否 | 布尔 |
| `beCode` | 条件 | 同上 |

**返回**（金额全部是**整数分**）：

```json
{ "productOriginalPrice": 2250, "productPrice": 2250, "originalPrice": 2250,
  "discount": 0, "price": 2250,
  "productList": [{ "productCode": "1440", "productName": "麦辣鸡腿汉堡",
                    "quantity": 1, "originalSubtotal": 2250, "subtotal": 2250 }],
  "takeWayList": [{ "code": "eat-in", "title": "堂食" }, { "code": "take-in-store", "title": "外带" }] }
```

**坑**：与 `query-meals` 的单位**不同**（这里是分，那里是元）。适配器对这里只做整数断言，不做乘除。

### list-nutrition-foods

无入参。

**注意：`data` 不是数组，而是一段紧凑表格字符串**（实测 160 行）：

```text
[160]{productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:
  猪柳麦满分,null,1288,308,16,16,24,781,213
  猪柳蛋麦满分,null,1618,387,23,21,25,846,243
```

解析由 `parseNutritionTable()` 完成（`lib/mcp/mcd-adapter.ts`）：

- 从 `[N]{列头}:` 读列名（按列名映射，不依赖列顺序）；
- 逐行逗号切分；若名称里含逗号导致列数超出，多余部分并回 `productName`，避免数值错位；
- `null` / 空串 → `undefined`，**不填 0 冒充真实值**；
- 缺 `energyKcal` 的行直接丢弃；
- 若上游将来改成数组返回，`normalizeNutrition` 会走数组分支。

**关键限制**：只有 `productName`，与菜单 SKU 的 `code` 无关联字段。因此本项目**不做名称匹配**，
`MealItem.nutrition` 恒为 `null`；营养数据通过 `McdAdapter.listNutrition()` 独立提供（160 条）。

## 4. 字段映射表

| 上游字段 | 领域字段 | 转换 |
|---|---|---|
| `meals[code].name` | `MealItem.name` | trim，缺失则 `未命名商品 <code>` |
| `meals[code].currentPrice` | `MealItem.priceFen` | 元 → 分（整数） |
| `meals[code].originalPrice` | `MealItem.originalPriceFen` | 元 → 分；仅当 > 现价时保留 |
| — | `MealItem.onSale` | `originalPriceFen > priceFen` |
| `categories[].name` | `MealItem.categoryName` / `MenuCategory.name` | 换行换空格 |
| `envelope.datetime` | `MealSourceMeta.upstreamDatetime` | 原样 |
| `envelope.traceId` | `MealSourceMeta.traceId` | 原样 |
| — | `MealSourceMeta.fetchedAt` | 本地 `new Date().toISOString()` |

## 5. 如何自行验证

```bash
npm run mcp:check    # 真实连接 + tools/list + 4 个只读工具
```

或者手工 curl（**注意不要把 token 贴进终端历史/截图**）：

```bash
curl -sS https://mcp.mcd.cn \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MCD_MCP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -c 300
```
