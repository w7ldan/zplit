import { describe, expect, it } from "vitest";
import { formatUserIdentity, formatUsername, parseUsername } from "./username";

describe("username domain", () => {
  it.each(["wildan", "w7ldan", "alice.tan", "bob_2026"])("accepts %s", (value) => {
    expect(parseUsername(value)).toEqual({ ok: true, value });
  });

  it("trims, accepts the display prefix, and normalizes case", () => {
    expect(parseUsername("  @Alice.Tan  ")).toEqual({ ok: true, value: "alice.tan" });
  });

  it.each(["ab", "a".repeat(21)])("rejects length %s", (value) => {
    expect(parseUsername(value)).toMatchObject({ ok: false });
  });

  it.each(["ab-1", "ab c", "ab+1", "ab/1"])("rejects unsupported characters in %s", (value) => {
    expect(parseUsername(value)).toMatchObject({ ok: false });
  });

  it.each([".alice", "alice.", "_alice", "alice_"])("rejects punctuation edges in %s", (value) => {
    expect(parseUsername(value)).toMatchObject({ ok: false });
  });

  it.each(["a..b", "a__b", "a._b", "a_.b"])("rejects consecutive punctuation in %s", (value) => {
    expect(parseUsername(value)).toMatchObject({ ok: false, error: "Username cannot contain consecutive punctuation." });
  });

  it.each(["admin", "administrator", "api", "app", "auth", "login", "logout", "signup", "settings", "support", "system", "zplit", "inbox", "notifications", "personal", "organizations", "groups", "share"])("rejects reserved name %s", (value) => {
    expect(parseUsername(value)).toMatchObject({ ok: false, error: "That username is reserved. Choose another." });
  });

  it("formats legacy and registered identities", () => {
    expect(formatUsername(null)).toBe("Not set");
    expect(formatUsername("wildan")).toBe("@wildan");
    expect(formatUserIdentity("Wildan", null)).toBe("Wildan");
    expect(formatUserIdentity("Wildan", "wildan")).toBe("Wildan @wildan");
  });
});
