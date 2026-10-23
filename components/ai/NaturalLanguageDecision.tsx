"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { computeBudgetSummary, suggestMealBudget } from "@/lib/budget/budget-engine";
import { formatFenSigned } from "@/lib/budget/money";
import { getActivePlan, loadBudgetState, type BudgetSettings } from "@/lib/budget/storage";
import type { BudgetPlan, BudgetSummary } from "@/lib/budget/types";
import type { DecideResponse } from "@/lib/ai/types";
import { networkError, readApiError, type FriendlyError } from "@/lib/ui/api-error";
import { Emphasis, Notice, NoticeList } from "@/components/ui/Notice";
import { AiRecommendationCard } from "./AiRecommendationCard";
import { IntentSummary } from "./IntentSummary";

/**
 * 首页自然语言决策区（任务 004 建立，任务 005 重做视觉与交互）。
 *
 * 交互刻意做得"轻"：一句话 + 四个快捷场景 + 一个可选的门店/预算设置，
 * 不做全屏聊天窗口。理由是这个产品的核心动作是"决定这一顿吃什么"，
 * 而不是"和 AI 聊天"——多轮对话会把决策成本加回去。
 *
 * 三条与安全相关的界面约束（视觉重做时一条都没有松）：
 * 1. **预算上下文默认不授权**：勾选框默认关闭，勾了才把本机账本的数字带给服务端；
 * 2. **不做任何写操作**：本组件不写账本、不建档，只展示"去预算页记账"的入口；
 * 3. **限制必须可见**：caveats 与 warnings 分组铺在结果下方，不用折叠藏起来。
 */

const DEFAULT_CITY = "广州市";
const DEFAULT_KEYWORD = "天河";
const CITIES = ["广州市", "深圳市", "佛山市", "东莞市", "北京市", "上海市"];
const MAX_CHARS = 500;

/** 四个快捷场景（任务 005 §4） */
const QUICK_INPUTS = [
  { label: "20 元以内吃什么", text: "20 元以内能吃什么？" },
  { label: "今天想省钱", text: "今天想省点钱，越便宜越好。" },
  { label: "想吃点好的", text: "今天想吃点好的，犒劳一下自己。" },
  { label: "换个口味", text: "想换个口味，不要和昨天吃的一样。" },
] as const;

interface StoreOption {
  storeCode: string;
  storeName: string;
  address?: string;
  businessStatus?: boolean;
}

export function NaturalLanguageDecision() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [result, setResult] = useState<DecideResponse | null>(null);

  const [settings, setSettings] = useState<BudgetSettings>({
    city: DEFAULT_CITY,
    keyword: DEFAULT_KEYWORD,
    storeCode: "",
  });
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [suggestionFen, setSuggestionFen] = useState<number | null>(null);
  const [usePlan, setUsePlan] = useState(false);
  const [mealsLeft, setMealsLeft] = useState("");

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const loadStores = useCallback(async (city: string, keyword: string, preferred = "") => {
    setStoreLoading(true);
    setStoreError(null);
    try {
      const query = new URLSearchParams({ city, keyword });
      const response = await fetch(`/api/stores?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const friendly = await readApiError(response);
        setStoreError(`${friendly.title}。${friendly.hint}`);
        return;
      }
      const data = (await response.json()) as { stores?: StoreOption[] };
      const list = data.stores ?? [];
      setStores(list);
      if (list.length === 0) {
        setStoreError("这个商圈没查到门店，换个关键词试试（例如：天河、体育西、大学城）");
        return;
      }
      const hit = list.find((store) => store.storeCode === preferred) ?? list[0];
      if (hit) {
        setSettings((prev) => ({
          ...prev,
          storeCode: hit.storeCode,
          storeName: hit.storeName,
        }));
      }
    } catch {
      setStoreError(networkError().hint);
    } finally {
      setStoreLoading(false);
    }
  }, []);

  // 只在客户端读本机账本；首帧不读，避免 hydration 不一致
  useEffect(() => {
    const loaded = loadBudgetState();
    const stored = loaded.state.settings;
    const city = stored.city?.trim() || DEFAULT_CITY;
    const keyword = stored.keyword?.trim() || DEFAULT_KEYWORD;

    setSettings({ city, keyword, storeCode: stored.storeCode ?? "", storeName: stored.storeName });

    const active = getActivePlan(loaded.state);
    if (active) {
      const computed = computeBudgetSummary(active, loaded.state.records);
      setPlan(active);
      setSummary(computed);
      setSuggestionFen(
        suggestMealBudget(computed, {
          dailyMealCount: active.dailyMealCount,
          defaultMealBudgetFen: active.defaultMealBudgetFen,
        }).suggestedFen,
      );
    }

    void loadStores(city, keyword, stored.storeCode ?? "");
  }, [loadStores]);

  async function submit(rawText?: string) {
    // 防重复点击：请求进行中直接忽略后续点击（不靠按钮的 disabled 单点防护）
    if (loading) return;

    const value = (rawText ?? text).trim();
    if (value.length === 0) {
      setError({
        title: "先用一句话说说你想吃什么",
        hint: "例如：今天只有 25 元，想吃鸡肉，不要太辣。也可以直接点下面四个快捷场景。",
        retryable: false,
      });
      inputRef.current?.focus();
      return;
    }
    if (!settings.storeCode) {
      setError({
        title: "还差一个门店",
        hint: "先选一家门店，才能查到这家店真实的麦当劳菜单与价格。",
        retryable: false,
      });
      setPanelOpen(true);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/ai/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          text: value,
          context: {
            city: settings.city,
            keyword: settings.keyword || undefined,
            storeCode: settings.storeCode,
            orderType: 1,
            beType: 1,
            mealsLeftToday: mealsLeft === "" ? undefined : Number(mealsLeft),
            budget:
              usePlan && plan && summary
                ? {
                    authorized: true,
                    hardCapFen: plan.defaultMealBudgetFen,
                    suggestedMealBudgetFen: suggestionFen ?? undefined,
                    remainingFen: summary.remainingFen,
                    daysRemaining: summary.daysRemaining,
                    reserveFen: summary.reserveFen,
                    planName: plan.name,
                  }
                : undefined,
          },
        }),
      });

      if (!response.ok) {
        setError(await readApiError(response));
        return;
      }

      setResult((await response.json()) as DecideResponse);
      // 结果跳到可见区域：用 requestAnimationFrame 等布局完成再滚
      requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch {
      setError(networkError());
    } finally {
      setLoading(false);
    }
  }

  function runPreset(preset: string) {
    if (loading) return;
    setText(preset);
    if (!settings.storeCode) {
      setPanelOpen(true);
      setError({
        title: "先选一家门店",
        hint: "选好门店后，再点一次快捷场景，就能拿到这家的真实价格。",
        retryable: false,
      });
      return;
    }
    void submit(preset);
  }

  function adjust() {
    setResult(null);
    setError(null);
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const selectedStore = settings.storeCode
    ? stores.find((store) => store.storeCode === settings.storeCode)
    : undefined;
  const storeLabel = selectedStore
    ? selectedStore.storeName
    : settings.storeName
      ? settings.storeName
      : settings.storeCode
        ? settings.storeCode
        : "";

  const primary = result?.recommendations.find((item) => item.primary) ?? result?.recommendations[0];
  const alternatives = result?.recommendations.filter((item) => item !== primary) ?? [];

  return (
    <section id="ask" className="scroll-mt-24">
      {/* ---------- 提问卡 ---------- */}
      <div className="surface p-4 sm:p-6">
        <h2 className="sr-only">用一句话说出你的用餐需求</h2>

        <label htmlFor="nl-input" className="sr-only">
          用一句话描述你的用餐需求（预算、口味、心情都可以）
        </label>
        <textarea
          id="nl-input"
          ref={inputRef}
          value={text}
          rows={2}
          maxLength={MAX_CHARS}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl / Cmd + Enter 直接提交，键盘用户不用去找按钮
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="比如：今天只有 25 元，想吃鸡肉，不要太辣。"
          className="field min-h-[92px] resize-none text-[15px] leading-7 sm:min-h-[104px] sm:text-base"
          aria-describedby="nl-input-hint"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_INPUTS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={loading}
              onClick={() => runPreset(preset.text)}
              className="chip"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading}
            aria-busy={loading}
            className="btn btn-primary h-12 w-full px-6 text-[15px] sm:w-auto"
          >
            {loading ? (
              <>
                <span className="pulse-dot size-2 rounded-full bg-white/90" />
                正在核验真实价格…
              </>
            ) : (
              <>帮我选这一顿</>
            )}
          </button>

          <p id="nl-input-hint" className="text-[11px] leading-5 text-ink-400">
            {text.length > 0 ? (
              <span className="num">
                {text.length}/{MAX_CHARS} 字
              </span>
            ) : (
              <>按 Ctrl / ⌘ + Enter 也能直接问</>
            )}
          </p>
        </div>

        {/* 门店 / 偏好设置：默认收起，只露一行摘要，不抢首屏注意力 */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3 text-[12px] text-ink-500">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span aria-hidden className="text-ink-400">
              门店
            </span>
            {storeLoading ? (
              <span className="text-ink-400">正在查找附近门店…</span>
            ) : storeLabel ? (
              <span className="truncate font-medium text-ink-900">{storeLabel}</span>
            ) : (
              <span className="font-medium text-brand-700">还没选门店</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setPanelOpen((prev) => !prev)}
            aria-expanded={panelOpen}
            aria-controls="nl-panel"
            className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-medium text-ink-700 transition hover:border-brand-200 hover:text-brand-700"
          >
            {panelOpen ? "收起设置" : "门店与偏好"}
          </button>
          {plan && summary ? (
            <span className="text-[11px] text-ink-400">
              已读取本机长期预算（勾选后才会上传数字）
            </span>
          ) : null}
        </div>

        {panelOpen ? (
          <div id="nl-panel" className="mt-3 space-y-3 rounded-2xl bg-cream-deep p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="城市"
                value={settings.city}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, city: event.target.value, storeCode: "" }))
                }
                className="field w-auto py-2 text-[13px]"
              >
                {CITIES.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
              <input
                aria-label="商圈关键词"
                value={settings.keyword}
                onChange={(event) => setSettings((prev) => ({ ...prev, keyword: event.target.value }))}
                placeholder="商圈，如 天河"
                className="field w-28 py-2 text-[13px] sm:w-40"
              />
              <button
                type="button"
                onClick={() => void loadStores(settings.city, settings.keyword, settings.storeCode)}
                disabled={storeLoading}
                className="btn btn-ghost px-3 py-2 text-[13px]"
              >
                {storeLoading ? "查询中…" : "查询门店"}
              </button>

              <label className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-ink-500">
                今天还剩
                <select
                  aria-label="今天还剩几餐"
                  value={mealsLeft}
                  onChange={(event) => setMealsLeft(event.target.value)}
                  className="field w-auto py-1.5 text-[12px]"
                >
                  <option value="">不确定</option>
                  {[1, 2, 3, 4].map((count) => (
                    <option key={count} value={count}>
                      {count} 餐
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {stores.length > 0 ? (
              <select
                aria-label="门店"
                value={settings.storeCode}
                onChange={(event) => {
                  const hit = stores.find((store) => store.storeCode === event.target.value);
                  setSettings((prev) => ({
                    ...prev,
                    storeCode: event.target.value,
                    storeName: hit?.storeName,
                  }));
                }}
                className="field py-2 text-[13px]"
              >
                {stores.map((store) => (
                  <option key={store.storeCode} value={store.storeCode}>
                    {store.storeName}
                    {store.address ? ` · ${store.address}` : ""}
                  </option>
                ))}
              </select>
            ) : null}

            {storeError ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
                {storeError}
              </p>
            ) : null}

            {plan && summary ? (
              <label className="flex items-start gap-2 text-[11px] leading-5 text-ink-500">
                <input
                  type="checkbox"
                  checked={usePlan}
                  onChange={(event) => setUsePlan(event.target.checked)}
                  className="mt-0.5 accent-brand-500"
                />
                <span>
                  参考我的长期预算（本机）：{plan.name} · 剩余{" "}
                  <span className="num font-semibold text-ink-900">
                    {formatFenSigned(summary.remainingFen)}
                  </span>{" "}
                  · 还剩 {summary.daysRemaining} 天
                  {suggestionFen !== null ? (
                    <>
                      {" "}
                      · 建议单餐{" "}
                      <span className="num font-semibold text-ink-900">
                        {formatFenSigned(suggestionFen)}
                      </span>
                    </>
                  ) : null}
                  <span className="mt-0.5 block text-ink-400">
                    勾选才会把这些数字发给服务端，仅用于估算预算影响；账本本身不会被修改。
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-[11px] leading-5 text-ink-400">
                还没有长期预算计划。想按月度预算算，可以先去{" "}
                <a href="/budget" className="font-medium text-brand-700 underline-offset-2 hover:underline">
                  长期预算页
                </a>{" "}
                建一个。
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* ---------- 错误 ---------- */}
      {error ? (
        <div className="mt-3">
          <Notice
            tone="error"
            role="alert"
            title={error.title}
            action={
              error.retryable ? (
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={loading}
                  className="btn btn-ghost px-3 py-1.5 text-[12px]"
                >
                  再试一次
                </button>
              ) : null
            }
          >
            {error.hint}
            {error.code ? (
              <span className="ml-1.5 text-[10px] text-ink-400">（{error.code}）</span>
            ) : null}
          </Notice>
        </div>
      ) : null}

      {/* ---------- 加载 ---------- */}
      {loading ? (
        <div className="mt-3 space-y-3" aria-live="polite" aria-busy="true">
          <div className="surface p-4 sm:p-5">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink-700">
              <span className="pulse-dot size-2 rounded-full bg-brand-500" />
              正在做三件事：读懂你的话 → 拉门店实时菜单 → 逐份核对官方价格
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <div className="skeleton h-7 w-24" />
              <div className="skeleton h-7 w-32" />
              <div className="skeleton h-7 w-20" />
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1.25fr_1fr]">
            <div className="skeleton h-64" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="skeleton h-32" />
              <div className="skeleton h-32" />
            </div>
          </div>
          <p className="text-center text-[11px] text-ink-400">通常需要 2~4 秒，不会用缓存或估算价格顶替</p>
        </div>
      ) : null}

      {/* ---------- 结果 ---------- */}
      {!loading && result ? (
        <div ref={resultRef} className="mt-3 scroll-mt-24 space-y-3">
          <IntentSummary result={result} />

          {result.clarification.needed ? (
            <Notice tone="warn" title="还需要你确认一下">
              <ul className="space-y-1">
                {result.clarification.questions.map((question) => (
                  <li key={question}>· {question}</li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-amber-800/80">在你回答之前，系统不会替你猜条件。</p>
            </Notice>
          ) : null}

          {result.recommendations.length === 0 ? (
            <Notice
              tone="neutral"
              title="这次没有给出推荐"
              action={
                <button type="button" onClick={adjust} className="btn btn-ghost px-3 py-1.5 text-[12px]">
                  调整条件，重新推荐
                </button>
              }
            >
              {result.emptyReason ?? "可以换个说法或调整预算再试一次。"}
              <span className="mt-1 block text-[11px] text-ink-400">
                系统不会用编造的餐品或价格填空。
              </span>
            </Notice>
          ) : (
            <>
              {primary ? (
                <div className="animate-fade-up">
                  <AiRecommendationCard
                    item={primary}
                    variant="primary"
                    budgetFen={result.budget.appliedFen}
                    storeName={result.source.storeName || result.source.storeCode}
                    storeCode={result.source.storeCode}
                    storeAddress={result.source.storeAddress}
                    onAdjust={adjust}
                  />
                </div>
              ) : null}

              {alternatives.length > 0 ? (
                <div className="space-y-2">
                  <p className="px-1 text-[11px] font-medium tracking-wide text-ink-400">
                    {/* 备选份数是数据决定的：候选不够时引擎只给 1~2 份，标题必须跟着变，
                        不能写死「两份」（任务 006 用真实菜单复现到只剩 1 份备选的情况） */}
                    {alternatives.length === 1
                      ? "另一份备选（同一次查询、同一套核验）"
                      : `另外 ${alternatives.length} 份备选（同一次查询、同一套核验）`}
                  </p>
                  <div className={alternatives.length === 1 ? "grid gap-3" : "grid gap-3 md:grid-cols-2"}>
                    {alternatives.map((item) => (
                      <AiRecommendationCard
                        key={item.recommendation.type}
                        item={item}
                        variant="compact"
                        budgetFen={result.budget.appliedFen}
                        storeName={result.source.storeName || result.source.storeCode}
                        storeCode={result.source.storeCode}
                        storeAddress={result.source.storeAddress}
                        onAdjust={adjust}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {/* 数据来源条 */}
              <div className="surface-muted flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[11px] leading-5 text-ink-500">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-1.5 rounded-full bg-mint-500" />
                  官方价格已核验 {result.priceVerification.verifiedCount}/
                  {result.priceVerification.quotesUsed} 份
                </span>
                <span>
                  门店：{result.source.storeName || result.source.storeCode}
                  {result.source.storeAddress ? `（${result.source.storeAddress}）` : ""}
                </span>
                <span>
                  数据时间：
                  {result.source.fetchedAt
                    ? new Date(result.source.fetchedAt).toLocaleString("zh-CN", { hour12: false })
                    : "—"}
                </span>
                <span className="text-ink-400">
                  耗时 {result.elapsedMs}ms
                  {result.ai?.usage?.totalTokens ? ` · 模型 ${result.ai.usage.totalTokens} tokens` : ""}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={adjust}
                  className="btn btn-ghost px-4 py-2.5 text-[13px]"
                >
                  调整条件，重新推荐
                </button>
                <a href="/budget" className="btn btn-ghost px-4 py-2.5 text-[13px]">
                  去长期预算页记账 →
                </a>
                <span className="text-[11px] text-ink-400">
                  这里不会自动记账，记录消费必须由你在预算页确认。
                </span>
              </div>
            </>
          )}

          {/* 告警：按"这次怎么算的"分组，不折叠 */}
          {result.warnings.length > 0 ? (
            <NoticeList
              tone="warn"
              title="需要你知道的几件事"
              meta={`${result.warnings.length} 条`}
              items={result.warnings.map((warning) => (
                <>
                  {warning.message}
                  <span className="ml-1 text-[10px] text-ink-400">[{warning.code}]</span>
                </>
              ))}
            />
          ) : null}

          {/* 限制：与告警分开，避免全挤成一段 */}
          {result.caveats.length > 0 ? (
            <NoticeList
              tone="neutral"
              title="数据边界与前提"
              meta="必须可见"
              items={result.caveats.map((caveat) => (
                <Emphasis text={caveat} />
              ))}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
