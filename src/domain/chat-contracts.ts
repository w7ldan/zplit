import type { ChatScope } from "./chat";

export type ChatMessageDto = {
  id: string;
  body: string | null;
  deleted: boolean;
  edited: boolean;
  createdAt: string;
  sender: {
    displayName: string;
    avatarSeed: string;
  };
  own: boolean;
  grouped: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export type ChatViewDto = {
  scope: ChatScope;
  threadId: string | null;
  messages: ChatMessageDto[];
  nextCursor: string | null;
  canSend: boolean;
  canModerate: boolean;
};

export type ChatActionState = {
  error: string;
  values: { body: string };
  success?: boolean;
};
