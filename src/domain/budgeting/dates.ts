import { isValidDateOnly } from "../date-only";

export function isValidBudgetDate(value: unknown): value is string {
  return isValidDateOnly(value);
}

export function compareBudgetDates(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Calendar date of a `Date` in the runtime's local timezone as `YYYY-MM-DD`.
 * Uses local getters so browser callers initialise from the user's calendar
 * day rather than the UTC day.
 */
export function localCalendarDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function inclusiveBudgetDays(startsOn: string, endsOn: string, today: string) {
  if (!isValidBudgetDate(startsOn) || !isValidBudgetDate(endsOn) || !isValidBudgetDate(today) || startsOn > endsOn) return 0;
  const effectiveStart = today < startsOn ? startsOn : today;
  if (effectiveStart > endsOn) return 0;
  const start = dateOnlyEpoch(effectiveStart);
  const end = dateOnlyEpoch(endsOn);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function dateOnlyEpoch(value: string) {
  const date = new Date(0);
  date.setUTCFullYear(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

export function calculateSafeDaily(startsOn: string, endsOn: string, today: string, remaining: number) {
  const remainingDays = inclusiveBudgetDays(startsOn, endsOn, today);
  return remainingDays > 0 ? Math.floor(remaining / remainingDays) : null;
}
