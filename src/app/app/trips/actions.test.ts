import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTripAction, deleteTripAction, updateTripAction } from "./actions";
import { LedgerNotFoundError } from "@/domain/ledger-repository";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createLedgerRepository: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: async (session?: { user: { id: string } }) => { const current = session ?? await mocks.requireSession(); return { user: current.user, ledger: mocks.createLedgerRepository(mocks.getDatabase(), current.user.id) }; } }));
vi.mock("@/domain/ledger-repository", async () => ({ ...(await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository")), createLedgerRepository: mocks.createLedgerRepository }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const state = { fieldErrors: {}, formError: "", values: { name: "", startsOn: "", endsOn: "", notes: "" } };
function form(values: Record<string, string>) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }

describe("Trip actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves validation errors before repository access", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const result = await createTripAction(state, form({ name: "", startsOn: "", endsOn: "", notes: "" }));
    expect(result).toMatchObject({ formError: "Please correct the marked fields.", fieldErrors: { name: "Name is required." } });
    expect(mocks.createLedgerRepository).not.toHaveBeenCalled();
  });

  it("creates, updates, and deletes through the owner-bound repository", async () => {
    const createTrip = vi.fn().mockResolvedValue({ id: "trip-a" });
    const updateTrip = vi.fn().mockResolvedValue({ id: "trip-a" });
    const deleteTrip = vi.fn().mockResolvedValue({ detachedOutingCount: 2 });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createTrip, updateTrip, deleteTrip });
    const values = { name: "  Bali 2026  ", startsOn: "2026-04-12", endsOn: "2026-04-16", notes: " Notes " };
    await expect(createTripAction(state, form(values))).rejects.toThrow("redirect:/app/trips?created=trip-a");
    expect(createTrip).toHaveBeenCalledWith({ name: "Bali 2026", startsOn: "2026-04-12", endsOn: "2026-04-16", notes: "Notes" });
    await expect(updateTripAction("trip-a", state, form(values))).rejects.toThrow("redirect:/app/trips/trip-a?saved=1");
    await expect(deleteTripAction("trip-a", { formError: "" }, form({ confirm: "delete" }))).rejects.toThrow("redirect:/app/trips?deleted=1");
    expect(deleteTrip).toHaveBeenCalledWith("trip-a");
  });

  it("maps foreign deletion to the existing not-found behavior", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ deleteTrip: vi.fn().mockRejectedValue(new LedgerNotFoundError()) });
    expect(await deleteTripAction("foreign", { formError: "" }, form({ confirm: "delete" }))).toEqual({ formError: "This Trip is no longer available." });
  });
});
