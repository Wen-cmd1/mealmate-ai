#!/usr/bin/env node
/**
 * MealMate AI —— 三段可复现演示自查脚本
 *
 * 用途：不依赖浏览器，直接用真实 API 复现「一句话推荐」与「手动预算推荐」两段，
 *       并打印第三段（长期预算 Meal Impact）的浏览器操作步骤。
 *
 * 前置条件：
 *   1) 已配置 .env.local 的 MCD_MCP_TOKEN（真实 MCP）
 *   2) 服务已启动：npm run dev（默认 http://localhost:3000）
 *
 * 用法：
 *   node scripts/demo-check.mjs
 *   BASE_URL=http://localhost:3100 node scripts/demo-check.mjs
 *
 * 退出码：0 = 全部通过；1 = 有失败项。
 */

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const STORE = process.env.DEMO_STORE_CODE || "1400359";
const CITY = process.env.DEMO_CITY || "广州市";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`${tag}  ${name}${detail ? `  (${detail})` : ""}`);
}

const yuan = (fen) => `¥${(fen / 100).toFixed(2)}`;

async function post(path, body, timeoutMs = 120_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 保留原始文本用于报错 */
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/** 方案字段在不同接口的嵌套层级不同，这里做一次统一归一 */
function plansOf(json) {
  const raw = json?.recommendations ?? [];
  return raw.map((x) => x?.recommendation ?? x);
}

/**
 * 核心断言：只断「不变量」，不断「今天的菜单恰好是什么」。
 * 给得出方案 → 必须在预算内、必须已核价；
 * 给不出方案 → 必须有原因说明。数量允许变化（引擎宁可少给也不凑数）。
 */
function checkPlans(label, json, budgetFen) {
  const plans = plansOf(json);
  check(`${label}：接口返回 success`, json?.success === true, `success=${json?.success}`);

  if (plans.length === 0) {
    check(
      `${label}：没有方案时必须给出原因`,
      Boolean(json?.emptyReason || (json?.warnings ?? []).length),
      json?.emptyReason ? `emptyReason=${String(json.emptyReason).slice(0, 40)}` : "有 warnings",
    );
    return;
  }

  check(`${label}：给出 ${plans.length} 份方案（1~3 份均合法）`, plans.length >= 1 && plans.length <= 3);

  const overBudget = plans.filter((p) => Number(p.totalPriceFen) > budgetFen);
  check(
    `${label}：每份都不超预算`,
    overBudget.length === 0,
    overBudget.length
      ? `超预算 ${overBudget.map((p) => yuan(p.totalPriceFen)).join(",")} > ${yuan(budgetFen)}`
      : `预算 ${yuan(budgetFen)}`,
  );

  const unverified = plans.filter((p) => p.priceVerified !== true);
  check(
    `${label}：每份都已官方算价核验`,
    unverified.length === 0,
    unverified.length ? `${unverified.length} 份未核价` : "全部 priceVerified",
  );

  for (const p of plans) {
    console.log(
      `      · ${p.type ?? "-"} / ${p.title} / ${yuan(p.totalPriceFen)} / 剩余 ${yuan(p.remainingFen ?? 0)}`,
    );
  }
}

async function main() {
  console.log(`\n=== MealMate AI 三段演示自查 ===`);
  console.log(`BASE_URL = ${BASE}`);
  console.log(`门店 = ${STORE} / 城市 = ${CITY}\n`);

  // 0) 连通性
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(10_000) });
    const j = await res.json().catch(() => null);
    check("服务可达且 /api/health 响应", res.ok, `status=${res.status}`);
    const mcpOk = j?.mcp?.connected === true || j?.mcp?.ok === true || j?.mcp?.status === "ok";
    check(
      "真实 MCP 已连接（否则第 1、2 段无法验证）",
      mcpOk,
      mcpOk ? "connected" : `mcp 状态见 /api/health：${JSON.stringify(j?.mcp ?? null).slice(0, 80)}`,
    );
  } catch (err) {
    check("服务可达", false, `无法连接 ${BASE}，请先 npm run dev（${err.message}）`);
    return finish();
  }

  // ── 第 1 段：一句话推荐 ──────────────────────────────────────────
  console.log(`\n--- 第 1 段：一句话推荐 ---`);
  const text = "今天中午只有 25 块，想吃鸡肉，不要太辣。";
  console.log(`输入：「${text}」`);
  const decide = await post("/api/ai/decide", { text, context: { city: CITY, storeCode: STORE } });
  check("第 1 段：HTTP 200", decide.status === 200, `status=${decide.status}`);
  if (!decide.json) {
    check("第 1 段：响应是合法 JSON", false, decide.text?.slice(0, 120) ?? "空响应");
  } else {
    const budgetFen = decide.json?.intent?.budgetFen ?? decide.json?.budget?.budgetFen ?? 2500;
    check("第 1 段：解析出预算上限 ¥25.00", budgetFen === 2500, `budgetFen=${budgetFen}`);
    check(
      "第 1 段：解析模式已标注（LLM 或 RULE_FALLBACK，不冒充）",
      ["LLM", "RULE_FALLBACK"].includes(decide.json?.mode),
      `mode=${decide.json?.mode}`,
    );
    check(
      "第 1 段：来源可追溯（provider + traceId）",
      decide.json?.source?.provider === "mcd-mcp" && Boolean(decide.json?.source?.traceId),
      `traceId=${decide.json?.source?.traceId ?? "缺失"}`,
    );
    checkPlans("第 1 段", decide.json, budgetFen);
  }

  // ── 第 2 段：手动预算推荐 ───────────────────────────────────────
  console.log(`\n--- 第 2 段：手动预算推荐（不经自然语言） ---`);
  const manualBudgetFen = 2000;
  console.log(`输入：预算 ${yuan(manualBudgetFen)}`);
  const rec = await post("/api/recommend", {
    budgetFen: manualBudgetFen,
    city: CITY,
    storeCode: STORE,
    orderType: 1,
    beType: 1,
  });
  check("第 2 段：HTTP 200", rec.status === 200, `status=${rec.status}`);
  if (rec.json) {
    checkPlans("第 2 段", rec.json, manualBudgetFen);
  } else {
    check("第 2 段：响应是合法 JSON", false, rec.text?.slice(0, 120) ?? "空响应");
  }

  // ── 第 3 段：长期预算 Meal Impact (浏览器) ─────────────────────
  console.log(`\n--- 第 3 段：长期预算 Meal Impact（需浏览器，本脚本只给步骤） ---`);
  console.log(`  1. 打开 ${BASE}/budget`);
  console.log(`  2. 首次进入：设置周期预算（如每月 ¥900）→ 保存`);
  console.log(`  3. 在「吃这顿之前 / 之后」面板输入金额 25（或点 ¥25 快捷键）`);
  console.log(`  4. 应看到：一句结论「如果花 ¥25.00，接下来 N 天平均每天还能安排 ¥X」`);
  console.log(`     以及「吃这顿之前 → 吃这顿之后」两组余额与日均对比`);
  console.log(`  5. 点「记为已消费」→ 金额进入账本 → 刷新页面，记录仍在（localStorage）`);
  console.log(`  6. 反向核对：只输入金额不会自动记账，必须点确认按钮才写入`);
  console.log(`  （该段的自动化断言见 docs/07-contest-readiness.md 第 4 节）`);

  finish();
}

function finish() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n=== 汇总：${passed} PASS / ${failed} FAIL ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("演示脚本异常：", err);
  process.exit(1);
});
