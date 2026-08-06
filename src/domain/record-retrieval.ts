export const RECORD_PAGE_SIZE = 20 as const;

export type RecordPage<T> = {
  items: T[];
  page: number;
  pageSize: typeof RECORD_PAGE_SIZE;
  totalItems: number;
  totalPages: number;
};

export type AssignmentFilter = "all" | "assigned" | "unassigned";
export type AllocationFilter = "all" | "complete" | "needs";

export type NormalizedFriendFilters = { archived: boolean; q?: string; page: number };
export type NormalizedOutingFilters = { q?: string; month?: string; page: number };
export type NormalizedExpenseFilters = { q?: string; outingId?: string; month?: string; assignment: AssignmentFilter; page: number };
export type NormalizedRepaymentFilters = { q?: string; friendId?: string; month?: string; allocation: AllocationFilter; page: number };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

export function normalizeText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 100).trim();
  return normalized || undefined;
}

export function normalizePage(value: unknown) {
  const text = typeof value === "number" ? value.toString() : typeof value === "string" ? value : "";
  return /^[1-9]\d*$/.test(text) ? Number(text) : 1;
}

export function clampPage(page: number, totalItems: number, pageSize = RECORD_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalItems) / pageSize));
  return Math.min(Math.max(1, normalizePage(page)), totalPages);
}

export function normalizeMonth(value: unknown) {
  if (typeof value !== "string") return undefined;
  const match = MONTH_PATTERN.exec(value);
  if (!match) return undefined;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? value : undefined;
}

export function normalizeTimezoneOffset(value: unknown) {
  const text = typeof value === "number" ? value.toString() : typeof value === "string" ? value : "";
  if (!/^-?\d+$/.test(text)) return undefined;
  const offset = Number(text);
  return Number.isSafeInteger(offset) && offset >= -840 && offset <= 840 ? offset : undefined;
}

export function normalizeUuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return undefined;
  return value.toLowerCase();
}

export function normalizeAssignment(value: unknown): AssignmentFilter {
  return value === "assigned" || value === "unassigned" ? value : "all";
}

export function normalizeAllocation(value: unknown): AllocationFilter {
  return value === "complete" || value === "needs" ? value : "all";
}

export function normalizeFriendFilters(input: { archived?: unknown; q?: unknown; page?: unknown } = {}): NormalizedFriendFilters {
  return { archived: input.archived === true || input.archived === "true", q: normalizeText(input.q), page: normalizePage(input.page) };
}

export function normalizeOutingFilters(input: { q?: unknown; month?: unknown; page?: unknown } = {}): NormalizedOutingFilters {
  return { q: normalizeText(input.q), month: normalizeMonth(input.month), page: normalizePage(input.page) };
}

export function normalizeExpenseFilters(input: { q?: unknown; outingId?: unknown; month?: unknown; assignment?: unknown; page?: unknown } = {}): NormalizedExpenseFilters {
  return {
    q: normalizeText(input.q),
    outingId: normalizeUuid(input.outingId),
    month: normalizeMonth(input.month),
    assignment: normalizeAssignment(input.assignment),
    page: normalizePage(input.page),
  };
}

export function normalizeRepaymentFilters(input: { q?: unknown; friendId?: unknown; month?: unknown; allocation?: unknown; page?: unknown } = {}): NormalizedRepaymentFilters {
  return {
    q: normalizeText(input.q),
    friendId: normalizeUuid(input.friendId),
    month: normalizeMonth(input.month),
    allocation: normalizeAllocation(input.allocation),
    page: normalizePage(input.page),
  };
}

export function monthStart(month: string, timezoneOffsetMinutes: unknown = 0) {
  const normalized = normalizeMonth(month);
  if (!normalized) throw new RangeError("Month must be YYYY-MM");
  const offset = normalizeTimezoneOffset(timezoneOffsetMinutes);
  if (offset === undefined) throw new RangeError("Timezone offset must be a whole number between -840 and 840 minutes");
  const [year, monthNumber] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1) + offset * 60_000);
}

export function nextMonthStart(month: string, timezoneOffsetMinutes: unknown = 0) {
  const normalized = normalizeMonth(month);
  if (!normalized) throw new RangeError("Month must be YYYY-MM");
  const offset = normalizeTimezoneOffset(timezoneOffsetMinutes);
  if (offset === undefined) throw new RangeError("Timezone offset must be a whole number between -840 and 840 minutes");
  const [year, monthNumber] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 1) + offset * 60_000);
}

export function monthKey(value: Date | string, timezoneOffsetMinutes: unknown = 0) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("Date is invalid");
  const offset = normalizeTimezoneOffset(timezoneOffsetMinutes);
  if (offset === undefined) throw new RangeError("Timezone offset must be a whole number between -840 and 840 minutes");
  const local = new Date(date.getTime() - offset * 60_000);
  return `${local.getUTCFullYear().toString().padStart(4, "0")}-${(local.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

export function monthDisplayLabel(value: Date | string) {
  const date = typeof value === "string" && MONTH_PATTERN.test(value) ? monthStart(value) : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("Date is invalid");
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

export function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function pageResult<T>(items: T[], totalItems: number, requestedPage: number, pageSize = RECORD_PAGE_SIZE): RecordPage<T> {
  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalItems) / pageSize));
  const page = Math.min(Math.max(1, normalizePage(requestedPage)), totalPages);
  return { items, page, pageSize: pageSize as typeof RECORD_PAGE_SIZE, totalItems, totalPages };
}

export function groupRecordsByMonth<T>(items: readonly T[], getDate: (item: T) => Date, timezoneOffsetMinutes: unknown = 0) {
  const groups: Array<{ month: string; items: T[] }> = [];
  for (const item of items) {
    const month = monthKey(getDate(item), timezoneOffsetMinutes);
    const last = groups.at(-1);
    if (last?.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
}

export type RecordQueryParams = Record<string, string | string[] | undefined>;

export function recordHref(pathname: string, params: RecordQueryParams, changes: Record<string, string | undefined> = {}) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const item of value) query.append(name, item);
    else if (value !== undefined) query.set(name, value);
  }
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) query.delete(name);
    else query.set(name, value);
  }
  const search = query.toString();
  return `${pathname}${search ? `?${search}` : ""}`;
}
