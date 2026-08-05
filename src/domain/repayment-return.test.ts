import { describe, expect, it } from "vitest";
import { addFriendToRepaymentReturnTarget, validateRepaymentReturnTarget } from "./repayment-return";

describe("repayment return targets", () => {
  it("accepts the repayment list route and preserves query and hash", () => {
    const target = "/app/repayments?q=Cash&source=ledger#top";
    expect(validateRepaymentReturnTarget(target)).toBe(target);
  });

  it("sets create and the new friend without trusting prior values", () => {
    expect(addFriendToRepaymentReturnTarget("/app/repayments?q=Cash&create=0&friendId=old#top", "friend-new"))
      .toBe("/app/repayments?q=Cash&create=1&friendId=friend-new#top");
  });

  it("rejects unsafe, malformed, wrong-route, and oversized targets", () => {
    for (const target of [
      "https://evil.example/app/repayments",
      "//evil.example/app/repayments",
      "/app",
      "/app/friends",
      "/app/repayments/anything",
      "/app/repayments\\\\evil.example",
      "/app/repayments?next=%5C%5Cevil.example",
      "/app/repayments?next=%255c%255cevil.example",
      "/app/repayments?next=%0a",
      "/app/repayments?bad=%",
      "/app/repayments?bad=%2G",
      "/app/repayments?bad=%C0%AF",
      "/app/repayments?bad=\n",
      `/app/repayments?x=${"a".repeat(2048)}`,
      "http://[",
    ]) expect(validateRepaymentReturnTarget(target)).toBeUndefined();
    expect(validateRepaymentReturnTarget(null)).toBeUndefined();
  });
});
