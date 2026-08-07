import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutingForm } from "./outing-form";

const initialState = {
  fieldErrors: {},
  formError: "",
  values: { title: "", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "" },
};

describe("OutingForm", () => {
  it("defaults a pristine create form to the browser-local current minute", async () => {
    const view = render(<OutingForm action={vi.fn().mockResolvedValue(initialState)} initialOccurredAtUtc="2026-08-07T12:34:56.789Z" />);

    const date = new Date("2026-08-07T12:34:56.789Z");
    const pad = (value: number) => value.toString().padStart(2, "0");
    const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    await waitFor(() => expect(screen.getByLabelText("Date and time")).toHaveValue(expected));
    view.rerender(<OutingForm action={vi.fn().mockResolvedValue(initialState)} initialOccurredAtUtc="2026-08-07T12:34:56.789Z" />);
    expect(screen.getByLabelText("Date and time")).toHaveValue(expected);
  });

  it("renders labels, datetime-local input, connected errors, and timezone offset", async () => {
    const { container } = render(<OutingForm action={vi.fn().mockResolvedValue(initialState)} />);

    for (const label of ["Title", "Date and time", "Notes"]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute("aria-describedby", expect.stringContaining("outing-"));
    }
    expect(screen.getByLabelText("Date and time")).toHaveAttribute("type", "datetime-local");
    expect((container.querySelector('input[name="timezoneOffsetMinutes"]') as HTMLInputElement).value).toBe(new Date().getTimezoneOffset().toString());
    expect(document.querySelectorAll(".outing-form__field-error")).toHaveLength(4);
    expect(document.querySelectorAll(".outing-form__message")).toHaveLength(1);
  });

  it("preserves values and exposes field errors after validation failure", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      fieldErrors: { occurredAtLocal: "Enter a valid date and time." },
      formError: "Please correct the marked fields.",
      values: { title: "Entered outing", occurredAtLocal: "2026-02-30T10:30", timezoneOffsetMinutes: "-480", notes: "Entered notes" },
    });
    render(<OutingForm action={action} />);
    fireEvent.submit(screen.getByRole("button", { name: "Add outing" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Entered outing"));
    expect(screen.getByLabelText("Date and time")).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("outing-occurred-at-error")).toHaveTextContent("Enter a valid date and time.");
  });

  it("preserves a submitted timestamp after another validation failure", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      fieldErrors: { title: "Title is required." },
      formError: "Please correct the marked fields.",
      values: { title: "Entered outing", occurredAtLocal: "2026-02-28T10:30", timezoneOffsetMinutes: "-480", notes: "Entered notes" },
    });
    render(<OutingForm action={action} />);
    fireEvent.submit(screen.getByRole("button", { name: "Add outing" }).closest("form")!);

    await waitFor(() => expect(screen.getByLabelText("Date and time")).toHaveValue("2026-02-28T10:30"));
  });

  it("keeps the persisted edit timestamp and does not regenerate it on rerender", async () => {
    const view = render(<OutingForm action={vi.fn().mockResolvedValue(initialState)} mode="edit" initialOccurredAtUtc="2026-01-02T10:30:45.000Z" initialValues={{ title: "Dinner", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "" }} />);
    const date = new Date("2026-01-02T10:30:45.000Z");
    const pad = (value: number) => value.toString().padStart(2, "0");
    const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    await waitFor(() => expect(screen.getByLabelText("Date and time")).toHaveValue(expected));
    view.rerender(<OutingForm action={vi.fn().mockResolvedValue(initialState)} mode="edit" initialOccurredAtUtc="2026-01-02T10:30:45.000Z" initialValues={{ title: "Dinner", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "" }} />);
    expect(screen.getByLabelText("Date and time")).toHaveValue(expected);
  });

  it("shows pending text and prevents repeat submission", () => {
    let resolveAction: (state: typeof initialState) => void = () => {};
    const action = vi.fn().mockReturnValue(new Promise((resolve) => { resolveAction = resolve; }));
    render(<OutingForm action={action} />);
    const form = screen.getByRole("button", { name: "Add outing" }).closest("form");
    if (!form) throw new Error("outing form is missing");

    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Adding outing…" })).toBeDisabled();
    resolveAction(initialState);
  });
});
