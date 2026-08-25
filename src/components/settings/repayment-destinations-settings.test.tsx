import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RepaymentDestinationsSettings, type SettingsRepaymentDestination, type SettingsRepaymentDestinationEntry } from "./repayment-destinations-settings";

const destinations: SettingsRepaymentDestination[] = [
  { id: "11111111-1111-4111-8111-111111111111", type: "bank_account" as const, name: "BCA", identifier: "123456", accountName: "Wildan", note: null, shareOnBalanceLinks: true },
  { id: "22222222-2222-4222-8222-222222222222", type: "e_wallet" as const, name: "GoPay", identifier: "0812", accountName: null, note: "Use this number", shareOnBalanceLinks: false },
];
const dana: SettingsRepaymentDestination = { id: "33333333-3333-4333-8333-333333333333", type: "e_wallet", name: "DANA", identifier: "0856", accountName: null, note: null, shareOnBalanceLinks: true };

function entries(items: SettingsRepaymentDestination[] = destinations): SettingsRepaymentDestinationEntry[] {
  return items.map((destination) => ({ ...destination, updateAction: vi.fn(), deleteAction: vi.fn() }));
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Move GoPay down" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Move GoPay down" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unable to save repayment destination order."));
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["GoPay", "BCA"]);
    expect(setOrderAction).toHaveBeenNthCalledWith(2, [destinations[0]!.id, destinations[1]!.id]);
  });

  it("adopts created destinations from a refresh of the same mounted component", async () => {
    const setOrderAction = vi.fn().mockResolvedValue({ ok: true });
    const { rerender } = render(<RepaymentDestinationsSettings destinations={entries()} createAction={vi.fn()} setOrderAction={setOrderAction} />);
    fireEvent.click(screen.getByRole("button", { name: "New destination" }));

    rerender(<RepaymentDestinationsSettings destinations={entries([...destinations, dana])} createAction={vi.fn()} setOrderAction={setOrderAction} />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "DANA" })).toBeInTheDocument());
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["BCA", "GoPay", "DANA"]);
    expect(screen.getByRole("button", { name: "New destination" })).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "Move DANA up" }));
    await waitFor(() => expect(setOrderAction).toHaveBeenCalledWith([destinations[0]!.id, dana.id, destinations[1]!.id]));
  });

  it("adopts edited destination details and closes the edit disclosure", async () => {
    const initial = { ...destinations[0], name: "BCA old", identifier: "old-identifier" };
    const updated = { ...initial, name: "BCA updated", identifier: "new-identifier" };
    const { rerender } = render(<RepaymentDestinationsSettings destinations={entries([initial])} createAction={vi.fn()} setOrderAction={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit BCA old" }));
    expect(screen.getByLabelText("Account number")).toHaveValue("old-identifier");

    rerender(<RepaymentDestinationsSettings destinations={entries([updated])} createAction={vi.fn()} setOrderAction={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "BCA updated" })).toBeInTheDocument());
    expect(screen.getByText("new-identifier")).toBeInTheDocument();
    expect(screen.queryByText("old-identifier")).not.toBeInTheDocument();
    expect(screen.queryByText("EDIT DESTINATION")).not.toBeInTheDocument();
  });

  it("removes deleted destinations and refreshes the one-item order boundary", async () => {
    const { rerender } = render(<RepaymentDestinationsSettings destinations={entries()} createAction={vi.fn()} setOrderAction={vi.fn()} />);
    rerender(<RepaymentDestinationsSettings destinations={entries([destinations[1]!])} createAction={vi.fn()} setOrderAction={vi.fn()} />);

    await waitFor(() => expect(screen.queryByRole("heading", { level: 3, name: "BCA" })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 3, name: "GoPay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move GoPay up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move GoPay down" })).toBeDisabled();
  });

  it("uses the confirmed server reorder as the next rollback order", async () => {
    const setOrderAction = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, message: "Unable to save repayment destination order." });
    const initial = [...destinations, dana];
    const confirmed = [destinations[1]!, destinations[0]!, dana];
    const { rerender } = render(<RepaymentDestinationsSettings destinations={entries(initial)} createAction={vi.fn()} setOrderAction={setOrderAction} />);

    fireEvent.click(screen.getByRole("button", { name: "Move GoPay up" }));
    await waitFor(() => expect(setOrderAction).toHaveBeenNthCalledWith(1, [destinations[1]!.id, destinations[0]!.id, dana.id]));
    rerender(<RepaymentDestinationsSettings destinations={entries(confirmed)} createAction={vi.fn()} setOrderAction={setOrderAction} />);
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["GoPay", "BCA", "DANA"]));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move GoPay down" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["GoPay", "BCA", "DANA"]);
  });

  it("does not clobber an optimistic reorder with stale props while pending", async () => {
    let resolveOrder: ((result: { ok: true }) => void) | undefined;
    const setOrderAction = vi.fn()
      .mockImplementationOnce(() => new Promise<{ ok: true }>((resolve) => { resolveOrder = resolve; }))
      .mockResolvedValueOnce({ ok: false, message: "Unable to save repayment destination order." });
    const { rerender } = render(<RepaymentDestinationsSettings destinations={entries()} createAction={vi.fn()} setOrderAction={setOrderAction} />);

    fireEvent.click(screen.getByRole("button", { name: "Move GoPay up" }));
    await waitFor(() => expect(setOrderAction).toHaveBeenCalledWith([destinations[1]!.id, destinations[0]!.id]));
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["GoPay", "BCA"]);

    rerender(<RepaymentDestinationsSettings destinations={entries()} createAction={vi.fn()} setOrderAction={setOrderAction} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["GoPay", "BCA"]);

    const confirmed = [{ ...destinations[1]! }, { ...destinations[0]!, identifier: "fresh-identifier" }];
    rerender(<RepaymentDestinationsSettings destinations={entries(confirmed)} createAction={vi.fn()} setOrderAction={setOrderAction} />);
    await waitFor(() => expect(screen.getByText("fresh-identifier")).toBeInTheDocument());
    resolveOrder!({ ok: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Move BCA up" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Move GoPay down" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["GoPay", "BCA"]);
    expect(screen.getByText("fresh-identifier")).toBeInTheDocument();
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
