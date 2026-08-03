import { describe, expect, it } from "vitest";
import { formatRupiah, parseRupiah } from "./rupiah";

describe("rupiah", () => {
  it("parses supported whole-rupiah forms", () => {
    expect(parseRupiah("84000")).toBe(84000);
    expect(parseRupiah("84.000")).toBe(84000);
    expect(parseRupiah("1.000.000")).toBe(1_000_000);
  });

  it("rejects invalid, zero, and out-of-range amounts", () => {
    for (const value of ["0", "00", "84.00", "84,000", "+84000", "-84000", "84 000", "84.000.00", "abc", "", "2147483648"]) {
      expect(parseRupiah(value)).toBeNull();
    }
    expect(parseRupiah(84000)).toBeNull();
  });

  it("formats whole rupiah", () => {
    expect(formatRupiah(0)).toBe("Rp 0");
    expect(formatRupiah(84000)).toBe("Rp 84.000");
    expect(formatRupiah(Number.MAX_SAFE_INTEGER)).toBe("Rp 9.007.199.254.740.991");
  });

  it("rejects invalid formatter amounts", () => {
    for (const amount of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => formatRupiah(amount)).toThrow(RangeError);
    }
  });
});
