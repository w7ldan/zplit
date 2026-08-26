import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { InboxControl } from "./inbox-control";
import { InboxLiveRefresh } from "./inbox-live-refresh";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), router: { refresh: vi.fn() } }));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  constructor() {
    FakeEventSource.instances.push(this);
  }
  close() {}
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  mocks.refresh.mockReset();
  mocks.router.refresh = mocks.refresh;
});

afterEach(() => vi.unstubAllGlobals());

describe("InboxControl", () => {
  it("uses the shared realtime provider and caps the accessible unread count", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unreadCount: 123 }) }));
    render(<RealtimeProvider><InboxControl initialUnreadCount={123} active /></RealtimeProvider>);
    const control = screen.getByRole("link", { name: "Inbox, 123 unread" });
    expect(control).toHaveAttribute("href", "/app/inbox");
    expect(control).toHaveAttribute("aria-current", "page");
    expect(control).toHaveTextContent("99+");
  });

  it("leaves zero unread visually quiet", () => {
    render(<RealtimeProvider><InboxControl initialUnreadCount={0} /></RealtimeProvider>);
    expect(screen.getByRole("link", { name: "Inbox" })).not.toHaveTextContent("99+");
    expect(document.querySelector(".inbox-control__count")).not.toBeInTheDocument();
  });

  it("refetches canonical unread state after a notification event", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ unreadCount: 0 }) })
      .mockResolvedValue({ ok: true, json: async () => ({ unreadCount: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<RealtimeProvider><InboxControl initialUnreadCount={0} /></RealtimeProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    act(() => FakeEventSource.instances[0]!.message({ type: "notification.state.changed", id: "r-1", sequence: 1, occurredAt: new Date().toISOString(), data: { reason: "created" } }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Inbox, 1 unread" })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes an open Inbox for notification events and reconnects", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    render(<RealtimeProvider><InboxLiveRefresh /></RealtimeProvider>);
    act(() => FakeEventSource.instances[0]!.message({ type: "notification.state.changed", id: "r-1", sequence: 1, occurredAt: new Date().toISOString(), data: { reason: "created" } }));
    expect(mocks.refresh).toHaveBeenCalledOnce();

    act(() => FakeEventSource.instances[0]!.onopen?.());
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
});
