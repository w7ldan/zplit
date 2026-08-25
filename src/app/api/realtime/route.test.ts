import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishRealtimeEvent } from "@/server/realtime";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), headers: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));

const decoder = new TextDecoder();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers({ cookie: "session=test" }));
});

describe("GET /api/realtime", () => {
  it("rejects anonymous connections", async () => {
    mocks.getSession.mockResolvedValue(null);
    const response = await GET(new Request("https://zplit.test/api/realtime"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("uses the authenticated user even when a query target is supplied", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-a" } });
    const request = new Request("https://zplit.test/api/realtime?userId=user-b", { headers: { "Last-Event-ID": "r-1" } });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");
    expect(response.headers.get("connection")).toBe("keep-alive");
    const reader = response.body!.getReader();
    const ready = await reader.read();
    expect(decoder.decode(ready.value)).toContain('"reconnecting":true');

    const next = reader.read();
    publishRealtimeEvent("user-a", { type: "state.invalidated", data: { scope: "profile" } });
    expect(decoder.decode((await next).value)).toContain('"scope":"profile"');
    await reader.cancel();
  });
});
