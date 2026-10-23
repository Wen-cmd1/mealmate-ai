# 任务 003 执行报告 —— 长期餐饮预算管理（MealMate AI v0.3.0）

> 执行时间：2026-10-21
> 工程路径：`mealmate-ai/`（仓库根目录）
> 版本：v0.2.0 → **v0.3.0**
> 边界：本次**未**开发 AI 对话、支付、真实下单、优惠券领取；所有 MCP 调用仍为只读。

---

## 0. 执行前检查（验证任务 001/002 未被破坏）

| 检查项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | **PASS**（`next typegen` + `tsc --noEmit` 零错误） |
| 单元测试 | `npm run test:unit` | **PASS** 153 passed / 8 files（任务 002 的基线） |
| 生产构建 | `npm run build` | **PASS**（`/`、`/budget` 静态；3 个 API 动态） |
| 真实 MCP 集成 | `npm run test:integration` | **PASS** 11 passed + 2 skipped（skip 均为"无 token 占位断言"） |

先读过 `README.md`、`docs/01-mcp-integration.md`、`docs/02-recommendation-report.md`、`docs/decisions.md` 再动手，
没有重建项目、没有改 `lib/mcp/*` 的接口契约、没有动 `/api/recommend` 的请求/响应字段。

---

## 1. 新增与修改的文件清单

### 新增 —— 预算引擎（`lib/budget/`，纯逻辑，无 IO）

| 文件 | 行数 | 职责 |
|---|---|---|
| `types.ts` | 268 | 全部类型契约：`BudgetPlan` / `ExpenseRecord` / `BudgetSummary` / `MealImpact` |
| `period.ts` | 316 | 日期与周期：纪元日运算、时区→日历日、周/月/自定义周期、剩余天数 |
| `ledger.ts` | 320 | 账本纯函数：新增/修改/删除/确认、幂等去重、按周期归属、排序 |
| `forecast.ts` | 148 | **Meal Impact** 单笔消费影响预测 |
| `budget-engine.ts` | 428 | 编排：建计划、概览、建议单餐预算、推荐价→影响 |
| `storage.ts` | 336 | localStorage 读写、版本号、逐条容错、状态变换 |
| `schema.ts` | 172 | Zod 校验（storage 条目 + 表单金额解析） |
| `meal-link.ts` | 76 | 推荐 → 消费草稿的桥接规则 |
| `index.ts` | 66 | 统一导出 |
| `money.ts` | +15 | 追加 `formatFenSigned`（带符号展示，超支用） |

### 新增 —— 页面与组件（`app/budget`、`components/budget/`）

| 文件 | 职责 |
|---|---|
| `app/budget/page.tsx` | `/budget` 路由壳（静态预渲染 + 本地数据声明） |
| `components/budget/BudgetWorkspace.tsx` | 状态中枢：localStorage ⇄ state ⇄ 纯函数 |
| `components/budget/BudgetOverview.tsx` | 本期概览（8 个指标 + 双进度条 + 告警） |
| `components/budget/PlanForm.tsx` | 预算计划新建/编辑（周期、预留、时区、餐次） |
| `components/budget/ExpenseComposer.tsx` | 手动记一笔（防重复提交） |
| `components/budget/ExpenseList.tsx` | 近期记录（改金额 / 删除 / 确认） |
| `components/budget/MealImpactPanel.tsx` | Meal Impact 交互式预测 |
| `components/budget/BudgetRecommend.tsx` | 剩余预算 → 真实推荐 → 记为已消费 |
| `components/budget/ImpactSummary.tsx` | 影响预测的展示块 |

### 新增 —— 测试

`tests/unit/budget-{period,ledger,forecast,engine,storage,recommend-link}.test.ts`、
`tests/integration/budget-recommend-real.test.ts`。

### 修改

| 文件 | 改动 |
|---|---|
| `app/page.tsx` | 长期预算入口变成真链接（`href="/budget"`）；阶段说明更新到任务 003；版本号 v0.3.0 |
| `components/ModeCard.tsx` | 新增 `href` / `actionText`，有 `href` 时整卡可点击（对无 `href` 的旧用法保持兼容） |
| `package.json` | version 0.3.0（依赖未变，未新增 npm 包） |
| `README.md` | 补充任务 003 的能力、目录、命令、限制 |
| `docs/decisions.md` | 追加 ADR-016 ~ ADR-021 |

> 交付截图在三张之外还多留了一张记账后的状态：`docs/screenshots/`（6 个 png）。

---

## 2. 长期预算引擎的设计说明

### 2.1 分层：一份数据，四个纯函数

```text
period.ts      「今天几号 / 这个周期还剩几天」（只管日期）
   ↓
ledger.ts      「哪条记录算数 / 怎么增加、修改、删除」（只管记录）
   ↓
forecast.ts    「这一笔花下去，后面每天还剩多少」（只管单笔影响）
   ↓
budget-engine.ts  「把三者拼成概览与建议」（只管编排）
```

**为什么全部做成纯函数**：数据存在浏览器里，计算也只能在浏览器里做。
如果服务端一套算法、前端再写一遍，早晚会漂移。现在同一份代码既被 `/budget` 页面调用，
也被 270 条单测直接调用 —— 测过的就是跑起来的。

### 2.2 日期：用「纪元日序号」，不用 `Date` 加减

- 日期统一是 `DateKey = YYYY-MM-DD`（**本地日历日**，不带时区偏移）。
- 加减一天 = 纪元日 ±1，跨月、跨年、闰年自动正确；1/31 加一个月不会跳到 3/3。
- 时区只在**一个地方**出现：`dateKeyOfInstant(occurredAt, timezone)`，把时间戳换算成"用户时区里的哪一天"。
  实测：`2026-10-31T16:30Z` 在 `Asia/Shanghai` 属于 **11-01**（已出本月周期），在 `UTC` 属于 **10-31**（仍在周期内）。
  这条单测保证了"跨时区记账不会漏记/多记"。
- 剩余天数、已过天数都做了 clamp：不会出现负数天数，也不会超过周期总长。

### 2.3 账本：`planned` 与 `confirmed` 严格隔离

| 状态 | 含义 | 扣减预算 | 出现在 |
|---|---|---|---|
| `confirmed` | 用户确认已发生的消费 | ✅ 是 | 已花金额、消费进度、日均 |
| `planned` | 计划消费 | ❌ 否 | 仅"计划支出对未来预算的影响" |

- **推荐结果永远不会自动进账本**：`POST /api/recommend` 不写任何东西；
  只有用户在卡片上点「记为已消费」→ 再确认金额，才 `addExpense`。
- **重复提交只落一条**：有 `requestId` 时幂等；没有时，10 秒内内容完全相同也视为重复
  （覆盖双击与网络重试，但超过 10 秒的相同内容算两笔 —— 用户可能真的又吃了一顿）。
- 删除计划会**级联删除**其记录，避免孤儿记录永远算不进任何周期。

### 2.4 概览口径（每个数字都只有一个定义）

| 指标 | 定义 | 边界处理 |
|---|---|---|
| 本周期已花 | Σ confirmed（周期内） | 周期外/其它计划的记录不计入，单独计数提示 |
| 本周期剩余 | `total - spent` | **可为负**（超支不夹到 0） |
| 可自由支配 | `remaining - reserve` | 可为负（已动用预留）→ 状态置 `tight` |
| 后续日均可用 | `max(disposable, 0) / daysRemaining` | `daysRemaining=0` → `null`，不做除零 |
| 消费进度 | `spent / total` | `total=0` → 0 |
| 时间进度 | `elapsed / daysTotal` | 用于对比"花得快不快" |
| 健康状态 | `ok / ahead / tight / over / ended / empty` | 消费进度超时间进度 15 个百分点 → `ahead` |

### 2.5 Meal Impact：只算钱，不做评价

公式（全部整数分，除法前先判分母）：

```text
消费前日均 = 可支配(remaining - reserve) / daysRemaining
消费后余额 = remaining - 本次消费 - 今天其它餐费
消费后分母 = 本次是否覆盖今天 ? (daysRemaining - 1) : daysRemaining
消费后日均 = 消费后可支配 / 分母        // 分母为 0 → null
```

**"不能假设今天只有一餐"是怎么落实的**：
- `mealsLeftToday` 是显式入参（界面上下拉可见），不藏在算法里；
- `otherMealsTodayFen` 一并从余额扣；
- 只要 `mealsLeftToday > 1` 或今天还有其它餐费，就**不**用 `daysRemaining - 1` 摊，今天仍然占用预算；
- 计划支出（`planned`）用 `assumeCoversToday: false`，因为它不该假设"发生在今天"。

文案边界：只出现"消费前日均 / 消费后日均 / 日均变化 / 预测前提 / 不确定性"，
没有"太贵""不该买"这类措辞（单测里有一条断言守着这个底线）。

---

## 3. 900 元月度预算完整演示案例

数据来自 `tests/integration/budget-recommend-real.test.ts`（真实 MCP）与 `docs/screenshots/budget-desktop-1440.png`（真实浏览器）。

**计划**：`10 月餐饮预算`，总额 **¥900.00**，预留 ¥0，`2026-10-01 ~ 2026-10-31`（31 天），时区 `Asia/Shanghai`，每天 3 餐。

**已确认消费 3 笔**：

| 日期 | 说明 | 金额 |
|---|---|---|
| 10-18 | 午餐 · 麦辣鸡腿堡套餐 | ¥24.50 |
| 10-19 | 晚餐 · 鸡薯双全盒（来源：推荐） | ¥15.90 |
| 10-20 | 聚餐 · 三件套 | ¥34.20 |
| **合计** | | **¥74.60** |

**10-21 的概览（实测输出）**：

| 指标 | 值 | 说明 |
|---|---|---|
| 已花 | ¥74.60 | 仅 confirmed |
| 剩余预算 | ¥825.40 | 900 − 74.60 |
| 可自由支配 | ¥825.40 | 未设预留 |
| 剩余天数 | 11 天 | 含今天（10-21 ~ 10-31） |
| 后续日均可用 | **¥75.04** | 82540 / 11 = 7503.6 → 7504 分 |
| 消费进度 | 8% | 时间进度 68% |
| 健康状态 | 进度正常 | 花得比时间慢 |

**建议单餐预算（实测）**：

```text
可自由支配 825.40 元 ÷ 11 天 ÷ 每天 3 餐 ≈ 每餐 25.00 元
```

→ 建议 **¥25.00**（2500 分），落在推荐 API 的 500~20000 分区间内，可直接发起真实查询。

**设 ¥100 预留时（同一份记录，实测输出）**：可支配 ¥725.40、日均 ¥65.95、建议单餐 **¥21.00**。

---

## 4. Meal Impact 实际计算结果

### 4.1 任务书样例（逐位吻合，单测锁定）

剩余 **¥360**、剩 **12 天**（含今天）、本次 **¥39**、无预留：

| 项目 | 结果 |
|---|---|
| 本次计划消费 | ¥39.00 |
| 消费后预算余额 | **¥321.00** |
| 消费前日均 | **¥30.00**（360 / 12） |
| 消费后日均 | **¥29.18**（32100 / 11 = 2918.18 → 2918 分） |
| 日均变化 | −¥0.82 |
| 覆盖今天 | 是（今天只剩这一餐） |
| 后续完整预算日 | 11 天 |

预测前提（原样输出）：
> 剩余预算按 12 天（含今天）均摊；本笔视为覆盖今天剩余餐次，后续只剩 11 个完整预算日；
> 假设后续每天花费与今天持平，且不再新增其它支出。

不确定性（原样输出）：
> 日均只是平摊，不代表必须花这么多；未考虑优惠券、门店临时调价与配送费；一次性大额支出会让日均再降。

### 4.2 "今天还有别的餐"的场景（同一笔 ¥39）

| 输入 | 覆盖今天 | 消费后日均 |
|---|---|---|
| 今天还剩 1 餐 | 是 | ¥29.18（32100 / 11） |
| 今天还剩 2 餐 | 否 | **¥26.75**（32100 / 12） |
| 今天还剩 1 餐 + 今天已另花 ¥15 | 否 | **¥25.50**（30600 / 12） |

### 4.3 与 900 元真实预算的联动（实测）

剩余 ¥825.40、11 天，`mealsLeftToday=1`：

| 本次消费 | 消费后余额 | 消费前日均 | 消费后日均 | 日均变化 |
|---|---|---|---|---|
| ¥13.90 | ¥811.50 | ¥75.04 | **¥81.15** | +¥6.11 |
| ¥15.90 | ¥809.50 | ¥75.04 | **¥80.95** | +¥5.91 |
| ¥22.90 | ¥802.50 | ¥75.04 | **¥80.25** | +¥5.21 |

> ⚠️ 这里日均"上升"不是 bug：本次花费（13.90）低于原日均（75.04），
> 剩下的钱要摊到更少的 10 天上，算术结果自然变高。
> 界面上专门有一句说明："这是平均分摊的算术结果，不代表可用预算变多。"
> 若按 `mealsLeftToday=2` 计算，日均则是 7377 / 7359 / 7295 分（即 ¥73.77 / ¥73.59 / ¥72.95），方向正常。

---

## 5. 三种 MCP 推荐与预算预测的联动结果

**链路**：剩余可支配 → 建议单餐预算 ¥25.00 → 前端把建议值填进输入框（可改）
→ `POST /api/recommend`（`budgetFen=2500`）→ 真实 MCP
→ 每条推荐的 `verifiedPriceFen` 喂给 `impactOfVerifiedPrice`。

**真实调用（2026-10-21 实测，门店 1400359）**：

`query-nearby-stores` → `query-meals` → `calculate-price` ×3，整链 **2.07 s**（浏览器端实测）。

| 方案 | 餐品 | 官方算价 | 内容待选 | 消费后余额 | 消费后日均 |
|---|---|---|---|---|---|
| 省钱优先 | 精选超值随心配 | **¥13.90** | ✅ 是 | ¥811.50 | ¥81.15 |
| 均衡选择 | "我就喜欢"鸡薯双全盒 | **¥15.90** | 否 | ¥809.50 | ¥80.95 |
| 满足优先 | 大堡口福三件套 | **¥22.90** | 否 | ¥802.50 | ¥80.25 |

三条全部 `priceVerified: true`、`priceMismatch: false`，且都 ≤ 预算 2500 分。

**"记为已消费"实测（浏览器端到端）**：

1. 点第一条（随心配，`needsFurtherSelection=true`）→ 金额输入框**留空**，提示"该套餐内容需要在点餐时选择，算价只是起价，请填写你的实际支付金额"；
2. 填入实付 **¥14.90**（≠ 算价 ¥13.90，模拟真实加价）→ 点「确认为已消费」；
3. localStorage 记录从 3 条变为 **4 条**，新记录 `source: "recommendation"`、`amountFen: 1490`、
   `relatedProductCode: 9900015568`、`relatedRecommendationType: "save"`；
4. 概览的"已花"随之更新，剩余预算与日均同步下降。

关键断言（单测 + 集成测试双重覆盖）：**点「查看推荐」这一步，账本条数与已花金额完全不变**。

---

## 6. 测试结果

### 6.1 命令级结果

| 命令 | 结果 | 明细 |
|---|---|---|
| `npm run typecheck` | **PASS** | `next typegen && tsc --noEmit`，0 error |
| `npm run test:unit` | **PASS** | **270 passed / 0 failed / 0 skipped**，14 个文件 |
| `npm run build` | **PASS** | `/` 与 `/budget` 静态预渲染；`/api/{health,recommend,stores}` 动态 |
| `npm run test:integration` | **PASS** | **17 passed / 3 skipped / 0 failed**，3 个文件（真实网络） |

**270 = 任务 002 的 153（全部保留且全过）+ 本次新增 117**：

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `budget-period.test.ts` | 22 | 周期计算、跨月跨年、闰年、时区 → 日历日、剩余天数边界 |
| `budget-ledger.test.ts` | 20 | 金额校验、planned/confirmed 隔离、幂等去重、改删、周期归属 |
| `budget-forecast.test.ts` | 16 | Meal Impact 准确性、样例逐位吻合、不假设只有一餐、除零、超支、预留 |
| `budget-engine.test.ts` | 28 | 900 元概览、建议单餐预算、超支/结束/未开始/预留超额、跨年周期 |
| `budget-storage.test.ts` | 23 | 序列化往返、损坏 JSON、版本不匹配、逐条容错、存储禁用、金额解析 |
| `budget-recommend-link.test.ts` | 8 | 推荐→账本、查询不写账本、重复点击、待选套餐、**旧 API 兼容** |

**3 个 skip 的说明**（不是"假装通过"）：
`mcp-connection` / `recommend-real` / `budget-recommend-real` 各有一个
`describe.runIf(!enabled)` 分支，只在**没有 token** 时运行占位断言。
本次有 token，所以这 3 条按设计跳过；对应的"真实调用"用例全部真实执行并通过。

### 6.2 任务书 11 项测试要求 → 对应用例

| 要求 | 对应位置 |
|---|---|
| 周期计算 | `budget-period` 全组 + `budget-engine`「每周/每月/自定义/跨年」 |
| 消费累计 | `budget-ledger` sumByStatus + `budget-engine`「900 元概览」 |
| 计划与已确认隔离 | `budget-ledger`「计划消费与已确认隔离」+ `budget-engine`「计划消费不扣减」 |
| 预留金额 | `budget-forecast`「预留金额」+ `budget-engine`「预留大于总额 / ¥100 预留」 |
| 超预算提示 | `budget-engine`「超预算」+ `budget-forecast`「超支」 |
| 预测金额准确性 | `budget-forecast`「任务书样例（必须逐位吻合）」 |
| 更新、删除、重复记录 | `budget-ledger`「修改与删除」「重复提交」 |
| 日期边界 | `budget-period`「剩余天数」「零长度周期」+ `budget-engine`「跨年周期」 |
| 本地存储校验 | `budget-storage` 全组 23 条 |
| 推荐结果与预算预测联动 | `budget-recommend-link`「全链路」+ 集成测试 `budget-recommend-real` |
| 旧 API 兼容性 | `budget-recommend-link`「任务 002 的 API 向后兼容」3 条 |

### 6.3 异常场景清单（任务书第九节）

| 场景 | 处理 | 验证 |
|---|---|---|
| 预算为零 | `total=0` → `consumedRatio=0`、日均 0、告警 `BUDGET_ZERO`，无除零 | 单测 |
| 没有消费记录 | 告警 `NO_RECORDS`，日均按整周期算 | 单测 |
| 已经超出预算 | `remaining` 为负、`overBudgetFen`、状态 `over`、日均夹到 0 | 单测 |
| 剩余日期为零 | 日均 `null`，不产生 NaN/Infinity | 单测 |
| 周期已结束 | 状态 `ended`、告警 `PERIOD_ENDED`、建议预算返回 null | 单测 |
| 预留大于预算 | 可支配为负、状态 `tight`、告警 `RESERVE_EXCEEDS_TOTAL` | 单测 |
| 修改/删除消费记录 | `updateExpense` / `removeExpense`，找不到返回 null 不抛错 | 单测 + 界面 |
| 跨月跨年 | `2026-12-20 ~ 2027-01-10` 共 22 天、12-31 剩 11 天 | 单测 |
| 本地数据损坏 | 逐条丢弃 + issue 提示，不整份重置；版本不符直接停读 | 单测 |
| 重复提交 | `requestId` 幂等 + 10 秒内容去重 + 按钮 pending 禁用 | 单测 + E2E |
| 取消记录消费 | 「记为已消费」→「取消」，不写账本 | E2E |
| 推荐价 ≠ 实付 | 金额输入框始终可改，E2E 用 ¥14.90 覆盖 ¥13.90 | E2E |
| 除以零 / 负数天数 | 所有除法先判分母；天数全部 clamp ≥ 0 | 单测 |

---

## 7. 移动端与桌面端验证

方法：`next start -p 3100` + 本机 Chrome 无头（CDP），实测截图 + 度量。

| 页面 | 视口 | HTTP | 横向溢出 | 页面高度 |
|---|---|---|---|---|
| `/budget` | 1440 | 200 | **无**（scrollWidth 1440 = viewport） | 1148 px |
| `/budget` | 390 | 200 | **无** | 1510 px |
| `/budget` | 360 | 200 | **无** | 1576 px |
| `/` | 1440 | 200 | **无** | 1649 px |
| `/` | 390 | 200 | **无** | 2432 px |

- 移动端为单列堆叠（`grid-cols-2 sm:grid-cols-4`、`lg:grid-cols-2` 断点），
  概览指标 2 列、桌面 4 列；记录行按钮在窄屏自动换行。
- 截图（真实数据，非示意）：
  - `docs/screenshots/budget-desktop-1440.png` —— 有 3 条记录 + 概览
  - `docs/screenshots/budget-mobile-390.png` —— 同数据移动端
  - `docs/screenshots/budget-recommend-result.png` —— 三条推荐 + 影响预测
  - `docs/screenshots/budget-after-record.png` —— 记账后状态
  - `docs/screenshots/home-desktop-1440.png` / `home-mobile-390.png` —— 首页双模式入口
- 首页截图里能看到 `MCP 已连接 · mcd-mcp v1.0.0 · 35 个工具`，说明真实连通性在浏览器端也生效。

---

## 8. 已知问题

1. **日均可能"反向上升"**：本次消费低于原日均时，剩余预算摊到更少天数上，消费后日均反而更高。
   这是"平均分摊"模型的算术结果（任务书样例本身的公式即如此）。已在界面加了一句解释，
   但没有改成"按餐次权重摊"——那需要用户填每餐占比，本期不引入。
2. **限流仍是进程内滑动窗口**（20 次/分钟/IP）。`/budget` 只在用户点按钮时才打上游，但多副本部署时这层保护挡不住总量。
3. **无法真正"跨设备"**：localStorage 天生单浏览器。清缓存、隐私模式、换浏览器都会丢数据（界面已明确提示，不是缺陷而是边界）。
4. **套餐组成仍未展开**：`needsFurtherSelection` 的套餐（随心配 / 1+1 / 任选）只能给"起价"，实际组成要在点餐时选。UI 已强制要求用户填实付金额，但没有做"选内容"的交互（那需要上游提供可选项列表，当前 `tools/list` 里没有对应工具）。
5. **多计划切换较简陋**：支持多份计划，但入口是概览上方一个下拉；没有"复制上月预算""按周滚动结转"这类便利功能。
6. **计划周期不支持自动滚动**：月末不会自动生成下月计划，需要用户手动改日期或新建（避免"未经确认就动用户账本"）。
7. **没有真实浏览器交互的自动化测试**：E2E 用一次性 CDP 脚本跑过（已删除），没有沉淀成 CI 里的 Playwright 用例（会引入 ~150MB 浏览器依赖）。
8. **推荐接口的 `preferences` 在预算模式里没暴露**：为了减少界面复杂度，`/budget` 只传预算/门店，不传口味偏好（单餐模式仍然支持）。

---

## 9. 下一阶段建议（仅建议，未执行）

1. **补齐"套餐构成"**：如果上游将来提供随心选/1+1 的选项接口，把 `needsFurtherSelection` 变成可选交互，
   才能把"起价"变成"确定的实付"，也让 Meal Impact 更准。
2. **把 E2E 沉淀成脚本**：现在的 CDP 脚本跑通即删，建议正式引入 Playwright（或复用 `playwright-cli`），
   把"推荐 → 记账 → 概览更新"钉成回归用例。
3. **预算结转**：加入"上期结余是否转入下期"，这是长期预算的刚需，但涉及口径变化，建议先定规则再实现。
4. **按餐次权重摊日均**：把"每天 3 餐"细化成"早/中/晚各自的预算权重"，可消除第 8 节第 1 条的"日均反向上升"观感。
5. **消费画像**：`/api/recommend` 已有真实价格，账本也有历史，可以做"你近 30 天人均 ¥X"的个人基线，
   但需要先明确隐私边界（纯本地计算，不上传）。
6. **服务端限流换成共享存储**（Redis/网关），并把 `/api/recommend` 的调用预算收窄到"每会话 N 次"。

---

## 10. 安全与边界确认

- 本阶段**没有**调用 `create-order` / `mall-create-order` / `auto-bind-coupons` / `draw-lottery` / 支付 / 取消订单 / 账户修改。
- 真实 MCP 调用只有：`query-nearby-stores`、`query-meals`、`calculate-price`（全部只读）。
- Token 仍然只从服务端 `process.env.MCD_MCP_TOKEN` 读取；`lib/budget/*` 与 `components/budget/*` 不引用任何 MCP 模块，
  安全单测里有"所有 `use client` 组件都不引用服务端 MCP 模块"的守卫。
- 本地存储序列化结果里只有 `plan / record / settings` 三类字段，单测断言其文本中不含
  `token / authorization / bearer / password / secret`。
- 所有金额在内部都是整数分；元只在展示层出现（`formatFen` / `formatFenSigned`）。
