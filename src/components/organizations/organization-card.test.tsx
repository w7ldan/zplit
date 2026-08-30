import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OrganizationSummary } from "@/domain/organization-contracts";
import { readCssBundle } from "@/test/read-css-bundle";
import { OrganizationCard } from "./organization-card";

const organization: OrganizationSummary = {
  id: "organization-a",
  name: "Studio",
  description: null,
  role: "owner",
  memberCount: 2,
  avatar: null,
};

describe("OrganizationCard", () => {
  it("uses one settled state for an empty canonical ledger", () => {
    render(
      <OrganizationCard
        organization={organization}
        ledgerSummary={{ totalOutstandingAmount: 0, totalExpenseAmount: 0, totalRepaidAmount: 0 }}
      />,
    );

    const card = screen.getByRole("link", { name: /Studio/ });
    expect(card).toHaveAttribute("href", "/app/organizations/organization-a");
    expect(screen.getByText("All settled up")).toBeInTheDocument();
    expect(card.querySelectorAll(".organization-card__ledger .technical-label")).toHaveLength(0);
    expect(card).not.toHaveTextContent("EXPENSES");
    expect(card).not.toHaveTextContent("REPAID");
  });

  it("shows only the canonical outstanding state when a balance remains", () => {
    render(
      <OrganizationCard
        organization={organization}
        ledgerSummary={{ totalOutstandingAmount: 450_000, totalExpenseAmount: 900_000, totalRepaidAmount: 450_000 }}
      />,
    );

    const card = screen.getByRole("link", { name: /Studio/ });
    expect(card.querySelectorAll(".organization-card__ledger > span")).toHaveLength(1);
    expect(screen.getByText("OUTSTANDING")).toBeInTheDocument();
    expect(screen.getByText("Rp 450.000")).toBeInTheDocument();
    expect(card).not.toHaveTextContent("EXPENSES");
    expect(card).not.toHaveTextContent("REPAID");
  });

  it("keeps shared cards rounded modestly and leaves section breathing room", () => {
    const { css } = readCssBundle();

    expect(css).toMatch(/\.group-card,\s*\.organization-card\s*\{[\s\S]*?border-radius: var\(--radius-md\)/);
    expect(css).toMatch(/\.overview-space-section \.group-grid,[\s\S]*?padding-bottom: 2rem/);
    expect(css).not.toMatch(/\.organization-card__ledger\s*\{[^}]*grid-template-columns/);
  });
});
