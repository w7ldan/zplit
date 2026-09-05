import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JourneyShowcase } from "./journey-showcase";

describe("JourneyShowcase", () => {
  it("renders one stable four-state product composition", () => {
    render(<JourneyShowcase />);

    expect(screen.getByRole("heading", { level: 2, name: "From an outing to a balance you can explain." })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(document.querySelectorAll(".journey-panel")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: /ADD Add the record/ })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll('.journey-expense-row__shares[data-visible="false"]')).toHaveLength(2);
  });

  it("progresses through explicit shares, repayment, and balances", () => {
    render(<JourneyShowcase />);

    fireEvent.click(screen.getByRole("tab", { name: /ASSIGN Assign shares/ }));
    expect(document.querySelectorAll('.journey-expense-row__shares[data-visible="true"]')).toHaveLength(2);
    expect(screen.getByText("Shares are entered explicitly.", { exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /REPAY Record repayment/ }));
    expect(screen.getByText("Received from Rani", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("100% allocated", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Rp 126.500", { exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /SETTLE Read the balance/ }));
    expect(screen.getByText("Open and settled states remain visible.", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("Rani", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dimas", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rp 42.500", { exact: true }).length).toBeGreaterThan(0);
  });

  it("supports roving keyboard navigation without scroll coupling", () => {
    render(<JourneyShowcase />);
    const first = screen.getByRole("tab", { name: /ADD Add the record/ });

    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /ASSIGN Assign shares/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /ASSIGN Assign shares/ }), { key: "End" });
    expect(screen.getByRole("tab", { name: /SETTLE Read the balance/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /SETTLE Read the balance/ }), { key: "Home" });
    expect(screen.getByRole("tab", { name: /ADD Add the record/ })).toHaveAttribute("aria-selected", "true");
  });
});
