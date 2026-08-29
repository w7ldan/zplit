import { describe, expect, it } from "vitest";
import { ChatInputError, normalizeChatMessageBody } from "./chat";

describe("chat message contract", () => {
  it("trims valid plain text and preserves internal line breaks", () => {
    expect(normalizeChatMessageBody("  first\nsecond  ")).toBe("first\nsecond");
  });

  it.each(["", " \n\t", "x".repeat(4001)])("rejects invalid message bodies", (body) => {
    expect(() => normalizeChatMessageBody(body)).toThrow(ChatInputError);
  });
});
