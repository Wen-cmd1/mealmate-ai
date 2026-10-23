# 发布审核清单（任务 008）

> 审计时间：2026-10-23 15:00 左右（北京时间）
> 审计对象：`mealmate-ai` 本地仓库 → `https://github.com/Wen-cmd1/mealmate-ai`（公开）
> 本任务边界：**仅本地检查与安全修复**。未执行 `git push`、未提交报名 Issue。

---

## 1. 结论

**状态：1 项阻塞，其余全部就绪。**

| | 事项 | 状态 |
|---|---|---|
| 🟢 | 安全面（凭证 / 忽略规则 / 隐私） | 通过，Git 对象级扫描零泄露 |
| 🟢 | 参赛材料完整性 | 5 份官方要求文件 + README 四项齐备 |
| 🟢 | `CONTEST_DECLARATION.md` 与官方一致性 | **SHA256 完全相同** |
| 🟢 | 提交作者 | 已修正为 `Wen-cmd1 <…@users.noreply.github.com>` |
| 🟢 | 远端地址 | 已配 `origin`，指向公开空仓库，可直接 push |
| 🔴 | `LICENSE` 版权主体 | **仍为 `[COPYRIGHT HOLDER]` 占位，等所有者提供** |

**在不填版权主体的情况下推送，等于公开发布一份权利人不明的授权文本。这是唯一必须先解决的问题。**

---

## 2. 逐项检查结果

### 2.1 本地工程（未新建、未重新 init）

| 项 | 值 |
|---|---|
| 路径 | `mealmate-ai/`（既有工程，原地操作） |
| 分支 | `main` |
| 提交数 | 3 |
| `.git` 创建 | 2026-10-23 14:32 |
| 工作区 | 干净（除本次审计产生的改动） |

### 2.2 `.gitignore` 与忽略规则实测

对**真实存在的路径**逐条执行 `git check-ignore`，而不是只看规则文本：

| 路径 | 结果 |
|---|---|
| `.env.local` | IGNORED ✓ |
| `.next/` | IGNORED ✓ |
| `.next.bak-005` / `.next.bak-007`（共 11 个备份） | IGNORED ✓ |
| `node_modules/` | IGNORED ✓ |
| `tsconfig.tsbuildinfo` | IGNORED ✓ |
| `.env.example` | **允许提交**（`!.env.example` 白名单） |

### 2.3 凭证与敏感信息（Git 对象级）

本任务新增 `_audit-git.mjs`，扫描 `.git` 里的**全部对象**（176 个文本 blob / 212 条路径映射），
而非工作区文件——因为只有前者能回答「推上去的东西里到底有什么」，
连历史中被删除、但 blob 仍留在 `.git` 里的文件也能覆盖。

| 检查 | 结果 |
|---|---|
| 真实 `MCD_MCP_TOKEN` 值反查 | **0 处**（176 个 blob 全查） |
| `Bearer` 令牌模式 | 1 处 → `tests/unit/security.test.ts:182` 脱敏函数测试输入（`ABCDEF…123456`） |
| `sk-` 风格密钥 | 6 处 → 全部测试假值（`sk-test-secret-value` / `sk-should-never-appear`） |
| 凭证赋值形态 | 7 处 → 4 处是正确的 `process.env.MCD_MCP_TOKEN` 读取，3 处测试假值 |
| `NEXT_PUBLIC_*TOKEN` | 1 处 → `.env.example` 里**警告文字**（"绝对不要改成这个前缀"），代码零引用，且有测试锁死 |
| 本机绝对路径 | 2 处 → 均为报告里**已脱敏**的风险描述（`C:\Users\<用户名>\…`），真实用户名 0 处 |
| 手机号 / 身份证 / 收货地址 | 未发现 |
| fixture 坐标 | 全部为 `0`（用 `city`+`keyword` 查询，未采集定位） |
| fixture 地址 | 麦当劳门店公开地址，非个人信息 |
| 服务端日志打印 key | 任务 006 已用假 key 实测，日志干净 |

**17 处模式命中全部逐条判定为「正确的读取方式 / 测试假值 / 防御性文档 / 已脱敏描述」，无真实凭证。**

### 2.4 参赛材料完整性

| 文件 | 大小 | 已跟踪 | 说明 |
|---|---|---|---|
| `README.md` | 34 KB | ✓ | 含官方要求的四项：项目介绍 / 安装方法 / 使用示例 / 目标用户 |
| `CONTEST_DECLARATION.md` | 1,522 B | ✓ | 见 2.5 |
| `MCP_INTEGRATION.md` | 8.2 KB | ✓ | 三个只读工具真实契约 + 调用链 + 业务价值 + 限制 |
| `mcp-config.example.json` | 215 B | ✓ | 只有 `${MCD_MCP_URL}` / `${MCD_MCP_TOKEN}`，**0 处长串** |
| `workbuddy.md` | 9.2 KB | ✓ | 按任务编号的真实过程 + 调试证据 |

### 2.5 `CONTEST_DECLARATION.md` 与官方原文一致性

| 项 | 官方（raw 下载） | 本地（仓库） |
|---|---|---|
| 字节数 | 1,522 | 1,522 |
| SHA256（前 32 位） | `cd28101bcb29cc8fb24b372fe91ce6b4` | `cd28101bcb29cc8fb24b372fe91ce6b4` |
| 行尾 | LF | LF |
| `diff` 结果 | — | **零差异** |

这是本清单里唯一可以下"绝对一致"结论的项——因为它是字节级的，不是肉眼比对。
官方要求该文件「内容不可改动」，所以连"本文档由 XX 提供"这类附注都不能加。

### 2.6 提交作者

| 检查点 | 修正前 | 修正后 |
|---|---|---|
| `%an` | `Wen` | **`Wen-cmd1`** |
| `%ae` | `wen@example.com`（保留域名占位） | **`332057996+Wen-cmd1@users.noreply.github.com`** |
| 覆盖范围 | 3 个提交全是占位 | 3 个提交全部重写 |
| 文件内容 | — | `git diff` 对比备份分支**零差异** |

重写用 `git rebase --root --exec 'git commit --amend --no-edit --reset-author'`，
改前已建备份分支 `backup-before-author-fix`。因从未推送，hash 变化无副作用。

新 hash：`b11b778`（首个）/ `9c6377e` / `567c811`（当前 HEAD）。

### 2.7 远端地址

| 项 | 值 |
|---|---|
| 配置 | `origin → https://github.com/Wen-cmd1/mealmate-ai.git`（fetch 与 push 一致） |
| 仓库全名 | `Wen-cmd1/mealmate-ai` |
| 可见性 | **public** |
| 创建时间 | 2026-10-23 14:58（北京时间） |
| 默认分支 | `main`（与本地一致） |
| 仓库状态 | **空**（`Git Repository is empty.`，branches 为空） |

仓库创建时间落在官方要求的 `2025-12-25 ~ 2026-10-25 23:59` 区间内 ✅。
因为是空仓库，`git push -u origin main` 不会遇到 non-fast-forward 冲突，不需要 `--allow-unrelated-histories`。

---

## 3. 一个必须记录的审计陷阱

本任务第一次运行凭证扫描时，脚本输出了：

```
待反查的敏感变量：(无)
✓ 未在任何文件中发现真实凭证值
```

**这个 ✓ 是假的。** 当时扫描根目录是工作区根（`2026-10-21-20-32-20/`），
而 `.env.local` 在 `mealmate-ai/` 里——脚本没读到基准 token，所以「反查」这一步根本没执行，
却仍然打印了通过。

已做两件事：

1. **给 `_audit-006.mjs` 加硬门禁**：读不到基准凭证时直接 `exit 2` 并说明原因，
   不再输出任何 ✓。已验证：在错误目录运行会中止。
2. **新增 `_audit-git.mjs`**：扫 Git 对象库而非文件系统，同样带该门禁。

**教训**：审计工具的「通过」必须能被证伪。一个「什么都没查」的检查和一个「查了没问题」的检查，
在输出上长得一样——这是审计最危险的失败模式，比漏报更隐蔽。

---

## 4. 发布前最后三步

**在 `LICENSE` 版权主体确认后执行，顺序不可颠倒。**

```bash
cd mealmate-ai

# 第 1 步：替换 LICENSE 版权行（唯一阻塞项）
#   把 [COPYRIGHT HOLDER] 换成所有者确认的署名，然后提交
git add LICENSE package.json
git commit -m "chore(release): 确认版权主体"

# 第 2 步：推送前最后一次安全扫描（应输出真实凭证 0 处）
node ../_audit-git.mjs
git status --porcelain          # 应为空

# 第 3 步：推送
git push -u origin main
```

推送后立即核对三件事：

1. GitHub 仓库首页右上角是否出现 **MIT** 许可证标识（说明 `LICENSE` 被正确识别）；
2. 提交记录里的作者头像/链接是否能点进 `Wen-cmd1` 主页
   （若显示为灰色无链接，说明 noreply 邮箱未关联，需改用账号绑定邮箱后重写作者）；
3. `CONTEST_DECLARATION.md` 在网页上渲染后，与官方仓库该文件**逐段**一致
   （网页渲染可能吞掉尾部空行，属正常）。

---

## 5. 仍未解决 / 需所有者决策

| 级别 | 事项 | 说明 |
|---|---|---|
| **P0** | `LICENSE` 版权主体 | 本次已确认「另行提供」，等具体署名后替换 |
| **P1** | Star = 0 | 排行榜只收录 Star > 0 的项目。文件齐备 ≠ 上榜；刷榜会被取消资格 |
| **P1** | 真实大模型未验收 | `.env.local` 中 `AI_API_KEY` 键不存在，对外只能称「规则解析」 |
| **P1** | `workbuddy.md` 不含逐字对话 | 影响 WorkBuddy 专项奖励核验；需从客户端导出补充 |
| **P2** | `package.json` 的 `"private": true` | 仅阻止误发 npm，不影响 GitHub 公开，可保留 |
| **P3** | 截图合计约 6 MB | 体积偏大但可接受 |

---

## 6. 本任务变更

| 文件 | 变更 |
|---|---|
| `package.json` | 新增 `description` / `license: MIT` / `repository` / `homepage`（依赖声明未动） |
| `docs/07-contest-readiness.md` | 修正失效的 commit hash；§8 补状态更新注记 |
| `docs/08-publish-checklist.md` | 本文件（新增） |
| 工作区外 | `_audit-006.mjs` 加假阴性门禁；新增 `_audit-git.mjs` |

Git 侧：`origin` 已配置；3 个提交作者已重写；备份分支 `backup-before-author-fix` 保留。

**未改动**：`LICENSE`（等确认）、任何源代码、任何测试、任何截图。
**未执行**：`git push`、报名 Issue、远端任何写操作。
