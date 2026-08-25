import { act, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeProvider, useRealtime } from "./realtime-provider";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  readyState = 0;
  close = vi.fn(() => { this.readyState = 2; });
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

function Consumer() {
  const { connection, openCount, subscribe } = useRealtime();
  const [events, setEvents] = useState<string[]>([]);
  useEffect(() => subscribe("state.invalidated", (event) => setEvents((current) => [...current, String(event.data.scope)])), [subscribe]);
  return <output data-testid="state">{connection}:{openCount}:{events.join(",")}</output>;
}

afterEach(() => {
  FakeEventSource.instances = [];
  vi.unstubAllGlobals();
});

describe("RealtimeProvider", () => {
  it("shares one native connection, dispatches typed events, and closes on cleanup", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { unmount } = render(<RealtimeProvider><Consumer /><Consumer /></RealtimeProvider>);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/realtime");

    act(() => FakeEventSource.instances[0].open());
    act(() => FakeEventSource.instances[0].message({ type: "state.invalidated", id: "r-1", sequence: 1, occurredAt: new Date().toISOString(), data: { scope: "settings" } }));
    expect(screen.getAllByTestId("state")[0]).toHaveTextContent("open:1:settings");
    expect(screen.getAllByTestId("state")[1]).toHaveTextContent("open:1:settings");

    unmount();
    expect(FakeEventSource.instances[0].close).toHaveBeenCalledOnce();
  });
});
