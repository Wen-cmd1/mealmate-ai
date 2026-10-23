/**
 * 金额工具：全项目内部统一使用**整数分**（fen）。
 *
 * 为什么必须用整数：
 * - 上游 `calculate-price` 直接返回分（如 2250 = ¥22.50）；
 * - 上游 `query-meals` 返回元字符串（如 "25.5"）；
 * - 浮点累加（22.50 + 34.50）在预算累计场景会出现 0.1 + 0.2 类误差，
 *   因此本项目只在**展示层**才把分换算成元。
 */

export const CURRENCY = "CNY" as const;

const YUAN_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * 元 → 分。接受 `"25.5"` / `"22.50"` / `25.5` 等形式。
 * 用字符串逐位解析，避免 `25.5 * 100 = 2549.9999...` 的浮点误差；
 * 超过两位小数时按第三位四舍五入。
 */
export function yuanToFen(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new TypeError(`非法的金额数值：${String(input)}`);
    }
    input = input.toFixed(4);
  }

  const text = input.trim();
  if (!YUAN_PATTERN.test(text)) {
    throw new TypeError(`非法的金额字符串："${input}"`);
  }

  const negative = text.startsWith("-");
  const [integerPart, fractionPart = ""] = (negative ? text.slice(1) : text).split(".");

  const fenFromInteger = Number(integerPart) * 100;
  const twoDigits = (fractionPart + "00").slice(0, 2);
  let fen = fenFromInteger + Number(twoDigits);

  // 第三位小数四舍五入
  if (fractionPart.length > 2 && Number(fractionPart[2]) >= 5) {
    fen += 1;
  }

  return negative ? -fen : fen;
}

/** 分 → 元（仅用于展示或对外 API 输出，不参与内部计算） */
export function fenToYuan(fen: number): number {
  assertFen(fen);
  return fen / 100;
}

/** 格式化为人民币字符串，如 `¥22.50`。 */
export function formatFen(fen: number): string {
  assertFen(fen);
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: CURRENCY,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(fen / 100);
}

/**
 * 带符号的金额格式化，如 `-¥12.50`。
 *
 * 预算场景里「剩余预算」「日均可用」都可能为负（超支），
 * 而 `formatFen` 会拒绝负数（它用于「价格」，价格不该是负的）。
 * 所以这里单独提供一个只做展示的带符号版本，内部仍复用 `formatFen`。
 */
export function formatFenSigned(fen: number): string {
  if (!Number.isInteger(fen)) {
    throw new TypeError(`金额必须是整数分，收到：${fen}`);
  }
  return fen < 0 ? `-${formatFen(-fen)}` : formatFen(fen);
}

/** 分求和（整数运算，无浮点误差） */
export function sumFen(values: readonly number[]): number {
  return values.reduce((total, value) => {
    assertFen(value);
    return total + value;
  }, 0);
}

/** 校验是否为整数分；上游若返回小数说明字段口径变了，必须立刻暴露 */
export function assertFen(fen: number, label = "金额"): void {
  if (!Number.isInteger(fen)) {
    throw new TypeError(`${label}必须是整数分，收到：${fen}`);
  }
  if (fen < 0) {
    throw new TypeError(`${label}不能为负数，收到：${fen}`);
  }
}

/** 预算判断辅助：是否在预算内 */
export function isWithinBudget(totalFen: number, budgetFen: number): boolean {
  assertFen(totalFen, "总价");
  assertFen(budgetFen, "预算");
  return totalFen <= budgetFen;
}
