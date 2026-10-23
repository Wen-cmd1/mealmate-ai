# 任务 006 交付报告 —— 发布审计、GitHub 开源准备与参赛交付

> **版本**：v0.5.0（审计后未升版，未新增功能）
> **审计时间**：2026-10-22 08:20 ~ 08:55（GMT+8）
> **审计对象**：`mealmate-ai/` 工作树（尚未有任何提交）
> **范围声明**：不新增产品功能，不重写 MCP / 推荐 / AI / 预算引擎。
> **未执行**：`git push`、创建远端仓库、部署、比赛报名、任何付费操作。
> **本报告不含任何凭证明文**：Token / Key 只以「键名 + 是否设置 + 长度」的形式出现。

---

## 0. 审计结论（先给结论，后面是依据）

| 项目 | 结果 |
| --- | --- |
| 真实凭证泄露 | **0 处**（用 `.env.local` 里的真实 token 反查全部文本文件（不含 `node_modules` / `.next*`）） |
| 会被误提交的敏感文件 | **0 个**（`.env.local` 命中 `.env*`，`.next.bak-*` 已补规则后命中） |
| 门禁 | typecheck ✅ / 单测 **474** ✅ / 集成 **26 通过 + 3 跳过** ✅ / build ✅ / 浏览器 E2E **69 通过 0 失败** ✅ |
| 审计中发现并修掉的真问题 | **4 个**（忽略规则缺失、锁文件版本不一致、文档含本机路径、2 处「写死份数」的界面文案与栅格） |
| 审计中发现并修掉的测试缺陷 | **2 个**（集成用例与 E2E 断言耦合了实时菜单，会随菜单调价随机变红） |
| 仍未解决 | 5 项，见 §7；其中 **LICENSE 待你决定**、**真实大模型未验收** |
| **最终结论** | **有条件可发布**（条件见 §8） |

---

## 1. 发布风险分级

分级标准：**P0** = 一旦公开就造成凭证泄露 / 法务问题 / 数据错误，必须修完才能推；**P1** = 公开发布前应当解决；**P2** = 影响体验或维护成本；**P3** = 可选优化。

| 编号 | 风险 | 级别 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| R-01 | `.gitignore` 未覆盖 `.next.bak-*`，3 个备份共 **178MB** 会被 `git add` 带进仓库 | **P0** | ✅ 已修 | 补 `/.next.bak-*/` 与 `/.next.bak`；已用 `git check-ignore` 验证 `.next.bak-006/006b/006c` 全部命中 |
| R-02 | `package-lock.json` 版本停留在 `0.1.0`，与 `package.json` 的 `0.5.0` 不一致 | **P1** | ✅ 已修 | `npm install --package-lock-only` 同步为 `0.5.0`；依赖声明未变（逐项比对通过） |
| R-03 | `docs/03-budget-report.md` 头部写了本机绝对路径（`C:\Users\<用户名>\…\mealmate-ai`） | **P1** | ✅ 已修 | 改为 `mealmate-ai/`（仓库根目录）；复扫后「本机绝对路径」为 0 处 |
| R-04 | 集成用例「10 元预算一定返回 0 条」与**实时菜单**耦合 | **P1** | ✅ 已修 | 2026-10-22 门店出现 ¥9.90 主食，断言当场变红。改为断言不变量，见 §6.3 |
| R-05 | E2E 断言「必须 3 份方案」与实时候选数耦合 | **P1** | ✅ 已修 | ¥18 预算实测只给 2 份（引擎「不凑数」），断言改为 1~3 份，见 §6.4 |
| R-06 | 界面写死「另外两份备选」：只剩 1 份备选时文案说谎 | **P1** | ✅ 已修 | 改为按实际份数，1 份时「另一份备选」 |
| R-07 | 单餐结果区写死 `md:grid-cols-3`：只有 2 份时右侧留空洞 | **P2** | ✅ 已修 | 按份数切 `md:grid-cols-2` / `md:grid-cols-3`，截图见 §6.5 |
| R-08 | **无 `LICENSE`**：公开仓库默认「保留所有权利」，复用者无法合法使用 | **P1** | ⏳ 待决定 | 候选与兼容性分析见 §5.1；**未擅自创建** |
| R-09 | **真实大模型未验收**：环境无 `AI_API_KEY`，所有验证都在规则降级路径 | **P1** | ⏳ 待决定 | 配置路径与降级已验证（§4），但「大模型解析」这条卖点未经真实模型回归 |
| R-10 | E2E 脚本在仓库**外**（`../_e2e-005.mjs`）且硬编码 Chrome 路径、截图输出目录、端口 | **P2** | ⏳ 待决定 | 直接放进仓库会把本机路径带进公开代码；需先参数化 |
| R-11 | 依赖含 **LGPL-3.0**（`@img/sharp-*`）、**MPL-2.0**（`lightningcss`）、**CC-BY-4.0**（`caniuse-lite`） | **P2** | 📄 已分析 | 源码分发无影响；若将来打包二进制分发需附声明，见 §5.2 |
| R-12 | 截图含真实门店名「麦当劳广州天源路餐厅（1400359）」与真实价格 | **P3** | 📄 已评估 | 均为公开可查信息，不含个人信息、不含凭证；保留可增加可信度 |
| R-13 | `public/` 下 5 个 `create-next-app` 默认 SVG 未被任何页面引用 | **P3** | ⏳ 未动 | 属清理项，按「不删东西」约定留给你决定 |
| R-14 | `package.json` 无 `engines` 字段，而 README 声明 Node ≥ 20.9 | **P3** | ⏳ 未动 | 建议补 `"engines": { "node": ">=20.9" }`，避免低版本 Node 报错难懂 |
| R-15 | `AGENTS.md` 是 `next dev` 自动生成并会自动重写的文件 | **P3** | 📄 已确认 | 内容为 Next 16 的 agent 提示，无敏感信息，可提交 |

**P0 清零**。剩余项全部是「需要你决策」或「可选优化」，没有我必须擅自处理才能继续的阻塞。

---

## 2. 凭证与忽略规则审计

### 2.1 `.env.local` 实际内容（只报键名）

| 变量 | 是否设置 | 长度 | 用途 | 是否服务端专用 |
| --- | --- | --- | --- | --- |
| `MCD_MCP_URL` | 已设置 | 18 | MCP 端点 | 是 |
| `MCD_MCP_TOKEN` | **已设置** | 32 | MCP 鉴权 | **是（绝不能加 `NEXT_PUBLIC_`）** |
| `MCD_MCP_TIMEOUT_MS` | 已设置 | 5 | 超时 | 是 |
| `MCD_DEFAULT_STORE_CODE` | 已设置 | 7 | 默认门店 | 是 |
| `MEAL_PROVIDER` | 已设置 | 7 | 数据源 | 是 |
| `AI_API_KEY` | **未设置（键都不存在）** | — | 大模型 | — |

**结论**：唯一的真凭证是 `MCD_MCP_TOKEN`（32 位）。`AI_API_KEY` 完全缺失，这就是 `mode` 恒为 `RULE_FALLBACK` 的直接原因。

### 2.2 真实 token 反查（最强检查）

做法：从 `.env.local` 读出 token 值，逐个扫描项目内全部文本文件（排除 `node_modules` / `.next*` / `.git`），匹配**完整值**。

```
待反查的敏感变量：MCD_MCP_TOKEN
✓ 未在任何文件中发现真实凭证值
```

**这是「零泄露」的直接证据**——不是"看起来没有"，是把真值拿去搜了一遍。

### 2.3 模式扫描（12 处命中，逐条判定）

| 位置 | 命中类型 | 判定 |
| --- | --- | --- |
| `.env.local:2` | `MCD_MCP_TOKEN=<32 位>` | **这是环境文件本身**，已被 `.env*` 忽略；不进仓库 |
| `README.md:321` | `AI_BASE_URL=https://api.openai.com/v1` | 公开示例 URL，非凭证 |
| `tests/unit/ai-provider.test.ts` ×4 | `"sk-test-***"` 一类伪造值 | 显式伪造的测试值，一眼可辨 |
| `tests/unit/ai-decision-agent.test.ts:427` | `"sk-should-never-appear"` | 用例本身就是「响应里不能出现凭证」 |
| `tests/unit/recommendation-engine.test.ts:332` | `"fake-token-for-test-***"` | 伪造值，用例验证「响应 JSON 无 token」 |
| `tests/unit/security.test.ts:182` | `Bearer ABCDEFGHIJ…` | 脱敏函数的测试输入 |
| `docs/decisions.md`、`lib/mcp/redact.ts`、`lib/ui/api-error.ts` | 含 `Bearer` 字样 | 脱敏**实现**，必须出现 |

**判定：12 处全部为「模板 / 测试假值 / 脱敏实现」，无真实凭证。**
（计数与正则写法相关，真正的依据是上表逐条核对，不是那个数字。）

### 2.4 日志是否泄露凭证（实测）

用一份**无效**的假 key（`sk-audit-invalid-key`）起了一个临时实例并发起真实请求，然后看服务端日志：

```
▲ Next.js 16.4.2
- Local: http://localhost:3102
✓ Ready in 538ms
✓ Running next.config.ts took 97ms
```

日志里**没有**出现 key、没有出现 `Authorization`、没有出现上游 URL。响应体里 `fallbackReason` 也只有
`HTTP_ERROR：调用模型服务失败`——不含端点、不含状态码细节。

### 2.5 `.gitignore` 改动（本任务唯一改的忽略规则）

```diff
  # next.js
  /.next/
  /out/
+
+ # 构建备份（本机 safe-delete 保护下的「只挪不删」产物，任务 005/006）
+ # 每次构建会留 ~60MB，绝不能进仓库
+ /.next.bak-*/
+ /.next.bak
```

验证（`git check-ignore -v`）：

| 路径 | 命中规则 | 结论 |
| --- | --- | --- |
| `.env.local` | `.gitignore:39:.env*` | 忽略 ✅ |
| `.next.bak-006` / `006b` / `006c` | `.gitignore:22:/.next.bak-*/` | 忽略 ✅（修复前会被提交） |
| `node_modules` | `.gitignore:4:/node_modules` | 忽略 ✅ |
| `tsconfig.tsbuildinfo` | `.gitignore:45:*.tsbuildinfo` | 忽略 ✅ |
| `.env.example` | 被 `!.env.example` 放行 | **提交**（应有） |

### 2.6 构建备份现状（只统计，未删除）

| 目录 | 体积 | 说明 |
| --- | --- | --- |
| `.next.bak-004a` ~ `004a4` | 约 240MB | 任务 004 期间产生 |
| `.next.bak-005` / `005b` / `005c` | 58 / 60 / 60 MB | 任务 005 期间产生 |
| `.next.bak-006` / `006b` / `006c` | 本次审计的三次构建 | 由本任务产生 |

全部留在盘上，**一个都没删**。它们已被忽略，不影响仓库体积；是否清理由你决定。

---

## 3. 仓库状态及可提交文件检查

### 3.1 审计前状态

```
$ git rev-parse --show-toplevel
fatal: not a git repository (or any of the parent directories): .git
$ ls -d ../.git ../../.git
上层无 .git
```

**确认：既不是仓库，也没有被任何上层仓库包含。** 没有历史提交、没有远端、没有分支 → 不存在"误推历史里的密钥"这类问题。

### 3.2 初始化（按 §2.6，先确认再执行）

前置确认三条全部通过后才执行：

1. 工作区确认——项目根目录就是 `mealmate-ai/`，根下无 `.docx/.pdf/.xlsx/.zip/.key/.pem` 等杂项文件；
2. 忽略规则确认——§2.5 已验证 `.env.local` / `.next.bak-*` / `node_modules` / `*.tsbuildinfo` 全部命中；
3. 敏感文件清单确认——唯一敏感文件是 `.env.local`，且已忽略；真实 token 反查 0 命中。

```bash
$ git init -b main
Initialized empty Git repository in C:/…/mealmate-ai/.git/
```

| 项 | 值 |
| --- | --- |
| 分支 | `main` |
| 提交数 | **0**（未提交任何内容） |
| 远端 | **0**（未配置） |
| 待纳入版本控制 | **154 个文件 / 7.17 MB**（新增本报告后 155） |

> **没有**创建 GitHub 仓库、**没有** `git add`、**没有** `git commit`、**没有** `git push`。

### 3.3 可提交文件分布

| 目录 | 文件数 | 说明 |
| --- | --- | --- |
| `tests/` | 38 | 单测 + 集成 + fixture + helpers |
| `docs/` | 38 | 01~06 报告、截图 33 张、decisions |
| `lib/` | 33 | MCP / 推荐 / 预算 / AI / UI |
| `components/` | 19 | 页面组件 |
| `app/` | 10 | 路由 + API |
| `public/` | 5 | 未使用的默认 SVG（R-13） |
| 根目录 | 11 | package.json / lock / README / AGENTS / .gitignore / .env.example 等 |

**体积**：7.17MB，最大单文件 394KB（`005-budget-recorded-desktop-1440.png`）——没有超过 GitHub 100MB 硬限制，也没到需要 Git LFS 的程度。

### 3.4 二进制资产逐项检查

33 个二进制文件（全部 `docs/screenshots/*.png` + `app/favicon.ico`）：

- 全部是**实际运行页面**的 CDP 截图，不含浏览器地址栏、不含开发者工具、不含 token 输入框；
- 页面本身从不渲染 token（`security.test.ts` 与 `ui-copy.test.ts` 双重静态断言）；
- 截图中的 `实时菜单已连接 · 1998ms` 只显示**耗时**，不显示令牌或端点。

### 3.5 fixture 检查

| 文件 | 内容性质 | 判定 |
| --- | --- | --- |
| `query-meals-1400359.json` | 门店菜单与标价，含 `_note` 记录抓取参数 | ✅ 公开商品信息 |
| `query-nearby-stores-guangzhou.json` | 门店名 / 地址 / 经纬度 | ✅ 公开商户信息；**无电话、无手机号**（正则实测 0 命中） |
| `calculate-price-1440.json` | 单次算价返回 | ✅ |
| `list-nutrition-foods.json` | 营养表字符串 | ✅ |

### 3.6 依赖与锁文件一致性

| 检查 | 结果 |
| --- | --- |
| `lockfileVersion` | 3 |
| 修复前 `lock.version` / `packages[""].version` | `0.1.0` / `0.1.0` ❌ 与 `package.json` 的 `0.5.0` 不一致 |
| 修复后 | `0.5.0` / `0.5.0` ✅ |
| `dependencies` 逐项比对 | OK（5 项完全一致） |
| `devDependencies` 逐项比对 | OK（7 项完全一致） |
| `package.json` 是否声明 `engines` | ❌ 未声明（见 R-14） |
| `private: true` | ✅ 保留——防止误 `npm publish`，Web 应用不需要发布到 npm |

---

## 4. LLM 就绪性与验证边界

### 4.1 配置说明是否够清楚

**修复前**：`.env.example` 的注释很完整（6 个 AI 变量逐个说明、含 `NEXT_PUBLIC_` 红线警告），
但 README 只有一句「可选：填 AI_API_KEY / AI_BASE_URL / AI_MODEL 启用大模型解析」——
**没有说怎么确认它真的生效**。这是开源项目最常见的问题：用户填了 key，页面还是「规则解析」，然后来提 issue。

**修复**：README 新增「启用大模型（可选，不配也能跑）」小节，给出三行配置 + 一条可直接粘贴的自检命令 + 4 种输出的含义对照表（`LLM` / 未配置 / HTTP_ERROR / TIMEOUT）。

### 4.2 无 Key 时降级是否正常（实测，不是推断）

```bash
POST /api/ai/decide
{"text":"今天中午只有 25 块，想吃鸡肉，不要太辣。","context":{"city":"广州市","storeCode":"1400359"}}
```

| 观测项 | 实测值 |
| --- | --- |
| HTTP 状态 | **200**（不是 500） |
| `mode` | `RULE_FALLBACK` |
| `ai.fallbackReason` | `未配置 AI_API_KEY` |
| `recommendations` | 3 份，全部 `priceVerified: true` |
| 价格 | ¥18.40 / ¥18.00 / ¥23.00（均 ≤ ¥25.00） |
| `source.toolsUsed` | `query-meals`, `calculate-price` |
| `source.traceId` | 有（32 位，非凭证） |
| `priceVerification` | `quotesUsed: 5, verifiedCount: 3, allVerified: true` |
| `warnings` | `RULE_FALLBACK` + `EXCLUSION_NOT_GUARANTEED`（文案如实说明「当前为规则解析模式」） |
| 耗时 | 2095ms |

**结论：无密钥时接口照常工作，降级状态在接口与页面双处如实标注。**

### 4.3 「配置了但不可用」是否也优雅降级（实测）

用假 key + 不可达端点（`http://127.0.0.1:9/v1`）起临时实例：

| 观测项 | 实测值 |
| --- | --- |
| HTTP 状态 | **200**（不是 502/500） |
| `mode` | `RULE_FALLBACK` |
| `ai.fallbackReason` | `HTTP_ERROR：调用模型服务失败` |
| `recommendations` | 3 份，仍全部核验通过 |
| 是否泄露端点/状态码/key | **否**（`fallbackReason` 只有一句人话） |
| 服务端日志是否含 key | **否** |

> 过程中的一个坑：第一次测这条时端口 3120/3102 的实例随 shell 退出而被回收，curl 又走了环境里的
> `HTTP_PROXY`，拿到的是代理的 `502 upstream connect failed`。**那是代理的错误，不是应用的行为**。
> 换成受管后台任务 + `--noproxy '*'` 重测后才是上表结果。这条记下来是为了避免把环境噪声当成产品缺陷。

### 4.4 验证边界（必须写清楚）

| 项 | 是否验证 | 方式 |
| --- | --- | --- |
| 无 Key → 规则降级 | ✅ 已验 | 真实 HTTP 请求（§4.2） |
| Key 无效 / 端点不可达 → 降级 | ✅ 已验 | 真实 HTTP 请求（§4.3） |
| 超时降级 | ⚠️ 仅单测 | `ai-provider.test.ts`（13 项含 TIMEOUT 分支）；未做真实超时演练 |
| 模型返回非 JSON / 字段不合白名单 → 丢弃降级 | ⚠️ 仅单测 | `ai-intent-schema.test.ts` 等 |
| **真实大模型的解析质量** | ❌ **未验证** | 环境无可用凭证 |
| 真实大模型下的 UI 回归 | ❌ **未验证** | 同上 |

**明确声明：本报告没有任何「真实模型调用成功」的结论。** 所有与模型相关的验证都止步于
「配置路径 + 失败路径 + 降级行为」。任务 004-A 曾用替身服务验证过 LLM 分支的代码路径，
但那**不是**真实模型验收，不能混为一谈。

**未产生任何费用**：没有购买服务、没有申请新 key、没有调用任何付费端点。

---

## 5. 许可证与开源准备建议

### 5.1 LICENSE 候选（**未选定，等你决定**）

当前仓库**没有** `LICENSE` 文件。按 GitHub 与伯尔尼公约的默认规则，这意味着「保留所有权利」——
别人**不能**合法复制、修改、分发，与「开源」二字相矛盾。参赛评审若要求「开源项目」，这是硬伤。

| 候选 | 优点 | 代价 | 适配度 |
| --- | --- | --- | --- |
| **MIT** | 最短、最通用；与 162 个依赖里 136 个 MIT 同频；评审/复用零摩擦 | 无专利授权条款；不要求署名到「显著位置」 | ⭐⭐⭐⭐⭐ 推荐 |
| **Apache-2.0** | 含**明示专利授权** + 商标条款 + 要求保留 NOTICE；对"怕被专利碰瓷"更稳 | 文本长；下游要带 NOTICE；与 GPLv2 不兼容（本项目无 GPL 依赖，无实际影响） | ⭐⭐⭐⭐ 可选 |
| **AGPL-3.0** | 强制网络服务者也开源 | 与「参赛作品可能被平台部署」冲突，评委可能顾虑 | ⭐ 不建议 |
| 暂不添加 | — | 默认闭源，与参赛"开源"要求可能冲突 | ⭐ 不建议 |

**我的建议是 MIT**，理由是：本项目是 Web 应用而非库，没有专利池诉求；依赖生态以 MIT 为主，
许可声明最省事；参赛场景下评委最熟悉。但**这属于法务与参赛规则的判断，需要你确认后我才创建文件**。

### 5.2 依赖许可兼容性（实测 162 个包）

| 许可证 | 数量 | 代表 |
| --- | --- | --- |
| MIT | 136 | next / react / zod / MCP SDK / vitest |
| ISC | 10 | 常见工具链 |
| Apache-2.0 | 6 | typescript（dev） |
| BSD-3-Clause | 3 | — |
| MPL-2.0 | 2 | `lightningcss`、`lightningcss-win32-x64-msvc` |
| Apache-2.0 AND LGPL-3.0-or-later（± MIT） | 2 | `@img/sharp-*`（Next 图片优化） |
| CC-BY-4.0 | 1 | `caniuse-lite` |
| BSD-2 / 0BSD | 各 1 | — |
| **GPL / AGPL / SSPL / BUSL** | **0** | ✅ 无强 copyleft |

**兼容性结论**：

- 以 **MIT 或 Apache-2.0** 发布**源码仓库**，与上述全部依赖兼容（MPL 是文件级 copyleft，只要不修改那些文件就不触发；LGPL 的 sharp 是**动态链接的原生模块**，源码分发不构成再分发二进制）。
- **若将来打包 Docker 镜像 / 可执行产物分发**，需额外附：sharp 的 LGPL 声明与源码获取途径、`caniuse-lite` 的 CC-BY-4.0 署名。当前不做，先记录。
- `typescript` 是 Apache-2.0，但属 devDependency，不进入运行时产物。

### 5.3 开源材料清单

| 材料 | 状态 | 说明 |
| --- | --- | --- |
| README 快速开始 | ✅ 完备 | 安装、环境变量、4 条门禁命令、`verify` 一键脚本 |
| README 功能说明 | ✅ 完备 | 单餐推荐 / 长期预算 / AI 决策 / 视觉规范 四节原理说明 |
| README **身份声明** | ✅ **本次新增** | 「非麦当劳官方产品」、只读三工具、不提供交易、商标归属、数据隐私 |
| README **截图与演示入口** | ✅ **本次新增** | `/demo` 说明 + 8 张主截图直链表格 |
| README **LLM 启用说明** | ✅ **本次新增** | 配置 + 自检命令 + 4 种输出含义 |
| `.env.example` | ✅ 完备 | 11 个变量、逐项中文注释、两条 `NEXT_PUBLIC_` 红线 |
| 测试说明 | ✅ 完备 | 单测/集成/E2E 三张表 + 命令 + 是否联网 + 规模 |
| 已知限制 | ✅ 16 条 | 含"AI 跑在规则降级"「排除只按名称」「过敏原无数据」等 |
| 安全边界 | ✅ | 只读三工具、不下单不领券、token 只服务端、账本只 localStorage |
| 演示入口 | ✅ `/demo` | 无凭证可看，显式「演示数据」横幅，与真实模式物理隔离 |
| **LICENSE** | ❌ **缺失** | 见 §5.1，等你选 |

---

## 6. 全部测试的实际结果

> 全部在本机实跑，逐项记录命令、结果、耗时。**跳过的用例不计入通过数。**

### 6.1 总表

| # | 命令 | 结果 | 耗时 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `npm run typecheck` | **PASS** `✓ Types generated successfully` | 11s | `next typegen && tsc --noEmit` |
| 2 | `npm run test:unit` | **PASS — 474 / 474**（27 文件） | 6s（vitest 3.31s） | 431 既有 + 43 任务 005 新增，无跳过 |
| 3 | `npm run test:integration` | **首跑 FAIL 1** → 修复后 **PASS — 26 通过 / 3 跳过 / 29** | 12s（vitest 6.59s） | 见 §6.3 |
| 4 | `npm run build` | **PASS** | 25s | `/`、`/_not-found`、`/budget`、`/demo` 预渲染；4 个 API 动态 |
| 5 | `node ../_e2e-005.mjs` | **首跑 66 PASS / 2 FAIL** → 修复后 **69 PASS / 0 FAIL** | 103s | 见 §6.4 |

### 6.2 SKIP 的真实原因（3 项）

```
↓ tests/integration/mcp-connection.test.ts > 未配置 token > 集成测试被跳过（无 MCD_MCP_TOKEN，未验证真实调用）
↓ tests/integration/recommend-real.test.ts > 未配置 token > 真实推荐集成测试被跳过（无 MCD_MCP_TOKEN，未验证）
↓ tests/integration/budget-recommend-real.test.ts > 未配置 token > 真实预算联动集成测试被跳过（无 MCD_MCP_TOKEN，未验证）
```

这 3 条是 `describe.skip("未配置 token")` 里的**占位断言**：当前环境**有** token，所以它们被跳过；
它们的价值是在**没有** token 的环境里显式记「NOT RUN」，而不是用 fixture 冒充真实验证。
**因此正确读法是「26 项真实验证通过 + 3 项占位跳过」，不能说成「29 项通过」。**

### 6.3 集成测试首跑失败：一个真问题

```
✗ 10 元预算：真实菜单里没有完整正餐，返回 0 条并给出原因
  AssertionError: expected [ { type: 'save', … } ] to deeply equal []
  实际：¥9.90「芝芝火腿扒堡组合」（main 角色，已核验）
```

**根因不是产品坏了，而是断言写死了某一天的菜单**。原断言：

```ts
expect(poor.recommendations).toEqual([]);
expect(poor.stats.quotesUsed).toBe(0);
```

2026-10-22 门店菜单里出现了 ¥9.90 的主食，10 元预算**真的能吃到东西**——产品的回答是对的，
测试的假设过期了。**修法：断言意图（不变量），而不是断言当天的事实**：

```ts
if (recommendations.length === 0) {
  expect(emptyReason).toBeTruthy();   // 给不出 → 必须说明原因
  expect(stats.quotesUsed).toBe(0);   // 且不能凭空算价
} else {
  // 给得出 → 必须在预算内、必须已核验（这才是真正要守的东西）
  for (const r of recommendations) {
    expect(r.totalPriceFen).toBeLessThanOrEqual(1000);
    expect(r.priceVerified).toBe(true);
  }
}
```

用例名也从「一定返回 0 条」改为「要么给不出并说明原因，要么给的都是预算内且已核验的」。

### 6.4 浏览器 E2E 首跑失败：同一类问题

```
✗ 手动预算：给出 3 份方案        cards=2
✗ 移动端：三份方案单列铺满        cards=2
```

用 ¥18 预算调 `/api/recommend` 复现：

```json
方案数: 2  →  省钱优先 ¥17.00 ｜ 满足优先 ¥18.00
warnings: [{"code":"INSUFFICIENT_CANDIDATES",
            "message":"预算内只找到 2 份符合条件的完整正餐，已按实际数量返回，不做凑数"}]
```

**引擎的行为是正确的、而且是有意为之**（"不做凑数"）；错的是 E2E 写死 `cards === 3`。
改法：断言改为 `1 ≤ cards ≤ 3`，并保留更强的一条「标题必须都在 {省钱优先, 均衡选择, 满足优先} 内」。
移动端那条同理（单列铺满的宽度断言不变，去掉 `cards === 3`）。

### 6.5 由实时数据暴露的 2 个界面缺陷（已修）

| 缺陷 | 复现 | 修复 |
| --- | --- | --- |
| 只剩 1 份备选时仍写「另外**两份**备选」 | ¥18 预算 → 1 主场 + 1 备选 | 按 `alternatives.length` 生成：「另一份备选」/「另外 N 份备选」 |
| 2 份方案时网格 `md:grid-cols-3` 右侧留洞 | 同上（截图前后对比可见） | 按份数切 `md:grid-cols-2` / `md:grid-cols-3` |

修复后截图（`docs/screenshots/005-single-meal-desktop-1440.png`，本次 E2E 重新生成）：
两张卡等宽铺满整行，底部「这次查询的提示」如实列出 `QUOTE_REJECTED_OVER_BUDGET` 与
`INSUFFICIENT_CANDIDATES`，并注明「官方算价 6 次 … 耗时 2751ms」。

> 保留项：单餐表单的按钮仍写「按预算帮我挑三份」。它是**请求**（表达意图：想要三份），不是**事实陈述**，
> 且结果页会明确说明「只找到 2 份，不做凑数」。故不改——只改"说谎的标签"，不改"许愿的按钮"。

### 6.6 真实 MCP 证据（本轮）

| 项 | 值 |
| --- | --- |
| 门店 | 麦当劳广州天源路餐厅（1400359） |
| 调用工具 | `query-meals` → `calculate-price`（单餐）/ `query-nearby-stores`（查门店） |
| 算价次数 | 单餐 6 次（4 次因算价超预算被剔除，2 次通过）；自然语言 5 次（3 次通过） |
| 上游时间戳 | `upstreamDatetime: 2026-10-22 08:21:36` |
| 耗时 | 单餐 2751ms；自然语言 2095ms |
| 数据真实性 | 与 `/demo` 的冻结快照**价格不同**（演示 ¥25.00/15.90/22.90 vs 实时 ¥18.40/18.00/23.00）——反证演示数据确实是冻结的、没有冒充实时 |

---

## 7. 未解决问题及责任优先级

| 编号 | 问题 | 影响 | 建议责任方 | 优先级 |
| --- | --- | --- | --- | --- |
| U-01 | **LICENSE 未定** | 无许可证 = 默认闭源，与「开源参赛」可能冲突 | **你（法务/参赛规则）** | **P1 · 发布前** |
| U-02 | **真实大模型未验收** | 若对外宣传"大模型理解"，实际跑的是正则，属宣传与实现不一致 | **你（提供凭证）** + 我（回归） | **P1 · 若要宣传** |
| U-03 | E2E 脚本在仓库外、硬编码本机路径 | 公开仓库缺 E2E 能力；直接搬进去会泄露本机路径 | 我（参数化后移入 `scripts/`） | P2 · 可发布后 |
| U-04 | 无 `engines` 字段 | 低版本 Node 报错难懂 | 我（一行改动） | P3 |
| U-05 | `public/` 5 个默认 SVG 未使用 | 观感/体积 | 你决定是否删 | P3 |
| U-06 | 首次提交尚未进行 | 目前 0 commit，任何误操作都不可回滚 | 你（审核后我执行 `/commit`） | P1 · 发布前 |

**关于 U-06**：现在仓库是"空仓库 + 154 个未跟踪文件"，**没有任何回滚点**。建议在推送前先做一次本地提交，
这样后续任何改动都能 diff、能回退。这一步需要你点头，我不擅自 `git add`。

---

## 8. 最终结论

### **有条件可发布（Conditionally Releasable）**

**安全维度：可以发布。** 真实凭证 0 泄露（真值反查）、敏感文件 0 漏网（忽略规则已验证）、
日志不含凭证（伪造 key 实测）、仓库里没有任何本机个人信息（处理后为 0 处）。

**工程维度：可以发布。** 五道门禁全绿：typecheck / 474 单测 / 26 集成 / 生产构建 / 69 条浏览器断言。
本轮共修掉 4 个真问题 + 2 个测试缺陷，其中「界面写死份数」与「测试耦合实时菜单」都是**只有在真实数据下才会暴露**的问题。

**发布前需要你决策的 3 件事：**

1. **许可证**——建议 MIT，但需你确认（法务与参赛规则的判断不在我职责内）；
2. **大模型**——要么补一个 `AI_API_KEY` 让我做一次真实回归，要么在所有对外文案里保持「规则解析」的表述（现有页面已经是这么写的，不算撒谎，只是卖点弱一些）；
3. **首次提交**——建议先做一次本地 commit 建立回滚点，再谈推送。

**这 3 件之外，我没有发现必须由我擅自处理才能继续的阻塞项。**

**以下动作我一件都没做**：`git add` / `git commit` / `git push` / 创建 GitHub 仓库 / 部署 / 报名 / 付费。
全部等你审核。

---

## 附 A：本次审计改动了什么（逐项可复核）

| 文件 | 改动 | 性质 | 原因 |
| --- | --- | --- | --- |
| `.gitignore` | 加 `/.next.bak-*/`、`/.next.bak` | 配置 | R-01（178MB 会被提交） |
| `package-lock.json` | 版本 `0.1.0` → `0.5.0`（仅元数据） | 配置 | R-02（与 package.json 不一致） |
| `docs/03-budget-report.md` | 本机路径 → `mealmate-ai/` | 文档脱敏 | R-03 |
| `tests/integration/recommend-real.test.ts` | 10 元预算用例改为不变量断言 | **测试** | R-04（耦合实时菜单） |
| `components/ai/NaturalLanguageDecision.tsx` | 「另外两份备选」→ 按实际份数 | **界面文案** | R-06（说错数量） |
| `components/SingleMealDecision.tsx` | 结果栅格按份数 2/3 切换 | **界面布局** | R-07（2 份时留洞） |
| `README.md` | 新增身份声明 / 截图与演示入口 / LLM 启用说明；测试表补 4 行 + E2E | 文档 | §4 要求 |
| `docs/06-release-audit.md` | 本文件 | 文档 | §6 要求 |
| `docs/decisions.md` | 追加 ADR-041~045 | 文档 | §6 要求 |

工作区根目录（**不在仓库内**，不会公开）新增的临时脚本：
`_audit-006.mjs`（凭证扫描）、`_t006/`（请求快照）、`_e2e-006*.log`（E2E 日志）。
E2E 脚本 `_e2e-005.mjs` 做了 3 处断言修改（§6.4），仍在仓库外。

**没有删除任何文件**：`.next.bak-*` 全部 9 个备份留在盘上，`public/` 的默认 SVG 一个没动。

---

## 附 B：复现命令

```bash
# 安全审计（反查真实 token，绝不打印值）
node ../_audit-006.mjs

# 门禁
npm run typecheck        # 11s
npm run test:unit        # 474 / 27 文件
npm run test:integration # 26 通过 + 3 跳过（需 MCD_MCP_TOKEN）
npm run build            # 25s

# 浏览器 E2E（需先起服务）
npx next start -p 3100
node ../_e2e-005.mjs     # 69 断言 + 14 张截图
```

> 本机构建时 safe-delete 保护会拦截 Next 清理 `.next`（>50 文件）。处理方式固定为
> `mv .next .next.bak-<任务号>`（**只挪不删**）。本次产生 `.next.bak-006` / `006b` / `006c`。
