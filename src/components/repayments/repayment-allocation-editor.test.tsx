import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RepaymentAllocationActionState } from "@/app/app/repayments/actions";
import type { RepaymentAllocationPlan } from "@/domain/ledger-repository";
import { RepaymentAllocationEditor } from "./repayment-allocation-editor";
import { ToastProvider } from "@/components/feedback/toast";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const shareA = "11111111-1111-4111-8111-111111111111";
const shareB = "22222222-2222-4222-8222-222222222222";
const plan: RepaymentAllocationPlan = {
  id: "33333333-3333-4333-8333-333333333333",
  ledgerScopeId: "scope-a",
  friendId: "44444444-4444-4444-8444-444444444444",
  friendName: "Ari",
  friendArchivedAt: null,
  amount: 84000,
  paidAt: new Date("2026-01-02T02:30:00.000Z"),
  paymentMethod: "Cash",
  notes: null,
  createdAt: new Date("2026-01-02T02:30:00.000Z"),
  allocatedAmount: 40000,
  unallocatedAmount: 44000,
  shares: [{
    id: shareA,
    expenseShareId: shareA,
    expenseDescription: "Dinner",
    outingTitle: "Friday night",
    outingOccurredAt: new Date("2026-01-01T10:00:00.000Z"),
    amountOwed: 70000,
    allocatedByOtherRepayments: 30000,
    currentAllocation: 40000,
    capacityAvailable: 40000,
  }],
};
const planWithUnrelatedDraft: RepaymentAllocationPlan = {
  ...plan,
  allocatedAmount: 50000,
  unallocatedAmount: 34000,
  shares: [...plan.shares, {
    id: shareB,
    expenseShareId: shareB,
    expenseDescription: "Coffee",
    outingTitle: "Friday night",
    outingOccurredAt: new Date("2026-01-01T10:00:00.000Z"),
    amountOwed: 50000,
    allocatedByOtherRepayments: 0,
    currentAllocation: 10000,
    capacityAvailable: 50000,
  }],
};

describe("RepaymentAllocationEditor", () => {
  it("shows share details, accessible fields, and live non-negative totals", () => {
    render(<RepaymentAllocationEditor action={vi.fn()} plan={plan} />);

    expect(screen.getByText("Dinner")).toBeInTheDocument();
    expect(screen.getByText(/Friday night/)).toBeInTheDocument();
    const row = document.querySelector<HTMLElement>(".repayment-allocation-editor__row")!;
    const details = within(row).getByText("Allocation details").closest("details") as HTMLDetailsElement;
    expect(details).not.toHaveAttribute("open");
    expect(within(row).getByText("Available", { selector: ".repayment-allocation-editor__available span" })).toBeInTheDocument();
    fireEvent.click(within(row).getByText("Allocation details"));
    expect(details).toHaveAttribute("open", "");
    expect(within(details).getByText("Original owed")).toBeInTheDocument();
    expect(within(details).getByText("Other repayments")).toBeInTheDocument();
    expect(within(details).getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("Rp 70.000", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Rp 30.000", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 40.000", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText("Repayment amount", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Applied to shares", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Needs allocation", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Allocated", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Unallocated", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("How this repayment adds up")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Amount to allocate to Dinner")).toHaveValue("40000");
    expect(screen.getByLabelText("Amount to allocate to Dinner")).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByText("Rp 84.000")).toBeInTheDocument();
    expect(screen.getAllByText("Rp 40.000")).not.toHaveLength(0);
    expect(screen.getByText("Rp 44.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 44.000 needs allocation. Only applied money reduces outstanding balances.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Repayment allocation progress" })).toHaveAttribute("aria-valuenow", "40000");
    const fill = document.querySelector(".allocation-bar__fill") as HTMLElement;
    expect(fill.style.transform).toBe("scaleX(0.47619047619047616)");
    expect(fill.style.width).toBe("");

    fireEvent.change(screen.getByLabelText("Amount to allocate to Dinner"), { target: { value: "100000" } });
    expect(screen.getAllByText("Rp 0").length).toBeGreaterThan(0);
    expect(screen.getByText("Rp 100.000", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("How this repayment adds up")).not.toBeInTheDocument();
    expect(screen.getByText("Over-allocated by Rp 16.000.")).toBeInTheDocument();
    expect((document.querySelector(".allocation-bar__fill") as HTMLElement).style.transform).toBe("scaleX(1)");
    expect(document.body).not.toHaveTextContent(/-Rp|automatic|distribut|delete|debtor|card|pill|status dot/i);
  });

  it("keeps long allocation labels available beside the amount field", () => {
    const description = "expense-" + "x".repeat(240);
    render(<RepaymentAllocationEditor action={vi.fn()} plan={{ ...plan, shares: [{ ...plan.shares[0]!, expenseDescription: description }] }} />);

    expect(screen.getByRole("textbox", { name: `Amount to allocate to ${description}` })).toBeInTheDocument();
    expect(screen.getByText(description, { exact: true })).toBeInTheDocument();
  });

  it("keeps off-page allocations in the live totals and preserves search context", () => {
    render(<RepaymentAllocationEditor action={vi.fn()} plan={{ ...plan, allocatedAmount: 50000, unallocatedAmount: 34000, sharePage: { items: plan.shares, page: 2, pageSize: 10, totalItems: 21, totalPages: 3 } }} allocationQuery="42.500" />);

    expect(screen.getByRole("searchbox", { name: "Search allocation choices" })).toHaveValue("42.500");
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", `/app/repayments/${plan.id}?q=42.500&page=1#repayment-allocations`);
    expect(document.querySelector('input[name="allocationPage"]')).toHaveValue("2");
    expect(document.querySelector('input[name="allocationQuery"]')).toHaveValue("42.500");

    fireEvent.change(screen.getByLabelText("Amount to allocate to Dinner"), { target: { value: "12000" } });
    expect(screen.getByRole("progressbar", { name: "Repayment allocation progress" })).toHaveAttribute("aria-valuenow", "22000");
    expect(screen.getByText("Rp 62.000 needs allocation. Only applied money reduces outstanding balances.")).toBeInTheDocument();
  });

  it("emphasizes changed allocation totals and resolves back to partial state", () => {
    render(<RepaymentAllocationEditor action={vi.fn()} plan={plan} />);
    expect(document.querySelectorAll(".changed-value--changed")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Amount to allocate to Dinner"), { target: { value: "84000" } });
    expect(document.querySelectorAll(".changed-value--changed")).toHaveLength(2);
    expect(screen.getByText("This repayment is fully applied. Applied money reduces outstanding balances.")).toBeInTheDocument();
    const applied = document.querySelector(".repayment-allocation-editor__totals .changed-value") as HTMLElement;
    const firstVisual = applied.querySelector(".changed-value__visual");
    expect(applied).toHaveAttribute("data-changed-revision", "1");

    fireEvent.change(screen.getByLabelText("Amount to allocate to Dinner"), { target: { value: "83000" } });
    const secondVisual = applied.querySelector(".changed-value__visual");
    expect(applied).toHaveAttribute("data-changed-revision", "2");
    expect(secondVisual).not.toBe(firstVisual);
    fireEvent.change(screen.getByLabelText("Amount to allocate to Dinner"), { target: { value: "82000" } });
    const thirdVisual = applied.querySelector(".changed-value__visual");
    expect(applied).toHaveAttribute("data-changed-revision", "3");
    expect(thirdVisual).not.toBe(secondVisual);
    fireEvent.change(screen.getByLabelText("Amount to allocate to Dinner"), { target: { value: "82000" } });
    expect(applied).toHaveAttribute("data-changed-revision", "3");
    expect(applied.querySelector(".changed-value__visual")).toBe(thirdVisual);
    fireEvent.change(screen.getByLabelText("Amount to allocate to Dinner"), { target: { value: "40000" } });
    expect(document.querySelectorAll(".changed-value--changed")).toHaveLength(2);
    expect(screen.getByText("Rp 44.000 needs allocation. Only applied money reduces outstanding balances.")).toBeInTheDocument();
    expect(screen.getByText("Available", { selector: ".repayment-allocation-editor__available span" })).toBeInTheDocument();
  });

  it("preserves values and exposes field errors after validation failure", async () => {
    const action = vi.fn().mockResolvedValue({
      fieldErrors: { [shareA]: "Enter a valid allocation." },
      formError: "Please correct the marked fields.",
      values: [{ expenseShareId: shareA, amountRupiah: "84.00" }],
    } satisfies RepaymentAllocationActionState);
    render(<RepaymentAllocationEditor action={action} plan={plan} />);
    fireEvent.change(screen.getByLabelText("Amount to allocate to Dinner"), { target: { value: "84.00" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save allocations" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Amount to allocate to Dinner")).toHaveValue("84.00"));
    await waitFor(() => expect(screen.getByLabelText("Amount to allocate to Dinner")).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText("Please correct the marked fields.")).toHaveAttribute("role", "alert");
  });

  it("describes a fully applied repayment without a status pill", () => {
    render(<RepaymentAllocationEditor action={vi.fn()} plan={{ ...plan, amount: 40_000, allocatedAmount: 40_000, unallocatedAmount: 0 }} />);

    expect(screen.getByText("This repayment is fully applied. Applied money reduces outstanding balances.")).toBeInTheDocument();
    expect(screen.queryByText(/needs allocation\./)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/badge|pill|success indicator/i);
  });

  it("prevents repeat submission and shows the pending label", async () => {
    let resolveAction: (state: RepaymentAllocationActionState) => void = () => {};
    const action = vi.fn(() => new Promise<RepaymentAllocationActionState>((resolve) => { resolveAction = resolve; }));
    render(<RepaymentAllocationEditor action={action} plan={plan} />);
    const form = screen.getByRole("button", { name: "Save allocations" }).closest("form");
    if (!form) throw new Error("allocation form is missing");
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Saving allocations…" })).toBeDisabled();
    resolveAction({ fieldErrors: {}, formError: "", values: [{ expenseShareId: shareA, amountRupiah: "40000" }] });
  });

  it("links to Expenses when there are no outstanding shares", () => {
    render(<RepaymentAllocationEditor action={vi.fn()} plan={{ ...plan, shares: [] }} />);
    expect(screen.getByText("No outstanding shares for this friend.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to Expenses/ })).toHaveAttribute("href", "/app/expenses");
    expect(screen.queryByRole("button", { name: "Save allocations" })).not.toBeInTheDocument();
  });

  it("removes immediately and sends the exact receipt through server-backed Undo", async () => {
    const receipt = { version: 1 as const, reversalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", allocationId: `${plan.id}:${shareA}`, repaymentId: plan.id, expenseShareId: shareA, friendId: plan.friendId, amount: 40000 };
    const secondReceipt = { ...receipt, reversalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    const removeAction = vi.fn()
      .mockResolvedValueOnce({ formError: "", removalReceipt: receipt })
      .mockResolvedValueOnce({ formError: "", removalReceipt: secondReceipt })
      .mockResolvedValueOnce({ formError: "", removalReceipt: secondReceipt });
    const undoAction = vi.fn().mockResolvedValue({ ok: true });
    render(<ToastProvider><RepaymentAllocationEditor action={vi.fn()} plan={plan} removeAction={removeAction} undoAction={undoAction} /></ToastProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Remove allocation" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Allocation removed"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(undoAction).toHaveBeenCalledWith(receipt));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove allocation" })).toBeEnabled());
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Remove allocation" }));
    await waitFor(() => expect(removeAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Allocation removed"));
    expect(undoAction).toHaveBeenCalledWith(receipt);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(undoAction).toHaveBeenCalledWith(secondReceipt));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove allocation" })).toBeEnabled());
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Remove allocation" }));
    await waitFor(() => expect(removeAction).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("updates only the removed draft and totals before refreshing, then restores them on Undo", async () => {
    router.refresh.mockClear();
    const receipt = { version: 1 as const, reversalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", allocationId: `${plan.id}:${shareA}`, repaymentId: plan.id, expenseShareId: shareA, friendId: plan.friendId, amount: 40000 };
    const removeAction = vi.fn().mockResolvedValue({ formError: "", removalReceipt: receipt });
    const undoAction = vi.fn().mockResolvedValue({ ok: true });
    render(<ToastProvider><RepaymentAllocationEditor action={vi.fn()} plan={planWithUnrelatedDraft} removeAction={removeAction} undoAction={undoAction} /></ToastProvider>);

    fireEvent.change(screen.getByLabelText("Amount to allocate to Coffee"), { target: { value: "12000" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove allocation" })[0]);

    await waitFor(() => expect(screen.getByLabelText("Amount to allocate to Dinner")).toHaveValue(""));
    expect(screen.getByLabelText("Amount to allocate to Coffee")).toHaveValue("12000");
    expect(screen.getByRole("progressbar", { name: "Repayment allocation progress" })).toHaveAttribute("aria-valuenow", "12000");
    expect(screen.getByText("Rp 12.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 72.000")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Removing allocation…" })[0]).toBeDisabled();
    expect(router.refresh).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(undoAction).toHaveBeenCalledWith(receipt));
    await waitFor(() => expect(screen.getByLabelText("Amount to allocate to Dinner")).toHaveValue("40000"));
    expect(screen.getByLabelText("Amount to allocate to Coffee")).toHaveValue("12000");
    expect(screen.getByRole("progressbar", { name: "Repayment allocation progress" })).toHaveAttribute("aria-valuenow", "52000");
    expect(screen.getByText("Rp 32.000")).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed allocation Undo visible with its persistent explanation", async () => {
    const receipt = { version: 1 as const, reversalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", allocationId: `${plan.id}:${shareA}`, repaymentId: plan.id, expenseShareId: shareA, friendId: plan.friendId, amount: 40000 };
    const undoAction = vi.fn().mockResolvedValue({ ok: false, message: "Undo unavailable: the repayment no longer has capacity." });
    render(<ToastProvider><RepaymentAllocationEditor action={vi.fn()} plan={plan} removeAction={vi.fn().mockResolvedValue({ formError: "", removalReceipt: receipt })} undoAction={undoAction} /></ToastProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Remove allocation" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Undo unavailable: the repayment no longer has capacity."));
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});
