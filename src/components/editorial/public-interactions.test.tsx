import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CollaborationDemo, PrivateShareDemo, RecordSearchDemo } from "./public-interactions";

describe("public story interactions", () => {
  it("traces a participant through conversation and the independent ledger", () => {
    const { container } = render(<CollaborationDemo />);
    const sari = screen.getByRole("button", { name: "Sari" });
    fireEvent.focus(sari);
    expect(sari).toHaveAttribute("aria-pressed", "true");
    expect(container.firstChild).toHaveAttribute("data-selected-person", "sari");
    expect(container.querySelectorAll('[data-related="sari"]')).toHaveLength(3);
    expect(screen.getByText("CHAT ≠ LEDGER")).toBeVisible();
    expect(screen.getByText("Sari owes you")).toBeVisible();
  });

  it("retrieves the original source and its provenance", () => {
    render(<RecordSearchDemo />);
    expect(screen.getByRole("button", { name: /Market \+ picnic/ })).toHaveTextContent("360.000");
    expect(screen.getByText(/Paid by you · Raka \+ Sari/)).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "unmatched" } });
    expect(screen.getByText(/No matching record/)).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "market" } });
    expect(screen.getByRole("button", { name: /Market \+ picnic/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps both owner provenance and read-only share readable", () => {
    const { container } = render(<PrivateShareDemo />);
    expect(container.querySelector('[data-private-panel="owner"]')).toHaveTextContent("360.000");
    expect(container.querySelector('[data-private-panel="shared"]')).toHaveTextContent("90.000");
    expect(screen.getByText("Shared view · no ledger editing")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
