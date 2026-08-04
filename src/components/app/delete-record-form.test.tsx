import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeleteConfirmation, DeleteRecordForm } from "./delete-record-form";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

describe("DeleteRecordForm", () => {
  it.each([
    ["outing", "Move or delete this outing's expenses first."],
    ["expense", "Remove repayment allocations before deleting this expense."],
    ["repayment", "Remove this repayment's allocations before deleting it."],
  ] as const)("requires confirmation and explains the %s restriction", (recordType, restriction) => {
    const action = vi.fn(async () => ({ formError: "" }));
    render(<DeleteRecordForm action={action} recordType={recordType} />);
    expect(screen.getByText(restriction)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: `Delete ${recordType}` });
    expect(button).toBeDisabled();
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveAttribute("name", "confirm");
    expect(checkbox).toHaveAttribute("value", "delete");
    fireEvent.click(checkbox);
    expect(button).toBeEnabled();
  });

  it("consumes the deleted flag without replaying it on refresh", () => {
    window.history.replaceState({}, "", "/app/expenses?deleted=1&keep=1");
    render(<DeleteConfirmation message="Expense deleted." />);
    expect(replace).toHaveBeenCalledWith("/app/expenses?keep=1", { scroll: false });
    expect(screen.getByRole("status")).toHaveTextContent("Expense deleted.");
  });
});
