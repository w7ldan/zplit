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
const initialState = {
  fieldErrors: {},
  formError: "",
  values: { friendId: "", amountRupiah: "", paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: "", notes: "" },
};

describe("RepaymentForm", () => {
  it("renders labelled square fields, active and archived friends, and local date controls", () => {
    const { container } = render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[activeFriend, archivedFriend]} />);

    for (const label of ["Friend", "Amount in rupiah", "Payment date and time", "Payment method", "Notes"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-describedby", expect.stringContaining("repayment-"));
    }
    expect(screen.getByLabelText("Amount in rupiah")).toHaveAttribute("inputmode", "numeric");
    expect(container.querySelector('input[type="datetime-local"]')).toBeInTheDocument();
    expect(container.querySelector('input[name="timezoneOffsetMinutes"]')).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ari" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Bima (ARCHIVED)" })).toBeInTheDocument();
    expect(document.querySelectorAll(".repayment-form__field-error")).toHaveLength(5);
  });

  it("preserves values and exposes accessible errors after validation failure", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      fieldErrors: { amountRupiah: "Enter whole rupiah, such as 84000 or 84.000." },
      formError: "Please correct the marked fields.",
      values: { friendId: activeFriend.id, amountRupiah: "84.00", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: "Cash", notes: "Received" },
    });
    render(<RepaymentForm action={action} friends={[activeFriend]} />);
    fireEvent.submit(screen.getByRole("button", { name: "Record repayment" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Amount in rupiah")).toHaveValue("84.00"));
    expect(screen.getByLabelText("Amount in rupiah")).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("repayment-amount-error")).toHaveTextContent("Enter whole rupiah");
    expect(screen.getByRole("alert")).toHaveTextContent("Please correct the marked fields.");
  });

  it("shows the required pending label and prevents repeat submission", () => {
    let resolveAction: (state: typeof initialState) => void = () => {};
    const action = vi.fn().mockReturnValue(new Promise((resolve) => { resolveAction = resolve; }));
    render(<RepaymentForm action={action} friends={[activeFriend]} />);
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
        friends={[activeFriend, archivedFriend]}
        mode="edit"
        friendLocked
        initialValues={{ friendId: activeFriend.id, amountRupiah: "84000", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: "Cash", notes: "Received" }}
      />,
    );

    expect(screen.getByLabelText("Friend")).toBeDisabled();
    expect(document.querySelector('input[type="hidden"][name="friendId"]')).toHaveValue(activeFriend.id);
    expect(screen.getByText("The friend is fixed while this repayment has allocations.")).toBeInTheDocument();
  });

  it("shows optional open shares and clears draft allocations when the friend changes", () => {
    render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[activeFriend, archivedFriend]} openExpenseSharesByFriend={{ [activeFriend.id]: [share], [archivedFriend.id]: [otherShare] }} />);

    expect(screen.getByRole("heading", { name: "Apply to outstanding expenses" })).toBeInTheDocument();
    expect(screen.getByText("Dinner")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Friend"), { target: { value: archivedFriend.id } });
    expect(screen.queryByText("Dinner")).not.toBeInTheDocument();
    expect(screen.getByText("Taxi")).toBeInTheDocument();
  });
});
