import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), listOrganizations: vi.fn(), listOrganizationOverviewSummaries: vi.fn(), readLedgerOverviewSummaries: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/organizations", () => ({ listOrganizations: mocks.listOrganizations, listOrganizationOverviewSummaries: mocks.listOrganizationOverviewSummaries }));
vi.mock("@/domain/ledger/summary", () => ({ readLedgerOverviewSummaries: mocks.readLedgerOverviewSummaries }));

import OrganizationsPage from "./page";

describe("/app/organizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.listOrganizations.mockResolvedValue([]);
    mocks.listOrganizationOverviewSummaries.mockResolvedValue([]);
    mocks.readLedgerOverviewSummaries.mockResolvedValue(new Map());
  });

  it("renders the empty organization shell", async () => {
    render(await OrganizationsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Organizations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Your organizations" })).toBeInTheDocument();
    expect(screen.getByText("No organizations yet.")).toBeInTheDocument();
    expect(document.querySelector(".organization-grid")).not.toBeInTheDocument();
  });

  it("renders membership-backed compact cards", async () => {
    mocks.listOrganizations.mockResolvedValue([{ id: "org-a", name: "Studio", description: null, role: "owner", memberCount: 2, avatar: null }]);
    render(await OrganizationsPage());
    expect(screen.getByRole("link", { name: /Studio/ })).toHaveAttribute("href", "/app/organizations/org-a");
    expect(screen.getByText(/Owner · 2 members/)).toBeInTheDocument();
    expect(document.querySelectorAll(".organization-grid")).toHaveLength(1);
  });

  it("passes permitted ledger summaries to organization cards", async () => {
    mocks.listOrganizations.mockResolvedValue([{ id: "org-a", name: "Studio", description: null, role: "member", memberCount: 2, avatar: null }]);
    mocks.listOrganizationOverviewSummaries.mockResolvedValue([{ id: "org-a", canViewLedger: true, ledgerScopeId: "scope-a" }]);
    mocks.readLedgerOverviewSummaries.mockResolvedValue(new Map([["scope-a", { totalOutstandingAmount: 80_000, totalExpenseAmount: 100_000, totalRepaidAmount: 20_000 }]]));
    render(await OrganizationsPage());
    expect(screen.getByText("Rp 80.000")).toBeInTheDocument();
  });
});
