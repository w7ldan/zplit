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
    createOrganizationInvitation: vi.fn(),
    searchOrganizationInvitationUsers: vi.fn(),
    listRegisteredFriendCandidates: vi.fn(),
    revalidatePath: vi.fn(),
    createOrganization: vi.fn(),
    deleteOrganization: vi.fn(),
    updateOrganization: vi.fn(),
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
  createOrganization: mocks.createOrganization,
  deleteOrganization: mocks.deleteOrganization,
  OrganizationError: mocks.OrganizationError,
  updateOrganization: mocks.updateOrganization,
}));
vi.mock("@/server/organization-invitations", () => ({
  createOrganizationInvitation: mocks.createOrganizationInvitation,
  OrganizationInvitationError: mocks.OrganizationInvitationError,
  revokeOrganizationInvitation: mocks.revokeOrganizationInvitation,
  searchOrganizationInvitationUsers: mocks.searchOrganizationInvitationUsers,
}));
vi.mock("@/server/collaboration-candidates", () => ({ listRegisteredFriendCandidates: mocks.listRegisteredFriendCandidates }));
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
    mocks.listRegisteredFriendCandidates.mockResolvedValue([{ userId: "user-friend", displayName: "Alice", username: "alice" }]);
    mocks.searchOrganizationInvitationUsers.mockResolvedValue([{ id: "user-other", displayName: "Other", username: "other" }]);

    await expect(searchOrganizationInvitationOptions("organization-a")).resolves.toEqual([
      { id: "user-other", label: "Other · @other", group: "Other Zplit users" },
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
