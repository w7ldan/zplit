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
    createGroupInvitation: vi.fn(),
    createGroupParticipantLinkRequest: vi.fn(),
    searchGroupJoinUsers: vi.fn(),
    listRegisteredFriendCandidates: vi.fn(),
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
vi.mock("@/server/collaboration-candidates", () => ({ listRegisteredFriendCandidates: mocks.listRegisteredFriendCandidates }));
vi.mock("@/server/user-avatars", () => ({ normalizeUserAvatar: mocks.normalizeUserAvatar }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createGroupInvitationAction, searchGroupJoinUserOptions } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue({ user: { id: "user-owner" } });
  mocks.getDatabase.mockReturnValue("database");
});

describe("Group collaboration candidate actions", () => {
  it("groups Personal Friends before unrelated username results", async () => {
    mocks.listRegisteredFriendCandidates.mockResolvedValue([{ userId: "user-friend", displayName: "Alice", username: "alice" }]);
    mocks.searchGroupJoinUsers.mockResolvedValue([{ id: "user-other", displayName: "Other", username: "other" }]);

    await expect(searchGroupJoinUserOptions("group-a")).resolves.toEqual([
      { id: "user-friend", label: "Alice · @alice", group: "Friends" },
      { id: "user-other", label: "Other · @other", group: "Other Zplit users" },
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
});
