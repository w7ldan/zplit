import type { ChatScope } from "./chat";

export type ChatMessageDto = {
  id: string;
  body: string | null;
  deleted: boolean;
  edited: boolean;
  createdAt: string;
  sender: {
    userId: string;
    displayName: string;
    customAvatar: { sha256: string } | null;
  };
  own: boolean;
  grouped: boolean;
  canEdit: boolean;
  canDelete: boolean;
  seenByCount: number;
  seenBy: string[];
};

export type ChatViewDto = {
  scope: ChatScope;
  threadId: string | null;
  messages: ChatMessageDto[];
  nextCursor: string | null;
  unreadCount: number;
  latestVisibleMessageId: string | null;
  canSend: boolean;
  canModerate: boolean;
};

export type ChatActionState = {
  error: string;
  values: { body: string };
  success?: boolean;
};
