import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BudgetFormState, BudgetRecurringRecordValues } from "@/app/app/personal/budget/actions";
import { localCalendarDate } from "@/domain/budgeting/dates";
import { RecurringRecordForm, RecurringTemplateForm } from "./recurring-forms";

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

describe("RecurringTemplateForm", () => {
  it("associates field errors with their controls", async () => {
    const failingAction = vi.fn(async () => ({
      fieldErrors: { name: "Name is required.", amount: "Enter a whole Rupiah amount greater than zero." },
      formError: "Please correct the marked fields.",
      values: { templateId: "", name: "", amount: "", categoryId: "", frequency: "every_budget_period", startsOn: "", spreadCount: "1" },
    }));
    const { container } = render(<RecurringTemplateForm action={failingAction} categories={[{ id: "food", name: "Food" }]} />);

    fireEvent.submit(container.querySelector("form")!);

    const name = await screen.findByLabelText("Name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-describedby", "recurring-name-new-error");
    expect(screen.getByText("Name is required.")).toHaveAttribute("id", "recurring-name-new-error");
    const amount = screen.getByLabelText("Amount");
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(amount).toHaveAttribute("aria-describedby", "recurring-amount-new-error");
  });
});
