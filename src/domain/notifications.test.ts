import { describe, expect, it } from "vitest";
import { normalizeNotificationMetadata, presentNotification } from "./notifications";

describe("notification catalog", () => {
  it("accepts only the bounded metadata for a known type", () => {
    expect(normalizeNotificationMetadata("system.test", { message: "  Ready  " })).toEqual({ message: "Ready" });
    expect(() => normalizeNotificationMetadata("system.test", { message: "" })).toThrow("Invalid metadata");
    expect(() => normalizeNotificationMetadata("system.test", { message: "x", unsafe: true })).toThrow("Invalid metadata");
    expect(() => normalizeNotificationMetadata("future.unknown" as never, { message: "nope" })).toThrow("Unsupported notification type");
  });

  it("falls back to escaped-by-React text for unsupported or malformed stored data", () => {
    expect(presentNotification("future.unknown", { html: "<img>" })).toEqual({ label: "Update", primary: "You have a new notification." });
    expect(presentNotification("system.test", { message: "<not html>" })).toEqual({ label: "System", primary: "<not html>" });
  });

  it("presents Friend-link requests without private account fields", () => {
    expect(presentNotification("friend.link.request", {
      requestId: "11111111-1111-4111-8111-111111111111",
      requesterDisplayName: "Owner",
      requesterUsername: "owner",
      friendName: "Office",
    })).toEqual({ label: "Friend link request", primary: "Owner @owner wants to link “Office”.", secondary: "Identity confirmation only." });
    expect(() => normalizeNotificationMetadata("friend.link.request", { requesterUsername: "owner", email: "owner@example.com" })).toThrow("Invalid metadata");
  });

  it("presents Organization invitations without accepting private fields", () => {
    const metadata = {
      invitationId: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      organizationName: "Zplit Team",
      inviterDisplayName: "Wildan",
      role: "treasurer",
      expiresAt: "2026-09-01T00:00:00.000Z",
    } as const;
    expect(presentNotification("organization.invitation", metadata)).toMatchObject({
      label: "Organization invitation",
      primary: "Wildan invited you to join Zplit Team as Treasurer.",
    });
    expect(() => normalizeNotificationMetadata("organization.invitation", { ...metadata, email: "private@example.com" })).toThrow("Invalid metadata");
    expect(() => normalizeNotificationMetadata("organization.invitation", { ...metadata, role: "owner" })).toThrow("Invalid metadata");
  });
});
