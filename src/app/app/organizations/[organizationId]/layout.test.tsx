import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationRole } from "@/domain/organization-permissions";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), getOrganizationForMember: vi.fn(), getOrganizationChatUnreadCount: vi.fn(), pathname: "/app/organizations/org-a/trips" }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/organizations", () => ({ getOrganizationForMember: mocks.getOrganizationForMember }));
vi.mock("@/server/chat", () => ({ getOrganizationChatUnreadCount: mocks.getOrganizationChatUnreadCount }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), usePathname: () => mocks.pathname }));

import OrganizationLayout from "./layout";

const organization = { id: "org-a", name: "Studio", description: "Shared work", role: "admin" as OrganizationRole, memberCount: 3, avatar: null, canViewLedger: true, canViewChat: true, canViewMembers: true, canManageRepaymentDestinations: true, canExport: true, canUpdate: true, canDelete: false, invitationRoles: ["member"] };

describe("Organization navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getDatabase.mockReturnValue({});
    mocks.getOrganizationForMember.mockResolvedValue(organization);
    mocks.getOrganizationChatUnreadCount.mockResolvedValue(0);
    mocks.pathname = "/app/organizations/org-a/trips";
  });

  it("uses the managed-workspace IA and consolidates Activity", async () => {
    render(await OrganizationLayout({ params: Promise.resolve({ organizationId: "org-a" }), children: <p>Content</p> }));
    const navigation = screen.getByRole("navigation", { name: "Organization navigation" });
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual(["Overview", "General", "Activity", "Expenses", "Repayments", "People", "Settings"]);
    expect(navigation.querySelector(".chat-unread-badge")).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "Trips" })).not.toBeInTheDocument();
    const activity = screen.getByRole("navigation", { name: "Organization activity navigation" });
    expect(within(activity).getByRole("link", { name: "Trips" })).toHaveAttribute("href", "/app/organizations/org-a/trips");
    expect(within(activity).getByRole("link", { name: "Outings" })).toHaveAttribute("href", "/app/organizations/org-a/outings");
  });

  it("does not expose ledger navigation without ledger access", async () => {
    mocks.getOrganizationForMember.mockResolvedValue({ ...organization, canViewLedger: false, canViewMembers: true, canManageRepaymentDestinations: false, canExport: false, canUpdate: false });
    render(await OrganizationLayout({ params: Promise.resolve({ organizationId: "org-a" }), children: <p>Content</p> }));
    const navigation = screen.getByRole("navigation", { name: "Organization navigation" });
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual(["Overview", "General", "People"]);
    expect(screen.queryByRole("navigation", { name: "Organization activity navigation" })).not.toBeInTheDocument();
  });

  it("keeps Settings discoverable for organization.update without ledger.view", async () => {
    mocks.getOrganizationForMember.mockResolvedValue({ ...organization, canViewLedger: false, canViewMembers: false, canManageRepaymentDestinations: false, canExport: false, canUpdate: true });
    render(await OrganizationLayout({ params: Promise.resolve({ organizationId: "org-a" }), children: <p>Content</p> }));
    expect(within(screen.getByRole("navigation", { name: "Organization navigation" })).getAllByRole("link").map((link) => link.textContent)).toEqual(["Overview", "General", "Settings"]);
  });

  it("shows the General unread badge from the server count", async () => {
    mocks.getOrganizationChatUnreadCount.mockResolvedValue(4);
    render(await OrganizationLayout({ params: Promise.resolve({ organizationId: "org-a" }), children: <p>Content</p> }));
    const general = within(screen.getByRole("navigation", { name: "Organization navigation" })).getByRole("link", { name: "General, 4 unread" });
    expect(general).toHaveTextContent("4");
  });
});
