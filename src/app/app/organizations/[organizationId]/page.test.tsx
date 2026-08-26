import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationRole } from "@/domain/organization-permissions";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), getOrganizationForMember: vi.fn(), listOrganizationMembers: vi.fn(), listPendingOrganizationInvitations: vi.fn(), notFound: vi.fn(() => { throw new Error("not_found"); }) }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/organizations", () => ({ getOrganizationForMember: mocks.getOrganizationForMember }));
vi.mock("@/server/organization-invitations", () => ({ listOrganizationMembers: mocks.listOrganizationMembers, listPendingOrganizationInvitations: mocks.listPendingOrganizationInvitations }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import OrganizationDetailPage from "./page";

const organization = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Studio",
  description: null,
  role: "admin" as OrganizationRole,
  memberCount: 2,
  avatar: null,
};

describe("Organization detail capability gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.listOrganizationMembers.mockResolvedValue([]);
    mocks.listPendingOrganizationInvitations.mockResolvedValue([]);
  });

  async function renderPage(permissions: { canUpdate: boolean; canDelete: boolean }, role: OrganizationRole = organization.role) {
    mocks.getOrganizationForMember.mockResolvedValue({ ...organization, role, ...permissions });
    render(await OrganizationDetailPage({ params: Promise.resolve({ organizationId: organization.id }) }));
  }

  it("keeps management controls out of the overview surface", async () => {
    await renderPage({ canUpdate: true, canDelete: false });
    expect(screen.getByText("This Organization workspace is ready for the capabilities available to you.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Organization profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete organization" })).not.toBeInTheDocument();
  });

  it("does not grant an Owner-named role any UI control when the server denies both capabilities", async () => {
    await renderPage({ canUpdate: false, canDelete: false }, "owner");
    expect(screen.queryByRole("heading", { level: 2, name: "Organization profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete organization" })).not.toBeInTheDocument();
  });

  it("keeps the overview focused on navigation when deletion is granted", async () => {
    await renderPage({ canUpdate: false, canDelete: true });
    expect(screen.getByText("This Organization workspace is ready for the capabilities available to you.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Organization profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete organization" })).not.toBeInTheDocument();
  });
});
