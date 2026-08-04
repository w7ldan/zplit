import { describe, expect, it } from "vitest";
import { isSameOriginRequest, normalizeOrigin } from "./same-origin-request";

describe("same-origin receipt requests", () => {
  it("normalizes valid origins and rejects malformed values", () => {
    expect(normalizeOrigin("https://zplit.test:443/")).toBe("https://zplit.test");
    expect(normalizeOrigin("https://zplit.test/path")).toBeNull();
    expect(normalizeOrigin("null")).toBeNull();
    expect(normalizeOrigin(null)).toBeNull();
  });

  it("requires an Origin that matches the configured origin", () => {
    expect(isSameOriginRequest(new Request("https://zplit.test/app", { headers: { Origin: "https://zplit.test" } }), "https://zplit.test")).toBe(true);
    expect(isSameOriginRequest(new Request("https://zplit.test/app"), "https://zplit.test")).toBe(false);
    expect(isSameOriginRequest(new Request("https://zplit.test/app", { headers: { Origin: "https://other.test" } }), "https://zplit.test")).toBe(false);
    expect(isSameOriginRequest(new Request("https://zplit.test/app", { headers: { Origin: "https://zplit.test/path" } }), "https://zplit.test")).toBe(false);
  });
});
