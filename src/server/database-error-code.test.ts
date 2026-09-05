import { describe, expect, it } from "vitest";
import { databaseCode } from "./database-error-code";

describe("databaseCode", () => {
  it("preserves direct-code lookup without traversing causes by default", () => {
    for (const error of [null, undefined, "23505", 23505, { code: 23505 }, { cause: { code: "23505" } }]) {
      expect(databaseCode(error)).toBeUndefined();
    }
    expect(databaseCode({ code: "23505", cause: { code: "23514" } })).toBe("23505");
  });

  it("preserves recursive lookup and outer string-code precedence when requested", () => {
    expect(databaseCode({ cause: { code: 123, cause: { code: "23514" } } }, true)).toBe("23514");
    expect(databaseCode({ code: "", cause: { code: "23514" } }, true)).toBe("");
    expect(databaseCode({ cause: null }, true)).toBeUndefined();
  });
});
