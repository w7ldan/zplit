import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("public Zplit page", () => {
  it("opens with a truthful spatial record and valid navigation", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Every amount has a trail." })).toBeInTheDocument();
    const navigation = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    expect(navigation.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#journey");
    expect(navigation.getByRole("link", { name: "Contexts" })).toHaveAttribute("href", "#scopes");
    expect(navigation.getByRole("link", { name: "Records" })).toHaveAttribute("href", "#records");
    for (const link of navigation.getAllByRole("link")) expect(document.querySelector(link.getAttribute("href")!)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Follow the record/ })).toHaveAttribute("href", "#model");
    expect(screen.getByRole("heading", { level: 2, name: "Bandung day out" })).toBeInTheDocument();
    expect(screen.getByText("Illustrative / Personal", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open shares" })).toHaveAttribute("aria-expanded", "false");
  });

  it("lets visitors inspect the same record without inventing automation", () => {
    render(<HomePage />);

    fireEvent.click(screen.getByRole("button", { name: "Open shares" }));
    expect(screen.getByRole("button", { name: "Close shares" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: /Rani/ }));
    expect(screen.getByText("Rani · selected share", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Settled after repayment", { exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Groups/ }));
    expect(screen.getByRole("button", { name: /Groups/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("conversation beside the ledger", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Peer-to-peer Group accounting keeps payer, shares, and settlement context explicit/)).toBeInTheDocument();
  });

  it("keeps the Journey keyboard-operable and the product story complete", () => {
    render(<HomePage />);

    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(document.querySelectorAll(".journey-panel")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: /ADD Add the record/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /ADD Add the record/ }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /ASSIGN Assign shares/ })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll('.journey-expense-row__shares[data-visible="true"]')).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: /REPAY Record repayment/ }));
    expect(screen.getAllByText("Received from Rani", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText("100% allocated", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 126.500", { exact: true }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: /SETTLE Read the balance/ }));
    expect(screen.getAllByText("Settled", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Open", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rp 42.500", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/nothing here is automatic/i).length).toBeGreaterThan(0);
  });

  it("makes proof, history, and private sharing explicit and interactive", () => {
    render(<HomePage />);

    expect(screen.getByText("Private · Read only", { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Focus receipt" }));
    expect(screen.getByRole("button", { name: "Return to expense" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /receipt\.jpgSupporting proof/ })).toHaveAttribute("aria-pressed", "true");

    const search = screen.getByRole("textbox", { name: "Search records" });
    fireEvent.change(search, { target: { value: "Taxi" } });
    const results = document.querySelector<HTMLElement>(".findability-search__results")!;
    expect(within(results).getByText("Taxi", { exact: true })).toBeInTheDocument();
    expect(within(results).queryByText("Dinner", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("Dimas recorded a payment to you in Bandung crew.", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/2,000 records/i)).not.toBeInTheDocument();
  });

  it("keeps public illustrations isolated from authenticated components", () => {
    render(<HomePage />);

    const publicStyles = readFileSync(path.resolve(process.cwd(), "src/app/styles/10-public.css"), "utf8");
    expect(publicStyles).toContain(".landing-chat-message");
    expect(publicStyles).not.toMatch(/\.chat-message\b/);
    expect(document.querySelectorAll(".landing-chat-message")).toHaveLength(2);
    expect(document.querySelectorAll(".chat-message")).toHaveLength(0);
    expect(document.querySelectorAll(".record-avatar")).toHaveLength(0);
    expect(document.querySelectorAll(".user-avatar__default")).toHaveLength(4);
  });
});
