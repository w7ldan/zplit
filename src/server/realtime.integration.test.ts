import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readRuntimeDatabaseConfig } from "@/db/client";
import { createRealtimeStream, publishRealtimeEvent, REALTIME_POSTGRES_CHANNEL } from "./realtime";

vi.mock("server-only", () => ({}));

const hasDatabaseConfig = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD_FILE"].every((name) => Boolean(process.env[name]?.trim()));
const decoder = new TextDecoder();
const suite = describe.skipIf(!hasDatabaseConfig);
let publisher: Client;
let observer: Client;

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await reader.read();
  return result.done ? "" : decoder.decode(result.value);
}

function nextWakeup() {
  return new Promise<{ channel: string; payload?: string }>((resolve) => {
    observer.once("notification", resolve);
  });
}

suite("PostgreSQL realtime transport", () => {
  beforeAll(async () => {
    const config = readRuntimeDatabaseConfig();
    publisher = new Client(config);
    observer = new Client(config);
    await publisher.connect();
    await observer.connect();
    await observer.query(`LISTEN ${REALTIME_POSTGRES_CHANNEL}`);
  });

  afterAll(async () => {
    await Promise.allSettled([publisher?.end(), observer?.end()]);
  });

  it("crosses independent PostgreSQL publisher/listener contexts and reaches only the target SSE user", async () => {
    const published = nextWakeup();
    await publishRealtimeEvent("user-a", { type: "notification.state.changed", data: { reason: "created" } });
    const wakeup = await published;
    expect(wakeup.channel).toBe(REALTIME_POSTGRES_CHANNEL);
    expect(JSON.parse(wakeup.payload!)).toEqual({ userId: "user-a", type: "notification.state.changed", data: { reason: "created" } });

    const abortA = new AbortController();
    const abortB = new AbortController();
    const readerA = createRealtimeStream("user-a", abortA.signal).getReader();
    const readerB = createRealtimeStream("user-b", abortB.signal).getReader();
    await readText(readerA);
    await readText(readerB);

    const nextA = readText(readerA);
    const nextB = readText(readerB);
    await publisher.query("SELECT pg_notify($1, $2)", [
      REALTIME_POSTGRES_CHANNEL,
      JSON.stringify({ userId: "user-a", type: "notification.state.changed", data: { reason: "created" } }),
    ]);
    const event = await nextA;
    expect(event).toContain('"type":"notification.state.changed"');
    expect(event).toContain('"reason":"created"');
    await expect(Promise.race([nextB, new Promise<string>((resolve) => setTimeout(() => resolve("timed out"), 100))])).resolves.toBe("timed out");

    abortA.abort();
    abortB.abort();
  }, 10_000);
});
