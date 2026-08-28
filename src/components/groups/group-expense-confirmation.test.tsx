import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupExpenseConfirmation, GroupExpenseVoid } from "./group-expense-confirmation";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const action = vi.fn(async () => ({ error: "" }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve; });
  return { promise, resolve };
}

afterEach(() => refresh.mockReset());

describe("Group expense lifecycle controls", () => {
  it("shows confirm and reject only as explicit payer decisions", () => {
    render(<GroupExpenseConfirmation confirmAction={action} rejectAction={action} />);
    expect(screen.getByRole("button", { name: "Confirm I paid" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject claim" })).toBeEnabled();
    expect(screen.getByText("Confirm that you paid this expense, or reject the claim that you paid it.")).toBeInTheDocument();
  });

  it("disables both decisions while confirming and keeps only confirm pending", async () => {
    const result = deferred<{ error: string }>();
    const confirmAction = vi.fn(() => result.promise);
    render(<GroupExpenseConfirmation confirmAction={confirmAction} rejectAction={action} />);

    fireEvent.submit(screen.getByRole("button", { name: "Confirm I paid" }).closest("form")!);

    expect(screen.getByRole("button", { name: "Confirming…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject claim" })).toBeDisabled();
    result.resolve({ error: "" });
    await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
  });

  it("disables both decisions while rejecting and keeps only reject pending", async () => {
    const result = deferred<{ error: string }>();
    const rejectAction = vi.fn(() => result.promise);
    render(<GroupExpenseConfirmation confirmAction={action} rejectAction={rejectAction} />);

    fireEvent.submit(screen.getByRole("button", { name: "Reject claim" }).closest("form")!);

    expect(screen.getByRole("button", { name: "Rejecting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirm I paid" })).toBeDisabled();
    result.resolve({ error: "" });
    await waitFor(() => expect(rejectAction).toHaveBeenCalledOnce());
  });

  it("restores both decisions after a failed confirm", async () => {
    const confirmAction = vi.fn(async () => ({ error: "This expense is no longer pending." }));
    render(<GroupExpenseConfirmation confirmAction={confirmAction} rejectAction={action} />);

    fireEvent.submit(screen.getByRole("button", { name: "Confirm I paid" }).closest("form")!);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This expense is no longer pending."));
    expect(screen.getByRole("button", { name: "Confirm I paid" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject claim" })).toBeEnabled();
  });

  it("restores both decisions after a failed reject", async () => {
    const rejectAction = vi.fn(async () => ({ error: "This expense is no longer pending." }));
    render(<GroupExpenseConfirmation confirmAction={action} rejectAction={rejectAction} />);

    fireEvent.submit(screen.getByRole("button", { name: "Reject claim" }).closest("form")!);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This expense is no longer pending."));
    expect(screen.getByRole("button", { name: "Confirm I paid" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject claim" })).toBeEnabled();
  });

  it("requires acknowledgement before voiding and explains the reversal", () => {
    render(<GroupExpenseVoid action={action} />);
    fireEvent.click(screen.getByText("Void expense", { selector: "summary" }));
    expect(screen.getByText("This keeps the expense in history but removes its current balance effect. It is not a hard delete.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Void expense" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Void expense" })).toBeEnabled();
  });

  it("refreshes canonical state after a successful payer action", async () => {
    const successAction = vi.fn(async () => ({ error: "", success: "Expense confirmed." }));
    render(<GroupExpenseConfirmation confirmAction={successAction} rejectAction={action} />);
    fireEvent.submit(screen.getByRole("button", { name: "Confirm I paid" }).closest("form")!);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
});
