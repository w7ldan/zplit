import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { assertPlainDto } from "@/test/assert-plain-dto";
import { GroupExpenseForm } from "./group-expense-form";

const participants = [
  { id: "alice", userId: "user-a", displayName: "Alice", label: null, status: "active" as const, canCreate: true, canPay: true, canParticipate: true, canBeCreditor: true },
  { id: "bob", userId: "user-b", displayName: "Bob", label: null, status: "active" as const, canCreate: true, canPay: true, canParticipate: true, canBeCreditor: true },
  { id: "charlie", userId: null, displayName: "Charlie", label: null, status: "external" as const, canCreate: false, canPay: false, canParticipate: true, canBeCreditor: false },
  { id: "former", userId: "user-c", displayName: "Former", label: null, status: "former" as const, canCreate: false, canPay: false, canParticipate: false, canBeCreditor: false },
];

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
});
