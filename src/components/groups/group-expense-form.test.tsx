import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { assertPlainDto } from "@/test/assert-plain-dto";
import { GroupExpenseForm } from "./group-expense-form";

const participants = [
  { id: "alice", userId: "user-a", displayName: "Alice", label: null, status: "active" as const, canCreate: true, canPay: true, canParticipate: true, canBeCreditor: true },
  { id: "bob", userId: "user-b", displayName: "Bob", label: null, status: "active" as const, canCreate: true, canPay: true, canParticipate: true, canBeCreditor: true },
  { id: "charlie", userId: null, displayName: "Charlie", label: null, status: "external" as const, canCreate: false, canPay: false, canParticipate: true, canBeCreditor: false },
  { id: "former", userId: "user-c", displayName: "Former", label: null, status: "former" as const, canCreate: false, canPay: false, canParticipate: false, canBeCreditor: false },
];
const budget = {
  payerParticipantId: "alice",
  defaultIncluded: true,
  defaultCategoryId: "33333333-3333-4333-8333-333333333333",
  categories: [
    { id: "33333333-3333-4333-8333-333333333333", name: "Uncategorized" },
    { id: "44444444-4444-4444-8444-444444444444", name: "Food" },
  ],
};

describe("GroupExpenseForm", () => {
  it("limits payers and share choices to the Stage 12B eligibility rules", () => {
    assertPlainDto(participants);
    render(<GroupExpenseForm action={vi.fn()} participants={participants} defaultPayerId="alice" initialOccurredAtUtc="2026-08-27T12:00:00.000Z" />);
    expect(within(screen.getByRole("combobox", { name: "Paid by" })).getAllByRole("option").map((option) => option.textContent)).toEqual(["Alice", "Bob"]);
    const add = screen.getByRole("combobox", { name: "Participant to add" });
    expect(within(add).getByRole("option", { name: "Charlie · External" })).toBeInTheDocument();
    expect(within(add).queryByRole("option", { name: "Former" })).not.toBeInTheDocument();
  });

  it("splits indivisible rupiah totals deterministically and exactly", () => {
    render(<GroupExpenseForm action={vi.fn()} participants={participants} defaultPayerId="alice" initialOccurredAtUtc="2026-08-27T12:00:00.000Z" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Total amount in rupiah" }), { target: { value: "100000" } });
    const add = screen.getByRole("combobox", { name: "Participant to add" });
    for (const id of ["alice", "bob", "charlie"]) {
      fireEvent.change(add, { target: { value: id } });
      fireEvent.click(screen.getByRole("button", { name: "Add share" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Split evenly" }));
    expect(screen.getByRole("textbox", { name: "Share amount for Alice" })).toHaveValue("33334");
    expect(screen.getByRole("textbox", { name: "Share amount for Bob" })).toHaveValue("33333");
    expect(screen.getByRole("textbox", { name: "Share amount for Charlie" })).toHaveValue("33333");
    expect(screen.getByText("Rp 100.000", { exact: true })).toBeInTheDocument();
  });

  it("offers the payer their private Budget control and withdraws it for another payer", async () => {
    const action = vi.fn().mockResolvedValue({ fieldErrors: {}, formError: "", values: { description: "", totalAmount: "", occurredAtLocal: "", timezoneOffsetMinutes: "", payerParticipantId: "alice", shares: [] } });
    render(<GroupExpenseForm action={action} participants={participants} defaultPayerId="alice" initialOccurredAtUtc="2026-08-27T12:00:00.000Z" budget={budget} />);

    const include = screen.getByRole("checkbox", { name: "Include this expense in my Budget" });
    expect(include).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Budget category" })).toHaveValue(budget.defaultCategoryId);

    fireEvent.change(screen.getByRole("combobox", { name: "Paid by" }), { target: { value: "bob" } });
    expect(screen.queryByRole("checkbox", { name: "Include this expense in my Budget" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Paid by" }), { target: { value: "alice" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Total amount in rupiah" }), { target: { value: "100000" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Participant to add" }), { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Add share" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Share amount for Alice" }), { target: { value: "100000" } });
    const form = screen.getByRole("button", { name: "Add expense" }).closest("form")!;
    fireEvent.submit(form);
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0]?.[1].get("budgetParticipation")).toBe("1");
    expect(action.mock.calls[0]?.[1].get("includeInBudget")).toBe("1");
    expect(action.mock.calls[0]?.[1].get("budgetCategoryId")).toBe(budget.defaultCategoryId);
  });

  it("never offers a Budget control for another payer's private Budget", () => {
    render(<GroupExpenseForm action={vi.fn()} participants={participants} defaultPayerId="bob" initialOccurredAtUtc="2026-08-27T12:00:00.000Z" budget={budget} />);
    expect(screen.queryByRole("checkbox", { name: "Include this expense in my Budget" })).not.toBeInTheDocument();
  });
});
