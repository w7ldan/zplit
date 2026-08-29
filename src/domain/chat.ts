export const CHAT_MESSAGE_MAX_LENGTH = 4000 as const;
export const CHAT_PAGE_SIZE = 50 as const;
export const CHAT_STATE_CHANGED_EVENT = "chat.state.changed" as const;

export type ChatScope =
  | { type: "organization"; id: string }
  | { type: "group"; id: string };

export class ChatInputError extends Error {
  constructor(readonly code: "empty" | "too_long") {
    super(code);
    this.name = "ChatInputError";
  }
}

export function normalizeChatMessageBody(value: unknown) {
  if (typeof value !== "string") throw new ChatInputError("empty");
  const body = value.trim();
  if (!body) throw new ChatInputError("empty");
  if (body.length > CHAT_MESSAGE_MAX_LENGTH) throw new ChatInputError("too_long");
  return body;
}
