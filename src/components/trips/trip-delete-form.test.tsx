import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TripDeleteForm } from "./trip-delete-form";

describe("TripDeleteForm", () => {
  it("requires confirmation and makes the non-destructive behavior explicit", () => {
    render(<TripDeleteForm action={vi.fn()} />);
    expect(screen.getByText(/removes only the grouping record/)).toBeInTheDocument();
    expect(screen.getByText(/Linked outings remain and become/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete trip" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Delete trip" })).toBeEnabled();
  });
});
