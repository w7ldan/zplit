import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
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
const searchableFriends = [{ id: activeFriend.id, label: activeFriend.name }, { id: archivedFriend.id, label: archivedFriend.name, archived: true }];

async function chooseExpense(name: RegExp | string) {
  const picker = screen.getByRole("combobox", { name: "Add outstanding expense" });
  fireEvent.click(picker);
  await screen.findByRole("searchbox", { name: "Search outstanding expenses" });
  const listbox = screen.getByRole("listbox");
  await waitFor(() => expect(within(listbox).getByRole("option", { name })).toBeInTheDocument());
  fireEvent.click(within(listbox).getByRole("option", { name }));
}

async function chooseFriend(name: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Friend" }));
  const searchInput = await screen.findByRole("searchbox", { name: "Search friends" });
  fireEvent.change(searchInput, { target: { value: typeof name === "string" ? name : "" } });
  const listbox = screen.getByRole("listbox");
  await waitFor(() => expect(within(listbox).getByRole("option", { name })).toBeInTheDocument());
  fireEvent.click(within(listbox).getByRole("option", { name }));
}

describe("RepaymentForm", () => {
  it("defaults a pristine create form to the browser-local current minute", async () => {
    render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} initialPaidAtUtc="2026-08-07T12:34:56.789Z" />);

    const date = new Date("2026-08-07T12:34:56.789Z");
    const pad = (value: number) => value.toString().padStart(2, "0");
    const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    await waitFor(() => expect(screen.getByLabelText("Payment date and time")).toHaveValue(expected));
  });

  it("keeps the persisted repayment timestamp in edit mode", async () => {
    render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} mode="edit" initialPaidAtUtc="2026-01-02T10:30:45.000Z" initialValues={{ friendId: activeFriend.id, amountRupiah: "64000", paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: "", notes: "" }} />);
    const date = new Date("2026-01-02T10:30:45.000Z");
    const pad = (value: number) => value.toString().padStart(2, "0");
    const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    await waitFor(() => expect(screen.getByLabelText("Payment date and time")).toHaveValue(expected));
  });

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

  it("offers canonical choices, optional Not specified, and preserves a legacy value as Other", () => {
    render(<RepaymentForm action={vi.fn()} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} mode="edit" initialValues={{ friendId: activeFriend.id, amountRupiah: "64000", paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: "Legacy wallet", notes: "" }} />);

    expect(screen.getByLabelText("Payment method")).toHaveValue("Other");
    expect(screen.getByLabelText("Custom payment method")).toHaveValue("Legacy wallet");
    expect(screen.getByRole("option", { name: "Not specified" })).toBeInTheDocument();
    for (const option of ["Bank transfer", "GoPay", "ShopeePay", "Cash", "Other"]) expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
  });

  it("shows recent canonical choices and routes custom choices through Other", () => {
    render(<RepaymentForm action={vi.fn()} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} recentPaymentMethods={["gOpAy", "Wallet"]} />);
    fireEvent.click(screen.getByText("Optional details"));
    expect(screen.getByRole("group", { name: "Recent" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "GoPay" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "recent-custom-1" } });
    expect(screen.getByLabelText("Payment method")).toHaveValue("Other");
    expect(screen.getByLabelText("Custom payment method")).toHaveValue("Wallet");
  });

  it("preserves Other and its custom value through validation failure", async () => {
    const action = vi.fn().mockResolvedValue({ ...initialState, fieldErrors: { paymentMethod: "Enter a custom payment method." }, formError: "Please correct the marked fields.", values: { ...initialState.values, friendId: activeFriend.id }, paymentMethodForm: { choice: "Other", other: "Wallet" } });
    render(<RepaymentForm action={action} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} />);
    fireEvent.click(screen.getByText("Optional details"));
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "Other" } });
    fireEvent.change(screen.getByLabelText("Custom payment method"), { target: { value: "Wallet" } });
    fireEvent.submit(screen.getByRole("button", { name: "Record repayment" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Payment method")).toHaveValue("Other"));
    expect(screen.getByLabelText("Custom payment method")).toHaveValue("Wallet");
    expect(screen.getByRole("alert")).toHaveTextContent("Please correct the marked fields.");
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
    expect(screen.getByLabelText("Payment date and time")).toHaveValue("2026-01-02T10:30");
    expect(screen.getByLabelText("Amount in rupiah")).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("repayment-amount-error")).toHaveTextContent("Enter whole rupiah");
    expect(screen.getByRole("alert")).toHaveTextContent("Please correct the marked fields.");
    expect(screen.getByText("Optional details").closest("details")).toHaveAttribute("open");
  });

  it("fills only the exact outstanding amount, focuses the field, and does not submit or alter the draft", async () => {
    const action = vi.fn().mockResolvedValue(initialState);
    render(
      <RepaymentForm
        action={action}
        friends={[{ id: activeFriend.id, label: activeFriend.name }]}
        searchFriends={vi.fn().mockResolvedValue(searchableFriends)}
        initialValues={{ friendId: activeFriend.id, amountRupiah: "12000", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: "Cash", notes: "Received" }}
        initialFriendContext={{ option: { id: activeFriend.id, label: activeFriend.name }, outstandingAmount: 64_000, openExpenseShares: [share] }}
      />,
    );

    fireEvent.click(screen.getByText("Allocate now"));
    await chooseExpense(/Dinner · Bandung day out/);
    fireEvent.change(screen.getByLabelText("Allocation for Dinner"), { target: { value: "12000" } });
    fireEvent.click(screen.getByText("Optional details"));
    expect(screen.getByLabelText("Payment method")).toHaveValue("Cash");
    expect(screen.getByLabelText("Notes")).toHaveValue("Received");
    fireEvent.click(screen.getByRole("button", { name: "Use full outstanding" }));

    expect(screen.getByLabelText("Amount in rupiah")).toHaveValue("64000");
    expect(document.activeElement).toBe(screen.getByLabelText("Amount in rupiah"));
    expect(screen.getByLabelText("Allocation for Dinner")).toHaveValue("12000");
    expect(screen.getByLabelText("Payment method")).toHaveValue("Cash");
    expect(screen.getByLabelText("Notes")).toHaveValue("Received");
    expect(action).not.toHaveBeenCalled();
  });

  it.each([
    { strategy: "oldest" as const, expectedIds: [share.id, secondShare.id] },
    { strategy: "newest" as const, expectedIds: [secondShare.id, share.id] },
  ])("recalculates all allocations immediately when using full outstanding with $strategy first", async ({ strategy, expectedIds }) => {
    render(
      <RepaymentForm
        action={vi.fn().mockResolvedValue(initialState)}
        friends={[{ id: activeFriend.id, label: activeFriend.name }]}
        searchFriends={vi.fn().mockResolvedValue([])}
        initialValues={{ friendId: activeFriend.id, amountRupiah: "12000", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: "", notes: "" }}
        initialAllocationStrategy={strategy}
        initialFriendContext={{ option: { id: activeFriend.id, label: activeFriend.name }, outstandingAmount: 128_000, openExpenseShares: [share, secondShare] }}
      />,
    );

    await waitFor(() => expect(screen.getAllByRole("textbox", { name: /Allocation for/ })).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Use full outstanding" }));

    expect(screen.getByLabelText("Amount in rupiah")).toHaveValue("128000");
    expect(screen.getByLabelText("Allocation for Dinner")).toHaveValue("64000");
    expect(screen.getByLabelText("Allocation for Coffee")).toHaveValue("64000");
    expect(screen.getAllByRole("textbox", { name: /Allocation for/ }).map((input) => input.id)).toEqual(expectedIds.map((id) => `repayment-allocation-${id}`));
  });

  it("caps full-outstanding automatic allocations at the available share balances", async () => {
    render(
      <RepaymentForm
        action={vi.fn().mockResolvedValue(initialState)}
        friends={[{ id: activeFriend.id, label: activeFriend.name }]}
        searchFriends={vi.fn().mockResolvedValue([])}
        initialValues={{ friendId: activeFriend.id, amountRupiah: "12000", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: "", notes: "" }}
        initialAllocationStrategy="oldest"
        initialFriendContext={{ option: { id: activeFriend.id, label: activeFriend.name }, outstandingAmount: 128_000, openExpenseShares: [share] }}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("Allocation for Dinner")).toHaveValue("12000"));
    fireEvent.click(screen.getByRole("button", { name: "Use full outstanding" }));

    expect(screen.getByLabelText("Amount in rupiah")).toHaveValue("128000");
    expect(screen.getByLabelText("Allocation for Dinner")).toHaveValue("64000");
    expect(screen.queryByLabelText("Allocation for Coffee")).not.toBeInTheDocument();
  });

  it("generates oldest and newest allocations, recalculates amounts, and leaves excess unallocated", async () => {
    render(
      <RepaymentForm
        action={vi.fn().mockResolvedValue(initialState)}
        friends={[{ id: activeFriend.id, label: activeFriend.name }]}
        searchFriends={vi.fn().mockResolvedValue([])}
        initialValues={{ friendId: activeFriend.id, amountRupiah: "70000", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: "", notes: "" }}
        initialAllocationStrategy="oldest"
        initialFriendContext={{ option: { id: activeFriend.id, label: activeFriend.name }, outstandingAmount: 128_000, openExpenseShares: [share, secondShare] }}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("Allocation for Dinner")).toHaveValue("64000"));
    expect(screen.getByLabelText("Allocation for Coffee")).toHaveValue("6000");
    fireEvent.change(screen.getByLabelText("Amount in rupiah"), { target: { value: "12000" } });
    expect(screen.getByLabelText("Allocation for Dinner")).toHaveValue("12000");
    expect(screen.queryByLabelText("Allocation for Coffee")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Allocation strategy"), { target: { value: "newest" } });
    expect(screen.getByLabelText("Allocation for Coffee")).toHaveValue("12000");
    expect(screen.queryByLabelText("Allocation for Dinner")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Amount in rupiah"), { target: { value: "" } });
    expect(screen.queryByLabelText("Allocation for Coffee")).not.toBeInTheDocument();
  });

  it("preserves generated values when switching to Manual and recalculates for a new friend", async () => {
    let resolveContext: (context: { option: { id: string; label: string }; outstandingAmount: number; openExpenseShares: typeof share[] }) => void = () => {};
    const loadFriendContext = vi.fn().mockReturnValue(new Promise((resolve) => { resolveContext = resolve; }));
    render(
      <RepaymentForm
        action={vi.fn().mockResolvedValue(initialState)}
        friends={[{ id: activeFriend.id, label: activeFriend.name }, { id: archivedFriend.id, label: archivedFriend.name, archived: true }]}
        searchFriends={vi.fn().mockResolvedValue(searchableFriends)}
        initialValues={{ friendId: activeFriend.id, amountRupiah: "70000", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: "", notes: "" }}
        initialAllocationStrategy="oldest"
        initialFriendContext={{ option: { id: activeFriend.id, label: activeFriend.name }, outstandingAmount: 128_000, openExpenseShares: [share, secondShare] }}
        loadFriendContext={loadFriendContext}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("Allocation for Dinner")).toHaveValue("64000"));
    fireEvent.change(screen.getByLabelText("Allocation strategy"), { target: { value: "manual" } });
    fireEvent.change(screen.getByLabelText("Allocation for Dinner"), { target: { value: "12000" } });
    fireEvent.change(screen.getByLabelText("Amount in rupiah"), { target: { value: "10000" } });
    expect(screen.getByLabelText("Allocation for Dinner")).toHaveValue("12000");

    fireEvent.change(screen.getByLabelText("Allocation strategy"), { target: { value: "oldest" } });
    await waitFor(() => expect(screen.getByLabelText("Allocation for Dinner")).toHaveValue("10000"));
    await chooseFriend("Bima (ARCHIVED)");
    resolveContext({ option: { id: archivedFriend.id, label: archivedFriend.name }, outstandingAmount: 64_000, openExpenseShares: [otherShare] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Use full outstanding" })).toBeInTheDocument());
    expect(screen.queryByLabelText("Allocation for Dinner")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Allocation for Taxi")).toHaveValue("10000");
  });

  it("does not expose stale context while a friend change is loading or overwrite a manual amount", async () => {
    let resolveContext: (context: { option: { id: string; label: string }; outstandingAmount: number; openExpenseShares: never[] }) => void = () => {};
    const loadFriendContext = vi.fn().mockReturnValue(new Promise((resolve) => { resolveContext = resolve; }));
    render(
      <RepaymentForm
        action={vi.fn().mockResolvedValue(initialState)}
        friends={[{ id: activeFriend.id, label: activeFriend.name }, { id: archivedFriend.id, label: archivedFriend.name, archived: true }]}
        searchFriends={vi.fn().mockResolvedValue(searchableFriends)}
        initialValues={{ friendId: activeFriend.id, amountRupiah: "12000", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: "", notes: "" }}
        initialFriendContext={{ option: { id: activeFriend.id, label: activeFriend.name }, outstandingAmount: 64_000, openExpenseShares: [] }}
        loadFriendContext={loadFriendContext}
      />,
    );

    await chooseFriend("Bima (ARCHIVED)");
    expect(screen.getByLabelText("Amount in rupiah")).toHaveValue("12000");
    expect(screen.queryByRole("button", { name: "Use full outstanding" })).not.toBeInTheDocument();
    resolveContext({ option: { id: archivedFriend.id, label: archivedFriend.name }, outstandingAmount: 22_000, openExpenseShares: [] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Use full outstanding" })).toBeInTheDocument());
    expect(screen.getByLabelText("Amount in rupiah")).toHaveValue("12000");
  });

  it("hides the full-outstanding shortcut for zero balances and edit forms", () => {
    const context = { option: { id: activeFriend.id, label: activeFriend.name }, outstandingAmount: 0, openExpenseShares: [] };
    const view = render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} initialFriendContext={context} />);
    expect(screen.queryByRole("button", { name: "Use full outstanding" })).not.toBeInTheDocument();
    view.unmount();
    render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} mode="edit" initialValues={{ friendId: activeFriend.id, amountRupiah: "64000", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: "", notes: "" }} initialFriendContext={{ ...context, outstandingAmount: 64_000 }} />);
    expect(screen.queryByRole("button", { name: "Use full outstanding" })).not.toBeInTheDocument();
  });

  it("submits selected allocation controls in their existing order", async () => {
    const action = vi.fn().mockResolvedValue(initialState);
    render(<RepaymentForm action={action} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} openExpenseSharesByFriend={{ [activeFriend.id]: [share, secondShare] }} />);
    fireEvent.click(screen.getByText("Allocate now"));
    await chooseExpense(/Dinner · Bandung day out/);
    await chooseExpense(/Coffee · Bandung day out/);
    fireEvent.change(screen.getByLabelText("Amount in rupiah"), { target: { value: "84000" } });
    fireEvent.change(screen.getByLabelText("Payment date and time"), { target: { value: "2026-01-02T10:30" } });
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "Cash" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Received" } });
    fireEvent.change(screen.getByLabelText("Allocation for Dinner"), { target: { value: "20000" } });
    fireEvent.change(screen.getByLabelText("Allocation for Coffee"), { target: { value: "30000" } });
    fireEvent.submit(screen.getByRole("button", { name: "Record repayment" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    const formData = action.mock.calls[0][1] as FormData;
    expect(formData.get("paymentMethodChoice")).toBe("Cash");
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
        searchFriends={vi.fn().mockResolvedValue(searchableFriends)}
        mode="edit"
        friendLocked
        initialValues={{ friendId: activeFriend.id, amountRupiah: "84000", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: "Cash", notes: "Received" }}
      />,
    );

    expect(screen.getByLabelText("Friend")).toBeDisabled();
    expect(document.querySelector('input[type="hidden"][name="friendId"]')).toHaveValue(activeFriend.id);
    expect(screen.getByText("The friend is fixed while this repayment has allocations.")).toBeInTheDocument();
  });

  it("opens and closes natively, and keeps Allocate now open through local rerenders", async () => {
    render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }, { id: archivedFriend.id, label: archivedFriend.name, archived: true }]} searchFriends={vi.fn().mockResolvedValue(searchableFriends)} openExpenseSharesByFriend={{ [activeFriend.id]: [share], [archivedFriend.id]: [otherShare] }} />);

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
    await chooseExpense(/Dinner · Bandung day out/);
    fireEvent.change(screen.getByLabelText("Allocation for Dinner"), { target: { value: "12000" } });
    expect(screen.getByText("Allocate now").closest("details")).toHaveAttribute("open");
    await chooseFriend("Bima (ARCHIVED)");
    expect(screen.getByText("Allocate now").closest("details")).toHaveAttribute("open");
    expect(screen.queryByLabelText("Allocation for Dinner")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Allocation for Taxi")).not.toBeInTheDocument();
    await chooseFriend("Ari");
    expect(screen.queryByLabelText("Allocation for Dinner")).not.toBeInTheDocument();
  });

  it("starts with no allocation rows and clears draft allocations when the friend changes", async () => {
    render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }, { id: archivedFriend.id, label: archivedFriend.name, archived: true }]} searchFriends={vi.fn().mockResolvedValue(searchableFriends)} openExpenseSharesByFriend={{ [activeFriend.id]: [share], [archivedFriend.id]: [otherShare] }} />);

    fireEvent.click(screen.getByText("Allocate now"));
    expect(screen.getByRole("heading", { name: "Apply to outstanding expenses" })).toBeVisible();
    expect(screen.getByLabelText("Add outstanding expense")).toBeInTheDocument();
    expect(screen.queryByLabelText("Allocation for Dinner")).not.toBeInTheDocument();
    await chooseExpense(/Dinner · Bandung day out/);
    fireEvent.change(screen.getByLabelText("Allocation for Dinner"), { target: { value: "12000" } });
    await chooseFriend("Bima (ARCHIVED)");
    expect(screen.queryByLabelText("Allocation for Dinner")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Allocation for Taxi")).not.toBeInTheDocument();
  });

  it("searches descriptions and outing titles with a twenty-result cap and useful labels", async () => {
    const shares = Array.from({ length: 21 }, (_, index) => ({
      ...share,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      expenseDescription: `Dinner ${index}`,
      outingTitle: "Bandung day out",
    }));
    render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} openExpenseSharesByFriend={{ [activeFriend.id]: shares }} />);
    fireEvent.click(screen.getByText("Allocate now"));
    const picker = screen.getByRole("combobox", { name: "Add outstanding expense" });
    fireEvent.click(picker);
    const searchInput = await screen.findByRole("searchbox", { name: "Search outstanding expenses" });
    await waitFor(() => expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(20));
    fireEvent.change(searchInput, { target: { value: "dinner 20" } });
    await waitFor(() => expect(within(screen.getByRole("listbox")).getByRole("option", { name: /Dinner 20 · Bandung day out · Rp 64\.000 remaining/ })).toBeInTheDocument());
    fireEvent.change(searchInput, { target: { value: "bandung" } });
    await waitFor(() => expect(within(screen.getByRole("listbox")).getByRole("option", { name: /Dinner 0 · Bandung day out · Rp 64\.000 remaining/ })).toBeInTheDocument());
  });

  it("adds multiple distinct expenses, rejects duplicates, and hides selected results", async () => {
    render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} openExpenseSharesByFriend={{ [activeFriend.id]: [share, secondShare] }} />);
    fireEvent.click(screen.getByText("Allocate now"));
    await chooseExpense(/Dinner · Bandung day out/);
    await chooseExpense(/Coffee · Bandung day out/);
    expect(screen.getAllByRole("textbox", { name: /Allocation for/ })).toHaveLength(2);
    const picker = screen.getByRole("combobox", { name: "Add outstanding expense" });
    fireEvent.click(picker);
    const searchInput = await screen.findByRole("searchbox", { name: "Search outstanding expenses" });
    fireEvent.change(searchInput, { target: { value: "dinner" } });
    await waitFor(() => expect(within(screen.getByRole("listbox")).queryByRole("option", { name: /Dinner · Bandung day out/ })).not.toBeInTheDocument());
    expect(screen.getAllByRole("textbox", { name: /Allocation for/ })).toHaveLength(2);
  });

  it("removes only one draft allocation and makes it searchable again", async () => {
    render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} openExpenseSharesByFriend={{ [activeFriend.id]: [share, secondShare] }} />);
    fireEvent.click(screen.getByText("Allocate now"));
    await chooseExpense(/Dinner · Bandung day out/);
    await chooseExpense(/Coffee · Bandung day out/);
    fireEvent.change(screen.getByLabelText("Allocation for Dinner"), { target: { value: "12000" } });
    fireEvent.change(screen.getByLabelText("Allocation for Coffee"), { target: { value: "30000" } });
    const dinnerRow = screen.getByLabelText("Allocation for Dinner").closest(".repayment-form__allocation");
    if (!dinnerRow) throw new Error("Dinner allocation row is missing");
    fireEvent.click(within(dinnerRow as HTMLElement).getByRole("button", { name: "Remove" }));
    expect(screen.queryByLabelText("Allocation for Dinner")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Allocation for Coffee")).toHaveValue("30000");
    expect(screen.getByRole("button", { name: "Remove" })).toHaveAttribute("type", "button");
    await chooseExpense(/Dinner · Bandung day out/);
    expect(screen.getByLabelText("Allocation for Dinner")).toHaveValue("");
  });

  it("renders selected share facts and only selected paired values in submitted form data", async () => {
    const action = vi.fn().mockResolvedValue(initialState);
    render(<RepaymentForm action={action} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} openExpenseSharesByFriend={{ [activeFriend.id]: [share, secondShare, { ...share, id: "66666666-6666-4666-8666-666666666666", expenseDescription: "Unselected" }] }} />);
    fireEvent.click(screen.getByText("Allocate now"));
    await chooseExpense(/Dinner · Bandung day out/);
    await chooseExpense(/Coffee · Bandung day out/);
    expect(screen.getAllByText("Original share Rp 84.000 · Previously repaid Rp 20.000 · Remaining Rp 64.000")).toHaveLength(2);
    expect(screen.getAllByText("01 Jan 2026")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Allocation for Dinner"), { target: { value: "12000" } });
    fireEvent.change(screen.getByLabelText("Allocation for Coffee"), { target: { value: "30000" } });
    fireEvent.submit(screen.getByRole("button", { name: "Record repayment" }).closest("form")!);
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    const formData = action.mock.calls[0]![1] as FormData;
    expect(formData.getAll("expenseShareId")).toEqual([share.id, secondShare.id]);
    expect(formData.getAll("amountRupiah").slice(-2)).toEqual(["12000", "30000"]);
    expect(formData.getAll("expenseShareId")).not.toContain("66666666-6666-4666-8666-666666666666");
  });

  it("restores selected allocations, exact drafts, errors, and disclosure state after validation", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      values: { ...initialState.values, friendId: activeFriend.id },
      allocations: [{ expenseShareId: share.id, amountRupiah: "84.00" }, { expenseShareId: secondShare.id, amountRupiah: "30000" }],
      allocationFieldErrors: { [share.id]: "Allocation is invalid." },
    });
    render(<RepaymentForm action={action} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} openExpenseSharesByFriend={{ [activeFriend.id]: [share, secondShare] }} />);
    fireEvent.submit(screen.getByRole("button", { name: "Record repayment" }).closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("Allocation for Dinner")).toHaveValue("84.00"));
    expect(screen.getByLabelText("Allocation for Coffee")).toHaveValue("30000");
    expect(screen.getByText("Allocation is invalid.")).toBeInTheDocument();
    expect(screen.getByText("Allocate now").closest("details")).toHaveAttribute("open");
  });

  it("keeps the allocation picker disabled and old shares unavailable during a friend context load", async () => {
    let resolveContext: (context: { option: { id: string; label: string }; outstandingAmount: number; openExpenseShares: typeof share[] }) => void = () => {};
    const loadFriendContext = vi.fn().mockReturnValue(new Promise((resolve) => { resolveContext = resolve; }));
    render(<RepaymentForm action={vi.fn().mockResolvedValue(initialState)} friends={[{ id: activeFriend.id, label: activeFriend.name }, { id: archivedFriend.id, label: archivedFriend.name, archived: true }]} searchFriends={vi.fn().mockResolvedValue(searchableFriends)} initialValues={{ friendId: activeFriend.id, amountRupiah: "12000", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: "", notes: "" }} initialFriendContext={{ option: { id: activeFriend.id, label: activeFriend.name }, outstandingAmount: 64_000, openExpenseShares: [share] }} loadFriendContext={loadFriendContext} />);
    fireEvent.click(screen.getByText("Allocate now"));
    await chooseExpense(/Dinner · Bandung day out/);
    await chooseFriend("Bima (ARCHIVED)");
    expect(screen.getByRole("combobox", { name: "Add outstanding expense" })).toBeDisabled();
    expect(screen.queryByLabelText("Allocation for Dinner")).not.toBeInTheDocument();
    resolveContext({ option: { id: archivedFriend.id, label: archivedFriend.name }, outstandingAmount: 22_000, openExpenseShares: [otherShare] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Use full outstanding" })).toBeInTheDocument());
    expect(screen.queryByLabelText("Allocation for Dinner")).not.toBeInTheDocument();
    await chooseExpense(/Taxi · Bandung day out/);
    expect(screen.getByLabelText("Allocation for Taxi")).toBeInTheDocument();
  });

  it("keeps a one-expense native fallback when JavaScript is unavailable", () => {
    const markup = renderToString(<RepaymentForm action={vi.fn()} friends={[{ id: activeFriend.id, label: activeFriend.name }]} searchFriends={vi.fn().mockResolvedValue([])} openExpenseSharesByFriend={{ [activeFriend.id]: [share] }} />);
    expect(markup).toContain('name="expenseShareId"');
    expect(markup).toContain('name="amountRupiah"');
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
