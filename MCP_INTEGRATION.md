# MCP 集成说明（MealMate AI / 饭搭子 AI）

> 本文件说明本项目**实际**调用麦当劳 MCP 的方式。文中所有参数、顺序、调用次数上限
> 均与 `lib/mcp/client.ts`、`lib/mcp/mcd-adapter.ts`、`lib/recommendation/engine.ts`
> 一一对应，可按第 6 节在工作区内自行复现核对。

---

## 1. 使用的 MCP Server

| 项 | 实际值 |
|---|---|
| Server | 麦当劳 MCP Server（官方） |
| 端点 | 环境变量 `MCD_MCP_URL`，默认 `https://mcp.mcd.cn` |
| 传输方式 | Streamable HTTP |
| 鉴权 | `Authorization: Bearer ${MCD_MCP_TOKEN}`（**仅服务端**，实测该端点只认此头） |
| Token 获取 | `open.mcd.cn/mcp` 手机号登录后在控制台激活领取（免费） |
| 传输层 | `lib/mcp/client.ts` |
| 领域适配层 | `lib/mcp/mcd-adapter.ts`（把上游载荷归一化为 `MealItem` / `StoreRef` / `PriceQuote`） |

**只读边界（代码级）**：全仓库只出现 `query-nearby-stores`、`query-meals`、
`calculate-price`、`list-nutrition-foods` 四个只读工具。**没有任何一处**调用
`create-order`、`mall-create-order`、`auto-bind-coupons` 等写操作。
本项目不会下单、不会支付、不会领券或核销券。

---

## 2. 使用的三个核心只读 Tool

### 2.1 `query-nearby-stores` — 找门店

| 入参 | 类型 | 本项目实际传值 |
|---|---|---|
| `beType` | number | 固定 `1`（到店自取） |
| `searchType` | number | 有城市/关键词时 `2`（按城市搜索），否则 `1`（按定位） |
| `city` | string | 用户所在城市，如 `广州市` |
| `keyword` | string | 门店名/商圈关键词，如 `天河`（可选） |

- 调用点：`McdAdapter.findStores()`（`lib/mcp/mcd-adapter.ts:433`）
- **何时调用**：仅在用户**尚未指定门店**时调用。前端已选门店后直接带 `storeCode`
  进入第 2 步，不会重复查门店。
- 实测注意：`searchType=1` 且带了城市/关键词时，上游可能返回 `600050`，
  适配器会按契约自动重试一次 `searchType=2`。

### 2.2 `query-meals` — 取门店实时菜单

| 入参 | 类型 | 本项目实际传值 |
|---|---|---|
| `storeCode` | string | 门店编码，如 `1400359` |
| `orderType` | number | 固定 `1` |
| `beType` | number | 固定 `1`（到店自取） |
| `beCode` | string | **不传**。契约要求 `beType=1` 时不得传 `beCode`，传了上游报错 |

- 调用点：`McdAdapter.getMenu()`（`lib/mcp/mcd-adapter.ts:464`）
- 一次请求 = 一次调用，返回整店菜单（含 SKU、分类、套餐组成、标价），
  由 `normalizeMeals()` 归一化为领域模型。

### 2.3 `calculate-price` — 官方算价核验

| 入参 | 类型 | 本项目实际传值 |
|---|---|---|
| `storeCode` | string | 同上 |
| `orderType` / `beType` | number | `1` / `1` |
| `needTableware` | boolean | `false` |
| `items[]` | array | `[{ productCode, quantity: 1 }]`，按候选组合逐项传入 |

- 调用点：`McdAdapter.quotePrice()`（`lib/mcp/mcd-adapter.ts:498`），
  由 `engine.ts:399` 在候选循环中**逐条**调用。
- 为什么逐个调用而不是批量：每个候选的**实际应付金额**（含套餐价、第二份优惠等）
  只有算价接口知道，菜单标价不能直接相乘。项目坚持"每份推荐都算过价"，
  因此宁可多花调用次数。
- 次数上限：`maxCandidatesPerPlan` 默认 **4**（每方案最多试 4 个候选），
  再按方案数均分 `maxQuotes` 得到 `planQuota`；超出即停止尝试并给出原因，
  不会为了凑满三份而无限调用。

---

## 3. 实际调用链

```
用户输入：「今天只有 25 元，想吃鸡肉，不要太辣」
        │
        ▼
POST /api/ai/decide
        │
        ├─ 意图解析（有 AI_API_KEY → 大模型；没有 → 规则解析，页面明确标注）
        │    产出：预算上限 / 餐次 / 口味 / 排除项 / 目标
        ▼
① query-nearby-stores   ← 仅当请求未带 storeCode
        │  返回门店列表 → 用户选定 storeCode
        ▼
② query-meals           ← 1 次
        │  storeCode + orderType=1 + beType=1
        │  返回整店菜单 → 候选池（按排除项过滤、按预算初筛）
        ▼
③ calculate-price       ← 逐候选，最多 4 次/方案 × 3 方案
        │  items = 该候选的完整组成
        │  返回真实应付金额 → priceVerified = true
        ▼
三份方案：省钱优先 / 均衡选择 / 满足优先
```

**一次真实响应的记录**（2026-10-22，门店 1400359，输入「今天中午只有 25 块，想吃鸡肉，不要太辣」）：

| 字段 | 实际值 |
|---|---|
| `source.provider` | `mcd-mcp` |
| `source.upstreamDatetime` | `2026-10-22 08:21:36`（以上游时间为准） |
| `source.traceId` | `79ee25c07c4eb3b55b166724a702e1c6` |
| `source.toolsUsed` | `["query-meals", "calculate-price"]` |
| `elapsedMs` | `2095` |
| `mode` | `RULE_FALLBACK`（当时未配置 `AI_API_KEY`） |

> 注意该次 `toolsUsed` 里**没有** `query-nearby-stores`——因为请求已带 `storeCode`，
> 第 ① 步按设计被跳过。这正是"不重复查门店"的实际证据。

---

## 4. 业务价值

1. **价格是真的，不是估的。** 每份推荐的总价来自 `calculate-price` 的实际返回，
   而不是"菜单标价 × 数量"。套餐价、第二份优惠等由上游计算，项目不改写、不四舍五入。
2. **预算能落到"这一顿吃不吃得起"。** 用户说"只有 25 元"，系统给的是
   ≤ ¥25.00 且已核价的组合，并显示"扣掉这份还剩多少"。
3. **核验状态可展示。** 每份方案带 `priceVerified`；没算过价的候选不会出现在结果里。
4. **门店级真实供给。** 同一个城市不同门店菜单与价格可能不同，一切以
   `storeCode` + 上游 `datetime` 为准，页面上标注数据来源与抓取时间。
5. **决策而不只是搜索。** 在真实供给上做三套权衡（省钱 / 均衡 / 满足），
   把"选不出来"变成"三选一，且知道代价"。

---

## 5. 限制说明

| 限制 | 具体表现 | 项目如何应对 |
|---|---|---|
| 依赖门店 | 不选门店拿不到菜单 | 首页先选门店，未选时引导而非报错 |
| 价格时效性 | 门店调价、售罄随时发生 | 响应带 `upstreamDatetime`，页面显示抓取时间；不承诺长期有效 |
| 算价有次数成本 | 不能对全菜单逐一算价 | 先按预算/排除项初筛，再限额核价（4/方案） |
| 营养数据不可用 | `query-meals` 不提供逐 SKU 营养，`list-nutrition-foods` 是独立口径 | `MealItem.nutrition` **恒为 `null`**，不按名称模糊匹配；评分里没有营养维度 |
| 只读 | 不能下单/支付/领券 | 产品定位就是"决定吃什么"，执行留给官方 App |
| 需要 Token | 无 `MCD_MCP_TOKEN` 时 MCP 接口返回 503 | 首页状态徽标显示"数据未连通"，错误文案给可执行提示 |
| 不做猜测 | 上游失败时不用模型知识补菜单 | 明确报错并说明"没有用任何猜测数据顶替" |

---

## 6. 如何自行验证

```bash
# 1) 准备环境（.env.local 不进仓库）
cp .env.example .env.local
#    按 .env.example 的说明，为 MCD_MCP_TOKEN 这一项填入你自己领取的 token
#    （token 在 open.mcd.cn/mcp 手机号登录后于控制台免费激活）

# 2) 启动
npm install && npm run dev

# 3) 打开 http://localhost:3000 ，页头应显示「实时菜单已连接」
#    输入：今天只有 25 元，想吃鸡肉，不要太辣 → 点「帮我选这一顿」

# 4) 核对返回里的来源字段
curl -s -X POST http://localhost:3000/api/ai/decide \
  -H "Content-Type: application/json" \
  -d '{"text":"25块想吃鸡肉","context":{"city":"广州市","storeCode":"1400359"}}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.source)})"
#    应看到 provider=mcd-mcp、toolsUsed 含 query-meals 与 calculate-price、traceId 非空
```

代码位置对照：传输 `lib/mcp/client.ts` · 适配 `lib/mcp/mcd-adapter.ts` ·
编排 `lib/recommendation/engine.ts` · 决策入口 `lib/ai/decision-agent.ts`。
