import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/db/schema", () => ({ users: { id: "id", username: "username" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((left: unknown, right: unknown) => ({ left, right })) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { updateUsernameAction } from "./actions";

function database(returning: unknown) {
  const returningCall = vi.fn(() => returning instanceof Error ? Promise.reject(returning) : Promise.resolve(returning));
  const where = vi.fn(() => ({ returning: returningCall }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  mocks.getDatabase.mockReturnValue({ update });
  return { update, set, where, returning: returningCall };
}

function form(value: string) {
  const formData = new FormData();
  formData.set("username", value);
  return formData;
}

describe("username settings action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
  });

  it.each(["a..b", "admin", "ab-"])("rejects %s before persistence and preserves input", async (value) => {
    const result = await updateUsernameAction({ error: "", value: "" }, form(value));
    expect(result).toMatchObject({ value });
    expect(result.error).toBeTruthy();
    expect(mocks.requireSession).not.toHaveBeenCalled();
  });

  it("normalizes a valid change and redirects to the compact profile", async () => {
    const db = database([{ username: "alice.tan" }]);
    await expect(updateUsernameAction({ error: "", value: "" }, form("  @Alice.Tan  "))).rejects.toThrow("redirect:/app/settings?saved=1#settings-profile-heading");
    expect(db.set).toHaveBeenCalledWith({ username: "alice.tan" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/settings");
  });

  it("preserves entered input when the database rejects a duplicate", async () => {
    database(Object.assign(new Error("duplicate"), { code: "23505" }));
    await expect(updateUsernameAction({ error: "", value: "" }, form("Wildan_2"))).resolves.toEqual({ error: "That username is already taken.", value: "Wildan_2" });
  });
});
