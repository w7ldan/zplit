import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExpenseForm } from "./expense-form";
import { ToastProvider } from "@/components/feedback/toast";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

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
  beforeEach(() => router.refresh.mockClear());

  function renderForm(action = vi.fn().mockResolvedValue(initialState), mode: "create" | "edit" = "create", initialValues = initialState.values) {
    return render(
      <ToastProvider>
        <ExpenseForm action={action} outings={[{ id: outing.id, label: outing.title }]} searchOutings={vi.fn().mockResolvedValue([])} mode={mode} initialValues={initialValues} />
      </ToastProvider>,
    );
  }

  it("renders accessible owner-owned outing fields without independent date controls", () => {
    const { container } = renderForm();

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
    renderForm(action);
    fireEvent.submit(screen.getByRole("button", { name: "Add expense" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Amount in rupiah")).toHaveValue("84.00"));
    expect(screen.getByLabelText("Amount in rupiah")).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("expense-amount-error")).toHaveTextContent("Enter whole rupiah");
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows pending text and prevents repeat submission", async () => {
    let resolveAction: (state: typeof initialState) => void = () => {};
    const action = vi.fn().mockReturnValue(new Promise((resolve) => { resolveAction = resolve; }));
    renderForm(action);
    const form = screen.getByRole("button", { name: "Add expense" }).closest("form");
    if (!form) throw new Error("expense form is missing");

    expect(form.querySelector("button")).toHaveTextContent("Add expense");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0]?.[1].get("intent")).toBeNull();
    expect(screen.getByRole("button", { name: "Adding expense…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save & add another" })).toBeDisabled();
    resolveAction(initialState);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add expense" })).toBeEnabled());
  });

  it("shows the continuation pending operation on both disabled buttons", async () => {
    let resolveAction: (state: typeof initialState) => void = () => {};
    const action = vi.fn().mockReturnValue(new Promise((resolve) => { resolveAction = resolve; }));
    renderForm(action);

    fireEvent.click(screen.getByRole("button", { name: "Save & add another" }));

    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Adding and continuing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add expense" })).toBeDisabled();
    resolveAction(initialState);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save & add another" })).toBeEnabled());
  });

  it("clears fields, keeps the outing, refreshes, focuses Description, and announces continuation once", async () => {
    const action = vi.fn().mockResolvedValue({ fieldErrors: {}, formError: "", values: { description: "", amountRupiah: "", outingId: outing.id }, success: { expenseId: "expense-a" } });
    renderForm(action);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Dinner" } });
    fireEvent.change(screen.getByLabelText("Amount in rupiah"), { target: { value: "84000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & add another" }));

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Description")).toHaveValue(""));
    expect(screen.getByLabelText("Amount in rupiah")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Outing" })).toHaveValue(outing.title);
    expect(action.mock.calls[0]?.[1].get("intent")).toBe("continue");
    expect(router.refresh).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Expense added"));
    expect(document.activeElement).toBe(screen.getByLabelText("Description"));
  });

  it("announces each new continuation and ignores a rerender of the same success", async () => {
    const success = (expenseId: string) => ({ fieldErrors: {}, formError: "", values: { description: "", amountRupiah: "", outingId: outing.id }, success: { expenseId } });
    const action = vi.fn().mockResolvedValueOnce(success("expense-a")).mockResolvedValueOnce(success("expense-b"));
    const view = renderForm(action);
    const continueButton = () => screen.getByRole("button", { name: "Save & add another" });

    fireEvent.click(continueButton());
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(1));
    view.rerender(
      <ToastProvider>
        <ExpenseForm action={action} outings={[{ id: outing.id, label: outing.title }]} searchOutings={vi.fn().mockResolvedValue([])} />
      </ToastProvider>,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(router.refresh).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Coffee" } });
    fireEvent.change(screen.getByLabelText("Amount in rupiah"), { target: { value: "12000" } });
    fireEvent.click(continueButton());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(2));
    expect(screen.getAllByText("Expense added")).toHaveLength(2);
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("does not render continuation in edit mode", () => {
    renderForm(vi.fn().mockResolvedValue(initialState), "edit", { description: "Dinner", amountRupiah: "84000", outingId: outing.id });
    expect(screen.queryByRole("button", { name: "Save & add another" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });
});
