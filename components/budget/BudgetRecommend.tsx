"use client";

import { useCallback, useMemo, useState } from "react";

import { impactOfVerifiedPrice, suggestMealBudget } from "@/lib/budget/budget-engine";
import { defaultIdFactory } from "@/lib/budget/ledger";
import { draftExpenseFromRecommendation } from "@/lib/budget/meal-link";
import { formatFen, formatFenSigned } from "@/lib/budget/money";
import { parseAmountInput } from "@/lib/budget/schema";
import type { BudgetSettings } from "@/lib/budget/storage";
import type { BudgetPlan, BudgetSummary } from "@/lib/budget/types";
import { AVOIDABLE_TAGS, PREFERENCE_OPTIONS } from "@/lib/recommendation/types";
import type { RecommendResponse, Recommendation } from "@/lib/recommendation/types";
import { networkError, readApiError, type FriendlyError } from "@/lib/ui/api-error";
import { Tag } from "@/components/ui/Brand";
import { Notice } from "@/components/ui/Notice";

/**
 * 「根据剩余预算推荐今天这顿」——任务 002 的推荐 API 与任务 003 的预算引擎在这里汇合。
 *
 * 三条不可让渡的规则：
 * 1. 建议单餐预算只是**建议**，输入框始终可改，改了就按改的算；
 * 2. 点「查看推荐」**不会**扣预算，扣预算必须用户显式点「记为已消费」并确认金额；
 * 3. 需要进一步选内容的套餐 / 未核验的价格，金额默认留空，由用户填实付。
 *
 * 任务 005 只重排视觉：把「建议值 + 三个输入」压成一张更短的卡，
 * 三份方案换成与首页一致的卡片语言（价格在右上、核验状态在标题下）。
 */

const CITIES = ["广州市", "深圳市", "佛山市", "东莞市", "北京市", "上海市"];

interface StoreOption {
  storeCode: string;
  storeName: string;
  address?: string;
  businessStatus?: boolean;
}

export interface RecordDraft {
  amountFen: number;
  description: string;
  relatedProductCode?: string;
  relatedRecommendationType?: string;
  requestId: string;
}

const TYPE_TONE: Record<Recommendation["type"], "mint" | "neutral" | "brand"> = {
  save: "mint",
  balanced: "neutral",
  satisfy: "brand",
};

export function BudgetRecommend({
  plan,
  summary,
  settings,
  onSettingsChange,
  onRecord,
  onError,
  disabled,
}: {
  plan: BudgetPlan;
  summary: BudgetSummary;
  settings: BudgetSettings;
  onSettingsChange: (patch: Partial<BudgetSettings>) => void;
  onRecord: (draft: RecordDraft) => { ok: boolean; message?: string };
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const suggestion = useMemo(
    () =>
      suggestMealBudget(summary, {
        dailyMealCount: plan.dailyMealCount,
        defaultMealBudgetFen: plan.defaultMealBudgetFen,
      }),
    [summary, plan.dailyMealCount, plan.defaultMealBudgetFen],
  );

  const [budgetYuan, setBudgetYuan] = useState(
    suggestion.suggestedFen ? String(suggestion.suggestedFen / 100) : "25",
  );
  const [mealsLeftToday, setMealsLeftToday] = useState("1");

  /** 口味偏好（影响打分）与排除项（走确定性过滤）—— 任务 004 要求长期预算页也能传偏好 */
  const [preferences, setPreferences] = useState<string[]>([]);
  const [avoids, setAvoids] = useState<string[]>([]);

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storesLoading, setStoresLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [result, setResult] = useState<RecommendResponse | null>(null);

  const [recordingType, setRecordingType] = useState<string | null>(null);
  const [recordAmountYuan, setRecordAmountYuan] = useState("");
  const [recordRequestId, setRecordRequestId] = useState("");

  const mealsLeft = Math.max(1, Math.min(4, Number(mealsLeftToday) || 1));

  const loadStores = useCallback(async () => {
    setStoresLoading(true);
    setStoreError(null);
    try {
      const query = new URLSearchParams({ city: settings.city, keyword: settings.keyword });
      const response = await fetch(`/api/stores?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const friendly = await readApiError(response);
        setStoreError(`${friendly.title}。${friendly.hint}`);
        setStores([]);
        return;
      }
      const data = (await response.json()) as { stores?: StoreOption[] };
      const list = data.stores ?? [];
      setStores(list);
      if (list.length === 0) {
        setStoreError("没有查到门店，换个商圈关键词试试");
        return;
      }
      const first = list[0] as StoreOption;
      if (!list.some((store) => store.storeCode === settings.storeCode)) {
        onSettingsChange({ storeCode: first.storeCode, storeName: first.storeName });
      }
    } catch {
      setStoreError(networkError().hint);
    } finally {
      setStoresLoading(false);
    }
  }, [settings.city, settings.keyword, settings.storeCode, onSettingsChange]);

  async function handleRecommend() {
    if (loading) return;
    setError(null);

    const budget = parseAmountInput(budgetYuan);
    if (!budget.ok || budget.fen === null) {
      setError({
        title: "单餐预算不合法",
        hint: budget.message ?? "请填一个大于 0 的金额。",
        retryable: false,
      });
      return;
    }
    if (budget.fen < 500 || budget.fen > 20_000) {
      setError({
        title: "超出接口支持的金额区间",
        hint: "单餐预算需要在 ¥5 ~ ¥200 之间（受推荐接口限制）。",
        retryable: false,
      });
      return;
    }
    if (!settings.storeCode) {
      setError({
        title: "还没选定门店",
        hint: "先在下面选城市与商圈，查到门店后再点推荐。",
        retryable: false,
      });
      return;
    }

    setLoading(true);
    setResult(null);
    setRecordingType(null);
    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          budgetFen: budget.fen,
          city: settings.city,
          keyword: settings.keyword,
          storeCode: settings.storeCode,
          orderType: 1,
          beType: 1,
          preferences: preferences.length > 0 ? preferences : undefined,
          avoidTags: avoids.length > 0 ? avoids : undefined,
        }),
      });
      if (!response.ok) {
        setError(await readApiError(response));
        return;
      }
      setResult((await response.json()) as RecommendResponse);
    } catch {
      setError(networkError());
    } finally {
      setLoading(false);
    }
  }

  function openRecord(rec: Recommendation) {
    const draft = draftExpenseFromRecommendation(rec);
    setRecordingType(rec.type);
    setRecordAmountYuan(draft.amountFen === null ? "" : String(draft.amountFen / 100));
    setRecordRequestId(defaultIdFactory());
  }

  function submitRecord(rec: Recommendation) {
    const draft = draftExpenseFromRecommendation(rec);
    const parsed = parseAmountInput(recordAmountYuan);
    if (!parsed.ok || parsed.fen === null || parsed.fen <= 0) {
      onError(parsed.message ?? "请填写实际支付金额（需要大于 0）");
      return;
    }

    const created = onRecord({
      amountFen: parsed.fen,
      description: draft.description,
      relatedProductCode: draft.relatedProductCode,
      relatedRecommendationType: draft.relatedRecommendationType,
      requestId: recordRequestId || defaultIdFactory(),
    });

    if (!created.ok) {
      onError(created.message ?? "写入账本失败");
      return;
    }
    setRecordingType(null);
    setRecordAmountYuan("");
    setRecordRequestId("");
  }

  return (
    <section className="surface p-5 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="eyebrow">吃掉这一顿之前先看一眼</p>
          <h2 className="mt-1 text-[17px] font-semibold tracking-tight text-ink-900">
            用剩余预算推荐今天这顿
          </h2>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-ink-500">
            建议值 = 剩余可支配金额 ÷ 剩余天数 ÷ 每日餐次，可以随时改。
            点「查看推荐」只查询真实菜单，<span className="font-medium text-ink-700">不会扣预算</span>。
          </p>
        </div>
        <span className="rounded-full border border-line bg-white px-2.5 py-1 text-[10px] text-ink-500">
          只读查询 · 不自动记账
        </span>
      </header>

      <div className="mt-3 rounded-2xl bg-cream-deep px-4 py-3">
        {suggestion.suggestedFen === null ? (
          <>
            <p className="text-[12px] font-medium text-ink-900">暂时给不出建议单餐预算</p>
            <p className="mt-0.5 text-[11px] leading-5 text-ink-500">{suggestion.blockedReason}</p>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-[11px] text-ink-500">建议单餐预算</p>
            <p className="num text-[22px] font-bold leading-none text-brand-700">
              {formatFen(suggestion.suggestedFen)}
            </p>
            <button
              type="button"
              onClick={() => setBudgetYuan(String((suggestion.suggestedFen ?? 0) / 100))}
              className="rounded-full border border-brand-200 bg-white px-2.5 py-1 text-[10px] font-medium text-brand-700 hover:bg-brand-50"
            >
              用这个数
            </button>
            <p className="w-full text-[11px] leading-5 text-ink-500">{suggestion.explanation}</p>
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-[11px] font-medium text-ink-700" htmlFor="rec-budget">
            这次的单餐预算（元）
          </label>
          <input
            id="rec-budget"
            inputMode="decimal"
            value={budgetYuan}
            onChange={(event) => setBudgetYuan(event.target.value)}
            disabled={disabled}
            className="field mt-1 py-2 text-[15px] font-semibold"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-ink-700" htmlFor="rec-meals">
            今天还剩几餐（含这顿）
          </label>
          <select
            id="rec-meals"
            value={mealsLeftToday}
            onChange={(event) => setMealsLeftToday(event.target.value)}
            className="field mt-1 py-2 text-[13px]"
          >
            {[1, 2, 3, 4].map((count) => (
              <option key={count} value={count}>
                {count} 餐
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <span className="block text-[11px] font-medium text-ink-700">口味偏好与排除（可多选）</span>
          <div className="mt-1.5 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-8 text-[10px] text-ink-400">想吃</span>
              {PREFERENCE_OPTIONS.map((option) => {
                const active = preferences.includes(option);
                return (
                  <button
                    key={`pref-${option}`}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPreferences((prev) => toggle(prev, option))}
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                      active
                        ? "border-brand-500 bg-brand-500 text-white"
                        : "border-line bg-white text-ink-600 hover:border-brand-200 hover:text-brand-700"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-8 text-[10px] text-ink-400">不吃</span>
              {AVOIDABLE_TAGS.map((option) => {
                const active = avoids.includes(option);
                return (
                  <button
                    key={`avoid-${option}`}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setAvoids((prev) => toggle(prev, option))}
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                      active
                        ? "border-amber-400 bg-amber-50 text-amber-800"
                        : "border-line bg-white text-ink-600 hover:border-amber-300"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] leading-4 text-ink-400">
              「不吃」是确定性过滤：名称里带这些词的餐品不会被推荐。但接口没有配料表，
              无法保证绝对不含，点单时请再确认。
            </p>
          </div>
        </div>

        <div className="sm:col-span-2">
          <span className="block text-[11px] font-medium text-ink-700">城市与门店</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <select
              aria-label="城市"
              value={settings.city}
              onChange={(event) => onSettingsChange({ city: event.target.value, storeCode: "" })}
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
              onChange={(event) => onSettingsChange({ keyword: event.target.value })}
              placeholder="商圈，如 天河"
              className="field w-28 py-2 text-[13px] sm:w-40"
            />
            <button
              type="button"
              onClick={() => void loadStores()}
              disabled={storesLoading}
              className="btn btn-ghost px-3 py-2 text-[12px]"
            >
              {storesLoading ? "查询中…" : "查询门店"}
            </button>
          </div>

          {stores.length > 0 ? (
            <select
              aria-label="门店"
              value={settings.storeCode}
              onChange={(event) => {
                const hit = stores.find((store) => store.storeCode === event.target.value);
                onSettingsChange({
                  storeCode: event.target.value,
                  storeName: hit?.storeName,
                });
              }}
              className="field mt-1.5 py-2 text-[13px]"
            >
              {stores.map((store) => (
                <option key={store.storeCode} value={store.storeCode}>
                  {store.storeName}
                  {store.address ? ` · ${store.address}` : ""}
                </option>
              ))}
            </select>
          ) : settings.storeCode ? (
            <p className="mt-1 text-[10px] text-ink-500">
              当前门店：{settings.storeName ?? settings.storeCode}（{settings.storeCode}）
            </p>
          ) : null}

          {storeError ? (
            <p className="mt-1 text-[11px] leading-5 text-amber-800">{storeError}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => void handleRecommend()}
          disabled={loading || disabled}
          aria-busy={loading}
          className="btn btn-primary h-11 w-full px-5 text-[14px] sm:w-auto"
        >
          {loading ? "正在调用官方接口核价…" : "按剩余预算推荐今天这顿"}
        </button>
      </div>

      {error ? (
        <div className="mt-3">
          <Notice tone="error" role="alert" title={error.title}>
            {error.hint}
            {error.code ? <span className="ml-1.5 text-[10px] text-ink-400">（{error.code}）</span> : null}
          </Notice>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3" aria-busy="true" aria-live="polite">
          {[0, 1, 2].map((index) => (
            <div key={index} className="skeleton h-56" />
          ))}
        </div>
      ) : null}

      {!loading && result ? (
        result.recommendations.length === 0 ? (
          <div className="mt-4">
            <Notice tone="neutral" title="这个预算内没有合适的完整正餐">
              {result.emptyReason ?? "可以试着把单餐预算调高一点。"}
            </Notice>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 lg:grid-cols-3">
              {result.recommendations.map((rec) => {
                const impact =
                  rec.verifiedPriceFen === null
                    ? null
                    : impactOfVerifiedPrice(summary, rec.verifiedPriceFen, {
                        mealsLeftToday: mealsLeft,
                      });
                const isRecording = recordingType === rec.type;

                return (
                  <article
                    key={rec.type}
                    className="flex h-full flex-col rounded-[20px] border border-line bg-white p-4"
                  >
                    <header className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Tag tone={TYPE_TONE[rec.type]}>{rec.title}</Tag>
                        <p
                          className={`mt-1 text-[10px] ${
                            rec.priceVerified ? "text-mint-600" : "text-amber-700"
                          }`}
                        >
                          {rec.priceVerified ? "官方算价已核验" : "未核验（不能当实付）"}
                          {rec.needsFurtherSelection ? " · 点餐时需选内容" : ""}
                        </p>
                      </div>
                      <p className="num shrink-0 text-lg font-bold leading-none text-ink-900">
                        {formatFen(rec.totalPriceFen)}
                      </p>
                    </header>

                    <ul className="mt-2.5 space-y-1 text-[11px] text-ink-700">
                      {rec.items.map((item) => (
                        <li key={item.code} className="flex justify-between gap-2">
                          <span className="min-w-0 truncate">{item.name}</span>
                          <span className="num shrink-0 text-ink-400">
                            {formatFen(item.unitPriceFen)}
                          </span>
                        </li>
                      ))}
                    </ul>

                    {impact ? (
                      <div className="mt-2.5 rounded-xl bg-cream-deep px-3 py-2 text-[10px] leading-5 text-ink-600">
                        <p className="text-ink-700">
                          吃这顿后余额{" "}
                          <span
                            className={`num font-semibold ${
                              impact.remainingAfterFen < 0 ? "text-red-600" : "text-ink-900"
                            }`}
                          >
                            {formatFenSigned(impact.remainingAfterFen)}
                          </span>
                          ，后续日均{" "}
                          <span className="num font-semibold text-ink-900">
                            {impact.afterDailyFen === null ? "—" : formatFenSigned(impact.afterDailyFen)}
                          </span>
                        </p>
                        <p className="text-ink-400">
                          消费前日均{" "}
                          {impact.beforeDailyFen === null ? "—" : formatFenSigned(impact.beforeDailyFen)}
                          {impact.reserveTouchedFen > 0 ? " · 会动用预留" : ""}
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-auto pt-2.5">
                      {isRecording ? (
                        <div className="space-y-2 rounded-xl border border-line p-2.5">
                          <p className="text-[10px] leading-4 text-ink-500">
                            {draftExpenseFromRecommendation(rec).note}
                          </p>
                          <input
                            aria-label="实际支付金额"
                            inputMode="decimal"
                            value={recordAmountYuan}
                            onChange={(event) => setRecordAmountYuan(event.target.value)}
                            placeholder="实际支付（元）"
                            className="field py-1.5 text-[13px]"
                          />
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => submitRecord(rec)}
                              className="flex-1 rounded-xl bg-mint-500 px-2 py-2 text-[11px] font-semibold text-white transition hover:bg-mint-600"
                            >
                              确认为已消费
                            </button>
                            <button
                              type="button"
                              onClick={() => setRecordingType(null)}
                              className="flex-1 rounded-xl border border-line px-2 py-2 text-[11px] text-ink-600"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openRecord(rec)}
                          disabled={disabled}
                          className="btn btn-ghost w-full px-3 py-2 text-[11px]"
                        >
                          记为已消费
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="surface-muted flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[11px] leading-5 text-ink-500">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-1.5 rounded-full bg-mint-500" />
                官方算价 {result.stats.quotesUsed} 次
              </span>
              <span>
                门店：{result.source.storeName || result.source.storeCode}
                {result.source.storeAddress ? `（${result.source.storeAddress}）` : ""}
              </span>
              <span>
                数据时间：{new Date(result.source.fetchedAt).toLocaleString("zh-CN", { hour12: false })}
              </span>
              <span className="text-ink-400">
                候选 {result.stats.withinBudgetCount} · 耗时 {result.elapsedMs}ms
              </span>
            </div>

            {result.warnings.length > 0 ? (
              <ul className="space-y-1 rounded-2xl bg-amber-50 px-4 py-3 text-[11px] leading-5 text-amber-800 ring-1 ring-amber-200">
                {result.warnings.map((warning) => (
                  <li key={`${warning.code}-${warning.message}`}>
                    {warning.message}
                    <span className="ml-1 text-[10px] text-ink-400">[{warning.code}]</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )
      ) : null}
    </section>
  );
}
