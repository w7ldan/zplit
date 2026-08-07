import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TripRow } from "./trip-row";

const trip = { id: "trip-a", ownerUserId: "owner-a", name: "Bali 2026", startsOn: "2026-04-12", endsOn: "2026-04-16", notes: null, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"), outingCount: 2, expenseCount: 3, expenseTotal: 84_000 };

describe("TripRow", () => {
  it("shows bounded grouping metadata and detail link", () => {
    render(<TripRow trip={trip} />);
    expect(screen.getByRole("link", { name: "Bali 2026" })).toHaveAttribute("href", "/app/trips/trip-a");
    expect(screen.getByText("12 Apr 2026 – 16 Apr 2026")).toBeInTheDocument();
    expect(screen.getByText("Rp 84.000")).toBeInTheDocument();
  });
});
