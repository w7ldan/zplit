import { afterEach, describe, expect, it, vi } from "vitest";
import { createRealtimeStream, publishRealtimeEvent, subscribeRealtime, REALTIME_HEARTBEAT_INTERVAL_MS } from "./realtime";

vi.mock("server-only", () => ({}));

const decoder = new TextDecoder();

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await reader.read();
  return result.done ? "" : decoder.decode(result.value);
}

afterEach(() => vi.useRealTimers());

describe("realtime publisher", () => {
  it("delivers only to the target user and keeps tabs independent", () => {
    const userA = vi.fn();
    const otherTabA = vi.fn();
    const userB = vi.fn();
    const unsubscribeA = subscribeRealtime("user-a", userA);
    const unsubscribeOtherTabA = subscribeRealtime("user-a", otherTabA);
    const unsubscribeB = subscribeRealtime("user-b", userB);

    publishRealtimeEvent("user-a", { type: "state.invalidated", data: { scope: "settings" } });
    expect(userA).toHaveBeenCalledTimes(1);
    expect(otherTabA).toHaveBeenCalledTimes(1);
    expect(userB).not.toHaveBeenCalled();

    unsubscribeA();
    publishRealtimeEvent("user-a", { type: "state.invalidated", data: { scope: "ledger" } });
    expect(userA).toHaveBeenCalledTimes(1);
    expect(otherTabA).toHaveBeenCalledTimes(2);

    unsubscribeOtherTabA();
    unsubscribeB();
  });

  it("returns a bounded, server-typed envelope", () => {
    const received: unknown[] = [];
    const unsubscribe = subscribeRealtime("user-a", (event) => received.push(event));
    const event = publishRealtimeEvent("user-a", { type: "state.invalidated", data: { scope: "profile" } });

    expect(event).toMatchObject({ type: "state.invalidated", data: { scope: "profile" } });
    expect(event.id).toMatch(/^r-\d+$/);
    expect(event.occurredAt).toEqual(expect.any(String));
    expect(received).toEqual([event]);
    expect(() => publishRealtimeEvent("user-a", { type: "bad type", data: {} })).toThrow("Invalid realtime event type");
    unsubscribe();
  });
});

describe("realtime stream", () => {
  it("sends a ready envelope, user-scoped events, and closes cleanly", async () => {
    const abort = new AbortController();
    const reader = createRealtimeStream("user-a", abort.signal).getReader();
    expect(await readText(reader)).toContain('"type":"realtime.ready"');

    const next = readText(reader);
    publishRealtimeEvent("user-a", { type: "state.invalidated", data: { scope: "settings" } });
    expect(await next).toContain('"scope":"settings"');

    abort.abort();
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });

  it("cleans the heartbeat and only removes the disconnected tab", async () => {
    vi.useFakeTimers();
    const first = createRealtimeStream("user-a", new AbortController().signal).getReader();
    const secondController = new AbortController();
    const second = createRealtimeStream("user-a", secondController.signal).getReader();
    await readText(first);
    await readText(second);
    expect(vi.getTimerCount()).toBe(2);

    await first.cancel();
    expect(vi.getTimerCount()).toBe(1);
    const next = readText(second);
    publishRealtimeEvent("user-a", { type: "state.invalidated", data: { scope: "ledger" } });
    expect(await next).toContain('"scope":"ledger"');

    const heartbeat = readText(second);
    vi.advanceTimersByTime(REALTIME_HEARTBEAT_INTERVAL_MS);
    expect(await heartbeat).toBe(": heartbeat\n\n");

    secondController.abort();
    expect(vi.getTimerCount()).toBe(0);
    expect(REALTIME_HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
  });
});
