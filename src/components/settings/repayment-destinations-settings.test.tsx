import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RepaymentDestinationsSettings, type SettingsRepaymentDestinationEntry } from "./repayment-destinations-settings";

const destinations = [
  { id: "11111111-1111-4111-8111-111111111111", type: "bank_account" as const, name: "BCA", identifier: "123456", accountName: "Wildan", note: null, shareOnBalanceLinks: true },
  { id: "22222222-2222-4222-8222-222222222222", type: "e_wallet" as const, name: "GoPay", identifier: "0812", accountName: null, note: "Use this number", shareOnBalanceLinks: false },
];

function entries(): SettingsRepaymentDestinationEntry[] {
  return destinations.map((destination) => ({ ...destination, updateAction: vi.fn(), deleteAction: vi.fn() }));
}

describe("RepaymentDestinationsSettings", () => {
  it("keeps create and edit disclosures collapsed and mutually exclusive", () => {
    render(<RepaymentDestinationsSettings destinations={entries()} createAction={vi.fn()} setOrderAction={vi.fn()} />);
    const newButton = screen.getByRole("button", { name: "New destination" });
    expect(newButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("ADD DESTINATION")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit BCA" })).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(newButton);
    expect(newButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("ADD DESTINATION")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit BCA" }));
    expect(screen.queryByText("ADD DESTINATION")).not.toBeInTheDocument();
    expect(screen.getByText("EDIT DESTINATION")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit BCA" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Edit GoPay" })).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "Edit GoPay" }));
    expect(screen.getAllByText("EDIT DESTINATION")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Edit BCA" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("EDIT DESTINATION")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit GoPay" })).toHaveFocus();
  });

  it("keeps a validation failure open with returned values", async () => {
    const createAction = vi.fn().mockResolvedValue({
      fieldErrors: { identifier: "Identifier or details are required." },
      formError: "Please correct the marked fields.",
      values: { type: "bank_account", name: "Savings", identifier: "", accountName: "", note: "", shareOnBalanceLinks: false },
    });
    render(<RepaymentDestinationsSettings destinations={entries()} createAction={createAction} setOrderAction={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "New destination" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Savings" } });
    fireEvent.click(screen.getByRole("button", { name: "Add destination" }));

    await waitFor(() => expect(screen.getByText("Please correct the marked fields.")).toBeInTheDocument());
    expect(screen.getByText("ADD DESTINATION")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Savings");
    expect(screen.getByRole("button", { name: "New destination" })).toHaveAttribute("aria-expanded", "true");
  });

  it("uses complete orders for arrows and restores the confirmed order on failure", async () => {
    const setOrderAction = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, message: "Unable to save repayment destination order." });
    render(<RepaymentDestinationsSettings destinations={entries()} createAction={vi.fn()} setOrderAction={setOrderAction} />);

    expect(screen.getByRole("button", { name: "Move BCA up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move GoPay down" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move GoPay up" }));
    await waitFor(() => expect(setOrderAction).toHaveBeenNthCalledWith(1, [destinations[1]!.id, destinations[0]!.id]));
    fireEvent.click(screen.getByRole("button", { name: "Move GoPay down" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unable to save repayment destination order."));
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["GoPay", "BCA"]);
    expect(setOrderAction).toHaveBeenNthCalledWith(2, [destinations[0]!.id, destinations[1]!.id]);
  });

  it("persists native drag drops through the same explicit-order action", async () => {
    const setOrderAction = vi.fn().mockResolvedValue({ ok: true });
    render(<RepaymentDestinationsSettings destinations={entries()} createAction={vi.fn()} setOrderAction={setOrderAction} />);
    const handle = screen.getByLabelText("Drag BCA to reorder");
    const target = screen.getByText("GoPay").closest("article");
    expect(handle).toHaveAttribute("draggable", "true");
    expect(target).not.toBeNull();

    fireEvent.dragStart(handle);
    fireEvent.dragOver(target!);
    fireEvent.drop(target!);
    await waitFor(() => expect(setOrderAction).toHaveBeenCalledWith([destinations[1]!.id, destinations[0]!.id]));
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["GoPay", "BCA"]);
  });
});
