import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExpenseForm } from "./expense-form";
import { ToastProvider } from "@/components/feedback/toast";
import { UnsavedChangesProvider } from "@/components/navigation/unsaved-changes";

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
const outingOption = { id: outing.id, label: outing.title };
const secondOuting = { id: "22222222-2222-4222-8222-222222222222", label: "Bandung day out" };

describe("ExpenseForm", () => {
  beforeEach(() => router.refresh.mockClear());

  function renderForm(action = vi.fn().mockResolvedValue(initialState), mode: "create" | "edit" = "create", initialValues = initialState.values, outings = [outingOption], searchOutings = vi.fn().mockResolvedValue(outings)) {
    return render(
      <ToastProvider>
        <ExpenseForm action={action} outings={outings} searchOutings={searchOutings} mode={mode} initialValues={initialValues} />
      </ToastProvider>,
    );
  }

  async function chooseOuting(label: string, query = label) {
    fireEvent.click(screen.getByRole("combobox", { name: "Outing" }));
    const searchInput = await screen.findByRole("searchbox", { name: "Search outings" });
    fireEvent.change(searchInput, { target: { value: query } });
    const listbox = screen.getByRole("listbox");
    await waitFor(() => expect(within(listbox).getByRole("option", { name: label })).toBeInTheDocument());
    fireEvent.click(within(listbox).getByRole("option", { name: label }));
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

    expect(screen.getByRole("button", { name: "Add expense" })).toBeInTheDocument();
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
    expect(screen.getByRole("combobox", { name: "Outing" })).toHaveTextContent(outing.title);
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

  it("changes an existing outing from A to B in edit mode", async () => {
    const action = vi.fn().mockResolvedValue({ ...initialState, values: { ...initialState.values, outingId: secondOuting.id }, fieldErrors: { description: "Enter a description." } });
    renderForm(action, "edit", { description: "Dinner", amountRupiah: "84000", outingId: outing.id }, [outingOption, secondOuting]);

    await chooseOuting(secondOuting.label, "Bandung");
    expect(screen.getByRole("combobox", { name: "Outing" })).toHaveTextContent(secondOuting.label);
    expect((document.querySelector('select[name="outingId"]') as HTMLSelectElement).value).toBe(secondOuting.id);
    fireEvent.submit(screen.getByRole("button", { name: "Save changes" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0][1].get("outingId")).toBe(secondOuting.id);
  });

  it("lets a contextual create outing change from A to B before submit", async () => {
    const action = vi.fn().mockResolvedValue(initialState);
    renderForm(action, "create", { ...initialState.values, outingId: outing.id }, [outingOption, secondOuting]);

    await chooseOuting(secondOuting.label);
    fireEvent.submit(screen.getByRole("button", { name: "Add expense" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0][1].get("outingId")).toBe(secondOuting.id);
  });

  it("keeps the sensible first outing default while allowing create to choose another", async () => {
    const action = vi.fn().mockResolvedValue(initialState);
    renderForm(action, "create", initialState.values, [outingOption, secondOuting]);

    expect(screen.getByRole("combobox", { name: "Outing" })).toHaveTextContent(outing.title);
    await chooseOuting(secondOuting.label);
    fireEvent.submit(screen.getByRole("button", { name: "Add expense" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0][1].get("outingId")).toBe(secondOuting.id);
  });

  it("preserves B after an outing validation failure", async () => {
    const action = vi.fn().mockResolvedValue({ ...initialState, fieldErrors: { amountRupiah: "Enter an amount." }, values: { description: "Dinner", amountRupiah: "bad", outingId: secondOuting.id } });
    renderForm(action, "create", initialState.values, [outingOption, secondOuting]);

    await chooseOuting(secondOuting.label);
    fireEvent.submit(screen.getByRole("button", { name: "Add expense" }).closest("form")!);
    await waitFor(() => expect(screen.getByText("Enter an amount.")).toBeInTheDocument());

    expect(screen.getByRole("combobox", { name: "Outing" })).toHaveTextContent(secondOuting.label);
    expect((document.querySelector('select[name="outingId"]') as HTMLSelectElement).value).toBe(secondOuting.id);
    expect(action.mock.calls[0][1].get("outingId")).toBe(secondOuting.id);
  });

  it("keeps the selected outing after Save & add another", async () => {
    const action = vi.fn().mockResolvedValue({ fieldErrors: {}, formError: "", values: { description: "", amountRupiah: "", outingId: secondOuting.id }, success: { expenseId: "expense-b" } });
    renderForm(action, "create", initialState.values, [outingOption, secondOuting]);

    await chooseOuting(secondOuting.label);
    fireEvent.click(screen.getByRole("button", { name: "Save & add another" }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Outing" })).toHaveTextContent(secondOuting.label));
    expect((document.querySelector('select[name="outingId"]') as HTMLSelectElement).value).toBe(secondOuting.id);
  });

  it("tracks persisted fields, ignores selector search, and becomes clean after exact reverts", async () => {
    render(
      <UnsavedChangesProvider>
        <ToastProvider><ExpenseForm action={vi.fn().mockResolvedValue(initialState)} outings={[outingOption, secondOuting]} searchOutings={vi.fn().mockResolvedValue([outingOption, secondOuting])} /></ToastProvider>
      </UnsavedChangesProvider>,
    );
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      fireEvent(window, event);
      return event.defaultPrevented;
    };

    expect(unload()).toBe(false);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Dinner" } });
    expect(unload()).toBe(true);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "" } });
    expect(unload()).toBe(false);

    fireEvent.click(screen.getByRole("combobox", { name: "Outing" }));
    const searchInput = await screen.findByRole("searchbox", { name: "Search outings" });
    fireEvent.change(searchInput, { target: { value: "Bandung" } });
    expect(unload()).toBe(false);
    fireEvent.keyDown(searchInput, { key: "Escape" });
    await chooseOuting(secondOuting.label);
    expect(unload()).toBe(true);
    fireEvent.click(screen.getByRole("combobox", { name: "Outing" }));
    const returnSearch = await screen.findByRole("searchbox", { name: "Search outings" });
    await waitFor(() => expect(within(screen.getByRole("listbox")).getByRole("option", { name: outing.title })).toBeInTheDocument());
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: outing.title }));
    expect(unload()).toBe(false);
    expect(returnSearch).not.toBeInTheDocument();
  });

  it("keeps a failed save protected and clears the guard after Save & add another succeeds", async () => {
    const failed = vi.fn().mockResolvedValue({ ...initialState, fieldErrors: { amountRupiah: "Enter an amount." }, formError: "Please correct the marked fields.", values: { description: "Dinner", amountRupiah: "bad", outingId: outing.id } });
    const view = render(
      <UnsavedChangesProvider>
        <ToastProvider><ExpenseForm action={failed} outings={[outingOption]} searchOutings={vi.fn().mockResolvedValue([outingOption])} /></ToastProvider>
      </UnsavedChangesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Dinner" } });
    fireEvent.submit(screen.getByRole("button", { name: "Add expense" }).closest("form")!);
    await waitFor(() => expect(screen.getByText("Please correct the marked fields.")).toBeInTheDocument());
    const failedUnload = new Event("beforeunload", { cancelable: true });
    fireEvent(window, failedUnload);
    expect(failedUnload.defaultPrevented).toBe(true);

    const success = vi.fn().mockResolvedValue({ fieldErrors: {}, formError: "", values: { description: "", amountRupiah: "", outingId: outing.id }, success: { expenseId: "expense-a" } });
    view.rerender(<UnsavedChangesProvider><ToastProvider><ExpenseForm action={success} outings={[outingOption]} searchOutings={vi.fn().mockResolvedValue([outingOption])} /></ToastProvider></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Coffee" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & add another" }));
    await waitFor(() => expect(success).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Description")).toHaveValue(""));
    await waitFor(() => expect((() => {
      const event = new Event("beforeunload", { cancelable: true });
      fireEvent(window, event);
      return event.defaultPrevented;
    })()).toBe(false));
  });
});
