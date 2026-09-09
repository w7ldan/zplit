import { isValidDateOnly } from "@/domain/date-only";

function calendarDate(value: string) {
  if (!isValidDateOnly(value)) return null;
  const date = new Date(0);
  date.setUTCFullYear(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function formatCalendarDate(value: string) {
  const date = calendarDate(value);
  if (!date) return "Invalid date";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}
