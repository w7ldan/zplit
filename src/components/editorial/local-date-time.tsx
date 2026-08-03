"use client";

import { useSyncExternalStore } from "react";

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
  return new Intl.DateTimeFormat(undefined, {
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
