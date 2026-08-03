import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("combines conditional class names", () => {
    expect(cn("text-sm", false && "hidden", "font-medium")).toBe("text-sm font-medium");
  });

  it("keeps the final conflicting Tailwind utility", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
