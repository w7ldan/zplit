import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("public Zplit page", () => {
  it("explains the product and keeps direct actions visible", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Shared expenses without the group-chat accounting." })).toBeInTheDocument();
    const navigation = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    expect(navigation.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#journey");
    expect(navigation.getByRole("link", { name: "The ledger" })).toHaveAttribute("href", "#ledger");
    expect(navigation.getByRole("link", { name: "Open Zplit" })).toHaveAttribute("href", "/app");
    expect(screen.getAllByRole("link", { name: "Open Zplit" })).toHaveLength(3);
    expect(screen.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#journey");
    expect(screen.getByText(/record an outing, add the expenses/i)).toBeInTheDocument();
    expect(screen.getByText(/Rani's shares/i)).toBeInTheDocument();
    expect(screen.getAllByText("Rp 42.500", { exact: true }).length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent(/future application|single owner|fake chart|receipt scanning|notifications/i);
  });

  it("shows one truthful five-step journey with keyboard-operable controls", () => {
    render(<HomePage />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    for (const label of [
      "An outing is created",
      "Expenses enter the outing",
      "Friend shares are assigned",
      "A repayment is recorded",
      "The balance becomes settled",
    ]) expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeInTheDocument();

    expect(screen.getByRole("tab", { name: /An outing is created/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /An outing is created/ }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Expenses enter the outing/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("Dinner", { exact: true }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: /Friend shares are assigned/ }));
    expect(screen.getByText("Rani · Dinner", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Rp 169.000", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Rp 191.000", { exact: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Rp 169.000 assigned of Rp 360.000")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /A repayment is recorded/ }));
    expect(screen.getByText("Rani pays back her shares", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 126.500", { exact: true }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: /The balance becomes settled/ }));
    expect(screen.getByText("Rani", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Dimas", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("SETTLED", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Remaining across this illustrative outing:", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 42.500", { exact: true }).length).toBeGreaterThan(0);
  });
});
