import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TestGroupJoinRequestError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    requireSession: vi.fn(),
    getDatabase: vi.fn(),
    addPersonalFriendAsGroupParticipant: vi.fn(),
    createGroupInvitation: vi.fn(),
    createGroupParticipantLinkRequest: vi.fn(),
    searchGroupJoinUsers: vi.fn(),
    listPersonalFriendCandidates: vi.fn(),
    revalidatePath: vi.fn(),
    createExternalParticipant: vi.fn(),
    createGroup: vi.fn(),
    deleteExternalParticipant: vi.fn(),
    deleteGroup: vi.fn(),
    GroupError: class GroupError extends Error {},
    removeGroupMember: vi.fn(),
    updateExternalParticipant: vi.fn(),
    updateGroup: vi.fn(),
    updateGroupMemberRole: vi.fn(),
    createGroupParticipantLinkRequestError: TestGroupJoinRequestError,
    GroupJoinRequestError: TestGroupJoinRequestError,
    revokeGroupJoinRequest: vi.fn(),
    normalizeUserAvatar: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/groups", () => ({
  addPersonalFriendAsGroupParticipant: mocks.addPersonalFriendAsGroupParticipant,
  createExternalParticipant: mocks.createExternalParticipant,
  createGroup: mocks.createGroup,
  deleteExternalParticipant: mocks.deleteExternalParticipant,
  deleteGroup: mocks.deleteGroup,
  GroupError: mocks.GroupError,
  removeGroupMember: mocks.removeGroupMember,
  updateExternalParticipant: mocks.updateExternalParticipant,
  updateGroup: mocks.updateGroup,
  updateGroupMemberRole: mocks.updateGroupMemberRole,
}));
vi.mock("@/server/group-join-requests", () => ({
  createGroupInvitation: mocks.createGroupInvitation,
  createGroupParticipantLinkRequest: mocks.createGroupParticipantLinkRequest,
  GroupJoinRequestError: mocks.GroupJoinRequestError,
  revokeGroupJoinRequest: mocks.revokeGroupJoinRequest,
  searchGroupJoinUsers: mocks.searchGroupJoinUsers,
}));
vi.mock("@/server/collaboration-candidates", () => ({ listPersonalFriendCandidates: mocks.listPersonalFriendCandidates }));
vi.mock("@/server/user-avatars", () => ({ normalizeUserAvatar: mocks.normalizeUserAvatar }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import {
  addPersonalFriendAsGroupParticipantAction,
  createGroupInvitationAction,
  invitePersonalFriendToGroupAction,
  searchGroupMemberOptions,
} from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue({ user: { id: "user-owner" } });
  mocks.getDatabase.mockReturnValue("database");
});

describe("Group collaboration candidate actions", () => {
  it("combines Personal Friends and username discovery without duplicate registered rows", async () => {
    mocks.listPersonalFriendCandidates.mockResolvedValue([{ personalFriendId: "friend-local", kind: "local", userId: null, displayName: "Local", username: null, label: null }, { personalFriendId: "friend-a", kind: "registered", userId: "user-friend", displayName: "Alice", username: "alice", label: null }]);
    mocks.searchGroupJoinUsers.mockResolvedValue([{ id: "user-other", displayName: "Other", username: "other" }]);

    await expect(searchGroupMemberOptions("group-a", "ali")).resolves.toEqual([
      { id: "personalFriend:friend-local", label: "Local · Local friend" },
      { id: "user-friend", label: "Alice · @alice · Zplit friend" },
      { id: "user-other", label: "Other · @other · Zplit user" },
    ]);
  });

  it("sends the selected Friend's userId through the canonical Group invitation service", async () => {
    mocks.createGroupInvitation.mockResolvedValue({ id: "request-a" });
    const formData = new FormData();
    formData.set("targetUserId", "user-friend");

    await expect(
      createGroupInvitationAction("group-a", { error: "", values: { targetUserId: "" } }, formData),
    ).resolves.toEqual({ error: "Invitation sent.", values: { targetUserId: "" } });
    expect(mocks.createGroupInvitation).toHaveBeenCalledWith(
      "database",
      "group-a",
      "user-owner",
      { targetUserId: "user-friend" },
    );
  });

  it("routes a selected local Personal Friend to participant projection", async () => {
    const formData = new FormData();
    formData.set("targetUserId", "personalFriend:friend-local");

    await expect(
      createGroupInvitationAction("group-a", { error: "", values: { targetUserId: "" } }, formData),
    ).resolves.toEqual({ error: "Member added.", values: { targetUserId: "" } });
    expect(mocks.addPersonalFriendAsGroupParticipant).toHaveBeenCalledWith(
      "database",
      "group-a",
      "user-owner",
      "friend-local",
    );
    expect(mocks.createGroupInvitation).not.toHaveBeenCalled();
  });

  it("uses stable IDs for registered invitations and local participant projections", async () => {
    await invitePersonalFriendToGroupAction("group-a", "user-friend");
    await addPersonalFriendAsGroupParticipantAction("group-a", "friend-local");

    expect(mocks.createGroupInvitation).toHaveBeenCalledWith(
      "database",
      "group-a",
      "user-owner",
      { targetUserId: "user-friend" },
    );
    expect(mocks.addPersonalFriendAsGroupParticipant).toHaveBeenCalledWith(
      "database",
      "group-a",
      "user-owner",
      "friend-local",
    );
  });
});
