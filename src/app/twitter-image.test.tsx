import { describe, expect, it } from "vitest";
import { alt, contentType, size } from "./twitter-image";

describe("Twitter image", () => {
  it("shares the fixed Open Graph image dimensions and alt text", () => {
    expect({ alt, contentType, size }).toEqual({
      alt: "Zplit shared expense ledger preview",
      contentType: "image/png",
      size: { width: 1200, height: 630 },
    });
  });
});
