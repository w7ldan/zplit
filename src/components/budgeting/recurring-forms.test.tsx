import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BudgetFormState, BudgetRecurringRecordValues } from "@/app/app/personal/budget/actions";
import { localCalendarDate } from "@/domain/budgeting/dates";
import { RecurringRecordForm } from "./recurring-forms";

const recordAction = vi.fn(async (state: BudgetFormState<BudgetRecurringRecordValues>) => state);

describe("RecurringRecordForm", () => {
  it("initialises the payment date from the browser-local calendar day and submits the visible value", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Asia/Jakarta";
    try {
      const before = localCalendarDate(new Date());
      render(<RecurringRecordForm action={recordAction} occurrenceId="occurrence-a" />);
      const input = screen.getByLabelText("Payment date") as HTMLInputElement;
      const after = localCalendarDate(new Date());
      expect([before, after]).toContain(input.value);

      const form = input.closest("form")!;
      expect(new FormData(form).get("occurredOn")).toBe(input.value);
      expect(new FormData(form).get("occurrenceId")).toBe("occurrence-a");

      fireEvent.change(input, { target: { value: "2026-09-12" } });
      expect(new FormData(form).get("occurredOn")).toBe("2026-09-12");
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});
