import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationRole } from "@/domain/organization-permissions";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), getOrganizationForMember: vi.fn(), notFound: vi.fn(() => { throw new Error("not_found"); }) }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/organizations", () => ({ getOrganizationForMember: mocks.getOrganizationForMember }));
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
  });

  async function renderPage(permissions: { canUpdate: boolean; canDelete: boolean }, role: OrganizationRole = organization.role) {
    mocks.getOrganizationForMember.mockResolvedValue({ ...organization, role, ...permissions });
    render(await OrganizationDetailPage({ params: Promise.resolve({ organizationId: organization.id }) }));
  }

  it("shows profile controls from organization.update and deletion from organization.delete", async () => {
    await renderPage({ canUpdate: true, canDelete: false });
    expect(screen.getByRole("heading", { level: 2, name: "Organization profile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete organization" })).not.toBeInTheDocument();
  });

  it("does not grant an Owner-named role any UI control when the server denies both capabilities", async () => {
    await renderPage({ canUpdate: false, canDelete: false }, "owner");
    expect(screen.queryByRole("heading", { level: 2, name: "Organization profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete organization" })).not.toBeInTheDocument();
  });

  it("renders deletion only when the server-derived deletion capability is granted", async () => {
    await renderPage({ canUpdate: false, canDelete: true });
    expect(screen.getByRole("button", { name: "Delete organization" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Organization profile" })).not.toBeInTheDocument();
  });
});
