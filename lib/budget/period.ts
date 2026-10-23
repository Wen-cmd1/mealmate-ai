/**
 * 日期与预算周期计算。
 *
 * 核心约定：日期是**本地日历日**（`DateKey = YYYY-MM-DD`），不是时间戳。
 *
 * 为什么不用 `Date` 直接加减：
 * - 服务端默认 UTC，客户端东八区，「今天」会差一天；
 * - `Date` 的 `setMonth` 在 1/31 加一个月会跳到 3/3，跨月边界必须显式取月末；
 * - 夏令时地区 `addDays` 用毫秒累加会差 1 小时，跨过午夜就错一天。
 *
 * 因此这里统一用「纪元日序号」（epoch day = 从 1970-01-01 起的天数）做整数运算：
 * 加减 1 天就是 ±1，跨月跨年自动正确，且不受时区/夏令时影响。
 * 时区只在**一个地方**用到：把「时间戳」换算成「用户时区里的哪一天」。
 */

import type { DateKey, IsoDateTime, PeriodKind } from "./types";

const MS_PER_DAY = 86_400_000;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 预算日期的合理范围（storage 校验与 UI 限制共用） */
export const MIN_DATE_KEY = "2000-01-01";
export const MAX_DATE_KEY = "2100-12-31";

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function daysInMonth(year: number, month: number): number {
  // Date.UTC(year, month, 0) = 该月最后一天
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidDateKey(value: unknown): value is DateKey {
  if (typeof value !== "string") return false;
  const matched = DATE_KEY_RE.exec(value);
  if (!matched) return false;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return value >= MIN_DATE_KEY && value <= MAX_DATE_KEY;
}

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export function parseDateKey(key: string): DateParts {
  if (!isValidDateKey(key)) {
    throw new RangeError(`非法的日期："${key}"（应为 YYYY-MM-DD）`);
  }
  const [year, month, day] = key.split("-").map(Number) as [number, number, number];
  return { year, month, day };
}

/** 日期 → 纪元日序号 */
export function toEpochDay(key: DateKey): number {
  const { year, month, day } = parseDateKey(key);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** 纪元日序号 → 日期 */
export function fromEpochDay(epochDay: number): DateKey {
  const date = new Date(epochDay * MS_PER_DAY);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function addDays(key: DateKey, days: number): DateKey {
  if (!Number.isInteger(days)) throw new RangeError(`加减天数必须是整数，收到：${days}`);
  return fromEpochDay(toEpochDay(key) + days);
}

/** to - from 的天数差（同日为 0） */
export function diffDays(from: DateKey, to: DateKey): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** 含首尾的总天数；to < from 时返回 0（不返回负数） */
export function dayCount(from: DateKey, to: DateKey): number {
  return Math.max(0, diffDays(from, to) + 1);
}

export function compareDateKeys(a: DateKey, b: DateKey): number {
  return toEpochDay(a) - toEpochDay(b);
}

export function minDateKey(a: DateKey, b: DateKey): DateKey {
  return compareDateKeys(a, b) <= 0 ? a : b;
}

export function maxDateKey(a: DateKey, b: DateKey): DateKey {
  return compareDateKeys(a, b) >= 0 ? a : b;
}

/* ------------------------------------------------------------------ *
 * 时区 → 日历日
 * ------------------------------------------------------------------ */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

export function isValidTimeZone(timezone: unknown): timezone is string {
  if (typeof timezone !== "string" || timezone.trim() === "") return false;
  try {
    dayFormatter(timezone);
    return true;
  } catch {
    return false;
  }
}

/**
 * 时间戳 → 指定时区里的日历日。
 * `occurredAt` 非法时返回 null（由调用方决定是丢弃还是报错）。
 */
export function dateKeyOfInstant(instant: IsoDateTime | Date, timezone: string): DateKey | null {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;

  const parts = dayFormatter(timezone).formatToParts(date);
  let year = "";
  let month = "";
  let day = "";
  for (const part of parts) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
  }
  if (!year || !month || !day) return null;

  const key = `${year}-${pad2(Number(month))}-${pad2(Number(day))}`;
  return isValidDateKey(key) ? key : null;
}

/** 指定时区里的「今天」 */
export function todayKey(timezone: string, now: Date = new Date()): DateKey {
  const key = dateKeyOfInstant(now, timezone);
  if (!key) throw new RangeError(`无法在时区 ${timezone} 下解析当前日期`);
  return key;
}

/**
 * 把本地日期时间（如 `<input type="datetime-local">` 的 `2026-10-21T12:30`）
 * 解析成 ISO 时间戳。按**浏览器本地时区**解释，与服务端无关。
 */
export function localDateTimeToIso(input: string): IsoDateTime | null {
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(input)) return null;
  // 只给日期时默认当天 12:00，避免 UTC 偏移把日期推到前一天/后一天
  const normalized = input.includes("T") ? input : `${input}T12:00`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** ISO 时间戳 → `<input type="datetime-local">` 的值（浏览器本地时区） */
export function isoToLocalDateTimeInput(instant: IsoDateTime): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}

/* ------------------------------------------------------------------ *
 * 周期推算
 * ------------------------------------------------------------------ */

export const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

/** 该日期是周几（0=周日） */
export function weekdayOf(key: DateKey): number {
  // 1970-01-01 是周四（4）
  return (((toEpochDay(key) + 4) % 7) + 7) % 7;
}

/** 所在周的周一（ISO 周，周一开始） */
export function startOfWeek(key: DateKey): DateKey {
  const weekday = weekdayOf(key);
  const offset = weekday === 0 ? 6 : weekday - 1;
  return addDays(key, -offset);
}

export function startOfMonth(key: DateKey): DateKey {
  const { year, month } = parseDateKey(key);
  return `${year}-${pad2(month)}-01`;
}

export function endOfMonth(key: DateKey): DateKey {
  const { year, month } = parseDateKey(key);
  return `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
}

export interface PeriodRange {
  startDate: DateKey;
  endDate: DateKey;
}

/**
 * 按周期类型与锚点日期推算起止日期。
 * - `week`：锚点所在周的周一 ~ 周日（7 天，跨月跨年均正确）
 * - `month`：锚点所在月的 1 日 ~ 月末（自动处理 28/29/30/31 天）
 * - `custom`：由调用方给出起止日期
 */
export function derivePeriodDates(periodKind: PeriodKind, anchor: DateKey): PeriodRange {
  switch (periodKind) {
    case "week":
      return { startDate: startOfWeek(anchor), endDate: addDays(startOfWeek(anchor), 6) };
    case "month":
      return { startDate: startOfMonth(anchor), endDate: endOfMonth(anchor) };
    case "custom":
      return { startDate: anchor, endDate: anchor };
  }
}

/**
 * 剩余预算天数（**含今天**）。
 * - 周期已结束 → 0
 * - 今天还没开始 → 整个周期天数
 * - 不会返回负数，也不会超过周期总天数
 */
export function remainingDaysInPeriod(
  startDate: DateKey,
  endDate: DateKey,
  today: DateKey,
): number {
  const total = dayCount(startDate, endDate);
  if (total === 0) return 0;

  const effectiveToday = maxDateKey(today, startDate);
  const remaining = diffDays(effectiveToday, endDate) + 1;
  return Math.min(total, Math.max(0, remaining));
}

/** 已经过的天数（含今天，最多等于总天数，周期未开始为 0） */
export function elapsedDaysInPeriod(
  startDate: DateKey,
  endDate: DateKey,
  today: DateKey,
): number {
  const total = dayCount(startDate, endDate);
  if (total === 0) return 0;
  if (compareDateKeys(today, startDate) < 0) return 0;
  return Math.min(total, diffDays(startDate, today) + 1);
}

export function isPeriodEnded(endDate: DateKey, today: DateKey): boolean {
  return compareDateKeys(today, endDate) > 0;
}

export function isPeriodNotStarted(startDate: DateKey, today: DateKey): boolean {
  return compareDateKeys(today, startDate) < 0;
}

/** 面向用户的中文范围描述，如 `2026-10-01 ~ 2026-10-31（31 天）` */
export function formatPeriodLabel(startDate: DateKey, endDate: DateKey): string {
  return `${startDate} ~ ${endDate}（${dayCount(startDate, endDate)} 天）`;
}
