# MealMate AI · 饭搭子 AI

面向大学生与年轻人的 AI 饮食决策与预算管理系统（参赛版本）。
通过**麦当劳官方 MCP**（Streamable HTTP）获取真实门店、真实菜单与**官方算价**，未来可扩展其他餐饮数据源。

> **当前进度：任务 006 —— 发布审计与开源准备（v0.5.0，功能冻结，五道门禁全绿）。**
> 已完成：单餐推荐（门店/菜单/角色分类/三方案/逐个官方算价核验）＋ 长期预算（周期预算、消费账本、
> Meal Impact 单笔影响预测、剩余预算驱动推荐、本地持久化）＋ AI 决策
> （一句话 → 意图解析 → Zod 校验 → 真实菜单 → 三方案 → 预算影响）＋ 视觉与交互重设计
> （珊瑚橙品牌体系、首选/备选信息层级、移动端 360~430 适配、`/demo` 演示模式）
> ＋ **发布审计**（凭证零泄露、忽略规则修复、依赖许可盘点、门禁逐项复核）。
> 未做：登录与数据库、真实下单、领券核销、支付、跨设备同步。
> **注意：当前部署未配置 `AI_API_KEY`，意图解析运行在「规则降级模式」，页面与接口都会明确标注。**
> **发布状态：有条件可发布** —— 待决定许可证、真实大模型验收、首次提交，详见
> [`docs/06-release-audit.md`](docs/06-release-audit.md) §8。
> 交付报告：[`docs/02-recommendation-report.md`](docs/02-recommendation-report.md)、
> [`docs/03-budget-report.md`](docs/03-budget-report.md)、
> [`docs/04-ai-agent-report.md`](docs/04-ai-agent-report.md)、
> [`docs/05-ui-report.md`](docs/05-ui-report.md)、
> [`docs/06-release-audit.md`](docs/06-release-audit.md)。

---

## 项目定位与身份声明

**这是一个参赛 / 学习性质的技术项目，不是麦当劳（金拱门）的官方产品。**

- 与麦当劳及其关联公司**没有**隶属、代理、授权或合作关系；项目名称、界面、配色均为自行设计，
  仓库内**不含**任何官方商标、吉祥物、宣传图或门店实拍照（品牌标记是自绘 SVG）。
- 通过官方开放的 MCP 接口**只读**查询门店、菜单与官方算价，全部调用仅限
  `query-nearby-stores` / `query-meals` / `calculate-price` 三个只读工具。
- **不提供**下单、支付、优惠券领取、核销、外送等任何交易能力，也不会代替用户操作门店账号。
- 文中出现的商品名、价格、门店名归各自权利人所有；**价格以门店实际收银为准**，
  本项目不构成任何价格承诺。
- 「麦当劳」「McDonald's」等商标归其权利人所有，本项目仅作**事实性指称**（说明数据来源）。
- 数据与隐私：预算与账本**只存在浏览器 localStorage**，不上传、不同步、无账号体系；
  服务端不持久化任何用户输入，仅在内存中转发一次查询。

如果你代表相关权利方并对本项目有异议，请通过 issue 联系，我们会配合调整。

---

## 目标用户

| 人群 | 他们的真实处境 | 这个项目替他做的判断 |
|---|---|---|
| **大学生 / 预算敏感的人** | 生活费按月或按周分配，一顿饭有明确上限，超了就要从后面几天扣 | 在硬上限内找到"算得上一顿正餐"的组合，并直接算出"扣掉这份还剩多少" |
| **午休时间短的上班族** | 不想在点餐页反复滑动比价，也不想天天吃同一家 | 一句话给三个方向（省钱 / 均衡 / 满足），选一个就能走 |
| **有口味禁忌的人** | 不吃辣、不想吃炸的、只要鸡肉 | 按排除项过滤候选，并**明确说明**"不能保证绝对不含" |
| **想控制单餐开销的人** | 知道月底会紧，但不知道"今天该花多少" | 用周期预算反推今日建议单餐预算，并预测这笔钱花完后的日均余量 |

**不适用**：需要营养学或医学建议的人（本项目没有营养评分，`nutrition` 恒为 `null`）、
需要下单/配送/领券的人（只读，不交易）、需要多人拼单或 AA 的场景。

---

## 使用示例

以下为**真实运行结果**，不是示意图。抓取时间 2026-10-22 上午，门店
「麦当劳广州天源路餐厅（1400359）」，数据源 `mcd-mcp`，`traceId 79ee25c0…`。

**输入**（首页一句话）：

> 今天中午只有 25 块，想吃鸡肉，不要太辣。

**解析出的条件**：午餐 · 预算上限 ¥25.00（硬上限，用户明说）· 想吃鸡肉 · 排除辣

**输出**（三份方案，全部经 `calculate-price` 官方核价）：

| 方案 | 餐品 | 官方核价 | 扣掉后还剩 | 为什么是它 |
|---|---|---|---|---|
| **均衡选择** | 东南亚风味椰香鸡扒堡组合 + 脆薯饼 | **¥18.40** | ¥6.60 | 主食 + 配餐，价格与组成折中 |
| 省钱优先 | 大脆鸡扒麦满分套餐 | ¥18.00 | ¥7.00 | 本次候选中已核价的最低完整正餐 |
| 满足优先 | 原味板烧鸡腿麦满分套餐 | ¥23.00 | ¥2.00 | 命中「鸡肉」偏好，且未超预算 |

**同一句话换到长期预算页**（`/budget`）：把 ¥18.40 记入账本后，Meal Impact 会给出
「吃这顿之前 / 之后」的日均对比，并先说结论——"这一笔花掉之后，接下来每天还能安排多少钱"。
具体金额取决于你自己设的周期预算与已记录笔数，这里不写死数字。

> 菜单与价格随门店、时段实时变化。上面是早餐时段的真实抓取，
> 换一天或换一家店，餐品和金额都会不同——这正是接入真实 MCP 的意义。

---

## 视觉规范（任务 005）

| 项 | 取值 | 说明 |
|---|---|---|
| 主色 | 珊瑚橙 `#F4713F` → `#DE5A2B` | 有食欲但不使用麦当劳官方红黄，避免身份混淆 |
| 底色 | 奶油白 `#FFFCF8` / 暖灰 `#FDF5EC` | 比纯白柔和，长时间看不刺眼 |
| 文字 | 暖调墨色 `#2A211C` / `#7C6C60` | 不用纯黑，减少冷硬感 |
| 点缀 | 薄荷绿 `#17A67C` | 只用于「已核验 / 连通 / 成功」这类正向信号 |
| 圆角 | 卡片 22~24px、控件 14~16px、胶囊 999px | — |
| 阴影 | 两级：卡片静置 / 首选方案浮起 | 不用重投影 |
| 动效 | 仅结果出现时一次 `fade-up`（0.34s） | 尊重 `prefers-reduced-motion` |

所有颜色定义在 `app/globals.css` 的 CSS 变量里，再映射进 Tailwind theme，
组件只用 `bg-brand-500` / `text-ink-500` 这类语义类名。

---

## 截图与演示

**演示入口 `/demo`**：用一次真实查询的冻结快照展示完整结果页。**不需要任何凭证**、不发起网络请求，
页面顶部有醒目的「演示数据 · 不是实时查询」横幅，与真实模式物理隔离（真实模式出错也不会回退到它）。

以下截图全部来自实际运行的页面（无头 Chrome 实拍，非设计稿）：

| 页面 | 桌面 1440 | 移动 390 |
|---|---|---|
| 首页 | [`005-home-desktop-1440.png`](docs/screenshots/005-home-desktop-1440.png) | [`005-home-mobile-390.png`](docs/screenshots/005-home-mobile-390.png) |
| 自然语言结果 | [`005-decide-desktop-1440.png`](docs/screenshots/005-decide-desktop-1440.png) | [`005-decide-mobile-390.png`](docs/screenshots/005-decide-mobile-390.png) |
| 长期预算 | [`005-budget-desktop-1440.png`](docs/screenshots/005-budget-desktop-1440.png) | [`005-budget-mobile-390.png`](docs/screenshots/005-budget-mobile-390.png) |
| Meal Impact | [`005-budget-impact-desktop-1440.png`](docs/screenshots/005-budget-impact-desktop-1440.png) | — |
| 演示模式 | [`005-demo-desktop-1440.png`](docs/screenshots/005-demo-desktop-1440.png) | [`005-demo-mobile-390.png`](docs/screenshots/005-demo-mobile-390.png) |

另有 360 / 430 / 768 三个断点的首页截图，全部在 `docs/screenshots/` 下。

---

## 技术栈

| 组件 | 版本 | 说明 |
|---|---|---|
| Next.js | 16.4.2 | App Router |
| React | 19.3.0 | — |
| TypeScript | 5.x | `strict: true` |
| Tailwind CSS | 4.x | 通过 `@tailwindcss/turbopack` |
| Node.js | 22.22.2（本机） | 需 ≥ 20.9 |
| MCP SDK | @modelcontextprotocol/sdk 1.32.1 | 官方 SDK |
| Vitest | 5.0.5 | 单元 + 集成测试 |
| Zod | 4.6.7 | 请求参数校验（任务 002 新增） |
| LLM Provider | 自研抽象（OpenAI 兼容） | 任务 004 新增，**不绑定供应商**；未配置时自动降级 |

---

## 快速开始

```bash
npm install

# 配置环境变量（真实 token 只放本地，已被 .gitignore 覆盖）
cp .env.example .env.local
#   编辑 .env.local，填入 MCD_MCP_TOKEN
#   可选：填 AI_API_KEY / AI_BASE_URL / AI_MODEL 启用大模型解析（留空则规则降级）

npm run dev               # http://localhost:3000

# 质量门禁
npm run typecheck         # next typegen + tsc --noEmit
npm run test:unit         # 单元测试（不联网，474 项）
npm run test:integration  # 真实 MCP（需要 token）
npm run build             # 生产构建
npm run verify            # typecheck + 单测 + build
```

- `/` —— **一句话决策**：输入「今天只有 25 元，想吃鸡肉，不要太辣」→ AI 解析意图 →
  真实菜单 + 官方算价 → 三个方案 + 预算影响；下方保留原有的「直接给预算」入口。
- `/budget` —— **长期预算**：建周期预算（默认 ¥900/月）→ 记一笔 / 从推荐记一笔 →
  看剩余预算、后续日均、Meal Impact，并用剩余预算 + 口味偏好去查真实菜单。
  数据存在浏览器 localStorage，没有云端同步（界面已明确提示）。
- `/demo` —— **演示模式**：没有凭证也能看到完整结果界面。数据是**一次真实查询的冻结快照**，
  全程标注「演示数据」，不发起任何网络请求；真实模式失败时不会自动回退到这里。

---

## 目录结构

```text
mealmate-ai/
├── app/
│   ├── page.tsx                      # 首页（首屏提问 → 首选方案 + 两份备选）
│   ├── budget/page.tsx               # /budget 长期预算页（静态壳）
│   ├── demo/page.tsx                 # /demo 演示模式（冻结的真实快照，不联网）
│   ├── layout.tsx / globals.css      # 全局壳 + 设计令牌（任务 005）
│   └── api/
│       ├── health/route.ts           # GET  /api/health    MCP 连接状态
│       ├── recommend/route.ts        # POST /api/recommend 单餐推荐
│       ├── ai/decide/route.ts        # POST /api/ai/decide 自然语言决策
│       └── stores/route.ts           # GET  /api/stores    门店列表
├── components/
│   ├── SingleMealDecision.tsx        # "use client" 单餐决策表单 + 状态
│   ├── RecommendationCard.tsx        # 推荐卡片
│   ├── McpStatusBadge.tsx / ModeCard.tsx
│   ├── ui/                           # 设计系统原子（无状态，可被服务端渲染）
│   │   ├── Brand.tsx                 #   品牌标 / 锁字 / Tag / StatusDot
│   │   ├── SiteHeader.tsx            #   全站页头（单餐 / 长期预算 / 演示 三入口）
│   │   └── Notice.tsx                #   分组提示块 + NoticeList + **加粗**渲染
│   ├── demo/DemoDecisionView.tsx     # 演示结果视图（不发起任何请求）
│   ├── ai/                           # "use client" 自然语言决策区
│   │   ├── NaturalLanguageDecision.tsx  # 输入 / 快捷入口 / 门店 / 预算授权 / 结果
│   │   ├── IntentSummary.tsx            # 「我理解到的需求」+ 解析模式徽标
│   │   └── AiRecommendationCard.tsx     # 单方案（价格/组成/理由/预算影响）
│   ├── budget/                       # "use client" 长期预算工作台
│       ├── BudgetWorkspace.tsx       #   状态中枢（localStorage ⇄ state）
│       ├── BudgetOverview.tsx        #   本期概览 + 双进度条
│       ├── PlanForm.tsx              #   预算计划新建/编辑
│       ├── ExpenseComposer.tsx       #   手动记一笔（防重复提交）
│       ├── ExpenseList.tsx           #   近期记录（改/删/确认）
│       ├── MealImpactPanel.tsx       #   Meal Impact 交互预测
│       ├── BudgetRecommend.tsx       #   剩余预算 + 口味偏好 → 真实推荐 → 记为已消费
│       └── ImpactSummary.tsx
├── lib/
│   ├── mcp/
│   │   ├── client.ts                 # MCP 握手 / 超时 / 信封解析
│   │   ├── mcd-adapter.ts            # 麦当劳适配器 + 纯函数归一化
│   │   └── redact.ts                 # 脱敏（无外部依赖）
│   ├── ai/                           # 任务 004：只在服务端运行
│   │   ├── types.ts                  #   意图/预算裁决/响应契约（客户端可引）
│   │   ├── intent-schema.ts          #   模型输出白名单校验 + 敏感字段 strip
│   │   ├── parse-intent.ts           #   规则解析 + 提示词 + 注入检测 + 合并
│   │   ├── provider.ts               #   LLM Provider 抽象（OpenAI 兼容）
│   │   ├── decision-agent.ts         #   编排：校验→意图→预算→推荐→组装
│   │   ├── response-builder.ts       #   理由/影响/必须展示的限制
│   │   ├── request-schema.ts         #   /api/ai/decide 请求校验
│   │   └── index.ts                  #   服务端统一导出
│   ├── ui/api-error.ts               # 错误码 → 人话 + 脱敏（客户端可引）
│   ├── demo/sample-decision.ts       # 演示数据（一次真实查询的冻结快照）
│   ├── providers/meal-provider.ts    # Provider 抽象 + 工厂
│   ├── budget/
│   │   ├── money.ts                  # 元 ↔ 分、整数求和、带符号展示
│   │   ├── types.ts                  # 预算/账本/影响预测类型契约
│   │   ├── period.ts                 # 纪元日运算 + 时区→日历日 + 周期推算
│   │   ├── ledger.ts                 # 账本纯函数（幂等、去重、周期归属）
│   │   ├── forecast.ts               # Meal Impact（单笔消费影响）
│   │   ├── budget-engine.ts          # 概览 / 建议单餐预算 / 推荐价→影响
│   │   ├── storage.ts                # localStorage（版本号 + 逐条容错）
│   │   ├── schema.ts                 # Zod 校验 + 金额输入解析
│   │   └── meal-link.ts              # 推荐 → 消费草稿
│   ├── recommendation/
│   │   ├── types.ts                  # 请求/响应/候选/评分类型（含 avoidTags）
│   │   ├── filters.ts                # 餐品角色分类 + 确定性排除 + 候选构造
│   │   ├── scoring.ts                # 四维评分 + 三方案权重
│   │   ├── engine.ts                 # 流程编排（含逐个算价核验）
│   │   ├── explain.ts                # 推荐理由生成
│   │   ├── schema.ts                 # Zod 校验
│   │   └── index.ts                  # 统一导出
│   └── api/
│       ├── http.ts                   # 统一响应 / 错误收敛 / 超时
│       └── rate-limit.ts             # 进程内滑动窗口限流
├── types/                            # meal.ts（领域模型） / mcp.ts（传输层）
├── tests/
│   ├── fixtures/                     # 真实抓取的上游返回
│   ├── helpers/                      # env.ts / fake-provider.ts / fake-llm.ts
│   ├── unit/                         # 474 项（不联网）
│   └── integration/                  # 真实 MCP（无 token 时整组 skip）
└── docs/
    ├── 01-mcp-integration.md         # MCP 契约与字段映射
    ├── 02-recommendation-report.md   # 任务 002 交付报告
    ├── 03-budget-report.md           # 任务 003 交付报告
    ├── 04-ai-agent-report.md         # 任务 004 交付报告
    ├── 05-ui-report.md               # 任务 005 交付报告（视觉 / 交互 / 演示模式）
    ├── 06-release-audit.md           # 任务 006 发布审计（凭证 / 仓库 / 许可 / 门禁）
    ├── screenshots/                  # 桌面/移动端真实截图
    └── decisions.md                  # 架构决策记录
```

---

## 单餐推荐是怎么算的

```text
限流 → 校验 → query-nearby-stores（可选）→ query-meals
     → 餐品角色分类（剔除周边/酱料/甜点/单点饮料/多人餐）
     → 构造候选（套餐 / 单主食 / 主食+配餐 / 主食+饮料）
     → 预算粗筛 → calculate-price 逐个核验 → 超预算就剔除换下一个
     → 三方案各取一条（主 SKU 不重复、优先不同分类）
```

**三个方案**

| 方案 | 取向 | 关键权重 |
|---|---|---|
| 省钱优先 | 预算内最便宜的**完整正餐** | priceFit 0.78 |
| 均衡选择 | 价格与餐品组成的折中（先试套餐/主食+配餐） | completeness 0.45 |
| 满足优先 | 尽量命中口味偏好，不超预算 | preference 0.52 |

**四条硬规矩**

1. 酱料、单点饮料、甜品、周边、多人餐**都不算一顿饭**，宁可返回 0 条也不凑数。
2. 菜单标价只是粗筛，`calculate-price` 的官方算价才是结论；两者不一致时**以算价为准**并标记。
3. 三种方案尽量用不同 SKU；候选不足就返回实际数量（并告警），不硬凑三条。
4. 营养数据不参与任何判断（见下）。

---

## 长期预算是怎么算的

```text
预算计划（总额 / 预留 / 周期 / 时区 / 每日餐次）
   → 账本（planned 不扣预算，confirmed 才扣）
   → 概览（已花、剩余、可支配、剩几天、日均、消费进度 vs 时间进度）
   → Meal Impact（这一笔花下去，消费后余额与后续日均）
   → 剩余预算 → 建议单餐预算 → /api/recommend（真实菜单 + 官方算价）
   → 用户点「记为已消费」并确认实付金额 → 才写入账本
```

**四条硬规矩**

1. **推荐结果绝不自动进账本**：点「查看推荐」只读查询，扣预算必须用户显式确认。
2. **`planned` 不扣预算**：只有 `confirmed` 进入"已花"，`planned` 只做前瞻。
3. **金额全程整数分**，除法前先判分母：剩余天数为 0 时日均返回 `null`，不产生 NaN/Infinity。
4. **"均衡"这些词只用在本来的含义上**：不假设"今天只有一餐"（`mealsLeftToday` 是显式入参），
   也不对消费做任何价值评价（只陈述余额与日均，附预测前提）。

**Meal Impact 公式**

```text
消费前日均 = 可支配(剩余 - 预留) / 剩余天数
消费后余额 = 剩余 - 本次消费 - 今天其它餐费
消费后日均 = 消费后可支配 / (本次覆盖今天 ? 剩余天数-1 : 剩余天数)
```

> 消费低于原日均时，日均会"反向上升"（剩余钱摊到更少天数）——这是平摊模型的算术结果，界面上有说明。

**数据持久化**

- localStorage，键 `mealmate.budget.v1`，带 `version` 字段；
- 读到损坏数据/未知版本 → 拒绝读取并提示，**逐条**丢弃坏条目（一条坏记录不会毁掉整份账本）；
- 隐私模式 / 禁用存储 → 退化为内存态并明确提示"刷新会丢"；
- 页面固定声明：只存在当前浏览器，**没有云同步、没有跨设备、不会自动读银行账单**。

---

## AI 决策是怎么走的（任务 004）

一句话：**大模型只负责"听懂"，确定性代码负责"算清"，MCP 负责"真实"。**

```text
自然语言（≤500 字）
  → 注入检测（命中就直接不调模型）
  → 意图解析：规则通道 + LLM 通道（可缺省）
      · LLM 输出经 Zod 白名单校验；不合法 → 整条丢弃并降级
      · 合并时规则明确的硬上限/目标不会被模型默认值覆盖；排除项取并集
  → 预算裁决：用户说的 > 计划建议 > 上下文上限 > 默认 ¥25
      然后被「用户已设上限」和「接口 ¥5~¥200」夹一遍（**只能下调**）
  → RecommendationEngine（任务 002 同一个引擎）
      · avoidTags 走 filterMenu 的确定性过滤，命中即不进候选池
      · 逐个 calculate-price 核验，超预算剔除
  → computeMealImpact（任务 003 同一个函数）
  → 响应：意图 + 三方案 + 预算影响 + 必须展示的限制
```

四条不可让渡的约定：

1. **模型不产出数据**：`ParsedIntent` 里没有价格/菜品/优惠券/营养字段，模型想编也没地方放；
2. **排除不是降分**：`不吃辣` 在过滤阶段就剔除，被排除的餐品连算价都不会发起；
3. **说不准就说不准**：`不吃辣` 只能保证"名称含辣的不推荐"，接口没有配料表，所以每次都会附带
   `EXCLUSION_NOT_GUARANTEED` 免责说明，**从不宣称"绝对不含"**；
4. **AI 不写任何东西**：`lib/ai` 里没有账本写函数、没有下单/支付/领券工具；
   用户说"这个月还剩 300 元"只作为提示，账本不会被改动。

没有配置 `AI_API_KEY` 时自动进入**规则解析模式**（`mode: "RULE_FALLBACK"`），
只识别预算、餐次、口味、排除、目标、周期剩余等有限条件，页面与接口都会明确标注，
不会冒充大模型的语义理解能力。

### 启用大模型（可选，不配也能跑）

在 `.env.local` 里补三行即可（都是**服务端专用**，切勿加 `NEXT_PUBLIC_` 前缀）：

```bash
AI_API_KEY=sk-xxxx
AI_BASE_URL=https://api.openai.com/v1   # 任何 OpenAI 兼容端点
AI_MODEL=gpt-4o-mini
```

改完重启 dev server，然后确认它真的生效：

```bash
curl -s -X POST http://localhost:3000/api/ai/decide \
  -H "Content-Type: application/json" \
  -d '{"text":"25块以内想吃鸡肉","context":{"city":"广州市","storeCode":"1400359"}}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.mode, JSON.stringify(j.ai))})"
```

| 输出 | 含义 |
|---|---|
| `LLM {"model":"…","elapsedMs":…}` | 真实模型已生效 |
| `RULE_FALLBACK {"fallbackReason":"未配置 AI_API_KEY"}` | 没读到密钥（检查变量名与是否重启） |
| `RULE_FALLBACK {"fallbackReason":"HTTP_ERROR：调用模型服务失败"}` | 密钥或端点不可用 |
| `RULE_FALLBACK {"fallbackReason":"TIMEOUT：模型调用超过 12000ms 未返回，已中止"}` | 超过 `AI_TIMEOUT_MS` |

**降级不会让接口失败**：无密钥、端点不可达、超时、返回非 JSON、字段不合白名单，
都只会退回规则解析，接口仍是 `200` 并照常返回三份真实推荐——只是 `mode` 与
`fallbackReason` 会如实写出来。模型的原始输出不会透给前端。

---

## API

### `POST /api/ai/decide`

```json
{
  "text": "今天只有 25 元，想吃鸡肉，不要太辣",
  "context": {
    "city": "广州市",
    "keyword": "天河",
    "storeCode": "1400359",
    "orderType": 1,
    "beType": 1,
    "mealsLeftToday": 2,
    "budget": { "authorized": true, "hardCapFen": 2500, "remainingFen": 82540, "daysRemaining": 11, "reserveFen": 0 }
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `text` | **是** | 1~500 字，超长直接 413（不截断，避免丢掉后半句的硬上限） |
| `context.storeCode` | **是**（要查真实菜单时） | 3~12 位数字 |
| `context.city` / `keyword` | 否 | 与 `/api/recommend` 一致 |
| `context.preferences` / `avoid` | 否 | 白名单：汉堡 / 鸡肉 / 牛肉 / 猪肉 / 鱼 / 辣 |
| `context.mealsLeftToday` | 否 | 1~4；**不传就不假设这一餐覆盖今天** |
| `context.budget.authorized` | **必须为 `true`** | 用户显式授权；否则整块预算上下文被忽略 |
| `context.budget.*Fen` | 否 | 用户带来的数据，服务端按不可信输入重新校验（越界/非整数直接丢弃） |

响应：`mode`（`LLM` / `RULE_FALLBACK`）、`ai`（模型名/耗时/usage/降级原因）、`intent`、
`understood`、`budget`（`appliedFen` / `source` / `clampedByContext` / `explanation`）、
`recommendations[]`（含 `impact` 预算影响与 `fitNotes` 契合点）、`priceVerification`、
`clarification`、`caveats`（**必须展示的前提与限制**）、`source`、`warnings`、`emptyReason`。

限流 **10 次/分钟/IP**；整体超时 45s。错误码与 `/api/recommend` 共用一套，
**模型故障不产生错误码**——只会让 `mode` 变成 `RULE_FALLBACK`。

### `POST /api/recommend`

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

| 字段 | 必填 | 说明 |
|---|---|---|
| `budgetFen` | 否（默认 2500） | 整数分，500 ~ 20000 |
| `city` | 否（默认 广州市） | — |
| `keyword` | 否 | 商圈/地标；**不传就拿不到门店名**（上游查门店必须有它） |
| `storeCode` | **是** | 3~12 位数字 |
| `orderType` / `beType` | 否（默认 1） | 本期只支持 1（到店自提），其他值直接 400 |
| `preferences` | 否 | 白名单：汉堡 / 鸡肉 / 牛肉 / 鱼 / 辣 |
| `avoidTags` | 否 | 白名单：汉堡 / 鸡肉 / 牛肉 / 猪肉 / 鱼 / 辣。**确定性排除**（任务 004 新增，可选，向后兼容） |
| `excludeCategories` | 否 | 按分类名排除（包含匹配） |
| `maxResults` | 否 | 1~3 |

响应含 `recommendations[]`（`totalPriceFen` / `priceVerified` / `priceMismatch` / `reason` / `highlights`）、
`source`（门店、抓取时间、上游业务时间、traceId、**实际调用过的工具**）、`stats`、`warnings`、`emptyReason`。

错误码：`INVALID_REQUEST`(400) / `RATE_LIMITED`(429) / `MISSING_TOKEN`(503) / `MCP_TIMEOUT`(504) / `MCP_UNAVAILABLE`(502) / `MENU_UNAVAILABLE`(502) / `INTERNAL`(500)。

### `GET /api/stores?city=广州市&keyword=天河`

返回真实门店列表。缺 `keyword` 会 400 并说明"上游只给城市时无法查询门店"（实测上游返回 `600058`）。

### `GET /api/health`

MCP 连接状态：服务端名、工具总数（35）、是否缺必需工具、握手耗时。

---

## 两条硬性约定

### 1. 价格单位统一为整数「分」

- `query-meals` 返回**元字符串**（`"13.9"`）→ 适配器 `yuanToFen()` 逐位解析成 `1390`；
- `calculate-price` 返回**整数分**（`1390`）→ 原样使用并断言必须是整数；
- 业务层、API 全部用分（字段名以 `Fen` 结尾），元只在展示层 `formatFen()` 出现。

禁止 `parseFloat(price) * 100`：浮点误差会让预算累计算出"多一分钱"。

### 2. 营养数据不与菜单 SKU 关联

`list-nutrition-foods` 只有 `productName`，菜单是 `code` + `name`，两者**无可靠公共键**。
因此 `MealItem.nutrition` 恒为 `null`，评分函数里没有营养维度。
**"均衡"只代表价格与餐品组成的折中，不代表营养均衡**——文案里写死了这句话，也有用例守着。

---

## 测试

| 类型 | 命令 | 是否联网 | 规模 |
|---|---|---|---|
| 金额换算 | `npm run test:unit` | 否 | 9 |
| 菜单/门店/算价归一化 | `npm run test:unit` | 否（真实 fixture） | 23 |
| 安全（token 不落盘/不出前端） | `npm run test:unit` | 否 | 12 |
| 推荐：分类/过滤/候选 | `npm run test:unit` | 否 | 38 |
| 推荐：评分/权重/排序 | `npm run test:unit` | 否 | 13 |
| 推荐：引擎主流程/故障/凑数 | `npm run test:unit` | 否 | 30 |
| 请求校验 | `npm run test:unit` | 否 | 21 |
| 限流 | `npm run test:unit` | 否 | 7 |
| 预算：周期/时区/跨年 | `npm run test:unit` | 否 | 22 |
| 预算：账本/幂等/改删 | `npm run test:unit` | 否 | 20 |
| 预算：Meal Impact | `npm run test:unit` | 否 | 16 |
| 预算：概览/建议单餐预算 | `npm run test:unit` | 否 | 28 |
| 预算：本地存储/损坏/金额解析 | `npm run test:unit` | 否 | 23 |
| 预算 × 推荐联动 + 旧 API 兼容 | `npm run test:unit` | 否 | 8 |
| 真实 MCP 连接 | `npm run test:integration` | **是** | 6 (+1 skip) |
| 真实单餐推荐（25 元 / 10 元） | `npm run test:integration` | **是** | 5 (+1 skip) |
| 真实预算 → 建议预算 → 推荐 → 影响 | `npm run test:integration` | **是** | 6 (+1 skip) |
| AI 意图：规则抽取/硬软预算/否定/澄清 | `npm run test:unit` | 否 | 22 |
| AI 意图：模型输出 Schema 校验 | `npm run test:unit` | 否 | 13 |
| AI：Provider（超时/HTTP/JSON 提取） | `npm run test:unit` | 否 | 13 |
| AI：解析通道（注入拦截/降级/合并） | `npm run test:unit` | 否 | 17 |
| AI：预算裁决 + 上下文清洗 | `npm run test:unit` | 否 | 17 |
| AI：决策 Agent 端到端（fixture 真实菜单） | `npm run test:unit` | 否 | 28 |
| AI：请求校验 + 旧接口兼容 | `npm run test:unit` | 否 | 18 |
| AI：安全边界静态扫描 | `npm run test:unit` | 否 | 14 |
| AI：004-A 验收缺陷回归（否定/双金额/¥3/历史/账本口径） | `npm run test:unit` | 否 | 19 |
| 真实自然语言 → MCP → 推荐 → 影响 | `npm run test:integration` | **是** | 9 |
| UI：文案契约（首屏/卡片五要素/诚实性措辞） | `npm run test:unit` | 否 | 13 |
| UI：设计令牌 / 禁用官方色 / 断点 | `npm run test:unit` | 否 | 10 |
| UI：演示模式与真实模式物理隔离 | `npm run test:unit` | 否 | 10 |
| UI：错误码 → 人话 / 详情脱敏 | `npm run test:unit` | 否 | 10 |
| 浏览器 E2E（8 条流程 + 响应式 + 演示） | `node ../_e2e-005.mjs` | **是** | 69 断言 |

单测合计 **474**（任务 002 的 153 + 任务 003 的 117 + 任务 004 的 142 + 004-A 新增 19 + 任务 005 新增 43，全部通过）。
集成合计 **26 passed / 3 skipped**。
`skip` 的都是"没有 token 时"的占位断言，有 token 时按设计跳过，不是把未执行算作通过。

浏览器 E2E 需要先 `npx next start -p 3100`，脚本在项目外的上一级目录（`../_e2e-005.mjs`），
用 CDP 驱动本机 Chrome，产出 `docs/screenshots/005-*.png`。最近一次：**69 PASS / 0 FAIL**（任务 006 复核）。

`tests/fixtures/*.json` 均为真实接口抓取（文件内 `_note` 记录抓取参数）。
没有 token 时集成测试整组 skip，报告里记"未验证"，不用 mock 冒充真实结果。

---

## 已知限制

1. **必须"城市 + 商圈关键词"才能查门店**：上游只给城市会返回 `600058`；不传 keyword 时仍可推荐，但门店名为空。
2. **报价不含优惠券**：`auto-bind-coupons` 属写操作，本期禁止调用；推荐价是"不用券的实付价"。
3. **营养维度缺席**：无关联键，不能宣称热量/营养均衡；需要先建人工审核的别名映射表。
4. **餐品角色是关键词启发式**：不认识的新品会落到 `unknown` 而不被推荐（宁可不推，也不误推）。
5. **限流是进程内的**：多副本部署时各自计数，生产需换 Redis / 网关限流。
6. **只支持到店自提**：外送 / 得来速需要 `beCode`，本期未实现。
7. **单请求最多 12 次算价**（3 方案 × 4 候选），极端情况下会放弃某个方案以保住响应时间。
8. **`query-meals` 不返回门店名**，需要调用方用 `query-nearby-stores` 回填。
9. **预算数据不能跨设备**：localStorage 是单浏览器存储，清缓存 / 隐私模式 / 换设备都会丢；没有账号与云端同步。
10. **日均可能"反向上升"**：本次消费低于原日均时，剩余预算摊到更少天数，日均变高（平摊模型的算术结果，不是 bug）。
11. **套餐内容待选的 SKU 只能给起价**：随心配 / 1+1 / 任选类套餐的组成需在点餐时选，记账时必须由用户填实付金额。
12. **预算计划不会自动结转**：月末不自动生成下月计划，避免未经确认就改动用户账本。
13. **AI 当前跑在规则降级模式**：本仓库未配置 `AI_API_KEY`，意图解析由正则完成，能覆盖任务列出的 10 类表达，但不具备跨句推理能力；配置 Key 后自动切到 LLM，需重新验收。
14. **排除只能按菜单名称**：上游没有配料/辣度字段，`不吃辣` 只能剔除名称含"辣"的餐品，无法保证配料里没有辣——每次都会附带免责说明，从不宣称"绝对不含"。
15. **过敏原完全无数据**：不查询、不推断、不保证；用户提到过敏时只提示"无法确认，请向门店核实"。
16. **程度词按"整类排除"处理**：`不要太辣` 会被当成"不吃辣"（宁严不宽），对"可以微辣"的用户属于过度限制。
