"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type RealtimeEnvelope = {
  type: string;
  id: string;
  sequence: number;
  occurredAt: string;
  data: Record<string, unknown>;
};

export type RealtimeConnectionState = "connecting" | "open" | "reconnecting" | "closed";
type RealtimeListener = (event: RealtimeEnvelope) => void;
type RealtimeContextValue = {
  connection: RealtimeConnectionState;
  /** Increments on every successful open; consumers can refetch canonical state after reconnect. */
  openCount: number;
  subscribe: (type: string, listener: RealtimeListener) => () => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

function parseEnvelope(value: unknown): RealtimeEnvelope | null {
  if (typeof value !== "object" || value === null) return null;
  const event = value as Partial<RealtimeEnvelope>;
  if (typeof event.type !== "string" || typeof event.id !== "string" || !Number.isSafeInteger(event.sequence) || typeof event.occurredAt !== "string") return null;
  if (typeof event.data !== "object" || event.data === null || Array.isArray(event.data)) return null;
  return event as RealtimeEnvelope;
}

export function RealtimeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const listeners = useRef(new Map<string, Set<RealtimeListener>>());
  const source = useRef<EventSource | null>(null);
  const [connection, setConnection] = useState<RealtimeConnectionState>(() => typeof EventSource === "undefined" ? "closed" : "connecting");
  const [openCount, setOpenCount] = useState(0);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      return;
    }

    const eventSource = new EventSource("/api/realtime");
    source.current = eventSource;
    eventSource.onopen = () => {
      setConnection("open");
      setOpenCount((count) => count + 1);
    };
    eventSource.onerror = () => setConnection(eventSource.readyState === 2 ? "closed" : "reconnecting");
    eventSource.onmessage = (message) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.data);
      } catch {
        return;
      }
      const event = parseEnvelope(parsed);
      if (!event) return;
      for (const listener of [...(listeners.current.get(event.type) ?? [])]) {
        try {
          listener(event);
        } catch {
          // A future consumer must not break the shared connection.
        }
      }
    };

    return () => {
      eventSource.onopen = null;
      eventSource.onerror = null;
      eventSource.onmessage = null;
      eventSource.close();
      if (source.current === eventSource) source.current = null;
    };
  }, []);

  const subscribe = useCallback((type: string, listener: RealtimeListener) => {
    const current = listeners.current.get(type) ?? new Set<RealtimeListener>();
    current.add(listener);
    listeners.current.set(type, current);
    return () => {
      current.delete(listener);
      if (current.size === 0) listeners.current.delete(type);
    };
  }, []);

  return <RealtimeContext.Provider value={{ connection, openCount, subscribe }}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error("useRealtime must be used inside RealtimeProvider");
  return context;
}
