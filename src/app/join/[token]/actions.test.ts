import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(() => "database"),
  claimInvitation: vi.fn(),
  createInvitedCredentialAccount: vi.fn(),
  acceptInvitation: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/auth/invitations", () => ({
  claimInvitation: mocks.claimInvitation,
  createInvitedCredentialAccount: mocks.createInvitedCredentialAccount,
  acceptInvitation: mocks.acceptInvitation,
  normalizeSuggestedName: (value: unknown) => typeof value === "string" ? value.trim() : "",
  validateInvitePassword: (value: string) => value.length >= 16 ? "" : "Password is too short.",
  validateSuggestedName: (value: string) => value.length > 0 && value.length <= 120,
}));

import { acceptInvitationAction } from "./actions";

const initialJoinActionState = {
  fieldErrors: {},
  formError: "",
  values: { name: "", password: "", confirmPassword: "" },
};

describe("join actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claims the invitation, creates a credential account, and enters login", async () => {
    mocks.claimInvitation.mockResolvedValue({ id: "invite-a", email: "person@example.com" });
    mocks.createInvitedCredentialAccount.mockResolvedValue({ id: "user-b" });
    mocks.acceptInvitation.mockResolvedValue({ id: "invite-a", acceptedUserId: "user-b" });
    const form = new FormData();
    form.set("name", "Ada Lovelace");
    form.set("password", "a".repeat(16));
    form.set("confirmPassword", "a".repeat(16));

    await expect(acceptInvitationAction("b".repeat(64), initialJoinActionState, form)).rejects.toThrow("redirect:/login?created=1");
    expect(mocks.claimInvitation).toHaveBeenCalledWith("database", "b".repeat(64));
    expect(mocks.createInvitedCredentialAccount).toHaveBeenCalledWith({ name: "Ada Lovelace", email: "person@example.com", password: "a".repeat(16) });
    expect(mocks.acceptInvitation).toHaveBeenCalledWith("database", "invite-a", "user-b");
  });

  it("rejects a used or invalid invitation without creating an account", async () => {
    mocks.claimInvitation.mockResolvedValue(null);
    const form = new FormData();
    form.set("name", "Ada");
    form.set("password", "a".repeat(16));
    form.set("confirmPassword", "a".repeat(16));

    await expect(acceptInvitationAction("b".repeat(64), initialJoinActionState, form)).resolves.toMatchObject({ formError: expect.stringMatching(/invalid|expired|revoked|used/) });
    expect(mocks.createInvitedCredentialAccount).not.toHaveBeenCalled();
  });
});
