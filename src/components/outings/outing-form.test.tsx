import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutingForm } from "./outing-form";

const initialState = {
  fieldErrors: {},
  formError: "",
  values: { title: "", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "", tripId: "" },
};
const tripA = "11111111-1111-4111-8111-111111111111";
const tripB = "22222222-2222-4222-8222-222222222222";
const trips = [{ id: "", label: "No trip" }, { id: tripA, label: "Trip A" }, { id: tripB, label: "Trip B" }];

async function chooseTrip(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Trip" }));
  const searchInput = await screen.findByRole("searchbox", { name: "Search trips" });
  fireEvent.change(searchInput, { target: { value: label } });
  const listbox = screen.getByRole("listbox");
  await waitFor(() => expect(within(listbox).getByRole("option", { name: label })).toBeInTheDocument());
  fireEvent.click(within(listbox).getByRole("option", { name: label }));
}

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
    expect(screen.getByLabelText("Trip")).toHaveTextContent("No trip");
    expect(screen.getByText("Optional details").closest("details")).not.toHaveAttribute("open");
    expect(document.querySelectorAll('[name="tripId"]')).toHaveLength(1);
    expect((container.querySelector('input[name="timezoneOffsetMinutes"]') as HTMLInputElement).value).toBe(new Date().getTimezoneOffset().toString());
    expect(document.querySelectorAll(".outing-form__field-error")).toHaveLength(4);
    expect(document.querySelectorAll(".outing-form__message")).toHaveLength(1);
  });

  it("starts with an existing Trip and lets the user choose another Trip or No trip", async () => {
    const action = vi.fn().mockResolvedValue({ ...initialState, values: { ...initialState.values, tripId: tripB } });
    render(<OutingForm action={action} mode="edit" trips={trips} searchTrips={vi.fn().mockResolvedValue(trips)} initialValues={{ title: "Dinner", occurredAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", notes: "", tripId: tripA }} />);

    expect(screen.getByLabelText("Trip")).toHaveTextContent("Trip A");
    expect(screen.getByText("Optional details").closest("details")).toHaveAttribute("open");
    await chooseTrip("Trip B");
    expect(screen.getByLabelText("Trip")).toHaveTextContent("Trip B");
    expect((document.querySelector('select[name="tripId"]') as HTMLSelectElement).value).toBe(tripB);
    fireEvent.submit(screen.getByRole("button", { name: "Save changes" }).closest("form")!);
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0][1].get("tripId")).toBe(tripB);

    await chooseTrip("No trip");
    expect(screen.getByLabelText("Trip")).toHaveTextContent("No trip");
    expect((document.querySelector('select[name="tripId"]') as HTMLSelectElement).value).toBe("");
  });

  it("allows a contextual Trip to be overridden before submit", async () => {
    render(<OutingForm action={vi.fn().mockResolvedValue(initialState)} trips={trips} searchTrips={vi.fn().mockResolvedValue(trips)} initialValues={{ ...initialState.values, tripId: tripA }} />);

    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(within(document.querySelector(".outing-form__trip-context")!).getByText("Trip A", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Optional details").closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByText("Optional details").closest("details")).toHaveAttribute("open");
    expect(screen.getByLabelText("Trip")).toHaveTextContent("Trip A");
    expect(document.querySelectorAll('[name="tripId"]')).toHaveLength(1);
    await chooseTrip("Trip B");
    expect(screen.getByLabelText("Trip")).toHaveTextContent("Trip B");
    await chooseTrip("No trip");
    expect(screen.getByLabelText("Trip")).toHaveTextContent("No trip");
    expect(within(document.querySelector(".outing-form__trip-context")!).getByText("No trip", { exact: true })).toBeInTheDocument();
  });

  it("keeps Optional details closed for a generic create until opened", async () => {
    render(<OutingForm action={vi.fn().mockResolvedValue(initialState)} trips={trips} searchTrips={vi.fn().mockResolvedValue(trips)} />);

    fireEvent.click(screen.getByText("Optional details"));
    expect(screen.getByText("Optional details").closest("details")).toHaveAttribute("open");
    await chooseTrip("Trip A");
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Useful context" } });
    expect(screen.getByLabelText("Trip")).toHaveTextContent("Trip A");
    expect(screen.getByLabelText("Notes")).toHaveValue("Useful context");
  });

  it("opens Optional details for existing Notes", () => {
    render(<OutingForm action={vi.fn().mockResolvedValue(initialState)} mode="edit" initialValues={{ ...initialState.values, notes: "Keep this visible" }} />);

    expect(screen.getByText("Optional details").closest("details")).toHaveAttribute("open");
    expect(screen.getByLabelText("Notes")).toHaveValue("Keep this visible");
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

  it("preserves a changed Trip and other submitted values after validation failure", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      fieldErrors: { title: "Title is required." },
      formError: "Please correct the marked fields.",
      values: { title: "Entered outing", occurredAtLocal: "2026-02-28T10:30", timezoneOffsetMinutes: "-480", notes: "Entered notes", tripId: tripB },
    });
    render(<OutingForm action={action} trips={trips} searchTrips={vi.fn().mockResolvedValue(trips)} initialValues={{ ...initialState.values, tripId: tripA }} />);
    await chooseTrip("Trip B");
    fireEvent.submit(screen.getByRole("button", { name: "Add outing" }).closest("form")!);

    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Entered outing"));
    expect(screen.getByLabelText("Date and time")).toHaveValue("2026-02-28T10:30");
    expect(screen.getByLabelText("Notes")).toHaveValue("Entered notes");
    expect(screen.getByLabelText("Trip")).toHaveTextContent("Trip B");
  });

  it("renders a Trip field error with its submitted selection", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      fieldErrors: { tripId: "Selected trip is no longer available." },
      formError: "Please correct the marked fields.",
      values: { title: "Dinner", occurredAtLocal: "2026-02-28T10:30", timezoneOffsetMinutes: "-480", notes: "Notes", tripId: tripB },
    });
    render(<OutingForm action={action} trips={trips} searchTrips={vi.fn().mockResolvedValue(trips)} />);
    fireEvent.submit(screen.getByRole("button", { name: "Add outing" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Selected trip is no longer available.")).toBeInTheDocument();
      expect(screen.getByLabelText("Trip")).toHaveTextContent("Trip B");
    });
    expect(screen.getByLabelText("Trip")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText("Trip")).toHaveTextContent("Trip B");
    expect(screen.getByText("Optional details").closest("details")).toHaveAttribute("open");
  });

  it("opens Optional details for Trip and Notes validation errors", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      fieldErrors: { tripId: "Select a valid trip.", notes: "Notes are too long." },
      formError: "Please correct the marked fields.",
      values: { ...initialState.values, title: "Dinner", occurredAtLocal: "2026-02-28T10:30", timezoneOffsetMinutes: "-480" },
    });
    render(<OutingForm action={action} trips={trips} searchTrips={vi.fn().mockResolvedValue(trips)} />);
    fireEvent.submit(screen.getByRole("button", { name: "Add outing" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Select a valid trip.")).toBeInTheDocument());
    expect(screen.getByText("Optional details").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Notes are too long.")).toBeInTheDocument();
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
