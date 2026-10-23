import { describe, expect, it } from "vitest";

import {
  addDays,
  compareDateKeys,
  dateKeyOfInstant,
  dayCount,
  daysInMonth,
  derivePeriodDates,
  diffDays,
  elapsedDaysInPeriod,
  endOfMonth,
  formatPeriodLabel,
  fromEpochDay,
  isPeriodEnded,
  isValidDateKey,
  isValidTimeZone,
  isoToLocalDateTimeInput,
  localDateTimeToIso,
  remainingDaysInPeriod,
  startOfMonth,
  startOfWeek,
  toEpochDay,
  todayKey,
  weekdayOf,
} from "@/lib/budget/period";

/** 任务 003：周期计算（含跨月、跨年、闰年、时区） */
describe("日期合法性", () => {
  it("接受合法日期、拒绝非法日期", () => {
    expect(isValidDateKey("2026-10-21")).toBe(true);
    expect(isValidDateKey("2024-02-29")).toBe(true); // 闰年
    expect(isValidDateKey("2026-02-29")).toBe(false); // 平年
    expect(isValidDateKey("2026-13-01")).toBe(false);
    expect(isValidDateKey("2026-04-31")).toBe(false);
    expect(isValidDateKey("2026-1-1")).toBe(false);
    expect(isValidDateKey("1999-12-31")).toBe(false); // 超出允许范围
    expect(isValidDateKey("")).toBe(false);
    expect(isValidDateKey(null as unknown as string)).toBe(false);
  });

  it("每月天数（含闰年二月）", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("时区合法性", () => {
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("纪元日运算（跨月 / 跨年）", () => {
  it("加减天数可以跨年", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("加减天数可以跨月且不会跳到 3 月 3 日", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("纪元日与日期可以互相还原", () => {
    // 2000-01-01 是本项目允许的最早日期（MIN_DATE_KEY）
    for (const key of ["2000-01-01", "2026-10-21", "2026-12-31", "2100-12-31"]) {
      expect(fromEpochDay(toEpochDay(key))).toBe(key);
    }
  });

  it("天数差与含首尾天数", () => {
    expect(diffDays("2026-10-01", "2026-10-31")).toBe(30);
    expect(dayCount("2026-10-01", "2026-10-31")).toBe(31);
    expect(dayCount("2026-10-31", "2026-10-01")).toBe(0); // 反序不返回负数
    expect(dayCount("2026-10-31", "2026-11-01")).toBe(2);
    expect(dayCount("2026-12-31", "2027-01-01")).toBe(2);
  });

  it("比较日期", () => {
    expect(compareDateKeys("2026-10-01", "2026-10-02")).toBeLessThan(0);
    expect(compareDateKeys("2026-10-02", "2026-10-02")).toBe(0);
    expect(compareDateKeys("2027-01-01", "2026-12-31")).toBeGreaterThan(0);
  });
});

describe("周期推算", () => {
  it("每周：周一到周日（跨月）", () => {
    expect(weekdayOf("2026-10-21")).toBe(3); // 周三
    const range = derivePeriodDates("week", "2026-10-21");
    expect(range.startDate).toBe("2026-10-19");
    expect(range.endDate).toBe("2026-10-25");
    expect(dayCount(range.startDate, range.endDate)).toBe(7);

    const crossMonth = derivePeriodDates("week", "2026-10-31");
    expect(crossMonth.startDate).toBe("2026-10-26");
    expect(crossMonth.endDate).toBe("2026-11-01");
  });

  it("每周：周日属于上一周", () => {
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19");
  });

  it("每月：自动取月末（28/29/30/31 天）", () => {
    expect(derivePeriodDates("month", "2026-02-15")).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
    expect(derivePeriodDates("month", "2024-02-15").endDate).toBe("2024-02-29");
    expect(derivePeriodDates("month", "2026-04-30").endDate).toBe("2026-04-30");
    expect(startOfMonth("2026-10-21")).toBe("2026-10-01");
    expect(endOfMonth("2026-10-21")).toBe("2026-10-31");
  });

  it("自定义周期：直接使用给定起止", () => {
    expect(derivePeriodDates("custom", "2026-12-20")).toEqual({
      startDate: "2026-12-20",
      endDate: "2026-12-20",
    });
  });
});

describe("剩余天数（含今天）", () => {
  it("月中、月末、周期已结束、周期未开始", () => {
    expect(remainingDaysInPeriod("2026-10-01", "2026-10-31", "2026-10-21")).toBe(11);
    expect(remainingDaysInPeriod("2026-10-01", "2026-10-31", "2026-10-31")).toBe(1);
    expect(remainingDaysInPeriod("2026-10-01", "2026-10-31", "2026-11-01")).toBe(0);
    expect(remainingDaysInPeriod("2026-10-01", "2026-10-31", "2026-09-30")).toBe(31);
    // 跨年周期
    expect(remainingDaysInPeriod("2026-12-20", "2027-01-10", "2026-12-31")).toBe(11);
  });

  it("已经过天数", () => {
    expect(elapsedDaysInPeriod("2026-10-01", "2026-10-31", "2026-10-21")).toBe(21);
    expect(elapsedDaysInPeriod("2026-10-01", "2026-10-31", "2026-09-30")).toBe(0);
    expect(elapsedDaysInPeriod("2026-10-01", "2026-10-31", "2026-11-15")).toBe(31);
  });

  it("周期是否结束", () => {
    expect(isPeriodEnded("2026-10-31", "2026-10-31")).toBe(false);
    expect(isPeriodEnded("2026-10-31", "2026-11-01")).toBe(true);
  });

  it("零长度周期不会除零或返回负数", () => {
    expect(dayCount("2026-10-21", "2026-10-20")).toBe(0);
    expect(remainingDaysInPeriod("2026-10-21", "2026-10-20", "2026-10-21")).toBe(0);
    expect(elapsedDaysInPeriod("2026-10-21", "2026-10-20", "2026-10-21")).toBe(0);
  });
});

describe("时区 → 日历日", () => {
  it("同一时刻在不同时区属于不同的一天", () => {
    const instant = "2026-10-31T16:30:00.000Z";
    expect(dateKeyOfInstant(instant, "Asia/Shanghai")).toBe("2026-11-01");
    expect(dateKeyOfInstant(instant, "UTC")).toBe("2026-10-31");
  });

  it("跨年边界", () => {
    const instant = "2026-12-31T16:00:00.000Z";
    expect(dateKeyOfInstant(instant, "Asia/Shanghai")).toBe("2027-01-01");
    expect(dateKeyOfInstant(instant, "America/New_York")).toBe("2026-12-31");
  });

  it("非法时间戳返回 null", () => {
    expect(dateKeyOfInstant("not-a-date", "UTC")).toBeNull();
  });

  it("todayKey 使用指定时区", () => {
    const now = new Date("2026-10-31T16:30:00.000Z");
    expect(todayKey("Asia/Shanghai", now)).toBe("2026-11-01");
    expect(todayKey("UTC", now)).toBe("2026-10-31");
  });

  it("form 日期时间与 ISO 可以互相还原", () => {
    const iso = localDateTimeToIso("2026-10-21T12:34");
    expect(iso).toBeTruthy();
    expect(isoToLocalDateTimeInput(iso as string)).toBe("2026-10-21T12:34");
    // 只给日期时默认中午，避免 UTC 偏移把日期推到前一天
    expect(localDateTimeToIso("2026-10-21")).toContain("2026-10-21");
    expect(localDateTimeToIso("2026/10/21")).toBeNull();
  });
});

describe("周期文案", () => {
  it("包含起止与天数", () => {
    expect(formatPeriodLabel("2026-10-01", "2026-10-31")).toBe("2026-10-01 ~ 2026-10-31（31 天）");
  });
});
