"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/auth/require-session";
import { ChatInputError, type ChatScope } from "@/domain/chat";
import type { ChatActionState } from "@/domain/chat-contracts";
import { ChatError, deleteChatMessage, editChatMessage, sendChatMessage } from "@/server/chat";
import { getDatabase } from "@/db/client";

function chatPath(scope: ChatScope) {
  return scope.type === "organization"
    ? `/app/organizations/${scope.id}/general`
    : `/app/personal/groups/${scope.id}/chat`;
}

function valuesFromForm(formData: FormData) {
  return { body: typeof formData.get("body") === "string" ? String(formData.get("body")) : "" };
}

function errorMessage(error: unknown) {
  if (error instanceof ChatInputError) return error.code === "too_long" ? "Messages must be 4,000 characters or fewer." : "Write a message before sending.";
  if (error instanceof ChatError) {
    return {
      invalid_id: "This chat is unavailable.",
      not_found: "This chat is unavailable.",
      message_not_found: "That message is no longer available.",
      forbidden: "You do not have permission to change that message.",
      invalid_cursor: "Older messages are unavailable. Reload the chat.",
      deleted: "Deleted messages cannot be edited.",
      not_member: "You are no longer a member of this Group.",
    }[error.code];
  }
  return "Unable to update the chat.";
}

export async function sendChatMessageAction(scope: ChatScope, _previousState: ChatActionState, formData: FormData): Promise<ChatActionState> {
  const values = valuesFromForm(formData);
  const session = await requireSession();
  try {
    await sendChatMessage(getDatabase(), { scope, userId: session.user.id, body: values.body });
  } catch (error) {
    return { error: errorMessage(error), values };
  }
  revalidatePath(chatPath(scope));
  return { error: "", values: { body: "" } };
}

export async function editChatMessageAction(scope: ChatScope, messageId: string, _previousState: ChatActionState, formData: FormData): Promise<ChatActionState> {
  const values = valuesFromForm(formData);
  const session = await requireSession();
  try {
    await editChatMessage(getDatabase(), { scope, messageId, userId: session.user.id, body: values.body });
  } catch (error) {
    return { error: errorMessage(error), values };
  }
  revalidatePath(chatPath(scope));
  return { error: "", values, success: true };
}

export async function deleteChatMessageAction(scope: ChatScope, messageId: string, _formData: FormData) {
  const session = await requireSession();
  try {
    await deleteChatMessage(getDatabase(), { scope, messageId, userId: session.user.id });
  } catch {
    // The canonical chat read after revalidation remains authoritative.
  }
  revalidatePath(chatPath(scope));
}
