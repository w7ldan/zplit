import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FakeClient {
    static clients = new Set<FakeClient>();
    private handlers = new Map<string, (...args: unknown[]) => void>();
    private listening = false;

    constructor() {
      FakeClient.clients.add(this);
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    async connect() {}

    async query(sql: string) {
      if (sql.startsWith("LISTEN ")) this.listening = true;
    }

    async end() {
      FakeClient.clients.delete(this);
      this.listening = false;
      this.handlers.get("end")?.();
    }

    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.(...args);
    }

    static notify(channel: string, payload: string) {
      for (const client of FakeClient.clients) {
        if (client.listening) client.emit("notification", { channel, payload });
      }
    }
  }

  return {
    FakeClient,
    query: vi.fn(async (_sql: string, params: [string, string]) => {
      FakeClient.notify(params[0], params[1]);
    }),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("pg", () => ({ Client: mocks.FakeClient }));
vi.mock("@/db/client", () => ({
  getDatabasePool: () => ({ query: mocks.query }),
  readRuntimeDatabaseConfig: () => ({}),
}));

import { createRealtimeStream, publishRealtimeEvent, REALTIME_HEARTBEAT_INTERVAL_MS, REALTIME_POSTGRES_CHANNEL } from "./realtime";

const decoder = new TextDecoder();

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await reader.read();
  return result.done ? "" : decoder.decode(result.value);
}

async function waitForListener() {
  await vi.waitFor(() => expect(mocks.FakeClient.clients.size).toBeGreaterThan(0));
}

afterEach(() => {
  vi.useRealTimers();
  mocks.FakeClient.clients.clear();
  mocks.query.mockClear();
});

describe("realtime publisher", () => {
  it("publishes a bounded wake-up through PostgreSQL with no local delivery assumption", async () => {
    await publishRealtimeEvent("user-a", { type: "state.invalidated", data: { scope: "profile" } });

    expect(mocks.query).toHaveBeenCalledWith("SELECT pg_notify($1, $2)", [
      REALTIME_POSTGRES_CHANNEL,
      JSON.stringify({ userId: "user-a", type: "state.invalidated", data: { scope: "profile" } }),
    ]);
    expect(() => publishRealtimeEvent("user-a", { type: "bad type", data: {} })).toThrow("Invalid realtime event type");
  });

  it("does not fail when publication has no subscribers or the database is unavailable", async () => {
    await expect(publishRealtimeEvent("user-a", { type: "state.invalidated", data: { scope: "settings" } })).resolves.toBeUndefined();
    mocks.query.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(publishRealtimeEvent("user-a", { type: "state.invalidated", data: { scope: "ledger" } })).resolves.toBeUndefined();
  });
});

describe("realtime stream", () => {
  it("fans out a PostgreSQL wake-up only to the target user's streams", async () => {
    const abortA = new AbortController();
    const abortB = new AbortController();
    const readerA = createRealtimeStream("user-a", abortA.signal).getReader();
    const readerOther = createRealtimeStream("user-b", abortB.signal).getReader();
    await readText(readerA);
    await readText(readerOther);
    await waitForListener();

    const nextA = readText(readerA);
    const nextOther = readText(readerOther);
    await publishRealtimeEvent("user-a", { type: "state.invalidated", data: { scope: "settings" } });
    expect(await nextA).toContain('"scope":"settings"');
    await expect(Promise.race([nextOther, new Promise<string>((resolve) => setTimeout(() => resolve("timed out"), 25))])).resolves.toBe("timed out");

    abortA.abort();
    abortB.abort();
  });

  it("ignores malformed wake-ups and preserves the event type and data", async () => {
    const abort = new AbortController();
    const reader = createRealtimeStream("user-a", abort.signal).getReader();
    await readText(reader);
    await waitForListener();

    const next = readText(reader);
    mocks.FakeClient.notify(REALTIME_POSTGRES_CHANNEL, JSON.stringify({ userId: "user-a", type: "bad type", data: {} }));
    await publishRealtimeEvent("user-a", { type: "notification.state.changed", data: { reason: "created" } });
    const event = await next;
    expect(event).toContain('"type":"notification.state.changed"');
    expect(event).toContain('"reason":"created"');
    abort.abort();
  });

  it("recovers the shared listener without replaying an earlier event", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const reader = createRealtimeStream("user-a", abort.signal).getReader();
    await readText(reader);
    await waitForListener();

    const first = readText(reader);
    await publishRealtimeEvent("user-a", { type: "state.invalidated", data: { scope: "first" } });
    expect(await first).toContain('"scope":"first"');

    const client = [...mocks.FakeClient.clients][0]!;
    client.emit("error", new Error("listener disconnected"));
    await vi.advanceTimersByTimeAsync(1_000);
    await waitForListener();

    const second = readText(reader);
    await publishRealtimeEvent("user-a", { type: "state.invalidated", data: { scope: "second" } });
    expect(await second).toContain('"scope":"second"');
    abort.abort();
    expect(REALTIME_HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
  });
});
