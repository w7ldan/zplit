import { describe, expect, it } from "vitest";
import {
  clampPage,
  escapeLikePattern,
  groupRecordsByMonth,
  monthDisplayLabel,
  monthKey,
  monthStart,
  nextMonthStart,
  normalizeExpenseFilters,
  normalizeFriendFilters,
  normalizeMonth,
  normalizeOutingFilters,
  normalizeRepaymentFilters,
  normalizeText,
  normalizeTimezoneOffset,
  normalizeUuid,
  pageResult,
} from "./record-retrieval";

describe("record retrieval", () => {
  it("normalizes text, UUID, month, enum, and page filters", () => {
    expect(normalizeText("  Ada   Lovelace  ")).toBe("Ada Lovelace");
    expect(normalizeText("x".repeat(101))).toHaveLength(100);
    expect(normalizeUuid("550E8400-E29B-41D4-A716-446655440000")).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(normalizeUuid("not-a-uuid")).toBeUndefined();
    expect(normalizeMonth("2026-00")).toBeUndefined();
    expect(normalizeMonth("2026-13")).toBeUndefined();
    expect(normalizeMonth("2026-04")).toBe("2026-04");
    expect(normalizeTimezoneOffset(-840)).toBe(-840);
    expect(normalizeTimezoneOffset("840")).toBe(840);
    expect(normalizeTimezoneOffset("-0")).toBe(-0);
    expect(normalizeTimezoneOffset("1.5")).toBeUndefined();
    expect(normalizeTimezoneOffset(" 60")).toBeUndefined();
    expect(normalizeTimezoneOffset(841)).toBeUndefined();
    expect(normalizeTimezoneOffset(null)).toBeUndefined();
    expect(normalizeFriendFilters({ archived: "wrong", page: "-2" })).toEqual({ archived: false, q: undefined, page: 1 });
    expect(normalizeOutingFilters({ month: "2026-04", q: " title " })).toEqual({ month: "2026-04", q: "title", page: 1 });
    expect(normalizeExpenseFilters({ assignment: "wrong", outingId: "wrong" })).toMatchObject({ assignment: "all", outingId: undefined });
    expect(normalizeRepaymentFilters({ allocation: "wrong", friendId: "wrong" })).toMatchObject({ allocation: "all", friendId: undefined });
  });

  it("escapes SQL LIKE metacharacters literally", () => {
    expect(escapeLikePattern("100%_\\paid")).toBe("100\\%\\_\\\\paid");
  });

  it("uses UTC month boundaries and deterministic labels", () => {
    expect(monthStart("2026-04").toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(nextMonthStart("2026-04").toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(monthDisplayLabel("2026-04")).toBe("April 2026");
  });

  it("uses the browser offset for month keys and UTC filter boundaries", () => {
    const boundary = new Date("2026-06-30T17:00:00.000Z");
    expect(monthKey(boundary, -420)).toBe("2026-07");
    const julyStart = monthStart("2026-07", -420);
    const augustStart = nextMonthStart("2026-07", -420);
    expect(julyStart.toISOString()).toBe("2026-06-30T17:00:00.000Z");
    expect(augustStart.toISOString()).toBe("2026-07-31T17:00:00.000Z");
    expect(boundary >= julyStart && boundary < augustStart).toBe(true);
    expect(boundary >= monthStart("2026-06", -420) && boundary < julyStart).toBe(false);
    expect(monthKey(new Date("2026-07-01T07:00:00.000Z"), 420)).toBe("2026-07");
    expect(monthKey(new Date("2026-06-30T23:59:59.999Z"), 420)).toBe("2026-06");
    expect(groupRecordsByMonth([{ date: boundary }], (item) => item.date, -420)).toEqual([{ month: "2026-07", items: [{ date: boundary }] }]);
    expect(() => monthKey(boundary, 841)).toThrow(RangeError);
  });

  it("clamps pages and preserves page-one metadata for empty results", () => {
    expect(clampPage(99, 41)).toBe(3);
    expect(clampPage(99, 0)).toBe(1);
    expect(pageResult([], 0, 99)).toEqual({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 });
  });

  it("groups only the supplied page without changing row order", () => {
    const items = [{ id: "a", date: new Date("2026-04-30T23:00:00Z") }, { id: "b", date: new Date("2026-04-01T00:00:00Z") }, { id: "c", date: new Date("2026-03-31T00:00:00Z") }];
    expect(groupRecordsByMonth(items, (item) => item.date)).toEqual([
      { month: "2026-04", items: [items[0], items[1]] },
      { month: "2026-03", items: [items[2]] },
    ]);
  });
});
