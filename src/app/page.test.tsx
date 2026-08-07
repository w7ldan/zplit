import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("public Zplit page", () => {
  it("explains the product and keeps direct actions visible", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Shared expenses without the group-chat accounting." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("data-reveal", "hero");
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveClass("landing-reveal");
    const navigation = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    expect(navigation.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#journey");
    expect(navigation.getByRole("link", { name: "The ledger" })).toHaveAttribute("href", "#ledger");
    expect(within(document.querySelector(".site-header__actions")!).getByRole("link", { name: "Open Zplit" })).toHaveAttribute("href", "/app");
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
    expect(document.querySelectorAll(".journey-panel")).toHaveLength(1);
    expect(document.querySelector(".journey-rail")).not.toBeInTheDocument();
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
    expect(document.querySelectorAll(".journey-expense-row")).toHaveLength(2);
    expect(document.querySelectorAll('.journey-expense-row__shares[data-visible="true"]')).toHaveLength(2);
    expect(document.querySelectorAll('.journey-expense-row__shares[data-visible="true"] .journey-row__label')).toHaveLength(3);
    expect(screen.getByText("Rp 169.000", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Rp 191.000", { exact: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Rp 169.000 assigned of Rp 360.000")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /A repayment is recorded/ }));
    expect(screen.getByText("Rani pays back her shares", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 126.500", { exact: true }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: /The balance becomes settled/ }));
    expect(screen.getAllByText("Rani", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dimas", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText("SETTLED", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Remaining across this illustrative outing:", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 42.500", { exact: true }).length).toBeGreaterThan(0);
  });

  it("groups public reveals around compositions while keeping core content mounted", () => {
    render(<HomePage />);

    expect(document.querySelectorAll(".landing-reveal")).toHaveLength(7);
    expect(document.querySelectorAll(".principle .landing-reveal, .system-areas li .landing-reveal, .footer__actions .landing-reveal")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "A clear record, not another group chat." })).toBeInTheDocument();
    expect(screen.getByText("Record the expense", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Friends", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Shared expenses, explicit friend shares, and settled balances.", { exact: true })).toBeInTheDocument();
  });
});
