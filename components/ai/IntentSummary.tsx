"use client";

import { formatFenSigned } from "@/lib/budget/money";
import {
  INTENT_PARSE_MODE_LABELS,
  USER_STATE_LABELS,
  type BudgetSource,
  type DecideResponse,
} from "@/lib/ai/types";

/**
 * 「AI 理解了哪些需求」（任务 004 建立，任务 005 重做视觉）。
 *
 * 这一块是任务 004 的**透明度承诺**：用户必须能一眼看到系统到底从他那句话里
 * 读出了什么——包括读错了什么。所以：
 * - 没识别到的条件显示为「未提及」，而不是悄悄用默认值；
 * - 解析模式明确标注 LLM 还是规则降级，规则模式下不冒充大模型；
 * - 抽取依据（signals）可展开，用的词是"我按这几个词判断的"，不是"我以为"。
 *
 * 视觉上把它压成一张"回执条"：一行结论 + 若干标签，不让它抢走推荐卡的注意力。
 */

/** 预算来源的短标签：五个字以内的版本，避免在窄卡片里被截断 */
const BUDGET_SOURCE_SHORT: Record<BudgetSource, string> = {
  user_hard_cap: "你说的上限",
  user_soft_target: "你说的价位",
  plan_suggestion: "长期预算推算",
  context_hard_cap: "你的单餐上限",
  default: "默认值",
};

function Item({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "brand" | "warn" | "mint";
}) {
  const valueClass =
    tone === "brand"
      ? "text-brand-700"
      : tone === "warn"
        ? "text-amber-800"
        : tone === "mint"
          ? "text-mint-600"
          : "text-ink-900";
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-white px-2.5 py-2 ring-1 ring-line">
      <span className="truncate text-[10px] leading-none text-ink-400">{label}</span>
      <span className={`truncate text-[12px] font-semibold leading-5 ${valueClass}`} title={value}>
        {value}
      </span>
    </div>
  );
}

export function IntentSummary({ result }: { result: DecideResponse }) {
  const { understood, budget, intent, mode, ai } = result;
  const isLlm = mode === "LLM";
  const usesDefaultBudget = budget.source === "default";

  return (
    <section className="surface p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-ink-900">我理解到的需求</h3>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium leading-none ${
              isLlm
                ? "border-mint-100 bg-mint-50 text-mint-600"
                : "border-line bg-cream-deep text-ink-500"
            }`}
            title={
              isLlm
                ? "本次由配置的大模型完成语义解析，并通过 Schema 校验"
                : "本次没有调用大模型，由确定性规则解析"
            }
          >
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${isLlm ? "bg-mint-500" : "bg-ink-400"}`}
            />
            {INTENT_PARSE_MODE_LABELS[mode]}
          </span>
        </div>
        {isLlm && ai?.model ? (
          <span className="text-[10px] text-ink-400">模型：{ai.model}</span>
        ) : null}
      </header>

      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
        <Item label="餐次" value={understood.mealTypeLabel} />
        <Item
          label={usesDefaultBudget ? "预算 · 默认值" : `预算 · ${BUDGET_SOURCE_SHORT[budget.source]}`}
          value={formatFenSigned(budget.appliedFen)}
          tone={usesDefaultBudget ? "warn" : "brand"}
        />
        <Item label="目标" value={understood.goalLabel} />
        <Item
          label="想吃"
          value={understood.preferences.length > 0 ? understood.preferences.join("、") : "未提及"}
        />
        <Item
          label="排除"
          value={understood.avoid.length > 0 ? `${understood.avoid.join("、")}（已过滤）` : "未提及"}
          tone={understood.avoid.length > 0 ? "warn" : "neutral"}
        />
      </div>

      <p className="mt-2.5 text-[12px] leading-6 text-ink-600">{budget.explanation}</p>

      {understood.avoid.length > 0 ? (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
          排除条件已生效：名称里带「{understood.avoid.join("、")}」的餐品这次不会被推荐。
          但接口只给菜名、没有配料表与辣度标注，所以
          <span className="font-semibold">不能保证绝对不含</span>，点单时请再和门店确认。
        </p>
      ) : null}

      {understood.remainingMentionFen !== null ? (
        <p className="mt-2 rounded-xl bg-cream-deep px-3 py-2 text-[11px] leading-5 text-ink-600">
          你提到还剩 {formatFenSigned(understood.remainingMentionFen)}
          ，这只是参考：系统没有读写你的账本，也不会把它记成任何一笔消费。
        </p>
      ) : null}

      {understood.userStates.length > 0 || understood.wantsCompleteMeal ? (
        <p className="mt-2 text-[11px] leading-5 text-ink-500">
          这句话里的状态：
          {[
            ...understood.userStates.map((state) => USER_STATE_LABELS[state]),
            ...(understood.wantsCompleteMeal ? ["想吃一顿完整的"] : []),
          ].join("、")}
          。这些只影响"三份方案里谁排第一"，不会改变你的预算与排除条件。
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {intent.signals.length > 0 ? (
          <details className="text-[11px] text-ink-500">
            <summary className="cursor-pointer select-none hover:text-ink-900">
              我按这几个词判断的（{intent.signals.length} 条）
            </summary>
            <ul className="mt-1.5 space-y-0.5 border-l border-line pl-3">
              {intent.signals.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
          </details>
        ) : null}

        {!isLlm && ai?.fallbackReason ? (
          <details className="text-[11px] text-ink-500">
            <summary className="cursor-pointer select-none hover:text-ink-900">
              为什么不是大模型解析
            </summary>
            <p className="mt-1.5 max-w-xl leading-5">
              {ai.fallbackReason}。规则模式只识别预算、餐次、口味、排除项等有限条件，
              不等同于大模型的语义理解；页面不会把它标成"AI 理解"。
            </p>
          </details>
        ) : null}
      </div>
    </section>
  );
}
