import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TripSummaryCopy } from "./trip-summary-copy";

describe("TripSummaryCopy", () => {
  it("reports truthful clipboard success", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<TripSummaryCopy text={"Bandung · 12 Apr 2026\n\nRani: Rp 28.000 outstanding"} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy trip summary" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Bandung · 12 Apr 2026\n\nRani: Rp 28.000 outstanding");
  });
});
