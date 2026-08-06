import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RepaymentForm } from "./repayment-form";

const activeFriend = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "owner-a",
  name: "Ari",
  phoneNumber: null,
  notes: null,
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const archivedFriend = { ...activeFriend, id: "22222222-2222-4222-8222-222222222222", name: "Bima", archivedAt: new Date("2026-01-01T00:00:00.000Z") };
const share = { id: "33333333-3333-4333-8333-333333333333", friendId: activeFriend.id, friendName: "Ari", expenseDescription: "Dinner", outingTitle: "Bandung day out", outingOccurredAt: new Date("2026-01-01T00:00:00.000Z"), amountOwed: 84_000, repaidAmount: 20_000, remainingAmount: 64_000 };
const otherShare = { ...share, id: "44444444-4444-4444-8444-444444444444", friendId: archivedFriend.id, friendName: "Bima", expenseDescription: "Taxi" };
const secondShare = { ...share, id: "55555555-5555-4555-8555-555555555555", expenseDescription: "Coffee" };
const initialState = {
  fieldErrors: {},
  formError: "",
  values: { friendId: "", amountRupiah: "", paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: "", notes: "" },
};

describe("RepaymentForm", () => {
  it("renders labelled square fields, active and archived friends, and local date controls", () => {
    const { container } = render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }, { id: archivedFriend.id, label: archivedFriend.name, archived: true }]} searchFriends={vi.fn().mockResolvedValue([])} />);

    for (const label of ["Friend", "Amount in rupiah", "Payment date and time", "Payment method", "Notes"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-describedby", expect.stringContaining("repayment-"));
    }
    expect(screen.getByLabelText("Amount in rupiah")).toHaveAttribute("inputmode", "numeric");
    expect(container.querySelector('input[type="datetime-local"]')).toBeInTheDocument();
    expect(container.querySelector('input[name="timezoneOffsetMinutes"]')).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ari" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Bima (ARCHIVED)" })).toBeInTheDocument();
    expect(document.querySelectorAll(".repayment-form__field-error")).toHaveLength(5);
    expect(screen.getByText("Allocate now")).toBeInTheDocument();
    expect(screen.getByText("Optional details")).toBeInTheDocument();
    expect(screen.getByText("Allocate now").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Optional details").closest("details")).not.toHaveAttribute("open");
  });

  it("preserves values and exposes accessible errors after validation failure", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      fieldErrors: { amountRupiah: "Enter whole rupiah, such as 84000 or 84.000." },
      formError: "Please correct the marked fields.",
      values: { friendId: activeFriend.id, amountRupiah: "84.00", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: "Cash", notes: "Received" },
    });
    render(<RepaymentForm action={action} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} />);
    fireEvent.submit(screen.getByRole("button", { name: "Record repayment" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Amount in rupiah")).toHaveValue("84.00"));
    expect(screen.getByLabelText("Amount in rupiah")).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("repayment-amount-error")).toHaveTextContent("Enter whole rupiah");
    expect(screen.getByRole("alert")).toHaveTextContent("Please correct the marked fields.");
    expect(screen.getByText("Optional details").closest("details")).toHaveAttribute("open");
  });

  it("submits closed disclosure controls in their existing order", async () => {
    const action = vi.fn().mockResolvedValue(initialState);
    render(<RepaymentForm action={action} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} openExpenseSharesByFriend={{ [activeFriend.id]: [share, secondShare] }} />);
    fireEvent.change(screen.getByLabelText("Amount in rupiah"), { target: { value: "84000" } });
    fireEvent.change(screen.getByLabelText("Payment date and time"), { target: { value: "2026-01-02T10:30" } });
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "Cash" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Received" } });
    fireEvent.change(screen.getByLabelText("Allocation for Dinner"), { target: { value: "20000" } });
    fireEvent.change(screen.getByLabelText("Allocation for Coffee"), { target: { value: "30000" } });
    fireEvent.submit(screen.getByRole("button", { name: "Record repayment" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    const formData = action.mock.calls[0][1] as FormData;
    expect(formData.get("paymentMethod")).toBe("Cash");
    expect(formData.get("notes")).toBe("Received");
    expect(formData.getAll("expenseShareId")).toEqual([share.id, secondShare.id]);
    expect(formData.getAll("amountRupiah")).toEqual(["84000", "20000", "30000"]);
  });

  it("shows the required pending label and prevents repeat submission", () => {
    let resolveAction: (state: typeof initialState) => void = () => {};
    const action = vi.fn().mockReturnValue(new Promise((resolve) => { resolveAction = resolve; }));
    render(<RepaymentForm action={action} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} />);
    const form = screen.getByRole("button", { name: "Record repayment" }).closest("form");
    if (!form) throw new Error("repayment form is missing");

    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Recording repayment…" })).toBeDisabled();
    resolveAction(initialState);
  });

  it("locks the friend selector and submits the existing friend ID when allocations exist", () => {
    render(
      <RepaymentForm
        action={vi.fn().mockResolvedValue(initialState)}
        friends={[{ id: activeFriend.id, label: activeFriend.name }, { id: archivedFriend.id, label: archivedFriend.name, archived: true }]}
        searchFriends={vi.fn().mockResolvedValue([])}
        mode="edit"
        friendLocked
        initialValues={{ friendId: activeFriend.id, amountRupiah: "84000", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: "Cash", notes: "Received" }}
      />,
    );

    expect(screen.getByLabelText("Friend")).toBeDisabled();
    expect(document.querySelector('input[type="hidden"][name="friendId"]')).toHaveValue(activeFriend.id);
    expect(screen.getByText("The friend is fixed while this repayment has allocations.")).toBeInTheDocument();
  });

  it("opens and closes natively, and keeps Allocate now open through local rerenders", () => {
    render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }, { id: archivedFriend.id, label: archivedFriend.name, archived: true }]} searchFriends={vi.fn().mockResolvedValue([])} openExpenseSharesByFriend={{ [activeFriend.id]: [share], [archivedFriend.id]: [otherShare] }} />);

    expect(screen.getByText("Allocate now").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Optional details").closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Allocate now"));
    expect(screen.getByText("Allocate now").closest("details")).toHaveAttribute("open");
    fireEvent.click(screen.getByText("Allocate now"));
    expect(screen.getByText("Allocate now").closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Optional details"));
    expect(screen.getByText("Optional details").closest("details")).toHaveAttribute("open");
    fireEvent.click(screen.getByText("Optional details"));
    expect(screen.getByText("Optional details").closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Allocate now"));
    fireEvent.change(screen.getByLabelText("Allocation for Dinner"), { target: { value: "12000" } });
    expect(screen.getByText("Allocate now").closest("details")).toHaveAttribute("open");
    fireEvent.change(screen.getByLabelText("Friend"), { target: { value: archivedFriend.id } });
    expect(screen.getByText("Allocate now").closest("details")).toHaveAttribute("open");
    expect(screen.queryByText("Dinner")).not.toBeInTheDocument();
    expect(screen.getByText("Taxi")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Friend"), { target: { value: activeFriend.id } });
    expect(screen.getByLabelText("Allocation for Dinner")).toHaveValue("");
  });

  it("shows optional open shares and clears draft allocations when the friend changes", () => {
    render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }, { id: archivedFriend.id, label: archivedFriend.name, archived: true }]} searchFriends={vi.fn().mockResolvedValue([])} openExpenseSharesByFriend={{ [activeFriend.id]: [share], [archivedFriend.id]: [otherShare] }} />);

    fireEvent.click(screen.getByText("Allocate now"));
    expect(screen.getByRole("heading", { name: "Apply to outstanding expenses" })).toBeVisible();
    expect(screen.getByText("Dinner")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Friend"), { target: { value: archivedFriend.id } });
    expect(screen.queryByText("Dinner")).not.toBeInTheDocument();
    expect(screen.getByText("Taxi")).toBeInTheDocument();
  });

  it("opens disclosures when returned values or allocation errors need attention", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      fieldErrors: { notes: "Notes must be 4000 characters or fewer." },
      values: { ...initialState.values, friendId: activeFriend.id, paymentMethod: "Cash", notes: "Too long" },
      allocations: [{ expenseShareId: share.id, amountRupiah: "84000" }],
      allocationFieldErrors: { [share.id]: "Allocation is invalid." },
    });
    render(<RepaymentForm action={action} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} openExpenseSharesByFriend={{ [activeFriend.id]: [share] }} />);
    fireEvent.submit(screen.getByRole("button", { name: "Record repayment" }).closest("form")!);

    await waitFor(() => expect(screen.getByLabelText("Payment method")).toHaveValue("Cash"));
    expect(screen.getByText("Allocate now").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Optional details").closest("details")).toHaveAttribute("open");
  });

  it("opens Allocate now for returned allocation values and errors", async () => {
    for (const result of [
      { allocations: [{ expenseShareId: share.id, amountRupiah: "84000" }] },
      { allocations: [{ expenseShareId: share.id, amountRupiah: "" }], allocationFieldErrors: { [share.id]: "Allocation is invalid." } },
    ]) {
      const action = vi.fn().mockResolvedValue({ ...initialState, ...result, values: { ...initialState.values, friendId: activeFriend.id } });
      const { unmount } = render(<RepaymentForm action={action} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} openExpenseSharesByFriend={{ [activeFriend.id]: [share] }} />);
      fireEvent.submit(screen.getByRole("button", { name: "Record repayment" }).closest("form")!);

      await waitFor(() => expect(screen.getByText("Allocate now").closest("details")).toHaveAttribute("open"));
      unmount();
    }
  });

  it("opens Optional details for returned validation errors", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      fieldErrors: { paymentMethod: "Payment method is too long.", notes: "Notes are too long." },
      values: initialState.values,
    });
    render(<RepaymentForm action={action} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} />);
    fireEvent.submit(screen.getByRole("button", { name: "Record repayment" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Optional details").closest("details")).toHaveAttribute("open"));
  });

  it("reopens a disclosure for each qualifying action result", async () => {
    const result = { ...initialState, values: { ...initialState.values, friendId: activeFriend.id }, allocations: [{ expenseShareId: share.id, amountRupiah: "84000" }] };
    const action = vi.fn().mockResolvedValueOnce({ ...result }).mockResolvedValueOnce({ ...result, allocations: [...result.allocations] });
    render(<RepaymentForm action={action} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} openExpenseSharesByFriend={{ [activeFriend.id]: [share] }} />);

    fireEvent.submit(screen.getByRole("button", { name: "Record repayment" }).closest("form")!);
    await waitFor(() => expect(screen.getByText("Allocate now").closest("details")).toHaveAttribute("open"));
    fireEvent.click(screen.getByText("Allocate now"));
    expect(screen.getByText("Allocate now").closest("details")).not.toHaveAttribute("open");
    fireEvent.submit(screen.getByRole("button", { name: "Record repayment" }).closest("form")!);
    await waitFor(() => expect(screen.getByText("Allocate now").closest("details")).toHaveAttribute("open"));
  });

  it("keeps disclosures out of edit mode", () => {
    render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} mode="edit" />);

    expect(screen.queryByText("Allocate now")).not.toBeInTheDocument();
    expect(screen.queryByText("Optional details")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Payment method")).toBeVisible();
    expect(screen.getByLabelText("Notes")).toBeVisible();
  });
});
