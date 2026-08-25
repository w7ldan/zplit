import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { InboxControl } from "./inbox-control";

describe("InboxControl", () => {
  it("uses the shared realtime provider and caps the accessible unread count", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unreadCount: 123 }) }));
    render(<RealtimeProvider><InboxControl initialUnreadCount={123} active /></RealtimeProvider>);
    const control = screen.getByRole("link", { name: "Inbox, 123 unread" });
    expect(control).toHaveAttribute("href", "/app/inbox");
    expect(control).toHaveAttribute("aria-current", "page");
    expect(control).toHaveTextContent("99+");
    vi.unstubAllGlobals();
  });

  it("leaves zero unread visually quiet", () => {
    render(<RealtimeProvider><InboxControl initialUnreadCount={0} /></RealtimeProvider>);
    expect(screen.getByRole("link", { name: "Inbox" })).not.toHaveTextContent("99+");
    expect(document.querySelector(".inbox-control__count")).not.toBeInTheDocument();
  });
});
