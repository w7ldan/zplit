"use client";

import { useSyncExternalStore } from "react";
import { calculateSafeDaily } from "@/domain/budgeting/dates";
import { formatSignedRupiah } from "@/domain/budgeting/amounts";

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function SafeDaily({ startsOn, endsOn, remaining }: { startsOn: string; endsOn: string; remaining: number }) {
  const today = useSyncExternalStore(() => () => {}, localToday, () => "");
  if (!today) return <span className="budget-value budget-value--neutral">—</span>;
  const safeDaily = calculateSafeDaily(startsOn, endsOn, today, remaining);
  return <span className="budget-value">{safeDaily === null ? "Period ended" : formatSignedRupiah(safeDaily)}</span>;
}
