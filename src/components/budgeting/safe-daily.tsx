"use client";

import { useSyncExternalStore } from "react";
import { calculateSafeDaily, localCalendarDate } from "@/domain/budgeting/dates";
import { formatSignedRupiah } from "@/domain/budgeting/amounts";

function localToday() {
  return localCalendarDate(new Date());
}

export function SafeDaily({ startsOn, endsOn, remaining }: { startsOn: string; endsOn: string; remaining: number }) {
  const today = useSyncExternalStore(() => () => {}, localToday, () => "");
  if (!today) return <span className="budget-value budget-value--neutral">—</span>;
  const safeDaily = calculateSafeDaily(startsOn, endsOn, today, remaining);
  return <span className="budget-value">{safeDaily === null ? "Period ended" : formatSignedRupiah(safeDaily)}</span>;
}
