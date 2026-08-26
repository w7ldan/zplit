import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), getOrganizationForMember: vi.fn(), getAuthenticatedOrganizationLedger: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/organizations", () => ({ getOrganizationForMember: mocks.getOrganizationForMember }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedOrganizationLedger: mocks.getAuthenticatedOrganizationLedger }));
vi.mock("@/components/organizations/organization-detail", () => ({ OrganizationProfile: () => <h2>Organization profile</h2> }));
vi.mock("@/components/settings/repayment-destinations-settings", () => ({ RepaymentDestinationsSettings: () => <div>Manage repayment destinations</div> }));
vi.mock("../../actions", () => ({ deleteOrganizationAction: vi.fn(), updateOrganizationAction: vi.fn() }));
vi.mock("../ledger-actions", () => ({ createRepaymentDestinationAction: vi.fn(), deleteRepaymentDestinationAction: vi.fn(), setRepaymentDestinationOrderAction: vi.fn(), updateRepaymentDestinationAction: vi.fn() }));

import OrganizationSettingsPage from "./page";

const session = { user: { id: "user-a" } };
const organization = { id: "org-a", name: "Studio", description: null, canUpdate: false, canDelete: false, canViewLedger: false, canManageRepaymentDestinations: false, canExport: false };

describe("Organization Settings capability composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(session);
    mocks.getDatabase.mockReturnValue("database");
    mocks.getAuthenticatedOrganizationLedger.mockResolvedValue({ ledger: { listRepaymentDestinations: vi.fn().mockResolvedValue([]) } });
  });

  async function renderPage(overrides: Partial<typeof organization>) {
    mocks.getOrganizationForMember.mockResolvedValue({ ...organization, ...overrides });
    render(await OrganizationSettingsPage({ params: Promise.resolve({ organizationId: "org-a" }) }));
  }

  it("shows profile settings with organization.update and does not load ledger-only content", async () => {
    await renderPage({ canUpdate: true });
    expect(screen.getByRole("heading", { name: "Organization profile" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Repayment destinations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Export management" })).not.toBeInTheDocument();
    expect(mocks.getAuthenticatedOrganizationLedger).not.toHaveBeenCalled();
  });

  it("keeps ledger-backed destinations read-only when only ledger.view is granted", async () => {
    await renderPage({ canViewLedger: true });
    expect(screen.queryByRole("heading", { name: "Organization profile" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Repayment destinations" })).toBeInTheDocument();
    expect(mocks.getAuthenticatedOrganizationLedger).toHaveBeenCalledWith("org-a", "ledger.view", session);
    expect(screen.queryByText("Manage repayment destinations")).not.toBeInTheDocument();
  });

  it("loads and exposes destination management without ledger.view", async () => {
    await renderPage({ canManageRepaymentDestinations: true });
    expect(screen.getByText("Manage repayment destinations")).toBeInTheDocument();
    expect(mocks.getAuthenticatedOrganizationLedger).toHaveBeenCalledWith("org-a", "repayment_destinations.manage", session);
  });

  it("keeps exports available without ledger.view or organization.update", async () => {
    await renderPage({ canExport: true });
    expect(screen.getByRole("heading", { name: "Export management" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View exports" })).toHaveAttribute("href", "/app/organizations/org-a/exports");
    expect(mocks.getAuthenticatedOrganizationLedger).not.toHaveBeenCalled();
  });
});
