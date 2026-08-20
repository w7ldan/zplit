import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ExpenseShareActionState } from "@/app/app/expenses/actions";
import { UnsavedChangesProvider } from "@/components/navigation/unsaved-changes";
import { ExpenseShareEditor, type ExpenseShareEditorFriend } from "./expense-share-editor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const activeFriend: ExpenseShareEditorFriend = { id: "11111111-1111-4111-8111-111111111111", name: "Rani", archivedAt: null, amountOwed: 40000 };
const archivedFriend: ExpenseShareEditorFriend = { id: "22222222-2222-4222-8222-222222222222", name: "Bima", archivedAt: new Date("2026-01-03T00:00:00.000Z"), amountOwed: 20000 };
const suggestedFriend = { id: "33333333-3333-4333-8333-333333333333", label: "Siti" };
const secondSuggestedFriend = { id: "44444444-4444-4444-8444-444444444444", label: "Tono" };

describe("expense share editor", () => {
  it("offers repayment only for an open persisted share", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[{ ...activeFriend, expenseShareId: "33333333-3333-4333-8333-333333333333", remainingAmount: 5000 }, { ...archivedFriend, expenseShareId: "44444444-4444-4444-8444-444444444444", remainingAmount: 0, settled: true }]} />);

    expect(screen.getByRole("link", { name: "Record repayment" })).toHaveAttribute("href", "/app/repayments?create=1&friendId=11111111-1111-4111-8111-111111111111&expenseShareId=33333333-3333-4333-8333-333333333333");
    expect(screen.getAllByRole("link", { name: "Record repayment" })).toHaveLength(1);
  });

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

  it("emphasizes only changed live totals after the initial render", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[activeFriend, archivedFriend]} />);
    expect(document.querySelectorAll(".changed-value--changed")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Rani"), { target: { value: "50000" } });
    expect(document.querySelectorAll(".changed-value--changed")).toHaveLength(2);
    const assigned = screen.getByText("Rp 70.000", { exact: true }).closest(".changed-value") as HTMLElement;
    const firstVisual = assigned.querySelector(".changed-value__visual");
    expect(assigned).toHaveAttribute("data-changed-revision", "1");
    expect(firstVisual).toHaveClass("changed-value--changed");
    expect(screen.getByText("Rp 14.000", { exact: true }).closest(".changed-value")).toHaveAttribute("data-changed-revision", "1");

    fireEvent.change(screen.getByLabelText("Rani"), { target: { value: "51000" } });
    const secondVisual = assigned.querySelector(".changed-value__visual");
    expect(assigned).toHaveAttribute("data-changed-revision", "2");
    expect(secondVisual).not.toBe(firstVisual);

    fireEvent.change(screen.getByLabelText("Rani"), { target: { value: "52000" } });
    const thirdVisual = assigned.querySelector(".changed-value__visual");
    expect(assigned).toHaveAttribute("data-changed-revision", "3");
    expect(thirdVisual).not.toBe(secondVisual);

    fireEvent.change(screen.getByLabelText("Rani"), { target: { value: "52000" } });
    expect(assigned).toHaveAttribute("data-changed-revision", "3");
    expect(assigned.querySelector(".changed-value__visual")).toBe(thirdVisual);
    expect(document.querySelectorAll(".changed-value--changed")).toHaveLength(2);
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
    fireEvent.click(screen.getByRole("combobox", { name: "Add friend" }));
    const searchInput = await screen.findByRole("searchbox", { name: "Search active friends" });
    fireEvent.change(searchInput, { target: { value: "Siti" } });
    const listbox = screen.getByRole("listbox");
    await waitFor(() => expect(within(listbox).getByRole("option", { name: "Siti" })).toBeInTheDocument());
    fireEvent.click(within(listbox).getByRole("option", { name: "Siti" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 friend" }));

    await waitFor(() => expect(screen.getByLabelText("Siti")).toHaveFocus());
    expect(screen.getByRole("button", { name: "Remove Siti" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Add friend" })).toHaveTextContent("Choose active friend");
    expect(searchFriends).toHaveBeenCalledWith("", "");
  });

  it("selects several friends before applying, excludes them afterward, and cancels cleanly", async () => {
    const searchFriends = vi.fn().mockResolvedValue([suggestedFriend, secondSuggestedFriend]);
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[activeFriend]} friendOptions={[suggestedFriend, secondSuggestedFriend]} searchFriends={searchFriends} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Add friend" }));
    const searchInput = await screen.findByRole("searchbox", { name: "Search active friends" });
    const listbox = screen.getByRole("listbox");
    await waitFor(() => expect(within(listbox).getByRole("option", { name: "Siti" })).toBeInTheDocument());
    fireEvent.click(within(listbox).getByRole("option", { name: "Siti" }));
    expect(searchInput).toBeInTheDocument();
    fireEvent.keyDown(searchInput, { key: "Escape" });
    expect(screen.queryByLabelText("Siti")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Add friend" }));
    await screen.findByRole("searchbox", { name: "Search active friends" });
    const reopenedBeforeApply = screen.getByRole("listbox");
    await waitFor(() => expect(within(reopenedBeforeApply).getByRole("option", { name: "Siti" })).toBeInTheDocument());
    fireEvent.click(within(reopenedBeforeApply).getByRole("option", { name: "Siti" }));
    const reopenedSearchInput = screen.getByRole("searchbox", { name: "Search active friends" });
    fireEvent.change(reopenedSearchInput, { target: { value: "Tono" } });
    await waitFor(() => expect(within(reopenedBeforeApply).getByRole("option", { name: "Tono" })).toBeInTheDocument());
    fireEvent.click(within(reopenedBeforeApply).getByRole("option", { name: "Tono" }));
    expect(within(reopenedBeforeApply).getByRole("option", { name: "Siti" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Add 2 friends" }));

    await waitFor(() => expect(screen.getByLabelText("Siti")).toBeInTheDocument());
    expect(screen.getByLabelText("Tono")).toHaveValue("");
    fireEvent.click(screen.getByRole("combobox", { name: "Add friend" }));
    const reopenedListbox = await screen.findByRole("listbox");
    expect(within(reopenedListbox).queryByRole("option", { name: "Siti" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search active friends" }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(new FormData(screen.getByRole("button", { name: "Save split" }).closest("form")!).getAll("friendId")).toEqual([activeFriend.id, suggestedFriend.id, secondSuggestedFriend.id]);
  });

  it("keeps the sticky summary on the live base and charge totals", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={100000} friends={[activeFriend]} charges={[{ name: "PB1", percentageBasisPoints: 1000, scope: "all", friendIds: [] }]} />);
    const summary = document.querySelector(".expense-share-editor__summary") as HTMLElement;
    expect(summary).toBeInTheDocument();
    expect(within(summary).getByText("Rp 44.000", { exact: true })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Rani"), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText("Charge 1 percentage"), { target: { value: "20" } });
    expect(within(summary).getByText("Rp 60.000", { exact: true })).toBeInTheDocument();
    expect(within(summary).getByText("Rp 40.000", { exact: true })).toBeInTheDocument();
  });

  it("uses a decimal keyboard for percentage charges", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[activeFriend]} charges={[{ name: "Service", percentageBasisPoints: 750, scope: "all", friendIds: [] }]} />);

    expect(screen.getByLabelText("Charge 1 percentage")).toHaveAttribute("inputmode", "decimal");
  });

  it("replaces the current draft with the previous saved split and drops unavailable targets", () => {
    render(<ExpenseShareEditor
      action={vi.fn()}
      expenseAmount={40000}
      friends={[activeFriend]}
      previousSplit={{
        friends: [
          { id: suggestedFriend.id, name: suggestedFriend.label, archivedAt: null, baseAmount: 40000 },
          archivedFriend,
        ],
        charges: [
          { name: "PB1", percentageBasisPoints: 500, scope: "all", friendIds: [] },
          { name: "Targeted", percentageBasisPoints: 1000, scope: "selected", friendIds: [suggestedFriend.id, archivedFriend.id] },
        ],
      }}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Use previous split" }));
    expect(screen.getByText("Replace current draft?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Replace draft" }));

    expect(screen.queryByLabelText("Rani")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Siti" })).toHaveValue("40000");
    expect(screen.queryByLabelText(/^Bima/)).not.toBeInTheDocument();
    expect(screen.getByText("Over-allocated by Rp 6.000.")).toBeInTheDocument();
    expect(screen.getByLabelText("Friends for charge 2")).toHaveTextContent("Siti");
    expect(screen.getByLabelText("Friends for charge 2")).not.toHaveTextContent("Bima");
    const form = screen.getByRole("button", { name: "Save split" }).closest("form")!;
    expect(JSON.parse((form.querySelector('input[name="charges"]') as HTMLInputElement).value)).toEqual([
      { name: "PB1", percentage: "5", scope: "all", friendIds: [] },
      { name: "Targeted", percentage: "10", scope: "selected", friendIds: [suggestedFriend.id] },
    ]);
  });

  it("does not render the previous split helper without a candidate", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[activeFriend]} />);
    expect(screen.queryByRole("button", { name: "Use previous split" })).not.toBeInTheDocument();
  });

  it("does not offer archived candidates through the multi-select", async () => {
    const archivedOption = { id: archivedFriend.id, label: archivedFriend.name, archived: true };
    const searchFriends = vi.fn().mockResolvedValue([archivedOption]);
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[activeFriend]} friendOptions={[archivedOption]} searchFriends={searchFriends} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Add friend" }));
    const listbox = await screen.findByRole("listbox");
    await waitFor(() => expect(within(listbox).getByText("No matching options.")).toBeInTheDocument());
    expect(within(listbox).queryByRole("option", { name: /Bima/ })).not.toBeInTheDocument();
  });

  it("removes a row from the submitted split", async () => {
    const action = vi.fn().mockResolvedValue({ fieldErrors: {}, formError: "", values: [{ friendId: archivedFriend.id, amountRupiah: "20000" }] });
    render(<ExpenseShareEditor action={action} expenseAmount={84000} friends={[activeFriend, archivedFriend]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Rani" }));
    expect(screen.queryByLabelText("Rani")).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: "Save split" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0]![1].getAll("friendId")).toEqual([archivedFriend.id]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument());
  });

  it("removes a friend and undoes its base amount and charge targeting", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[activeFriend]} charges={[{ name: "PB1", percentageBasisPoints: 1000, scope: "selected", friendIds: [activeFriend.id] }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Rani" }));
    expect(screen.queryByRole("textbox", { name: "Rani" })).not.toBeInTheDocument();
    expect(screen.getByText("Rani removed ·")).toBeInTheDocument();
    expect(screen.getByText("Rp 84.000 is your portion.", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByRole("textbox", { name: "Rani" })).toHaveValue("40000");
    expect(within(screen.getByLabelText("Friends for charge 1")).getAllByRole("checkbox")[0]).toBeChecked();
    expect(screen.getByText("Rp 44.000", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("restores a removed charge definition and position", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[activeFriend]} charges={[
      { name: "PB1", percentageBasisPoints: 500, scope: "selected", friendIds: [activeFriend.id] },
      { name: "VAT", percentageBasisPoints: 1000, scope: "all", friendIds: [] },
    ]} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    expect(screen.queryByDisplayValue("PB1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByLabelText("Charge 1")).toHaveValue("PB1");
    expect(screen.getByLabelText("Charge 1 percentage")).toHaveValue("5");
    expect(screen.getByLabelText("Charge 1 scope")).toHaveValue("selected");
    expect(within(screen.getByLabelText("Friends for charge 1")).getByRole("checkbox")).toBeChecked();
    expect(screen.getByLabelText("Charge 2")).toHaveValue("VAT");
  });

  it("replaces the previous undo token and does not duplicate a re-added friend", async () => {
    const searchFriends = vi.fn().mockResolvedValue([suggestedFriend]);
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[{ id: suggestedFriend.id, name: suggestedFriend.label, archivedAt: null, amountOwed: 40000 }]} friendOptions={[suggestedFriend]} searchFriends={searchFriends} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Siti" }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Add friend" }));
    const listbox = await screen.findByRole("listbox");
    await waitFor(() => expect(within(listbox).getByRole("option", { name: "Siti" })).toBeInTheDocument());
    fireEvent.click(within(listbox).getByRole("option", { name: "Siti" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 friend" }));
    expect(screen.getByRole("textbox", { name: "Siti" })).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Remove Siti" }));
    expect(screen.getByText("Siti removed ·")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getAllByRole("textbox", { name: "Siti" })).toHaveLength(1);
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

  it("splits evenly across one friend and the owner", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={101} friends={[activeFriend]} />);
    fireEvent.click(screen.getByRole("button", { name: "Split evenly (incl. you)" }));
    expect(screen.getByLabelText("Rani")).toHaveValue("50");
    expect(screen.getByText("Rp 51 is your portion.", { exact: false })).toBeInTheDocument();
  });

  it("splits multiple friends with the deterministic owner remainder", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={100} friends={[activeFriend, archivedFriend]} />);
    fireEvent.click(screen.getByRole("button", { name: "Split evenly (incl. you)" }));
    expect(screen.getByLabelText("Rani")).toHaveValue("33");
    expect(screen.getByLabelText(/^Bima/)).toHaveValue("33");
    expect(screen.getByText("Rp 34 is your portion.", { exact: false })).toBeInTheDocument();
  });

  it("does not offer split evenly without a selected friend", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={100} friends={[]} friendOptions={[suggestedFriend]} />);
    expect(screen.queryByRole("button", { name: "Split evenly (incl. you)" })).not.toBeInTheDocument();
  });

  it("shows final charged totals and reconstructs charge metadata in the form", () => {
    const action = vi.fn().mockResolvedValue({ fieldErrors: {}, formError: "", values: [{ friendId: activeFriend.id, amountRupiah: "40000" }], charges: [{ name: "PB1", percentage: "10", scope: "all", friendIds: [] }] });
    render(<ExpenseShareEditor action={action} expenseAmount={100_000} friends={[{ ...activeFriend, baseAmount: 40_000, amountOwed: 44_000 }]} charges={[{ name: "PB1", percentageBasisPoints: 1000, scope: "all", friendIds: [] }]} />);
    expect(screen.getByText("Base Rp 40.000")).toBeInTheDocument();
    expect(screen.getByText("PB1 10% · Rp 4.000")).toBeInTheDocument();
    expect(screen.getByText("Final Rp 44.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 44.000", { exact: true })).toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: "Save split" }).closest("form")!);
    expect(JSON.parse(action.mock.calls[0]![1].get("charges") as string)).toEqual([{ name: "PB1", percentage: "10", scope: "all", friendIds: [] }]);
  });

  it("does not self-confirm a dirty split save", async () => {
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    const action = vi.fn().mockResolvedValue({ fieldErrors: {}, formError: "", values: [{ friendId: activeFriend.id, amountRupiah: "50000" }], charges: [] });
    render(
      <UnsavedChangesProvider>
        <ExpenseShareEditor action={action} expenseAmount={84000} friends={[activeFriend]} />
      </UnsavedChangesProvider>,
    );

    fireEvent.change(screen.getByLabelText("Rani"), { target: { value: "50000" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save split" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Rani")).toHaveValue("50000");
  });

  it("supports selected charge targets and removes stale targets with a friend", () => {
    render(<ExpenseShareEditor action={vi.fn()} expenseAmount={100_000} friends={[activeFriend, archivedFriend]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add charge" }));
    fireEvent.change(screen.getByLabelText("Charge 1 scope"), { target: { value: "selected" } });
    fireEvent.change(screen.getByLabelText("Charge 1 percentage"), { target: { value: "5" } });
    fireEvent.click(within(screen.getByLabelText("Friends for charge 1")).getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Remove Rani" }));
    expect(screen.getByLabelText("Friends for charge 1")).not.toHaveTextContent("Rani");
  });

  it("guards base edits, friend changes, charges, and exact undo/reverts", () => {
    render(
      <UnsavedChangesProvider>
        <ExpenseShareEditor action={vi.fn()} expenseAmount={84000} friends={[activeFriend]} friendOptions={[suggestedFriend]} />
      </UnsavedChangesProvider>,
    );
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      fireEvent(window, event);
      return event.defaultPrevented;
    };

    expect(unload()).toBe(false);
    fireEvent.change(screen.getByLabelText("Rani"), { target: { value: "50000" } });
    expect(unload()).toBe(true);
    fireEvent.change(screen.getByLabelText("Rani"), { target: { value: "40000" } });
    expect(unload()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Remove Rani" }));
    expect(unload()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(unload()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Add charge" }));
    expect(unload()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(unload()).toBe(false);
  });
});
