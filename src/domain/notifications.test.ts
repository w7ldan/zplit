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
});
