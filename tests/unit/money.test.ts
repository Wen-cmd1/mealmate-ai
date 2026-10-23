import { describe, expect, it } from "vitest";

import {
  assertFen,
  fenToYuan,
  formatFen,
  isWithinBudget,
  sumFen,
  yuanToFen,
} from "@/lib/budget/money";

describe("金额单位转换（元 ↔ 分）", () => {
  it("把上游菜单的元字符串正确转成分", () => {
    // 这些字符串全部来自真实 query-meals 返回
    expect(yuanToFen("25.5")).toBe(2550);
    expect(yuanToFen("22.5")).toBe(2250);
    expect(yuanToFen("34.5")).toBe(3450);
    expect(yuanToFen("3")).toBe(300);
    expect(yuanToFen("72.5")).toBe(7250);
  });

  it("避免浮点误差（0.1 + 0.2 场景）", () => {
    // 若用 parseFloat(x)*100，22.5*100 会出现 2250.0000000000002 之类的误差
    expect(yuanToFen("0.1") + yuanToFen("0.2")).toBe(30);
    expect(yuanToFen(25.5)).toBe(2550);
    expect(yuanToFen(15.9)).toBe(1590);
  });

  it("超过两位小数时按第三位四舍五入", () => {
    expect(yuanToFen("12.345")).toBe(1235);
    expect(yuanToFen("12.344")).toBe(1234);
    expect(yuanToFen("0.005")).toBe(1);
  });

  it("拒绝非法金额输入", () => {
    expect(() => yuanToFen("abc")).toThrow();
    expect(() => yuanToFen("")).toThrow();
    expect(() => yuanToFen(Number.NaN)).toThrow();
    expect(() => yuanToFen(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("分转元仅用于展示", () => {
    expect(fenToYuan(2250)).toBe(22.5);
    expect(fenToYuan(0)).toBe(0);
  });

  it("格式化输出人民币两位小数", () => {
    expect(formatFen(2250)).toContain("22.50");
    expect(formatFen(500)).toContain("5.00");
  });

  it("整数分校验：非整数 / 负数必须报错", () => {
    expect(() => assertFen(22.5)).toThrow(/整数分/);
    expect(() => assertFen(-1)).toThrow(/负数/);
    expect(() => assertFen(2250)).not.toThrow();
  });

  it("整数求和无浮点漂移", () => {
    expect(sumFen([2250, 3450, 5])).toBe(5705);
    expect(sumFen([])).toBe(0);
  });

  it("预算判断", () => {
    expect(isWithinBudget(2250, 2250)).toBe(true);
    expect(isWithinBudget(2251, 2250)).toBe(false);
  });
});
