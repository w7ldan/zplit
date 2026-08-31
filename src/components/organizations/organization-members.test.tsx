import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OrganizationInvitationSummary, OrganizationMember } from "@/domain/organization-contracts";
import type { PersonalFriendCandidate } from "@/domain/collaboration-candidates";
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
  createOrganizationInvitationAction: mocks.create,
  invitePersonalFriendToOrganizationAction: mocks.invite,
  searchOrganizationInvitationOptions: mocks.search,
  revokeOrganizationInvitationAction: mocks.revoke,
}));

import { OrganizationMembers } from "./organization-members";

const member: OrganizationMember = { id: "user-a", displayName: "Alice Tan", username: "alice", role: "member" };
const pendingInvitation: OrganizationInvitationSummary = { id: "invitation-a", targetUserId: "user-b", displayName: "Bob", username: "bob", role: "member", expiresAt: "2026-09-01T00:00:00.000Z" };
const friendCandidate: PersonalFriendCandidate = {
  personalFriendId: "friend-carol",
  kind: "registered",
  userId: "user-friend",
  displayName: "Carol",
  username: "carol",
  label: null,
};
const localFriendCandidate: PersonalFriendCandidate = {
  personalFriendId: "friend-alex",
  kind: "local",
  userId: null,
  displayName: "Alex",
  username: null,
  label: null,
};

describe("OrganizationMembers", () => {
  it("shows identity-only roster data and capability-derived invite roles", () => {
    assertPlainDto({ members: [member], pendingInvitations: [], invitationRoles: ["admin", "treasurer", "member"] });
    const { container } = render(<OrganizationMembers
      organizationId="11111111-1111-4111-8111-111111111111"
      members={[member]}
      pendingInvitations={[]}
      invitationRoles={["admin", "treasurer", "member"]}
      friendCandidates={[friendCandidate]}
    />);

    expect(screen.getByText("Alice Tan")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("Member", { selector: ".organization-members__role" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Alice Tan avatar" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Alice Tan avatar" }).tagName).toBe("svg");
    expect(container.querySelector('img[src*="/app/avatar?userId=user-a"]')).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveValue("member");
    expect(screen.getByText("Carol")).toBeInTheDocument();
    expect(screen.getByText("@carol")).toBeInTheDocument();
    expect(screen.getByText("Registered")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite" })).toBeInTheDocument();
    expect(container.querySelector('option[value="user-friend"]')).not.toBeInTheDocument();
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
    />);

    expect(screen.getByRole("combobox", { name: "Role" })).toHaveValue("member");
    expect(screen.getByRole("combobox", { name: "Role" }).querySelectorAll("option")).toHaveLength(1);
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
  });

  it("keeps local Personal Friends under Expense contacts instead of membership invites", () => {
    render(<OrganizationMembers
      organizationId="11111111-1111-4111-8111-111111111111"
      pendingInvitations={[]}
      invitationRoles={["member"]}
      friendCandidates={[localFriendCandidate]}
      expenseFriendCandidates={[localFriendCandidate]}
      canViewExpenseContacts
      canManageExpenseContacts
    />);

    expect(screen.getByRole("heading", { name: "Expense contacts" })).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use in expenses" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add someone else" })).toHaveAttribute(
      "href",
      "/app/organizations/11111111-1111-4111-8111-111111111111/friends?create=1",
    );
  });
});
