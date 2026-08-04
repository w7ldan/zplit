import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExpenseShareActionState } from "@/app/app/expenses/actions";
import { ExpenseShareEditor, type ExpenseShareEditorFriend } from "./expense-share-editor";

const activeFriend: ExpenseShareEditorFriend = { id: "11111111-1111-4111-8111-111111111111", name: "Rani", archivedAt: null, amountOwed: 40000 };
const archivedFriend: ExpenseShareEditorFriend = { id: "22222222-2222-4222-8222-222222222222", name: "Bima", archivedAt: new Date("2026-01-03T00:00:00.000Z"), amountOwed: 20000 };

describe("expense share editor", () => {
  it("shows accessible fields, archived text, and live totals", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[activeFriend, archivedFriend]} />);

    expect(screen.getByLabelText("Rani")).toHaveValue("40000");
    expect(screen.getByLabelText(/^Bima/)).toHaveValue("20000");
    expect(screen.getByText("ARCHIVED")).toBeInTheDocument();
    expect(screen.getByText("Rp 84.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 60.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 24.000")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Expense allocation" })).toHaveAttribute("aria-valuenow", "60000");
    expect(screen.getByLabelText("Rani")).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByLabelText("Rani")).toHaveAttribute("aria-describedby", expect.stringContaining("help"));
    expect(document.body).not.toHaveTextContent(/pill|status dot/);
  });

  it("updates the owner portion without displaying a negative value", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[activeFriend, archivedFriend]} />);
    fireEvent.change(screen.getByLabelText("Rani"), { target: { value: "84000" } });
    fireEvent.change(screen.getByLabelText(/^Bima/), { target: { value: "84000" } });

    expect(screen.getAllByText("Rp 0").length).toBeGreaterThan(0);
    expect(screen.getByText("Over-allocated by Rp 84.000.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/-Rp|-\d/);
  });

  it("disables repeated submission and shows pending copy", async () => {
    let resolveAction: (state: ExpenseShareActionState) => void = () => {};
    const action = vi.fn(() => new Promise<ExpenseShareActionState>((resolve) => { resolveAction = resolve; }));
    render(<ExpenseShareEditor action={action} expenseAmount={84000} friends={[activeFriend]} />);
    fireEvent.submit(screen.getByRole("button", { name: "Save split" }).closest("form")!);

    await waitFor(() => expect(screen.getByRole("button", { name: "Saving split…" })).toBeDisabled());
    resolveAction({ fieldErrors: {}, formError: "", values: [{ friendId: activeFriend.id, amountRupiah: "" }] });
  });

  it("links to friends when no eligible friend exists", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[]} />);
    expect(screen.getByRole("link", { name: /Go to friends/ })).toHaveAttribute("href", "/app/friends");
    expect(screen.queryByRole("button", { name: "Save split" })).not.toBeInTheDocument();
  });
});
