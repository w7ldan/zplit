import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeleteConfirmation, DeleteRecordForm } from "./delete-record-form";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

describe("DeleteRecordForm", () => {
  const revision = "a".repeat(64);
  const impacts = {
    outing: { recordType: "outing" as const, expenseCount: 0, expenseTotal: 0, receiptCount: 0, shareCount: 0, allocationCount: 0, affectedRepaymentCount: 0, affectedRepaymentIds: [], affectedFriendIds: [] },
    expense: { recordType: "expense" as const, receiptCount: 0, shareCount: 0, allocationCount: 0, affectedRepaymentCount: 0, affectedRepaymentIds: [], affectedFriendIds: [] },
    repayment: { recordType: "repayment" as const, allocationCount: 0, friendId: "friend-a" },
  };

  it.each(["outing", "expense", "repayment"] as const)("uses one checkbox without dependencies for %s", (recordType) => {
    const action = vi.fn(async () => ({ formError: "" }));
    render(<DeleteRecordForm action={action} recordType={recordType} impact={impacts[recordType]} impactRevision={revision} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    const button = screen.getByRole("button", { name: `Delete ${recordType}` });
    expect(button).toBeDisabled();
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveAttribute("name", "confirm");
    expect(checkbox).toHaveAttribute("value", "delete");
    fireEvent.click(checkbox);
    expect(button).toBeEnabled();
  });

  it("uses two checkboxes, exact counts, and a cascade label for an outing", () => {
    const action = vi.fn(async () => ({ formError: "" }));
    const impact = { ...impacts.outing, expenseCount: 3, expenseTotal: 6000, receiptCount: 2, shareCount: 4, allocationCount: 2, affectedRepaymentCount: 2, affectedRepaymentIds: ["repayment-a"], affectedFriendIds: ["friend-a"] };
    render(<DeleteRecordForm action={action} recordType="outing" impact={impact} impactRevision={revision} />);
    expect(screen.getByText("Also permanently delete 3 expenses and their related 2 receipts, 4 shares, and 2 allocations.")).toBeInTheDocument();
    expect(screen.getByText("The repayment records remain, but the removed amounts will become unallocated.")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    const button = screen.getByRole("button", { name: "Delete outing and 3 expenses" });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Confirm deletion" }));
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Also delete 3 expenses and related data" }));
    expect(button).toBeEnabled();
  });

  it("uses the expense cascade label and allocation consequence copy", () => {
    const action = vi.fn(async () => ({ formError: "" }));
    const impact = { ...impacts.expense, receiptCount: 1, shareCount: 2, allocationCount: 1, affectedRepaymentCount: 1, affectedRepaymentIds: ["repayment-a"], affectedFriendIds: ["friend-a"] };
    render(<DeleteRecordForm action={action} recordType="expense" impact={impact} impactRevision={revision} />);
    expect(screen.getByText("Also permanently delete this expense’s 1 receipt, 2 shares, and 1 allocation.")).toBeInTheDocument();
    expect(screen.getByText("The repayment records remain, but the removed amounts will become unallocated.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Confirm deletion" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Also delete this expense’s related data" }));
    expect(screen.getByRole("button", { name: "Delete expense and related data" })).toBeEnabled();
  });

  it("submits both exact confirmations and keeps server errors accessible", async () => {
    const action = vi.fn(async (state: { formError: string }, formData: FormData) => {
      void state;
      void formData;
      return { formError: "Current dependencies changed." };
    });
    const impact = { ...impacts.repayment, allocationCount: 2 };
    render(<DeleteRecordForm action={action} recordType="repayment" impact={impact} impactRevision={revision} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Confirm deletion" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Also remove 2 allocations" }));
    fireEvent.submit(screen.getByRole("button", { name: "Delete repayment and 2 allocations" }).closest("form")!);
    await waitFor(() => expect(action).toHaveBeenCalled());
    const submitted = action.mock.calls[0]?.[1];
    expect(submitted.getAll("confirm")).toEqual(["delete"]);
    expect(submitted.getAll("confirmCascade")).toEqual(["delete-dependents"]);
    expect(submitted.getAll("impactRevision")).toEqual([revision]);
    expect(screen.getByDisplayValue(revision)).toHaveAttribute("name", "impactRevision");
    await waitFor(() => expect(screen.getByText("Current dependencies changed.")).toHaveAttribute("role", "alert"));
  });

  it("uses a server-returned impact and revision and resets both confirmations", async () => {
    const updatedRevision = "b".repeat(64);
    const updatedImpact = { ...impacts.outing, expenseCount: 1, expenseTotal: 9000, affectedRepaymentIds: ["repayment-b"], affectedFriendIds: ["friend-b"] };
    const action = vi.fn(async () => ({ formError: "The dependent records changed.", impact: updatedImpact, impactRevision: updatedRevision }));
    render(<DeleteRecordForm action={action} recordType="outing" impact={impacts.outing} impactRevision={revision} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Confirm deletion" }));
    fireEvent.submit(screen.getByRole("button", { name: "Delete outing" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Also permanently delete 1 expense and their related 0 receipts, 0 shares, and 0 allocations.")).toBeInTheDocument());
    expect(screen.getByDisplayValue(updatedRevision)).toHaveAttribute("name", "impactRevision");
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: "Confirm deletion" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Also delete 1 expense and related data" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Delete outing and 1 expenses" })).toBeDisabled();
    expect(document.querySelectorAll('input[type="hidden"]')).toHaveLength(1);
    expect(document.querySelector('input[type="hidden"]')?.getAttribute("value")).not.toContain("friend-b");
  });

  it("removes obsolete cascade confirmation and updates labels when dependencies disappear", async () => {
    const updatedRevision = "c".repeat(64);
    const action = vi.fn(async () => ({ formError: "The dependent records changed.", impact: impacts.outing, impactRevision: updatedRevision }));
    const impact = { ...impacts.outing, expenseCount: 1, receiptCount: 1, shareCount: 1, allocationCount: 1 };
    render(<DeleteRecordForm action={action} recordType="outing" impact={impact} impactRevision={revision} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Confirm deletion" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Also delete 1 expense and related data" }));
    fireEvent.submit(screen.getByRole("button", { name: "Delete outing and 1 expenses" }).closest("form")!);

    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Also delete 1 expense and related data" })).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Confirm deletion" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Delete outing" })).toBeDisabled();
    expect(screen.getByDisplayValue(updatedRevision)).toBeInTheDocument();
  });

  it("resets confirmation when equal counts hide a changed dependent identity", async () => {
    const updatedRevision = "d".repeat(64);
    const initialImpact = { ...impacts.expense, receiptCount: 1, shareCount: 1, allocationCount: 1, affectedRepaymentCount: 1, affectedRepaymentIds: ["repayment-a"], affectedFriendIds: ["friend-a"] };
    const updatedImpact = { ...initialImpact, affectedRepaymentIds: ["repayment-b"], affectedFriendIds: ["friend-b"] };
    const action = vi.fn(async () => ({ formError: "The dependent records changed.", impact: updatedImpact, impactRevision: updatedRevision }));
    render(<DeleteRecordForm action={action} recordType="expense" impact={initialImpact} impactRevision={revision} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Confirm deletion" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Also delete this expense’s related data" }));
    fireEvent.submit(screen.getByRole("button", { name: "Delete expense and related data" }).closest("form")!);

    await waitFor(() => expect(screen.getByDisplayValue(updatedRevision)).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Confirm deletion" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Also delete this expense’s related data" })).not.toBeChecked();
  });

  it("consumes the deleted flag without replaying it on refresh", () => {
    window.history.replaceState({}, "", "/app/expenses?deleted=1&keep=1");
    render(<DeleteConfirmation message="Expense deleted." />);
    expect(replace).toHaveBeenCalledWith("/app/expenses?keep=1", { scroll: false });
    expect(screen.getByRole("status")).toHaveTextContent("Expense deleted.");
  });
});
