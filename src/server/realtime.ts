import "server-only";

import { Client } from "pg";
import { getDatabasePool, readRuntimeDatabaseConfig } from "@/db/client";

export const REALTIME_HEARTBEAT_INTERVAL_MS = 25_000;
export const REALTIME_POSTGRES_CHANNEL = "zplit_realtime_wakeup";
const MAX_REALTIME_EVENT_BYTES = 16 * 1024;
const MAX_SUBSCRIBER_QUEUE = 16;
const LISTENER_RECONNECT_DELAY_MS = 1_000;
const EVENT_TYPE = /^[a-z][a-z0-9._:-]{0,63}$/;
const encoder = new TextEncoder();

export type RealtimeJsonValue = string | number | boolean | null | RealtimeJsonValue[] | { [key: string]: RealtimeJsonValue };
export type RealtimeData = { [key: string]: RealtimeJsonValue };

export type RealtimeEvent = {
  type: string;
  id: string;
  sequence: number;
  occurredAt: string;
  data: RealtimeData;
};

export type RealtimeEventInput = {
  type: string;
  data: RealtimeData;
};

type Subscriber = (event: RealtimeEvent) => void;
type SerializedEvent = { event: RealtimeEvent; wire: string };

const subscribers = new Map<string, Set<Subscriber>>();
let nextSequence = 1;
let listenerClient: Client | undefined;
let listenerConnect: Promise<void> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

function assertUserId(userId: string) {
  if (!userId.trim()) throw new TypeError("A realtime user id is required");
}

function normalizeData(input: RealtimeEventInput) {
  if (!EVENT_TYPE.test(input.type)) throw new TypeError("Invalid realtime event type");

  try {
    const serializedData = JSON.stringify(input.data);
    if (!serializedData || serializedData[0] !== "{") throw new TypeError("Realtime event data must be an object");
    return JSON.parse(serializedData) as RealtimeData;
  } catch {
    throw new TypeError("Realtime event data must be JSON serializable");
  }
}

function serializeEvent(input: RealtimeEventInput): SerializedEvent {
  const data = normalizeData(input);

  const sequence = nextSequence++;
  const event = { type: input.type, id: `r-${sequence}`, sequence, occurredAt: new Date().toISOString(), data };
  const wire = JSON.stringify(event);
  if (encoder.encode(wire).byteLength > MAX_REALTIME_EVENT_BYTES) throw new RangeError("Realtime event payload is too large");
  return { event, wire };
}

function serializeWakeup(userId: string, input: RealtimeEventInput) {
  const data = normalizeData(input);
  const wire = JSON.stringify({ userId, type: input.type, data });
  if (encoder.encode(wire).byteLength > MAX_REALTIME_EVENT_BYTES) throw new RangeError("Realtime event payload is too large");
  return wire;
}

function formatEvent(wire: string, id: string) {
  return `id: ${id}\ndata: ${wire}\n\n`;
}

export function subscribeRealtime(userId: string, subscriber: Subscriber) {
  assertUserId(userId);
  const current = subscribers.get(userId) ?? new Set<Subscriber>();
  current.add(subscriber);
  subscribers.set(userId, current);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    current.delete(subscriber);
    if (current.size === 0) subscribers.delete(userId);
    if (subscribers.size === 0) stopRealtimeListener();
  };
}

export function publishRealtimeEvent(userId: string, input: RealtimeEventInput) {
  assertUserId(userId);
  return publishWakeup(serializeWakeup(userId, input));
}

async function publishWakeup(payload: string) {
  try {
    await getDatabasePool().query("SELECT pg_notify($1, $2)", [REALTIME_POSTGRES_CHANNEL, payload]);
  } catch {
    // Durable state must survive an unavailable freshness channel.
  }
}

function dispatchRealtimeEvent(userId: string, event: RealtimeEvent) {
  for (const subscriber of [...(subscribers.get(userId) ?? [])]) {
    try {
      subscriber(event);
    } catch {
      // One broken stream must not prevent delivery to another tab.
    }
  }
}

function scheduleRealtimeListenerReconnect() {
  if (!subscribers.size && !listenerClient) return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void ensureRealtimeListener();
  }, LISTENER_RECONNECT_DELAY_MS);
}

function handleRealtimeListenerFailure(client: Client) {
  if (listenerClient !== client) return;
  listenerClient = undefined;
  void client.end().catch(() => undefined);
  scheduleRealtimeListenerReconnect();
}

function ensureRealtimeListener() {
  if (listenerClient || listenerConnect || !subscribers.size) return listenerConnect ?? Promise.resolve();

  const connection = (async () => {
    let client: Client | undefined;
    try {
      client = new Client(readRuntimeDatabaseConfig());
      client.on("notification", ({ channel, payload }) => {
        if (channel !== REALTIME_POSTGRES_CHANNEL || !payload) return;
        try {
          const value = JSON.parse(payload) as { userId?: unknown; type?: unknown; data?: unknown };
          if (typeof value.userId !== "string" || typeof value.type !== "string") return;
          const serialized = serializeEvent({ type: value.type, data: value.data as RealtimeData });
          dispatchRealtimeEvent(value.userId, serialized.event);
        } catch {
          // Malformed wake-ups fail closed and never reach an SSE subscriber.
        }
      });
      client.on("error", () => handleRealtimeListenerFailure(client!));
      client.on("end", () => handleRealtimeListenerFailure(client!));
      await client.connect();
      await client.query(`LISTEN ${REALTIME_POSTGRES_CHANNEL}`);
      if (!subscribers.size) {
        await client.end();
        return;
      }
      listenerClient = client;
    } catch {
      if (client) await client.end().catch(() => undefined);
      scheduleRealtimeListenerReconnect();
    }
  })();
  const tracked = connection.finally(() => {
    if (listenerConnect === tracked) listenerConnect = undefined;
  });
  listenerConnect = tracked;
  return tracked;
}

function stopRealtimeListener() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  const client = listenerClient;
  listenerClient = undefined;
  if (client) void client.end().catch(() => undefined);
}

function createReadyEvent(reconnecting: boolean) {
  return serializeEvent({ type: "realtime.ready", data: { reconnecting } });
}

export function createRealtimeStream(userId: string, signal: AbortSignal, reconnecting = false) {
  assertUserId(userId);

  let closeStream: () => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: () => void = () => undefined;

      const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        unsubscribe();
        signal.removeEventListener("abort", closeStream);
      };

      closeStream = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // The consumer may already have cancelled the stream.
        }
      };

      const send = (chunk: string) => {
        if (closed) return;
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          closeStream();
          return;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closeStream();
        }
      };

      const sendEvent = (event: RealtimeEvent) => send(formatEvent(JSON.stringify(event), event.id));
      unsubscribe = subscribeRealtime(userId, sendEvent);
      signal.addEventListener("abort", closeStream, { once: true });
      heartbeat = setInterval(() => send(": heartbeat\n\n"), REALTIME_HEARTBEAT_INTERVAL_MS);
      void ensureRealtimeListener().then(() => {
        if (closed) return;
        const ready = createReadyEvent(reconnecting);
        send(formatEvent(ready.wire, ready.event.id));
        if (signal.aborted) closeStream();
      });

      return cleanup;
    },
    cancel() {
      closeStream();
    },
  }, { highWaterMark: MAX_SUBSCRIBER_QUEUE, size: () => 1 });

  return stream;
}
