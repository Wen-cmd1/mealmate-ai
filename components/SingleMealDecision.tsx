"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { yuanToFen } from "@/lib/budget/money";
import { PREFERENCE_OPTIONS, type RecommendResponse } from "@/lib/recommendation/types";
import { networkError, readApiError, type FriendlyError } from "@/lib/ui/api-error";
import { Notice, NoticeList } from "@/components/ui/Notice";
import { RecommendationCard } from "@/components/RecommendationCard";

/**
 * 单餐决策交互区（任务 002 建立，任务 005 重做视觉）。
 *
 * 数据流：本组件 → `POST /api/recommend` → 服务端 MCP → 麦当劳官方接口。
 * 浏览器端**只拿到推荐结果**，永远不接触 token，也不直接调 MCP。
 *
 * 位置：首页第二屏，作为自然语言入口的补充——不想打字的人可以直接给预算。
 * 因此这里不再重复"这是什么产品"的宣传语，只保留必要说明。
 */

const BUDGET_PRESETS = [10, 15, 20, 25, 30, 50];
const CITIES = ["广州市", "深圳市", "佛山市", "东莞市", "北京市", "上海市"];
const DEFAULT_CITY = "广州市";
const DEFAULT_KEYWORD = "天河";
const DEFAULT_BUDGET_YUAN = "25";
const MIN_BUDGET_YUAN = 5;
const MAX_BUDGET_YUAN = 200;

interface StoreOption {
  storeCode: string;
  storeName: string;
  address?: string;
  businessStatus?: boolean;
}

function parseBudgetYuan(input: string): number | null {
  try {
    const fen = yuanToFen(input);
    if (!Number.isInteger(fen)) return null;
    if (fen < MIN_BUDGET_YUAN * 100 || fen > MAX_BUDGET_YUAN * 100) return null;
    return fen;
  } catch {
    return null;
  }
}

export function SingleMealDecision() {
  const [budgetYuan, setBudgetYuan] = useState(DEFAULT_BUDGET_YUAN);
  const [city, setCity] = useState(DEFAULT_CITY);
  const [keyword, setKeyword] = useState(DEFAULT_KEYWORD);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeCode, setStoreCode] = useState("");
  const [preferences, setPreferences] = useState<string[]>([]);

  const [storesLoading, setStoresLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [result, setResult] = useState<RecommendResponse | null>(null);

  const resultRef = useRef<HTMLDivElement | null>(null);

  const loadStores = useCallback(async (nextCity: string, nextKeyword: string) => {
    setStoresLoading(true);
    setStoreError(null);
    try {
      const query = new URLSearchParams({ city: nextCity, keyword: nextKeyword });
      const response = await fetch(`/api/stores?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const friendly = await readApiError(response);
        setStoreError(`${friendly.title}。${friendly.hint}`);
        setStores([]);
        setStoreCode("");
        return;
      }
      const data = (await response.json()) as { stores?: StoreOption[] };
      const list = data.stores ?? [];
      setStores(list);
      setStoreCode(list[0]?.storeCode ?? "");
      if (list.length === 0) setStoreError("这个商圈没查到门店，试试换个关键词（例如：天河、大学城）");
    } catch {
      setStoreError(networkError().hint);
    } finally {
      setStoresLoading(false);
    }
  }, []);

  // 首次进入自动拉一次门店（用默认城市 + 商圈），失败也不影响页面其他部分
  useEffect(() => {
    void loadStores(DEFAULT_CITY, DEFAULT_KEYWORD);
  }, [loadStores]);

  function togglePreference(preference: string) {
    setPreferences((prev) =>
      prev.includes(preference) ? prev.filter((p) => p !== preference) : [...prev, preference],
    );
  }

  async function handleRecommend() {
    // 防重复提交：请求中直接忽略
    if (loading) return;
    setError(null);

    const budgetFen = parseBudgetYuan(budgetYuan);
    if (budgetFen === null) {
      setError({
        title: "预算数字不太对",
        hint: `单餐预算需要在 ¥${MIN_BUDGET_YUAN} ~ ¥${MAX_BUDGET_YUAN} 之间，最多两位小数。`,
        retryable: false,
      });
      return;
    }
    if (!storeCode) {
      setError({
        title: "还没选定门店",
        hint: "先在上面选一家门店，才能查到这家店真实的菜单与价格。",
        retryable: false,
      });
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          budgetFen,
          city,
          keyword,
          storeCode,
          orderType: 1,
          beType: 1,
          preferences,
        }),
      });
      if (!response.ok) {
        setError(await readApiError(response));
        return;
      }
      setResult((await response.json()) as RecommendResponse);
      requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch {
      setError(networkError());
    } finally {
      setLoading(false);
    }
  }

  const selectedStore = stores.find((s) => s.storeCode === storeCode);

  return (
    <section id="single-meal" className="surface scroll-mt-24 p-4 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* 预算 */}
        <div>
          <label htmlFor="budget" className="block text-[12px] font-medium text-ink-700">
            单餐预算（元）
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="num text-lg font-semibold text-ink-400">¥</span>
            <input
              id="budget"
              type="number"
              inputMode="decimal"
              min={MIN_BUDGET_YUAN}
              max={MAX_BUDGET_YUAN}
              step={0.5}
              value={budgetYuan}
              onChange={(event) => setBudgetYuan(event.target.value)}
              className="field w-24 py-2 text-base font-semibold"
            />
            <div className="flex flex-wrap gap-1">
              {BUDGET_PRESETS.map((preset) => {
                const active = Number(budgetYuan) === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setBudgetYuan(String(preset))}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                      active
                        ? "bg-brand-500 text-white"
                        : "bg-cream-deep text-ink-600 hover:bg-brand-50 hover:text-brand-700"
                    }`}
                  >
                    ¥{preset}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 门店 */}
        <div>
          <span className="block text-[12px] font-medium text-ink-700">城市与门店</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <select
              aria-label="城市"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              className="field w-auto py-2 text-[13px]"
            >
              {CITIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <input
              aria-label="商圈关键词"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="商圈，如 天河"
              className="field w-24 py-2 text-[13px] sm:w-32"
            />
            <button
              type="button"
              onClick={() => void loadStores(city, keyword)}
              disabled={storesLoading}
              className="btn btn-ghost px-2.5 py-2 text-[12px]"
            >
              {storesLoading ? "查询中…" : "查询门店"}
            </button>
          </div>
          <select
            id="store"
            value={storeCode}
            onChange={(event) => setStoreCode(event.target.value)}
            disabled={stores.length === 0}
            aria-label="门店"
            className="field mt-1.5 py-2 text-[13px]"
          >
            {stores.length === 0 ? (
              <option value="">{storesLoading ? "正在查询门店…" : "暂无门店"}</option>
            ) : (
              stores.map((store) => (
                <option key={store.storeCode} value={store.storeCode}>
                  {store.storeName}
                  {store.address ? ` · ${store.address}` : ""}
                </option>
              ))
            )}
          </select>
          {storeError ? (
            <p className="mt-1 text-[11px] leading-5 text-amber-800">{storeError}</p>
          ) : (
            <p className="mt-1 text-[11px] leading-5 text-ink-400">
              上游要求「城市 + 商圈关键词」才能查门店，只给城市会报错。
            </p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[12px] font-medium text-ink-700">
          口味偏好 <span className="font-normal text-ink-400">（可选，可多选，只影响排序）</span>
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {PREFERENCE_OPTIONS.map((preference) => {
            const active = preferences.includes(preference);
            return (
              <button
                key={preference}
                type="button"
                aria-pressed={active}
                onClick={() => togglePreference(preference)}
                className={`rounded-full border px-3 py-1.5 text-[12px] transition ${
                  active
                    ? "border-brand-500 bg-brand-500 text-white"
                    : "border-line bg-white text-ink-600 hover:border-brand-200 hover:text-brand-700"
                }`}
              >
                {preference}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => void handleRecommend()}
          disabled={loading}
          aria-busy={loading}
          className="btn btn-primary h-11 w-full px-5 text-[14px] sm:w-auto"
        >
          {loading ? "正在调用官方接口核价…" : "按预算帮我挑三份"}
        </button>
        {selectedStore ? (
          <p className="text-[11px] text-ink-400">
            当前门店：{selectedStore.storeName}
            {selectedStore.businessStatus === false ? "（显示为休息中）" : ""}
          </p>
        ) : null}
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
        <div className="mt-4 grid gap-3 sm:grid-cols-3" aria-live="polite" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className="skeleton h-64" />
          ))}
        </div>
      ) : null}

      {!loading && result ? (
        <div ref={resultRef} className="mt-4 scroll-mt-24 space-y-3">
          {result.recommendations.length > 0 ? (
            <>
              {/* 份数由真实候选决定（1~3）。写死 3 列时，只有 2 份会在右侧留一个空洞
                  （任务 006 用 ¥18 预算的真实菜单复现），所以按实际份数选栅格。 */}
              <div
                className={
                  result.recommendations.length >= 3
                    ? "grid gap-3 md:grid-cols-3"
                    : "grid gap-3 md:grid-cols-2"
                }
              >
                {result.recommendations.map((rec) => (
                  <RecommendationCard key={rec.type} rec={rec} />
                ))}
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
                  数据时间：
                  {new Date(result.source.fetchedAt).toLocaleString("zh-CN", { hour12: false })}
                </span>
                <span className="text-ink-400">
                  候选 {result.stats.withinBudgetCount} · 耗时 {result.elapsedMs}ms
                </span>
              </div>

              {result.warnings.length > 0 ? (
                <NoticeList
                  tone="warn"
                  title="这次查询的提示"
                  items={result.warnings.map((warning) => (
                    <>
                      {warning.message}
                      <span className="ml-1 text-[10px] text-ink-400">[{warning.code}]</span>
                    </>
                  ))}
                />
              ) : null}
            </>
          ) : (
            <Notice tone="neutral" title="没有找到合适的推荐">
              {result.emptyReason ?? "预算内没有符合条件的完整正餐。"}
              <span className="mt-1 block text-[11px] text-ink-400">
                门店：{result.source.storeName || result.source.storeCode} · 菜单{" "}
                {result.stats.menuItemCount} 项 · 其中可作为正餐 {result.stats.anchorCount} 项
              </span>
            </Notice>
          )}
        </div>
      ) : null}
    </section>
  );
}
