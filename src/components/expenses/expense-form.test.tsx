import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExpenseForm } from "./expense-form";

const outing = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "owner-a",
  title: "Jakarta dinner",
  occurredAt: new Date("2026-01-02T10:30:00.000Z"),
  notes: null,
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

const initialState = {
  fieldErrors: {},
  formError: "",
  values: { description: "", amountRupiah: "", outingId: "" },
};

describe("ExpenseForm", () => {
  it("renders accessible owner-owned outing fields without independent date controls", () => {
    const { container } = render(<ExpenseForm action={vi.fn().mockResolvedValue(initialState)} outings={[{ id: outing.id, label: outing.title }]} searchOutings={vi.fn().mockResolvedValue([])} />);

    for (const label of ["Description", "Amount in rupiah", "Outing"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-describedby", expect.stringContaining("expense-"));
    }
    expect(screen.getByLabelText("Amount in rupiah")).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByText(/84000 or 84\.000/)).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "No outing" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Jakarta dinner" })).toBeInTheDocument();
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(container.querySelector('input[name="timezoneOffsetMinutes"]')).toBeNull();
    expect(document.querySelectorAll(".expense-form__field-error")).toHaveLength(3);
    expect(document.querySelectorAll(".expense-form__message")).toHaveLength(1);
  });

  it("preserves values and exposes field errors after validation failure", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      fieldErrors: { amountRupiah: "Enter whole rupiah, such as 84000 or 84.000." },
      formError: "Please correct the marked fields.",
      values: { description: "Dinner", amountRupiah: "84.00", outingId: outing.id },
    });
    render(<ExpenseForm action={action} outings={[{ id: outing.id, label: outing.title }]} searchOutings={vi.fn().mockResolvedValue([])} />);
    fireEvent.submit(screen.getByRole("button", { name: "Add expense" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Amount in rupiah")).toHaveValue("84.00"));
    expect(screen.getByLabelText("Amount in rupiah")).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("expense-amount-error")).toHaveTextContent("Enter whole rupiah");
  });

  it("shows pending text and prevents repeat submission", () => {
    let resolveAction: (state: typeof initialState) => void = () => {};
    const action = vi.fn().mockReturnValue(new Promise((resolve) => { resolveAction = resolve; }));
    render(<ExpenseForm action={action} outings={[{ id: outing.id, label: outing.title }]} searchOutings={vi.fn().mockResolvedValue([])} />);
    const form = screen.getByRole("button", { name: "Add expense" }).closest("form");
    if (!form) throw new Error("expense form is missing");

    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Adding expense…" })).toBeDisabled();
    resolveAction(initialState);
  });
});
