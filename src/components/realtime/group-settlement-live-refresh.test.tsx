import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeProvider } from "./realtime-provider";
import { GroupSettlementLiveRefresh } from "./group-settlement-live-refresh";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

class FakeEventSource {
  static instance: FakeEventSource | undefined;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;

  constructor() {
    FakeEventSource.instance = this;
  }

  close() {}

  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

afterEach(() => {
  refresh.mockReset();
  FakeEventSource.instance = undefined;
  vi.unstubAllGlobals();
});

describe("GroupSettlementLiveRefresh", () => {
  it("refreshes matching settlement events through the existing shared provider", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    render(
      <RealtimeProvider>
        <GroupSettlementLiveRefresh
          groupId="group-a"
          settlementId="settlement-a"
        />
      </RealtimeProvider>,
    );
    act(() => FakeEventSource.instance?.message({
      type: "group.settlement.changed",
      id: "r-1",
      sequence: 1,
      occurredAt: new Date().toISOString(),
      data: { groupId: "group-a", settlementId: "settlement-a", state: "confirmed" },
    }));
    expect(refresh).toHaveBeenCalledOnce();
    act(() => FakeEventSource.instance?.message({
      type: "group.settlement.changed",
      id: "r-2",
      sequence: 2,
      occurredAt: new Date().toISOString(),
      data: { groupId: "group-a", settlementId: "settlement-b", state: "pending" },
    }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
