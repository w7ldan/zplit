import { describe, expect, it, vi } from "vitest";
import { requireSession } from "./require-session";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "session=test" }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));

describe("requireSession", () => {
  it("redirects when the request has no authenticated session", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(requireSession()).rejects.toThrow("redirect:/login");
  });

  it("returns the authenticated session without a fallback identity", async () => {
    const session = { user: { id: "user-a", name: "Wildan", email: "owner@example.com" } };
    mocks.getSession.mockResolvedValue(session);

    await expect(requireSession()).resolves.toBe(session);
    expect(mocks.getSession).toHaveBeenCalledWith({ headers: expect.any(Headers) });
  });
});
