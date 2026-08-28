import { describe, expect, it } from "vitest";
import { assertPlainDto } from "./assert-plain-dto";

describe("assertPlainDto", () => {
  it("accepts nested transport data", () => {
    expect(() => assertPlainDto({ id: "group-a", capabilities: { canDelete: false }, rows: [{ amount: 10 }] })).not.toThrow();
  });

  it.each([
    ["function", { canDelete: () => true }],
    ["symbol", { value: Symbol("runtime") }],
    ["class instance", new Date("2026-08-28T00:00:00Z")],
    ["undefined", { value: undefined }],
  ])("rejects %s values", (_label, value) => {
    expect(() => assertPlainDto(value)).toThrow();
  });

  it("rejects circular data", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => assertPlainDto(value)).toThrow(/circular/);
  });
});
