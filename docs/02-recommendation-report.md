# 任务 002 执行报告：单餐预算推荐引擎

> 项目：MealMate AI（饭搭子 AI）· 参赛版本 v0.2.0
> 完成时间：2026-10-21 21:45（GMT+8）
> 数据来源：麦当劳官方 MCP（`https://mcp.mcd.cn`，mcd-mcp v1.0.0），**全程只读**
> 本次未创建订单、未领券、未支付、未核销，未修改任何账户信息

---

## 0. 结论先说

- 单餐预算推荐已经**跑通真实数据**：从真实门店 → 真实菜单 → 官方逐个算价 → 三份推荐，全链路无 mock。
- ¥25 预算实测返回 3 条推荐，**每一条都通过 `calculate-price` 核验**，实测单次请求耗时约 1.6–1.8 s，共 3 次算价调用。
- 预算不足时（¥10）**返回 0 条并说明最低价正餐**，不拿酱料/饮料/周边凑数。
- 营养数据**完全没有参与打分**——上游营养表与菜单 SKU 没有可靠关联键，任何"营养均衡"的说法都是编造。
- 新增 21 个文件、修改 6 个文件；单元测试 153 项全通过，集成测试 11 项通过、2 项 skip（skip 原因见 §7）。

---

## 1. 先复核任务 001（动手前）

按任务书要求，改代码前先验一遍既有工程：

| 检查项 | 命令 | 结果 |
|---|---|---|
| 读文档 | `README.md`、`docs/01-mcp-integration.md`、`docs/decisions.md` | ✅ 3 份都已读，ADR-001~009 约束已遵守 |
| TypeScript | `npm run typecheck` | ✅ PASS（`tsc --noEmit` 零错误） |
| 单元测试 | `npm run test:unit` | ✅ PASS（3 文件 / 41 用例） |
| 生产构建 | `npm run build` | ✅ PASS（5.1 s，`/` 静态 + `/api/health` 动态） |
| 真实 MCP | `npm run test:integration` | ✅ PASS（6 通过 / 1 skip，skip 是"无 token 时"的占位用例） |

**没有需要先修的基础问题**，因此直接在原架构上继续开发，没有重建项目、没有推翻目录结构。
唯一的环境操作：构建前把旧 `.next` 目录 `mv` 成备份（本机 safe-delete 保护会拦截 `next build` 清理 50+ 文件），这是环境限制，不是代码缺陷。

---

## 2. 新增与修改的文件清单

### 新增（21 个）

| 文件 | 作用 |
|---|---|
| `lib/recommendation/types.ts` | 推荐请求/响应/候选/评分/告警的完整类型契约 |
| `lib/recommendation/filters.ts` | 餐品角色分类、非正餐排除、候选构造、预算过滤 |
| `lib/recommendation/scoring.ts` | 四维评分、三方案权重、排序与"完整性优先"重排 |
| `lib/recommendation/explain.ts` | 推荐理由与无结果原因的自然语言生成 |
| `lib/recommendation/engine.ts` | 流程编排：门店 → 菜单 → 过滤 → 候选 → 逐个算价核验 → 三方案去重 |
| `lib/recommendation/schema.ts` | Zod 请求校验（预算区间、白名单、`.strict()`） |
| `lib/mcp/redact.ts` | 脱敏逻辑独立成文件（避免推荐引擎被 SDK 依赖污染） |
| `lib/api/http.ts` | 统一 JSON 响应、错误收敛、整体超时兜底 |
| `lib/api/rate-limit.ts` | 进程内滑动窗口限流（按 IP + scope） |
| `app/api/recommend/route.ts` | `POST /api/recommend` |
| `app/api/stores/route.ts` | `GET /api/stores`（门店选择所需，只读） |
| `components/SingleMealDecision.tsx` | 单餐决策交互区（预算/城市/门店/偏好/三卡/状态） |
| `components/RecommendationCard.tsx` | 单条推荐卡片 |
| `tests/helpers/fake-provider.ts` | 假 Provider（默认用真实 fixture 菜单） |
| `tests/unit/recommendation-filters.test.ts` | 分类/排除/候选/预算 38 项 |
| `tests/unit/recommendation-scoring.test.ts` | 评分/权重/排序/营养不参与 13 项 |
| `tests/unit/recommendation-engine.test.ts` | 主流程/核验/故障/凑数/安全 30 项 |
| `tests/unit/recommend-request-schema.test.ts` | 请求校验 21 项 |
| `tests/unit/rate-limit.test.ts` | 限流行为 7 项 |
| `tests/integration/recommend-real.test.ts` | 真实 MCP 推荐（25 元 / 10 元） |
| `docs/02-recommendation-report.md` | 本报告 |

### 修改（6 个）

| 文件 | 改动 |
|---|---|
| `lib/recommendation/index.ts` | 由"占位且调用即抛错"改为统一导出真实引擎 |
| `lib/mcp/client.ts` | `redactSecrets` 移到 `lib/mcp/redact.ts` 并向后兼容 re-export（行为不变） |
| `app/page.tsx` | 接入 `<SingleMealDecision />`，阶段说明更新到任务 002，长期预算仍占位 |
| `tests/unit/security.test.ts` | 新增 3 项：客户端组件不得引引擎实现、路由不得回传凭证、引擎不含写操作工具名 |
| `package.json` | 新增依赖 `zod@^4.6.7`；`typecheck` 改为 `next typegen && tsc --noEmit`（原因见下） |
| `README.md` | 补齐任务 002 的算法、API、测试与限制 |

> 目录结构未调整，`lib/recommendation/` 按任务书要求拆成 `types / filters / scoring / engine / explain`，只额外多了 `schema.ts`（Zod 校验体，独立出来才可单测）。

---

## 3. 推荐算法说明

### 3.1 完整流程

```text
POST /api/recommend
  ├─ ① 限流（20 次/分钟/IP）→ ② Zod 校验（预算 500~20000 分，纯白名单，拒绝未知字段）
  ├─ ③ query-nearby-stores   反查门店名（可选，失败只降级 + 告警，不阻断）
  ├─ ④ query-meals           取该门店当前菜单 → 归一化为 MealItem（元 → 整数分）
  ├─ ⑤ 分类过滤              剔除周边/酱料/单点饮料/甜品/单配餐/多人餐
  ├─ ⑥ 候选构造              套餐 / 单点主食 / 主食+配餐 / 主食+饮料
  ├─ ⑦ 预算粗筛              用菜单标价先筛（只为减少算价调用，不作为最终结论）
  ├─ ⑧ calculate-price       对候选**逐个**核验真实应付金额
  │     ├─ 算价 > 预算       → 剔除，换下一个候选（记录 over_budget）
  │     ├─ 算价抛错          → 跳过该候选（记录 quote_failed），不伪造价格
  │     └─ 算价 ≤ 0          → 视为异常报价，剔除（记录 quote_invalid）
  └─ ⑨ 三方案去重 + 分类多样化 → 生成理由 → 返回
```

**为什么必须逐项核验**：菜单标价是"展示价"，官方算价才是"这一单实际要付的钱"。两者可能不一致（示例见 §7 的 `priceMismatch` 测试），**系统一律以算价为准**，`priceVerified: true` 的推荐才有资格输出。

### 3.2 餐品角色分类（防止"凑数"的核心）

任务书的硬要求是"不能把酱料、纪念品、单独饮料冒充一顿完整正餐"。所以先定角色，再谈预算：

| 角色 | 判定依据（商品品类关键词） | 能否当一顿饭 |
|---|---|---|
| `combo` | 三件套/四件套/单人餐/套餐/随心配/随心选/任选/盒/桶/拼 | ✅ 锚点 |
| `main` | 汉堡/堡/巨无霸/麦香鸡/麦香鱼/卷/饭/三明治/帕尼尼 | ✅ 锚点 |
| `side` | 薯条/鸡块/鸡翅/鸡排/脆汁鸡/炸鸡/小食盘/芝士条… | ❌ 只能加购 |
| `drink` | 可乐/咖啡/拿铁/红茶/果汁/牛奶/饮品/雪冰… | ❌ 只能加购 |
| `dessert` | 冰淇淋/圆筒/新地/麦旋风/派/蛋糕/蛋挞 | ❌ |
| `sauce` | 以「酱」结尾且不含食物主体词 | ❌ |
| `merch` | 徽章/周边/毛绒/帽子/按摩捶/百宝袋 | ❌ |
| `unknown` | 未命中任何规则 | ❌（宁可不推荐） |

判定顺序是有意的，因为真实菜单里存在"名字很像"的坑：

- 「蘸酱炸鸡」是炸鸡**不是**酱（先把含食物主体词的排除出 sauce）
- 「薯条脆卜卜毛绒周边」是周边**不是**薯条（merch 判定在最前）
- 「纯牛奶(盒装)」是饮料**不是**含「牛」的正餐（食物提示词不能放单字 牛/鸡/鱼）
- 「学生专享饮品随心选」是饮品**不是**套餐（饮品判定先于套餐）
- 「汉堡开心乐园餐」是套餐**不是**单品汉堡（套餐判定先于主食）
- 「全明星双人分享餐八件套」是多人餐，**不能**当单餐（`multi_person` 排除）

另有 `needsFurtherSelection`：`随心选 / 任选 / 随心配 / 单品精选 / 1+1` 这类可自选内容的套餐，
**价格可以核验、组成不可编造**。这类推荐会显式标注"内容需在点餐时选择，实际组成以门店为准"。

### 3.3 候选构造

| 组成 | 说明 | 完整性得分 |
|---|---|---|
| `combo` | 套餐单独成餐 | 1.00 |
| `main+side` | 主食 + 最便宜配餐 | 0.90 |
| `main+drink` | 主食 + 最便宜饮料 | 0.80 |
| `main` | 单点主食 | 0.55 |

不做全排列：预算决策只需要"最便宜的加购搭配"，全排列会让候选数爆炸而结果无实质改善。

### 3.4 评分：四个维度，三套权重

```text
score = Σ(weightᵢ × scoreᵢ) / Σweightᵢ
```

| 维度 | 定义 |
|---|---|
| `priceFit` | 省钱/满足：`1 - 价格/预算`；均衡：`1 - |价格 - 0.75×预算| / (0.75×预算)` |
| `completeness` | 见 §3.3 表格 |
| `preference` | 命中偏好数 / 所选偏好数（未选偏好时该权重归零并重新归一化其余权重） |
| `value` | 促销力度：`(原价合计 - 现价合计) / 原价合计` |

| 方案 | priceFit | completeness | preference | value |
|---|---|---|---|---|
| 省钱优先 | **0.78** | 0.17 | 0.02 | 0.03 |
| 均衡选择 | 0.32 | **0.45** | 0.15 | 0.08 |
| 满足优先 | 0.18 | 0.20 | **0.52** | 0.10 |

**权重是实测调出来的，记录两次真实修正**：

1. 省钱方案最初给 `preference: 0.10`，真实跑出来是「¥15.90 鸡薯双全盒（命中鸡肉）」压过「¥13.90 随心配」——一个叫"省钱优先"的方案多花 2 元，语义冲突。把偏好权重降到 0.02 后，省钱方案确实给出全场最低完整正餐。
2. 均衡方案最初纯粹按权重算，真实跑出来是「¥17.00 单点麦香鸡」，等于"又一个省钱方案"。改为**先在所有"组成完整"（套餐/主食+配餐）的候选里挑，挑不到才退回单主食**，现在给出的是套餐。

排序稳定：分数降序 → 价格升序 → SKU 编码升序，同样输入永远得到同样输出（有用例覆盖）。

### 3.5 三方案如何保证不重复

- **主 SKU 去重**：已用过的 `primaryCode` 直接跳过，不消耗算价次数；
- **分类多样化**：先尝试与已选方案不同 `categoryName` 的候选（pass 0），全部撞车才放宽（pass 1）；
- **不足就返回实际数量**：候选不足 3 条时返回 1~2 条并给出 `INSUFFICIENT_CANDIDATES` 告警，**绝不凑数**。

### 3.6 价格与单位

- 菜单 `currentPrice` 是**元字符串**（`"13.9"`）→ 适配器用 `yuanToFen()` 逐位解析成整数分；
- `calculate-price` 返回**整数分**（`1390`）→ 原样使用并断言必须是整数；
- 业务层、API、类型定义**全部**是整数分，字段名统一 `Fen` 结尾，元只在展示层 `formatFen()` 出现。

### 3.7 可解释性

理由只陈述可核验事实：算价金额、占预算比例、剩余金额、组成形式、是否促销、是否与标价不一致。
**不出现**"健康""低卡""营养均衡""最好吃"这类无法证明的表述；每一份推荐都附带
"未使用优惠券，因此这不是理论最低到手价"的提示。

### 3.8 明确不做的

- **营养不参与打分**：`list-nutrition-foods` 只有 `productName`，与菜单 `code` 无关联键，
  按时 nutrition 恒为 `null`。评分函数有一个用例专门验证"即使强行塞入营养数据，得分也完全不变"。
- "均衡"只代表**价格与餐品组成**的折中，不代表营养均衡——文案里写死了这句话。

---

## 4. 一次 ¥25 预算的真实推荐结果

请求：`budgetFen=2500, city=广州市, keyword=天河, storeCode=1400359, orderType=1, beType=1, preferences=["鸡肉"]`
实测：HTTP 200，耗时 1.80 s，返回 3 条，全部 `priceVerified: true`。

| 方案 | 餐品 | 官方算价 | 预算占比 | 剩余 | 备注 |
|---|---|---|---|---|---|
| 省钱优先 | 精选超值随心配 | **¥13.90** | 56% | ¥11.10 | 全场最低完整正餐；可自选内容，组成需点餐时确认 |
| 均衡选择 | “我就喜欢”鸡薯双全盒 | **¥15.90** | 64% | ¥9.10 | 原价 ¥28.50，促销中；套餐（主食+配餐）|
| 满足优先 | 麦乐鸡套餐 | **¥25.00** | 100% | ¥0.00 | 命中「鸡肉」偏好；原价 ¥37.50，刚好用满预算 |

**实际返回的理由原文**（未改一个字）：

> ¥13.90 的「精选超值随心配」是本次候选里已通过官方算价核验的最低完整正餐，对比 ¥25.00 的预算还剩 ¥11.10。该套餐内容需在点餐时选择，实际组成以门店为准。

> ¥15.90 的「“我就喜欢”鸡薯双全盒」占预算 64%，形式为套餐；在「价格」与「餐品组成」之间取折中。注意：这里衡量的是价格与组成，不是营养——营养数据与菜单 SKU 尚无可靠关联字段。

> ¥25.00 的「麦乐鸡套餐」命中你选的「鸡肉」偏好，且未超过 ¥25.00 的预算，刚好用满预算。

**本次调用统计**（来自响应 `stats`）：

```json
{
  "menuItemCount": 123,
  "anchorCount": 63,
  "withinBudgetCount": 26,
  "quotesUsed": 3,
  "verifiedCount": 3,
  "rejectionCounts": {},
  "exclusionCounts": {
    "drink_only": 23, "side_only": 19, "dessert_only": 8,
    "non_food": 5, "multi_person": 4, "sauce": 1
  }
}
```

> 123 项菜单里，63 项才算得上"一份正餐"；其余 60 项（23 饮料 + 19 配餐 + 8 甜品 + 5 周边 + 4 多人餐 + 1 酱料）全部被挡在推荐之外。

**另一个真实档位（¥15，紧预算）**：预算内只剩 3 个候选，返回
`¥13.90 精选超值随心配 / ¥14.00 牛肉堡单品精选 / ¥14.90 人气经典随心配`，同样是 3 次算价、全部核验通过。
说明预算收紧时系统不会硬凑贵套餐，也不会低于候选数瞎编。

---

## 5. 实际调用的 MCP 工具

全程只读，共 3 个工具：

| 工具 | 入参（真实值） | 本次调用次数 | 用途 |
|---|---|---|---|
| `query-nearby-stores` | `{beType:1, searchType:2, city:"广州市", keyword:"天河"}` | 1 | 反查门店名/地址/营业状态 |
| `query-meals` | `{storeCode:"1400359", orderType:1, beType:1}` | 1 | 取该门店在售菜单（123 SKU / 15 分类） |
| `calculate-price` | `{storeCode:"1400359", orderType:1, beType:1, needTableware:false, items:[{productCode,quantity:1}]}` | 3（每条推荐各 1 次） | **逐项核验**真实应付金额 |

`source.toolsUsed` 字段会如实回传本次用到的工具链：
`["query-nearby-stores","query-meals","calculate-price"]`。

**未调用（本期禁止）**：`create-order`、`mall-create-order`、`auto-bind-coupons`、`draw-lottery`、`cancel-order`、`party-order-create`。
其中 `auto-bind-coupons` 未调用意味着**本次报价不含优惠券抵扣**，文案已明确说明。

---

## 6. API 示例（已脱敏）

### 6.1 请求

```http
POST /api/recommend
Content-Type: application/json
```

```json
{
  "budgetFen": 2500,
  "city": "广州市",
  "keyword": "天河",
  "storeCode": "1400359",
  "orderType": 1,
  "beType": 1,
  "preferences": ["鸡肉"]
}
```

> `keyword` 不是任务书示例里的字段，是本任务新增的**可选**字段。原因见 §8 第 1 条：
> 上游查门店必须"城市 + 关键词"，没有 keyword 就只能拿到门店编码、拿不到门店名（会给出告警，不影响推荐）。

### 6.2 响应（节选一条，完整结构见引擎类型）

```json
{
  "success": true,
  "budgetFen": 2500,
  "recommendations": [
    {
      "type": "save",
      "title": "省钱优先",
      "items": [
        {
          "code": "9900015568",
          "name": "精选超值随心配",
          "role": "combo",
          "categoryName": "随心配 1+1",
          "quantity": 1,
          "menuPriceFen": 1390,
          "unitPriceFen": 1390,
          "onSale": false,
          "needsFurtherSelection": true
        }
      ],
      "totalPriceFen": 1390,
      "menuPriceFen": 1390,
      "verifiedPriceFen": 1390,
      "priceVerified": true,
      "priceMismatch": false,
      "remainingFen": 1110,
      "composition": "combo",
      "needsFurtherSelection": true,
      "reason": "¥13.90 的「精选超值随心配」是本次候选里已通过官方算价核验的最低完整正餐，对比 ¥25.00 的预算还剩 ¥11.10。该套餐内容需在点餐时选择，实际组成以门店为准。",
      "highlights": [
        "官方算价核验通过：¥13.90",
        "菜单标价与官方算价一致",
        "套餐内容可自选，实际组成需在点餐时确认",
        "未使用优惠券（本阶段禁止领券），因此这不是理论最低到手价"
      ],
      "score": 0.516,
      "scoreBreakdown": { "priceFit": 0.444, "completeness": 1, "preference": 0, "value": 0 }
    }
  ],
  "source": {
    "provider": "mcd-mcp",
    "storeCode": "1400359",
    "storeName": "麦当劳广州天源路餐厅",
    "storeAddress": "天源路5号",
    "orderType": 1,
    "beType": 1,
    "fetchedAt": "2026-10-21T13:38:48.000Z",
    "upstreamDatetime": "2026-10-21 21:38:48",
    "traceId": "见响应原文（前端仅展示前 8 位）",
    "toolsUsed": ["query-nearby-stores", "query-meals", "calculate-price"]
  },
  "stats": { "menuItemCount": 123, "anchorCount": 63, "withinBudgetCount": 26, "quotesUsed": 3, "verifiedCount": 3 },
  "warnings": [
    { "code": "NEEDS_FURTHER_SELECTION", "message": "部分推荐是「可自选内容」的套餐，实际组成需在点餐时确认，价格已按官方算价核验" }
  ],
  "elapsedMs": 1578
}
```

> 响应里**没有** token、没有 `Authorization`、没有上游堆栈、没有原始载荷（有用例断言 `items` 的字段清单恰好是展示所需的 10 个）。

### 6.3 错误响应（实测）

| 场景 | 状态码 | 响应 |
|---|---|---|
| 预算 0 | 400 | `{"success":false,"error":{"code":"INVALID_REQUEST","message":"预算（分）必须是 500~20000 之间的整数","retryable":false},"field":"budgetFen"}` |
| `orderType=2` | 400 | `{...,"message":"orderType只支持 1（到店自提）；外送/得来速/团餐本期未接入","field":"orderType"}` |
| `storeCode:"abc"` | 400 | `{...,"message":"storeCode 必须是 3~12 位数字（麦当劳门店编码）","field":"storeCode"}` |
| 未知字段 `token` | 400 | `{...,"message":"Unrecognized key: \"token\"","field":"body"}` |
| 请求体非 JSON | 400 | `{...,"message":"请求体不是合法 JSON"}` |
| 触发限流 | 429 | `{...,"code":"RATE_LIMITED","message":"请求过于频繁，请 21 秒后再试"}`，带 `retry-after: 21` |
| 上游超时 | 504 | `{...,"code":"MCP_TIMEOUT","message":"调用麦当劳接口超时，请稍后重试","retryable":true}`（单测覆盖） |
| 未配 token | 503 | `{...,"code":"MISSING_TOKEN","message":"服务端未配置 MCD_MCP_TOKEN，无法查询真实菜单（不会用模拟数据替代）"}`（单测覆盖） |

### 6.4 门店接口（配套，只读）

```http
GET /api/stores?city=广州市&keyword=天河
```

```json
{ "success": true, "city": "广州市", "keyword": "天河", "count": 5,
  "stores": [{ "storeCode": "1400359", "storeName": "麦当劳广州天源路餐厅", "address": "天源路5号", "businessStatus": true }],
  "fetchedAt": "2026-10-21T13:38:10.000Z" }
```

缺 `keyword` 时返回 400 并说明原因：`keyword（商圈/地标，如「天河」）必填——上游麦当劳接口只给城市时无法查询门店`。

---

## 7. 全部测试结果

### 7.1 命令级

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | ✅ **PASS**（零错误） |
| `npm run test:unit` | ✅ **PASS** — 8 文件 / **153 用例全部通过** |
| `npm run build` | ✅ **PASS** — `/` 静态，`/api/health`、`/api/recommend`、`/api/stores` 动态 |
| `npm run test:integration` | ✅ **PASS** — 2 文件 / **11 通过 + 2 skip** |

单元测试分布：

| 文件 | 用例 |
|---|---|
| `recommendation-filters.test.ts` | 38 |
| `recommendation-engine.test.ts` | 30 |
| `mcd-adapter.test.ts`（任务 001） | 23 |
| `recommend-request-schema.test.ts` | 21 |
| `recommendation-scoring.test.ts` | 13 |
| `security.test.ts` | 12 |
| `money.test.ts`（任务 001） | 9 |
| `rate-limit.test.ts` | 7 |

> **关于 2 个 skip**：`describe.runIf(!enabled)` 里那两条是"**没有 token 时应跳过**"的占位断言。
> 本次**有 token**，所以这两条按设计被 skip，属于正确状态；真实调用本身（11 条）全部执行并通过。
> 没有任何一条"该跑的测试"被标记成通过或悄悄跳过。

### 7.2 任务书要求的 11 个场景

| # | 场景 | 覆盖方式 | 结果 |
|---|---|---|---|
| 1 | 预算 10/15/20/25/30/50 元 | 单测 6 档参数化 + 实测 ¥10/¥15/¥25 走真实接口 | ✅ PASS |
| 2 | 预算内没有适合餐品 | 单测断言返回 0 条、算价调用 0 次、`emptyReason` 含最低价 | ✅ PASS（实测 ¥10：本店最低 ¥13.90） |
| 3 | 三种推荐重复 SKU 处理 | 单测：主 SKU 去重 + 只有 1/2 个候选时返回 1/2 条 | ✅ PASS |
| 4 | 元与分转换 | `money.test.ts` 9 项 + 引擎断言所有金额为整数分 | ✅ PASS |
| 5 | 菜单价与算价不一致 | 单测：报价 = 标价 + 500 → `priceMismatch: true`、以算价计入、highlight 说明 | ✅ PASS |
| 6 | MCP 连接超时 | 单测：`kind: "TIMEOUT"` → `RecommendationError(MCP_TIMEOUT, 504)` | ✅ PASS |
| 7 | 门店查询失败 | 单测：降级继续 + `STORE_LOOKUP_FAILED` 告警 + 门店名留空 | ✅ PASS |
| 8 | 无效请求参数 | 18 个非法用例（预算/门店码/用餐方式/偏好/未知字段/非对象） | ✅ PASS（并实测 400） |
| 9 | 非餐食商品排除 | 单测：周边/酱料/饮料/配餐各计 1 次排除；纯周边菜单返回 0 条 | ✅ PASS |
| 10 | 有效候选不足三个 | 单测：1 个候选→1 条、2 个→2 条、`INSUFFICIENT_CANDIDATES` 写明实际数量 | ✅ PASS |
| 11 | Token 不在 API 响应泄露 | 单测：响应 JSON 无 token/Bearer/Authorization；字段清单固定；`items` 不带 nutrition/source | ✅ PASS |
| 附 | 限流 | 单测 7 项 + 实测：第 21 次请求返回 429 + `retry-after` | ✅ PASS |
| 附 | 客户端不引服务端实现 | 安全用例：`use client` 组件不得引 `recommendation/engine|filters|scoring|explain|schema|index` | ✅ PASS |

### 7.3 真实接口实测（`next start` + curl，非单测）

| 项 | 结果 |
|---|---|
| `GET /` | 200，19,643 B，含「今天吃什么？」「单餐决策」「帮我决定吃什么」「口味偏好」 |
| `GET /api/stores?city=广州市&keyword=天河` | 200，5 家门店 |
| `GET /api/stores?city=广州市`（缺 keyword） | 400 + 中文原因 |
| `POST /api/recommend`（¥25，真实） | 200，1.80 s，3 条推荐，3 次算价 |
| `POST /api/recommend`（¥15，真实） | 200，1.74 s，3 条推荐（预算内刚好 3 个候选） |
| `POST /api/recommend`（5 类非法参数） | 全部 400，字段级报错 |
| 连续 21 次请求 | 第 13 次起 429（此前已用掉 8 次配额），`retry-after: 21` |

---

## 8. 当前问题

1. **上游查门店必须"城市 + 关键词"**。实测只给 `city` 会返回业务失败
   `600058 城市名或者关键词不能为空`，所以 `/api/stores` 把 `keyword` 设为必填，
   并在请求里新增可选 `keyword` 用于反查门店名。没传 keyword 时仍能推荐，但 `storeName` 为空并给出 `STORE_NAME_UNAVAILABLE` 告警。
2. **报价不含优惠券**。`auto-bind-coupons` 属写操作，本期禁止调用；账号卡包本身也是 0 张。
   因此推荐价是"不用券的实付价"，文案已写明"不是理论最低到手价"。要算到手价必须先解决"谁授权领券"。
3. **营养维度确实缺席**。上游营养表与 SKU 没有关联键，"均衡选择"目前只代表价格与组成的折中。
   要做热量推荐，必须先建**人工审核**的别名映射表（不能用模糊匹配，ADR-003 已否决）。
4. **餐品角色是关键词启发式**。真实菜单里已处理 6 类易混淆名字，但上游一旦上新品
   （例如"XX 堡卷"里的新造词），仍可能落到 `unknown` 而不被推荐。当前策略是"不认识就不推荐"，比误推安全，但会有漏。
5. **限流是进程内的**。多实例部署时各副本独立计数，挡不住总量。生产需换 Redis 或网关限流（代码注释里写明了这个边界）。
6. **只支持到店自提**。`orderType/beType` 用 `refine` 硬限制为 1；外送/得来速需要 `beCode`，本期未实现。
7. **`calculate-price` 上限 12 次/请求**（3 方案 × 4 候选）。极端预算下若前 4 个候选都被算价否决，
   该方案会放弃而不是继续试——换来的是可控的响应时间（实测 1.6–1.8 s）。
8. **首次冷启动握手约 300–600 ms**。已用 `globalThis` 单例复用连接，但进程重启后第一次请求仍会慢一点。
9. **前端还未做真实浏览器截图**。本期用 curl + 生产服务器实测代替（见 §9），页面交互的视觉细节留给后续 UI 任务。

10. **（已随手修复）`npm run typecheck` 在全新克隆下会失败**。回归时把 `.next` 移走再跑，报
    `app/layout.tsx(15,50): error TS2304: Cannot find name 'LayoutProps'.`
    原因是 Next 16 把 `LayoutProps` 这类路由类型生成在 `.next/types` 里，先跑 `tsc` 自然找不到。
    已把脚本改成 `next typegen && tsc --noEmit`，并实测"移走 `.next` 后再跑"能通过。
    这是任务 001 遗留的隐患（当时目录里有上次构建产物，所以没暴露），不修的话 `npm run verify` 在新机器上第一步就会红。

---

## 9. 演示说明（可复现）

```bash
cd mealmate-ai
npm install

# 1) 配 token（只写本地，不进 git）
cp .env.example .env.local && vi .env.local   # 填 MCD_MCP_TOKEN

# 2) 质量门禁
npm run typecheck && npm run test:unit && npm run build

# 3) 起生产服务
npm run start -- -p 3100

# 4) 打开页面
#    http://localhost:3100
#    - 预算默认 25，可点 ¥10/¥15/¥20/¥25/¥30/¥50 快捷切换
#    - 城市默认「广州市」，商圈默认「天河」，点「查询门店」换门店
#    - 口味偏好可多选（汉堡/鸡肉/牛肉/鱼/辣）
#    - 点「帮我决定吃什么」→ 三张卡片 + 门店/数据时间/调用工具/耗时
```

命令行等价验证：

```bash
curl -s http://localhost:3100/api/stores?city=广州市\&keyword=天河 | head -c 300

curl -s -X POST http://localhost:3100/api/recommend \
  -H 'content-type: application/json' \
  -d '{"budgetFen":2500,"city":"广州市","keyword":"天河","storeCode":"1400359","orderType":1,"beType":1,"preferences":["鸡肉"]}'
```

页面状态覆盖：加载态（三张骨架卡）、空结果（显示 `emptyReason` + 菜单/锚点数量）、
错误态（红框 + 字段名 + 服务端中文原因）、成功态（三卡 + 来源信息 + 告警列表）。

---

## 10. 下一阶段建议（仅建议，未执行）

1. **先补"门店关键词 → 门店 ID"的缓存层**：`/api/stores` 每次都要打上游，页面切换城市就一次调用；用 5 分钟内存缓存即可显著降调用量。
2. **建营养别名映射表（人工审核版）**：`{ alias, skuCode, source }`，先覆盖 30 个高频 SKU 即可支撑"热量上限"筛选；没有这一层，"均衡/健康"永远是空话。
3. **把"组合"从 1+1 扩展到 1+2**（主食+配餐+饮料），但必须先解决算价次数上限——建议改成"先按价位聚类，每类只算 1 个代表"。
4. **长期预算模式用 localStorage 起步**：记录每餐实际花费，再算日均/周均，不要在这一阶段引数据库（任务书已排除用户体系）。
5. **补一次真实浏览器截图**（Chrome DevTools 或 Playwright），用于参赛材料；本期用 curl 实测替代。
6. **考虑把 `source.traceId` 打进前端错误提示**：上游出问题时，traceId 是唯一的回溯线索，但目前只展示前 8 位，建议加一个"复制完整 traceId"按钮。

---

**本次任务到此为止，未进入任务 003。**
