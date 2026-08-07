import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ExpenseShareActionState } from "@/app/app/expenses/actions";
import { ExpenseShareEditor, type ExpenseShareEditorFriend } from "./expense-share-editor";

const activeFriend: ExpenseShareEditorFriend = { id: "11111111-1111-4111-8111-111111111111", name: "Rani", archivedAt: null, amountOwed: 40000 };
const archivedFriend: ExpenseShareEditorFriend = { id: "22222222-2222-4222-8222-222222222222", name: "Bima", archivedAt: new Date("2026-01-03T00:00:00.000Z"), amountOwed: 20000 };
const suggestedFriend = { id: "33333333-3333-4333-8333-333333333333", label: "Siti" };

describe("expense share editor", () => {
  it("shows accessible fields, archived text, and live totals", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[activeFriend, archivedFriend]} />);

    expect(screen.getByLabelText("Rani")).toHaveValue("40000");
    expect(screen.getByLabelText(/^Bima/)).toHaveValue("20000");
    expect(screen.getByText("ARCHIVED")).toBeInTheDocument();
    for (const label of ["Expense total", "Assigned to friends", "Your portion"]) expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Total owed by friends", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("How this split adds up")).not.toBeInTheDocument();
    expect(screen.queryByText("Expense total − Assigned to friends = Your portion")).not.toBeInTheDocument();
    expect(screen.getByText("Rp 24.000 is your portion. Assigned shares become friend balances.")).toBeInTheDocument();
    expect(screen.getByText("Rp 84.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 60.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 24.000")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Expense allocation" })).toHaveAttribute("aria-valuenow", "60000");
    const fill = document.querySelector(".allocation-bar__fill") as HTMLElement;
    expect(fill.style.transform).toBe("scaleX(0.7142857142857143)");
    expect(fill.style.width).toBe("");
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
    expect(screen.queryByText("How this split adds up")).not.toBeInTheDocument();
    expect(screen.getByText("Over-allocated by Rp 84.000.")).toBeInTheDocument();
    expect((document.querySelector(".allocation-bar__fill") as HTMLElement).style.transform).toBe("scaleX(1)");
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

  it("renders selected rows only, adds an active friend, and focuses its amount", async () => {
    const searchFriends = vi.fn().mockResolvedValue([suggestedFriend]);
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[activeFriend]} friendOptions={[suggestedFriend]} searchFriends={searchFriends} />);

    expect(screen.getByLabelText("Rani")).toBeInTheDocument();
    expect(screen.queryByLabelText("Siti")).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole("combobox", { name: "Add friend" }));
    await waitFor(() => expect(within(screen.getByRole("listbox")).getByRole("option", { name: "Siti" })).toBeInTheDocument());
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Siti" }));

    await waitFor(() => expect(screen.getByLabelText("Siti")).toHaveFocus());
    expect(screen.getByRole("button", { name: "Remove Siti" })).toBeInTheDocument();
    expect(searchFriends).toHaveBeenCalledWith("", "");
  });

  it("removes a row from the submitted split", async () => {
    const action = vi.fn().mockResolvedValue({ fieldErrors: {}, formError: "", values: [{ friendId: archivedFriend.id, amountRupiah: "20000" }] });
    render(<ExpenseShareEditor action={action} expenseAmount={84000} friends={[activeFriend, archivedFriend]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Rani" }));
    expect(screen.queryByLabelText("Rani")).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: "Save split" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0]![1].getAll("friendId")).toEqual([archivedFriend.id]);
  });

  it("preserves archived rows and entered values after validation", async () => {
    const action = vi.fn().mockResolvedValue({
      fieldErrors: { [activeFriend.id]: "Enter whole rupiah." },
      formError: "Please correct the marked fields.",
      values: [
        { friendId: activeFriend.id, amountRupiah: "84.00" },
        { friendId: archivedFriend.id, amountRupiah: "20000" },
      ],
    });
    render(<ExpenseShareEditor action={action} expenseAmount={84000} friends={[activeFriend, archivedFriend]} />);
    fireEvent.change(screen.getByLabelText("Rani"), { target: { value: "84.00" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save split" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Please correct the marked fields.")).toBeInTheDocument());
    expect(screen.getByLabelText("Rani")).toHaveValue("84.00");
    expect(screen.getByLabelText(/^Bima/)).toHaveValue("20000");
    expect(screen.getByText("ARCHIVED")).toBeInTheDocument();
    expect(screen.getByText("Enter whole rupiah.")).toBeInTheDocument();
  });

  it("includes a native add-one fallback", () => {
    const markup = renderToString(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[activeFriend]} friendOptions={[suggestedFriend]} />);
    expect(markup).toContain('name="additionalFriendId"');
    expect(markup).toContain('name="additionalAmountRupiah"');
  });
});
