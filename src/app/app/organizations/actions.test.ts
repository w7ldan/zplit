import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TestOrganizationInvitationError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    requireSession: vi.fn(),
    getDatabase: vi.fn(),
    addPersonalFriendAsOrganizationExpenseContact: vi.fn(),
    addPersonalFriendAsOrganizationParticipant: vi.fn(),
    createLocalOrganizationParticipant: vi.fn(),
    createOrganizationInvitation: vi.fn(),
    searchOrganizationInvitationUsers: vi.fn(),
    listPersonalFriendCandidates: vi.fn(),
    requireOrganizationAccess: vi.fn(),
    revalidatePath: vi.fn(),
    createOrganization: vi.fn(),
    deleteOrganization: vi.fn(),
    archiveOrganization: vi.fn(),
    restoreOrganization: vi.fn(),
    OrganizationError: class OrganizationError extends Error {},
    OrganizationInvitationError: TestOrganizationInvitationError,
    revokeOrganizationInvitation: vi.fn(),
    normalizeUserAvatar: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/organizations", () => ({
  addPersonalFriendAsOrganizationExpenseContact: mocks.addPersonalFriendAsOrganizationExpenseContact,
  requireOrganizationAccess: mocks.requireOrganizationAccess,
  createOrganization: mocks.createOrganization,
  deleteOrganization: mocks.deleteOrganization,
  archiveOrganization: mocks.archiveOrganization,
  restoreOrganization: mocks.restoreOrganization,
  OrganizationError: mocks.OrganizationError,
  updateOrganization: mocks.updateOrganization,
}));
vi.mock("@/server/organization-invitations", () => ({
  createOrganizationInvitation: mocks.createOrganizationInvitation,
  OrganizationInvitationError: mocks.OrganizationInvitationError,
  revokeOrganizationInvitation: mocks.revokeOrganizationInvitation,
  searchOrganizationInvitationUsers: mocks.searchOrganizationInvitationUsers,
}));
vi.mock("@/server/collaboration-candidates", () => ({ listPersonalFriendCandidates: mocks.listPersonalFriendCandidates }));
vi.mock("@/server/organization-participants", () => ({
  addPersonalFriendAsOrganizationParticipant: mocks.addPersonalFriendAsOrganizationParticipant,
  createLocalOrganizationParticipant: mocks.createLocalOrganizationParticipant,
  organizationParticipantErrorMessage: vi.fn(() => "Unable to add this member."),
}));
vi.mock("@/server/user-avatars", () => ({ normalizeUserAvatar: mocks.normalizeUserAvatar }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import {
  addPersonalFriendAsOrganizationExpenseContactAction,
  createOrganizationInvitationAction,
  invitePersonalFriendToOrganizationAction,
  searchOrganizationInvitationOptions,
} from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue({ user: { id: "user-owner" } });
  mocks.getDatabase.mockReturnValue("database");
});

describe("Organization collaboration candidate actions", () => {
  it("keeps username discovery as the fallback after first-class Personal Friend rows", async () => {
    mocks.requireOrganizationAccess.mockResolvedValue({ can: () => true });
    mocks.listPersonalFriendCandidates.mockResolvedValue([{ personalFriendId: "friend-local", kind: "local", userId: null, displayName: "Local", username: null, label: null }, { personalFriendId: "friend-a", kind: "registered", userId: "user-friend", displayName: "Alice", username: "alice", label: null }]);
    mocks.searchOrganizationInvitationUsers.mockResolvedValue([{ id: "user-other", displayName: "Other", username: "other" }]);

    await expect(searchOrganizationInvitationOptions("organization-a", "ali")).resolves.toEqual([
      { id: "personalFriend:friend-local", label: "Local · Local friend" },
      { id: "user-friend", label: "Alice · @alice · Zplit friend" },
      { id: "user-other", label: "Other · @other · Zplit user" },
    ]);
  });

  it("sends the selected Friend's userId through the canonical invitation service", async () => {
    mocks.createOrganizationInvitation.mockResolvedValue({ id: "invitation-a" });
    const formData = new FormData();
    formData.set("targetUserId", "user-friend");
    formData.set("role", "member");

    await expect(
      createOrganizationInvitationAction("organization-a", { error: "", values: { targetUserId: "", role: "member" } }, formData),
    ).resolves.toEqual({ error: "Invitation sent.", values: { targetUserId: "", role: "member" } });
    expect(mocks.createOrganizationInvitation).toHaveBeenCalledWith(
      "database",
      "organization-a",
      "user-owner",
      { targetUserId: "user-friend", role: "member" },
    );
  });

  it("routes a local Personal Friend to Organization participant creation", async () => {
    const formData = new FormData();
    formData.set("targetUserId", "personalFriend:friend-local");
    formData.set("role", "member");

    await expect(
      createOrganizationInvitationAction("organization-a", { error: "", values: { targetUserId: "", role: "member" } }, formData),
    ).resolves.toEqual({ error: "Member added.", values: { targetUserId: "", role: "member" } });
    expect(mocks.addPersonalFriendAsOrganizationParticipant).toHaveBeenCalledWith("database", "organization-a", "user-owner", "friend-local");
    expect(mocks.createOrganizationInvitation).not.toHaveBeenCalled();
  });

  it("uses canonical user IDs for member invites and Personal Friend IDs for expense contacts", async () => {
    const role = new FormData();
    role.set("role", "member");
    await invitePersonalFriendToOrganizationAction("organization-a", "user-friend", role);
    await addPersonalFriendAsOrganizationExpenseContactAction("organization-a", "friend-local");

    expect(mocks.createOrganizationInvitation).toHaveBeenCalledWith(
      "database",
      "organization-a",
      "user-owner",
      { targetUserId: "user-friend", role: "member" },
    );
    expect(mocks.addPersonalFriendAsOrganizationExpenseContact).toHaveBeenCalledWith(
      "database",
      "organization-a",
      "user-owner",
      "friend-local",
    );
  });
});
