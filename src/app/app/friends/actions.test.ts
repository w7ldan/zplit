import { describe, expect, it, vi } from "vitest";
import { archiveFriendAction, createFriendAction, restoreFriendAction, updateFriendAction } from "./actions";
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
  const initialFriendActionState: FriendActionState = {
    fieldErrors: {},
    formError: "",
    values: { name: "", phoneNumber: "", notes: "" },
  };

  it("returns field errors without touching the repository", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const state = await createFriendAction(initialFriendActionState, form({ name: "", phoneNumber: "", notes: "" }));

    expect(state).toMatchObject({ formError: "Please correct the marked fields.", fieldErrors: { name: "Name is required." } });
    expect(mocks.createLedgerRepository).not.toHaveBeenCalled();
  });

  it("binds create to the authenticated owner and redirects after success", async () => {
    const createFriend = vi.fn().mockResolvedValue({ id: "friend-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createFriend });

    await expect(createFriendAction(initialFriendActionState, form({
      name: "  Ada  ",
      phoneNumber: " +62 1 ",
      notes: "  Notes  ",
      ownerUserId: "owner-b",
    }))).rejects.toThrow("redirect:/app/friends");

    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(createFriend).toHaveBeenCalledWith({ name: "Ada", phoneNumber: "+62 1", notes: "Notes" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/friends");
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
    const setFriendArchived = vi.fn().mockResolvedValue({ id: "friend-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ setFriendArchived });

    await expect(archiveFriendAction("friend-a", initialFriendActionState, new FormData())).rejects.toThrow("redirect:/app/friends/friend-a");
    expect(setFriendArchived).toHaveBeenCalledWith("friend-a", true);

    mocks.redirect.mockImplementationOnce((path: string) => { throw new Error(`redirect:${path}`); });
    await expect(restoreFriendAction("friend-a", initialFriendActionState, new FormData())).rejects.toThrow("redirect:/app/friends/friend-a");
    expect(setFriendArchived).toHaveBeenCalledWith("friend-a", false);
  });
});
