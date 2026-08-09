import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("public Zplit page", () => {
  it("opens with the Bandung balance and keeps every public anchor valid", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Shared expenses without the group-chat accounting." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("data-reveal", "hero");
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveClass("landing-reveal");
    const navigation = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    expect(navigation.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#journey");
    expect(navigation.getByRole("link", { name: "The ledger" })).toHaveAttribute("href", "#ledger");
    expect(within(document.querySelector(".site-header__actions")!).getByRole("link", { name: "Open Zplit" })).toHaveAttribute("href", "/app");
    expect(screen.getAllByRole("link", { name: /Open Zplit/ })).toHaveLength(3);
    for (const link of navigation.getAllByRole("link")) expect(document.querySelector(link.getAttribute("href")!)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#journey");
    const heroLedger = document.querySelector<HTMLElement>(".hero__ledger")!;
    expect(within(heroLedger).getByText("Bandung day out", { exact: true })).toBeInTheDocument();
    expect(within(heroLedger).getByText("Rani assigned", { exact: true })).toBeInTheDocument();
    expect(within(heroLedger).getByText("Rp 42.500", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("The same ledger continues", { exact: true })).not.toBeInTheDocument();
    const handoff = document.querySelector<HTMLElement>("[data-ledger-handoff]")!;
    expect(within(handoff).getByText("Bandung day out", { exact: true })).toBeInTheDocument();
    expect(within(handoff).getByText("Rani assigned", { exact: true })).toBeInTheDocument();
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
    expect(screen.getAllByText("Rp 169.000", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rp 191.000", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Rp 169.000 assigned of Rp 360.000")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /A repayment is recorded/ }));
    expect(screen.getByText("Show money received.", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 126.500", { exact: true }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: /The balance becomes settled/ }));
    expect(screen.getAllByText("Rani", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dimas", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText("SETTLED", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Remaining across this illustrative outing:", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 42.500", { exact: true }).length).toBeGreaterThan(0);
  });

  it("continues the same story through search, receipt, private share, and payoff", () => {
    render(<HomePage />);

    expect(document.querySelectorAll(".landing-reveal")).toHaveLength(4);
    expect(screen.queryByText("A clear record, not another group chat.", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("The working parts stay connected.", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Record the expense", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /2,000 records.*Still one search away/i })).toBeInTheDocument();
    const search = screen.getByRole("search", { name: "Illustrative expense search" });
    expect(search.querySelector("input")).toHaveValue("Dinner");
    expect(within(search).getByText("Dinner", { exact: true })).toBeInTheDocument();
    expect(search.closest('[data-story-motion="search"]')).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "The receipt stays with the expense." })).toBeInTheDocument();
    expect(screen.getByText("receipt.jpg", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Attached to this expense", { exact: true })).toBeInTheDocument();
    const receipt = document.querySelector<HTMLElement>(".expense-proof__receipt")!;
    expect(receipt.closest(".expense-proof")).toHaveTextContent("Dinner");
    expect(receipt.closest('[data-story-motion="receipt"]')).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Send the balance.*not the spreadsheet/i })).toBeInTheDocument();
    const privateLedger = document.querySelector<HTMLElement>(".private-ledger")!;
    expect(within(privateLedger).getAllByText("Dimas", { exact: true })).toHaveLength(2);
    expect(within(privateLedger.querySelector(".private-ledger__source")!).getByText("Dimas", { exact: true })).toBeInTheDocument();
    expect(within(privateLedger.querySelector(".private-ledger__source")!).getByText("Rp 42.500", { exact: true })).toBeInTheDocument();
    expect(within(privateLedger.querySelector(".private-ledger__statement")!).getAllByText("Rp 42.500", { exact: true })).toHaveLength(2);
    expect(within(privateLedger).getByText("Private · Read only", { exact: true })).toBeInTheDocument();
    expect(privateLedger.closest('[data-story-motion="private-share"]')).toBeInTheDocument();
    const payoff = document.querySelector<HTMLElement>(".story-close")!;
    expect(within(payoff).getAllByText("Rp 42.500", { exact: true })).toHaveLength(2);
    expect(within(payoff.querySelector(".payoff__row")!).getByText("Dimas", { exact: true })).toBeInTheDocument();
    expect(within(payoff).getByText("Shared expenses, made explicit.", { exact: true })).toBeInTheDocument();
    expect(within(payoff).getByRole("link", { name: "Open Zplit →" })).toHaveAttribute("href", "/app");
    expect(payoff).toHaveAttribute("data-story-motion", "finale");
  });
});
