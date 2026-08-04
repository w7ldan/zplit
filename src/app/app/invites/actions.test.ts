import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(() => "database"),
  getAuth: vi.fn(() => ({ options: { baseURL: "https://zplit.example" } })),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  isInstallationOwner: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
  revalidatePath: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/auth/runtime", () => ({ getAuth: mocks.getAuth }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/auth/invitations", () => ({
  ACTIVE_INVITATION_ERROR: "An active invitation already exists for that email.",
  EXISTING_ACCOUNT_ERROR: "An account with that email already exists.",
  createInvitation: mocks.createInvitation,
  revokeInvitation: mocks.revokeInvitation,
  isInstallationOwner: mocks.isInstallationOwner,
  normalizeInvitationEmail: (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "",
  normalizeSuggestedName: (value: unknown) => typeof value === "string" ? value.trim() : "",
  validateInvitationEmail: (value: string) => value === "person@example.com",
  validateSuggestedName: (value: string) => value.length <= 120,
}));

import { createInviteAction } from "./actions";

const initialInviteActionState = {
  fieldErrors: {},
  formError: "",
  values: { email: "", suggestedName: "" },
  invitation: null,
};

describe("invite actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a normalized invitation and returns a shareable link", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.isInstallationOwner.mockResolvedValue(true);
    mocks.createInvitation.mockResolvedValue({
      invitation: { email: "person@example.com", expiresAt: new Date("2026-08-11T00:00:00.000Z") },
      token: "a".repeat(64),
    });
    const form = new FormData();
    form.set("email", " PERSON@EXAMPLE.COM ");
    form.set("suggestedName", " Ada ");

    const state = await createInviteAction(initialInviteActionState, form);

    expect(mocks.createInvitation).toHaveBeenCalledWith("database", {
      email: "person@example.com",
      suggestedName: "Ada",
      createdByUserId: "owner-a",
    });
    expect(state.invitation).toEqual({
      link: `https://zplit.example/join/${"a".repeat(64)}`,
      email: "person@example.com",
      expiresAt: "2026-08-11T00:00:00.000Z",
    });
  });

  it("rejects invalid input before touching the database", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.isInstallationOwner.mockResolvedValue(true);
    const form = new FormData();
    form.set("email", "bad");
    const state = await createInviteAction(initialInviteActionState, form);

    expect(state.fieldErrors.email).toBeTruthy();
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it("returns stable duplicate errors", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.isInstallationOwner.mockResolvedValue(true);
    mocks.createInvitation.mockRejectedValue(new Error("An active invitation already exists for that email."));
    const form = new FormData();
    form.set("email", "person@example.com");

    await expect(createInviteAction(initialInviteActionState, form)).resolves.toMatchObject({
      formError: "An active invitation already exists for that email.",
    });
  });

  it("rejects non-owner actions through not-found", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "user-b" } });
    mocks.isInstallationOwner.mockResolvedValue(false);
    await expect(createInviteAction(initialInviteActionState, new FormData())).rejects.toThrow("not-found");
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });
});
