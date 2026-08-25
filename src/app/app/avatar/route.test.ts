import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(),
  getDatabase: vi.fn(),
  getAvatar: vi.fn(),
  normalize: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));

vi.stubEnv("BETTER_AUTH_URL", "https://zplit.test");
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/user-avatars", () => ({
  AVATAR_READ_HEADERS: {
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
  },
  MAX_AVATAR_BYTES: 5 * 1024 * 1024,
  normalizeUserAvatar: mocks.normalize,
  saveUserAvatar: mocks.save,
  deleteUserAvatar: mocks.remove,
}));
vi.mock("@/server/user-avatar-access", () => ({ getUserAvatarForViewer: mocks.getAvatar }));

import { DELETE, GET, POST } from "./route";

const normalized = { mediaType: "image/webp" as const, byteSize: 4, sha256: "a".repeat(64), content: Buffer.from([1, 2, 3, 4]) };

function uploadRequest(file = new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0])], "avatar.jpg", { type: "image/jpeg" }), fields: Record<string, string | File> = { avatar: file }, requestHeaders: Record<string, string> = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const request = new Request("https://zplit.test/app/avatar", { method: "POST", headers: { Origin: "https://zplit.test", "Content-Length": "100000", ...requestHeaders } });
  Object.defineProperty(request, "formData", { value: async () => form });
  return request;
}

describe("user avatar route", () => {
  it("rejects anonymous mutations and enforces origin and request bounds", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await POST(uploadRequest())).status).toBe(401);
    expect((await DELETE(new Request("https://zplit.test/app/avatar", { method: "DELETE" }))).status).toBe(401);
    expect((await GET(new Request("https://zplit.test/app/avatar"))).status).toBe(401);

    mocks.getSession.mockResolvedValue({ user: { id: "user-a" } });
    expect((await POST(uploadRequest(undefined, undefined, { Origin: "" }))).status).toBe(403);
    expect((await POST(uploadRequest(undefined, undefined, { "Content-Length": String(6 * 1024 * 1024 + 1) }))).status).toBe(413);
  });

  it("accepts one signed upload, returns metadata only, and replaces for the session user", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.normalize.mockResolvedValue(normalized);
    mocks.save.mockResolvedValue({ mediaType: "image/webp", byteSize: 4, sha256: normalized.sha256 });
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ avatar: { mediaType: "image/webp", byteSize: 4, sha256: normalized.sha256 } });
    expect(mocks.save).toHaveBeenCalledWith("database", "user-a", normalized);
    expect(JSON.stringify(body)).not.toContain("content");

    const mismatch = await POST(uploadRequest(new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "avatar.jpg", { type: "image/jpeg" })));
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).error).toContain("does not match");
    expect(mocks.normalize).toHaveBeenCalledOnce();
  });

  it("returns private bytes only to an authorized viewer and removes only the session user's row", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.getAvatar.mockResolvedValue({ ...normalized, content: Buffer.from([9, 8, 7, 6]) });
    const response = await GET(new Request("https://zplit.test/app/avatar?userId=user-a"));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7, 6]));
    expect(response.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("etag")).toBe(`"${normalized.sha256}"`);
    expect(mocks.getAvatar).toHaveBeenCalledWith("database", "user-a", "user-a");

    mocks.getAvatar.mockResolvedValue(null);
    expect((await GET(new Request("https://zplit.test/app/avatar?userId=user-b"))).status).toBe(404);
    mocks.remove.mockResolvedValue(true);
    expect((await DELETE(new Request("https://zplit.test/app/avatar", { method: "DELETE", headers: { Origin: "https://zplit.test" } }))).status).toBe(204);
    expect(mocks.remove).toHaveBeenCalledWith("database", "user-a");
  });
});
