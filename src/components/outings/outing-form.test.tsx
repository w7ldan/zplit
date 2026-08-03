import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutingForm } from "./outing-form";

const initialState = {
  fieldErrors: {},
  formError: "",
  values: { title: "", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "" },
};

describe("OutingForm", () => {
  it("renders labels, datetime-local input, connected errors, and timezone offset", async () => {
    const { container } = render(<OutingForm action={vi.fn().mockResolvedValue(initialState)} />);

    for (const label of ["Title", "Date and time", "Notes"]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute("aria-describedby", expect.stringContaining("outing-"));
    }
    expect(screen.getByLabelText("Date and time")).toHaveAttribute("type", "datetime-local");
    expect((container.querySelector('input[name="timezoneOffsetMinutes"]') as HTMLInputElement).value).toBe(new Date().getTimezoneOffset().toString());
    expect(document.querySelectorAll(".outing-form__field-error")).toHaveLength(3);
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
