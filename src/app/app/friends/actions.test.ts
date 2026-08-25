import { beforeEach, describe, expect, it, vi } from "vitest";
import { archiveFriendAction, createFriendAction, restoreFriendAction, undoFriendArchiveAction, updateFriendAction } from "./actions";
import type { FriendActionState } from "./actions";
import { LedgerNotFoundError } from "@/domain/ledger-repository";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/user-directory", () => ({ searchUsernameDirectory: vi.fn() }));
vi.mock("@/server/friend-links", () => ({
  cancelFriendLinkRequest: vi.fn(),
  createFriendLinkRequest: vi.fn(),
  FriendLinkError: class FriendLinkError extends Error {},
}));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", async () => {
  const actual = await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository");
  return { ...actual, createLedgerRepository: mocks.createLedgerRepository };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

function form(values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

describe("friend actions", () => {
  beforeEach(() => vi.clearAllMocks());

  const initialFriendActionState: FriendActionState = {
    fieldErrors: {},
    formError: "",
    values: { name: "", phoneNumber: "", notes: "" },
  };

  it("returns field errors without touching the repository", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const state = await createFriendAction("/app/repayments?create=1", initialFriendActionState, form({ name: "", phoneNumber: "", notes: "" }));

    expect(state).toMatchObject({ formError: "Please correct the marked fields.", fieldErrors: { name: "Name is required." } });
    expect(mocks.createLedgerRepository).not.toHaveBeenCalled();
  });

  it("binds create to the authenticated owner and redirects after success", async () => {
    const createFriend = vi.fn().mockResolvedValue({ id: "friend-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createFriend });

    await expect(createFriendAction(undefined, initialFriendActionState, form({
      name: "  Ada  ",
      countryCode: "+62",
      otherCountryCode: "",
      phoneNumber: "81112345",
      phoneFieldsChanged: "1",
      legacyPhoneNumber: "",
      notes: "  Notes  ",
      ownerUserId: "owner-b",
    }))).rejects.toThrow("redirect:/app/friends?created=friend-a");

    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(createFriend).toHaveBeenCalledWith({ name: "Ada", phoneNumber: "+6281112345", notes: "Notes" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/friends");
  });

  it("continues to repayment with the created friend selected", async () => {
    const createFriend = vi.fn().mockResolvedValue({ id: "friend-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createFriend });

    await expect(createFriendAction("/app/repayments?q=Cash&create=0&friendId=old#top", initialFriendActionState, form({
      name: "Ari",
      countryCode: "+62",
      otherCountryCode: "",
      phoneNumber: "81112345",
      phoneFieldsChanged: "1",
      legacyPhoneNumber: "",
      notes: "",
    }))).rejects.toThrow("redirect:/app/repayments?q=Cash&create=1&friendId=friend-a#top");
  });

  it("falls back to the normal confirmation for an invalid bound target", async () => {
    const createFriend = vi.fn().mockResolvedValue({ id: "friend-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createFriend });

    await expect(createFriendAction("https://evil.example/app/repayments", initialFriendActionState, form({
      name: "Ari",
      countryCode: "+62",
      otherCountryCode: "",
      phoneNumber: "81112345",
      phoneFieldsChanged: "1",
      legacyPhoneNumber: "",
      notes: "",
    }))).rejects.toThrow("redirect:/app/friends?created=friend-a");
    expect(mocks.redirect.mock.calls.every(([path]) => !String(path).startsWith("https://"))).toBe(true);
  });

  it("maps cross-owner update failures to a generic form error", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ updateFriend: vi.fn().mockRejectedValue(new LedgerNotFoundError()) });

    const state = await updateFriendAction("friend-b", initialFriendActionState, form({ name: "Friend", phoneNumber: "", notes: "" }));

    expect(state.formError).toBe("This friend is no longer available.");
    expect(state.formError).not.toContain("friend-b");
  });

  it("binds archive and restore to the authenticated owner", async () => {
    const reversalReceipt = { version: 1 as const, friendId: "friend-a", archivedAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z" };
    const archiveFriend = vi.fn().mockResolvedValue({ id: "friend-a", reversalReceipt });
    const setFriendArchived = vi.fn().mockResolvedValue({ id: "friend-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ archiveFriend, setFriendArchived });

    await expect(archiveFriendAction("friend-a", initialFriendActionState, new FormData())).resolves.toMatchObject({ archiveReceipt: reversalReceipt });
    expect(archiveFriend).toHaveBeenCalledWith("friend-a");
    expect(setFriendArchived).not.toHaveBeenCalledWith("friend-a", true);

    mocks.redirect.mockImplementationOnce((path: string) => { throw new Error(`redirect:${path}`); });
    await expect(restoreFriendAction("friend-a", initialFriendActionState, new FormData())).rejects.toThrow("redirect:/app/friends/friend-a?saved=1");
    expect(setFriendArchived).toHaveBeenCalledWith("friend-a", false);
  });

  it("reverses only through the authenticated owner and reports stale archives safely", async () => {
    const receipt = { version: 1 as const, friendId: "friend-a", archivedAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z" };
    const undoFriendArchive = vi.fn().mockRejectedValue(new LedgerNotFoundError());
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ undoFriendArchive });

    await expect(undoFriendArchiveAction(receipt)).resolves.toEqual({ ok: false, message: "Undo unavailable: this friend changed after it was archived." });
    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(undoFriendArchive).toHaveBeenCalledWith(receipt);
  });
});
