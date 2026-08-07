import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TripForm } from "./trip-form";

const initialState = { fieldErrors: {}, formError: "", values: { name: "", startsOn: "", endsOn: "", notes: "" } };

describe("TripForm", () => {
  it("uses native calendar date inputs and preserves field errors", async () => {
    const action = vi.fn().mockResolvedValue({ ...initialState, fieldErrors: { endsOn: "End date must be on or after the start date." }, formError: "Please correct the marked fields.", values: { name: "Bali 2026", startsOn: "2026-04-12", endsOn: "2026-04-11", notes: "Notes" } });
    render(<TripForm action={action} />);
    expect(screen.getByLabelText("Start date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("End date")).toHaveAttribute("type", "date");
    fireEvent.submit(screen.getByRole("button", { name: "Add trip" }).closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Bali 2026"));
    expect(screen.getByLabelText("End date")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("End date must be on or after the start date.")).toBeInTheDocument();
  });
});
