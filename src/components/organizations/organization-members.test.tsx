import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OrganizationInvitationSummary, OrganizationMember } from "@/domain/organization-contracts";
import { assertPlainDto } from "@/test/assert-plain-dto";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  search: vi.fn().mockResolvedValue([]),
  revoke: vi.fn(),
  invite: vi.fn(),
  addExpense: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/app/organizations/actions", () => ({
  addPersonalFriendAsOrganizationExpenseContactAction: mocks.addExpense,
  createLocalOrganizationParticipantAction: vi.fn(),
  createOrganizationInvitationAction: mocks.create,
  invitePersonalFriendToOrganizationAction: mocks.invite,
  searchOrganizationInvitationOptions: mocks.search,
  searchOrganizationInvitationUserOptions: mocks.search,
  revokeOrganizationInvitationAction: mocks.revoke,
}));

import { OrganizationMembers } from "./organization-members";

const member: OrganizationMember = { id: "participant-a", userId: "user-a", displayName: "Alice Tan", username: "alice", label: null, role: "member", isLocal: false };
const pendingInvitation: OrganizationInvitationSummary = { id: "invitation-a", participantId: null, targetUserId: "user-b", displayName: "Bob", username: "bob", role: "member", expiresAt: "2026-09-01T00:00:00.000Z" };

describe("OrganizationMembers", () => {
  it("shows identity-only roster data and capability-derived invite roles", () => {
    assertPlainDto({ members: [member], pendingInvitations: [], invitationRoles: ["admin", "treasurer", "member"] });
    const { container } = render(<OrganizationMembers
      organizationId="11111111-1111-4111-8111-111111111111"
      members={[member]}
      pendingInvitations={[]}
      invitationRoles={["admin", "treasurer", "member"]}
      canManageMembers
    />);

    expect(screen.getByText("Alice Tan")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("Member · Zplit member")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Alice Tan avatar" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Alice Tan avatar" }).tagName).toBe("svg");
    expect(container.querySelector('img[src*="/app/avatar?userId=user-a"]')).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role for registered account" })).toHaveValue("member");
    expect(screen.getByRole("heading", { name: "Add member" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Search by name or @username..." })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add member" })).toHaveLength(2);
    expect(container.querySelector('select[name="targetUserId"]')).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "Admin" })).not.toHaveLength(0);
    expect(screen.getAllByRole("option", { name: "Treasurer" })).not.toHaveLength(0);
    expect(screen.queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Custom" })).not.toBeInTheDocument();
    expect(screen.queryByText(/email/i)).not.toBeInTheDocument();
  });

  it("keeps role selection fixed to Member without roles.manage and shows pending revoke", () => {
    assertPlainDto(pendingInvitation);
    render(<OrganizationMembers
      organizationId="11111111-1111-4111-8111-111111111111"
      pendingInvitations={[pendingInvitation]}
      invitationRoles={["member"]}
      canManageMembers={false}
    />);

    expect(screen.getByRole("combobox", { name: "Role for registered account" })).toHaveValue("member");
    expect(screen.getByRole("combobox", { name: "Role for registered account" }).querySelectorAll("option")).toHaveLength(1);
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
  });

  it("keeps Expense contacts separate from Organization members", () => {
    render(<OrganizationMembers
      organizationId="11111111-1111-4111-8111-111111111111"
      pendingInvitations={[]}
      invitationRoles={["member"]}
      canManageMembers
      expenseFriendCandidates={[{ personalFriendId: "friend-alex", userId: null, displayName: "Alex", username: null, label: null }]}
      canViewExpenseContacts
      canManageExpenseContacts
    />);

    expect(screen.getByRole("heading", { name: "Expense contacts" })).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use in expenses" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add local member" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage expense contacts" })).toHaveAttribute(
      "href",
      "/app/organizations/11111111-1111-4111-8111-111111111111/friends?create=1",
    );
  });

  it("renders archived members without management affordances", () => {
    render(
      <OrganizationMembers
        organizationId="11111111-1111-4111-8111-111111111111"
        members={[member]}
        pendingInvitations={[]}
        invitationRoles={[]}
        canManageMembers={false}
        canManageExpenseContacts={false}
      />,
    );

    expect(screen.getByText("Alice Tan")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Add member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Add local member" })).not.toBeInTheDocument();
  });
});
