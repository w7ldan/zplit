import { describe, expect, it, vi } from "vitest";
import { createOutingAction, updateOutingAction } from "./actions";
import type { OutingActionState } from "./actions";
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

const initialState: OutingActionState = {
  fieldErrors: {},
  formError: "",
  values: { title: "", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "" },
};

function form(values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

describe("outing actions", () => {
  it("returns validation errors before touching the repository", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const state = await createOutingAction(initialState, form({ title: "", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "" }));

    expect(state.formError).toBe("Please correct the marked fields.");
    expect(state.fieldErrors).toMatchObject({ title: "Title is required." });
    expect(mocks.createLedgerRepository).not.toHaveBeenCalled();
  });

  it("binds create to the authenticated owner and redirects", async () => {
    const createOuting = vi.fn().mockResolvedValue({ id: "outing-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createOuting });

    await expect(createOutingAction(initialState, form({
      title: "  Dinner  ",
      occurredAtLocal: "2026-01-02T10:30",
      timezoneOffsetMinutes: "-480",
      notes: "  Notes  ",
      ownerUserId: "owner-b",
    }))).rejects.toThrow("redirect:/app/outings");

    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(createOuting).toHaveBeenCalledWith({ title: "Dinner", occurredAt: new Date("2026-01-02T02:30:00.000Z"), notes: "Notes" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/outings");
  });

  it("maps a foreign update to the generic not-found form error", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ updateOuting: vi.fn().mockRejectedValue(new LedgerNotFoundError()) });

    const state = await updateOutingAction("outing-b", initialState, form({ title: "Outing", occurredAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", notes: "" }));

    expect(state.formError).toBe("This outing is no longer available.");
    expect(state.formError).not.toContain("outing-b");
  });
});
