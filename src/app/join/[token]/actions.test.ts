import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(() => "database"),
  acceptInvitation: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/auth/invitations", () => ({
  INVITATION_UNAVAILABLE_ERROR: "This invitation is unavailable.",
  acceptInvitation: mocks.acceptInvitation,
  normalizeSuggestedName: (value: unknown) => typeof value === "string" ? value.trim() : "",
  validateInvitePassword: (value: string) => value.length >= 16 ? "" : "Password is too short.",
  validateSuggestedName: (value: string) => value.length > 0 && value.length <= 120,
}));

import { acceptInvitationAction } from "./actions";

const initialJoinActionState = {
  fieldErrors: {},
  formError: "",
  values: { name: "" },
};

describe("join actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts through the invitation service and enters login", async () => {
    mocks.acceptInvitation.mockResolvedValue({ id: "user-b" });
    const form = new FormData();
    form.set("name", "Ada Lovelace");
    form.set("password", "a".repeat(16));
    form.set("confirmPassword", "a".repeat(16));

    await expect(acceptInvitationAction("b".repeat(43), initialJoinActionState, form)).rejects.toThrow("redirect:/login?joined=1");
    expect(mocks.acceptInvitation).toHaveBeenCalledWith("database", "b".repeat(43), { name: "Ada Lovelace", password: "a".repeat(16) });
  });

  it("rejects an unavailable invitation without returning passwords", async () => {
    mocks.acceptInvitation.mockRejectedValue(new Error("This invitation is unavailable."));
    const form = new FormData();
    form.set("name", "Ada");
    form.set("password", "a".repeat(16));
    form.set("confirmPassword", "a".repeat(16));

    await expect(acceptInvitationAction("b".repeat(43), initialJoinActionState, form)).resolves.toEqual({
      fieldErrors: {},
      formError: "This invitation is unavailable.",
      values: { name: "Ada" },
    });
  });
});
