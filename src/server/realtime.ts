import "server-only";

export const REALTIME_HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_REALTIME_EVENT_BYTES = 16 * 1024;
const MAX_SUBSCRIBER_QUEUE = 16;
const EVENT_TYPE = /^[a-z][a-z0-9._:-]{0,63}$/;
const encoder = new TextEncoder();

// ponytail: in-process fanout; add PostgreSQL LISTEN/NOTIFY when more than one effective web instance is deployed.
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

function assertUserId(userId: string) {
  if (!userId.trim()) throw new TypeError("A realtime user id is required");
}

function serializeEvent(input: RealtimeEventInput): SerializedEvent {
  if (!EVENT_TYPE.test(input.type)) throw new TypeError("Invalid realtime event type");

  let data: RealtimeData;
  try {
    const serializedData = JSON.stringify(input.data);
    if (!serializedData || serializedData[0] !== "{") throw new TypeError("Realtime event data must be an object");
    data = JSON.parse(serializedData) as RealtimeData;
  } catch {
    throw new TypeError("Realtime event data must be JSON serializable");
  }

  const sequence = nextSequence++;
  const event = { type: input.type, id: `r-${sequence}`, sequence, occurredAt: new Date().toISOString(), data };
  const wire = JSON.stringify(event);
  if (encoder.encode(wire).byteLength > MAX_REALTIME_EVENT_BYTES) throw new RangeError("Realtime event payload is too large");
  return { event, wire };
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
  };
}

export function publishRealtimeEvent(userId: string, input: RealtimeEventInput) {
  assertUserId(userId);
  const serialized = serializeEvent(input);
  for (const subscriber of [...(subscribers.get(userId) ?? [])]) {
    try {
      subscriber(serialized.event);
    } catch {
      // One broken stream must not prevent delivery to another tab.
    }
  }
  return serialized.event;
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
      const ready = createReadyEvent(reconnecting);
      send(formatEvent(ready.wire, ready.event.id));
      if (signal.aborted) closeStream();

      return cleanup;
    },
    cancel() {
      closeStream();
    },
  }, { highWaterMark: MAX_SUBSCRIBER_QUEUE, size: () => 1 });

  return stream;
}
