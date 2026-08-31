import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), getOrganizationForMember: vi.fn(), listOrganizationMembers: vi.fn(), listPendingOrganizationInvitations: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/organizations", () => ({ getOrganizationForMember: mocks.getOrganizationForMember }));
vi.mock("@/server/organization-invitations", () => ({ listOrganizationMembers: mocks.listOrganizationMembers, listPendingOrganizationInvitations: mocks.listPendingOrganizationInvitations }));
vi.mock("@/components/organizations/organization-members", () => ({ OrganizationMembers: () => null }));

import OrganizationPeoplePage from "./page";

describe("Organization People capability composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.listOrganizationMembers.mockResolvedValue([]);
    mocks.listPendingOrganizationInvitations.mockResolvedValue([]);
  });

  it("does not expose expense contacts to members.view alone", async () => {
    mocks.getOrganizationForMember.mockResolvedValue({ id: "org-a", name: "Studio", description: null, canViewMembers: true, canViewLedger: false, invitationRoles: [] });
    render(await OrganizationPeoplePage({ params: Promise.resolve({ organizationId: "org-a" }) }));
    expect(screen.queryByRole("heading", { name: "Expense contacts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add someone else" })).not.toBeInTheDocument();
  });
});
