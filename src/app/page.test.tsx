import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("public Zplit page", () => {
  it("opens with the current product story and valid navigation", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Keep shared money on the record." })).toBeInTheDocument();
    const navigation = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    expect(navigation.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#journey");
    expect(navigation.getByRole("link", { name: "Contexts" })).toHaveAttribute("href", "#scopes");
    expect(navigation.getByRole("link", { name: "Records" })).toHaveAttribute("href", "#records");
    expect(within(document.querySelector(".site-header__actions")!).getByRole("link", { name: "Open Zplit" })).toHaveAttribute("href", "/app");
    for (const link of navigation.getAllByRole("link")) expect(document.querySelector(link.getAttribute("href")!)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read the model" })).toHaveAttribute("href", "#model");
    expect(screen.getByRole("heading", { level: 2, name: "Bandung day out" })).toBeInTheDocument();
    expect(screen.getByText("Illustrative / Personal", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("The same ledger continues", { exact: true })).not.toBeInTheDocument();
    expect(document.querySelector("[data-ledger-handoff]" )).not.toBeInTheDocument();
    expect(document.querySelector(".hero__field")).not.toBeInTheDocument();
  });

  it("keeps the Journey compact and keyboard-operable", () => {
    render(<HomePage />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(document.querySelectorAll(".journey-panel")).toHaveLength(1);
    expect(document.querySelector(".journey-runway")).not.toBeInTheDocument();
    for (const label of ["Add the record", "Assign shares", "Record repayment", "Read the balance"]) expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeInTheDocument();

    expect(screen.getByRole("tab", { name: /ADD Add the record/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /ADD Add the record/ }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /ASSIGN Assign shares/ })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll('.journey-share-list[data-visible="true"]')).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: /REPAY Record repayment/ }));
    expect(screen.getByText("Show money received.", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 126.500", { exact: true }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: /SETTLE Read the balance/ }));
    expect(screen.getAllByText("Settled", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Open", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rp 42.500", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText(/nothing here is automatic/)).toBeInTheDocument();
  });

  it("represents the broader product without inventing product statistics", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 2, name: "One product. Different places for the money to live." })).toBeInTheDocument();
    expect(screen.getByText("Private, owner-centric ledger. You front money; Friends owe you.", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Peer-to-peer records where the payer, shares, and settlement context stay with the Group.", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Entity-centric records operated by members with the access their role allows.", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Talk beside the record. Keep the record authoritative." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "The explanation stays with the number." })).toBeInTheDocument();
    expect(screen.getByText("Private · Read only", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Every record stays findable." })).toBeInTheDocument();
    expect(screen.getByLabelText("Search records")).toHaveValue("Dinner");
    expect(screen.queryByText(/2,000 records/i)).not.toBeInTheDocument();
  });
});
