"use client";

import { useSyncExternalStore } from "react";
import { formatCalendarDate } from "./calendar-date";

export { formatCalendarDate } from "./calendar-date";

type LocalDateTimeProps = {
  iso: string;
  mode?: "date" | "date-time";
};

function formatUtc(date: Date, mode: "date" | "date-time") {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(mode === "date-time" ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function formatLocal(date: Date, mode: "date" | "date-time") {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(mode === "date-time" ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

export function LocalDateTime({ iso, mode = "date-time" }: LocalDateTimeProps) {
  const date = new Date(iso);
  const valid = !Number.isNaN(date.getTime());
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);

  const content = !valid ? "Invalid date" : hydrated ? formatLocal(date, mode) : formatUtc(date, mode);
  return <time dateTime={iso}>{content}</time>;
}

export function CalendarDate({ value }: { value: string }) {
  return <time dateTime={value}>{formatCalendarDate(value)}</time>;
}

export function CalendarDateRange({ startsOn, endsOn }: { startsOn: string | null; endsOn: string | null }) {
  const content = startsOn && endsOn
    ? `${formatCalendarDate(startsOn)} – ${formatCalendarDate(endsOn)}`
    : startsOn
      ? `From ${formatCalendarDate(startsOn)}`
      : endsOn
        ? `Until ${formatCalendarDate(endsOn)}`
        : "Dates not set";
  return <span>{content}</span>;
}
