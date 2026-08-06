import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RepaymentAllocationActionState } from "@/app/app/repayments/actions";
import type { RepaymentAllocationPlan } from "@/domain/ledger-repository";
import { RepaymentAllocationEditor } from "./repayment-allocation-editor";
import { ToastProvider } from "@/components/feedback/toast";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const shareA = "11111111-1111-4111-8111-111111111111";
const plan: RepaymentAllocationPlan = {
  id: "33333333-3333-4333-8333-333333333333",
  ownerUserId: "owner-a",
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

describe("RepaymentAllocationEditor", () => {
  it("shows share details, accessible fields, and live non-negative totals", () => {
    render(<RepaymentAllocationEditor action={vi.fn()} plan={plan} />);

    expect(screen.getByText("Dinner")).toBeInTheDocument();
    expect(screen.getByText(/Friday night/)).toBeInTheDocument();
    expect(screen.getByText("Original amount owed")).toBeInTheDocument();
    expect(screen.getByText("Repaid through other repayments")).toBeInTheDocument();
    expect(screen.getByText("Capacity available to this repayment")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount to allocate to Dinner")).toHaveValue("40000");
    expect(screen.getByLabelText("Amount to allocate to Dinner")).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByText("Rp 84.000")).toBeInTheDocument();
    expect(screen.getAllByText("Rp 40.000")).not.toHaveLength(0);
    expect(screen.getByText("Rp 44.000")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Repayment allocation progress" })).toHaveAttribute("aria-valuenow", "40000");
    const fill = document.querySelector(".allocation-bar__fill") as HTMLElement;
    expect(fill.style.transform).toBe("scaleX(0.47619047619047616)");
    expect(fill.style.width).toBe("");

    fireEvent.change(screen.getByLabelText("Amount to allocate to Dinner"), { target: { value: "100000" } });
    expect(screen.getAllByText("Rp 0").length).toBeGreaterThan(0);
    expect(screen.getByText("Over-allocated by Rp 16.000.")).toBeInTheDocument();
    expect((document.querySelector(".allocation-bar__fill") as HTMLElement).style.transform).toBe("scaleX(1)");
    expect(document.body).not.toHaveTextContent(/-Rp|automatic|distribut|delete|debtor|card|pill|status dot/i);
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
    expect(screen.getByLabelText("Amount to allocate to Dinner")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Please correct the marked fields.")).toHaveAttribute("role", "alert");
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
    const receipt = { version: 1 as const, allocationId: `${plan.id}:${shareA}`, repaymentId: plan.id, expenseShareId: shareA, friendId: plan.friendId, amount: 40000 };
    const removeAction = vi.fn().mockResolvedValue({ formError: "", removalReceipt: receipt });
    const undoAction = vi.fn().mockResolvedValue({ ok: true });
    render(<ToastProvider><RepaymentAllocationEditor action={vi.fn()} plan={plan} removeAction={removeAction} undoAction={undoAction} /></ToastProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Remove allocation" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Allocation removed"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(undoAction).toHaveBeenCalledWith(receipt));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("keeps a failed allocation Undo visible with its persistent explanation", async () => {
    const receipt = { version: 1 as const, allocationId: `${plan.id}:${shareA}`, repaymentId: plan.id, expenseShareId: shareA, friendId: plan.friendId, amount: 40000 };
    const undoAction = vi.fn().mockResolvedValue({ ok: false, message: "Undo unavailable: the repayment no longer has capacity." });
    render(<ToastProvider><RepaymentAllocationEditor action={vi.fn()} plan={plan} removeAction={vi.fn().mockResolvedValue({ formError: "", removalReceipt: receipt })} undoAction={undoAction} /></ToastProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Remove allocation" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Undo unavailable: the repayment no longer has capacity."));
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});
