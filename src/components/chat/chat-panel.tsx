"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/identity/user-avatar";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import type { ChatScope } from "@/domain/chat";
import type { ChatActionState, ChatMessageDto, ChatViewDto } from "@/domain/chat-contracts";
import { deleteChatMessageAction, editChatMessageAction, markChatReadAction, sendChatMessageAction } from "@/app/app/chat-actions";

const emptyState: ChatActionState = { error: "", values: { body: "" } };

function scopeMessageId(scope: ChatScope) {
  return scope.type === "organization" ? `organization-chat-${scope.id}` : `group-chat-${scope.id}`;
}

function ChatEditForm({
  scope,
  message,
  onCancel,
  onSuccess,
}: {
  scope: ChatScope;
  message: ChatMessageDto;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, action] = useActionState(
    editChatMessageAction.bind(null, scope, message.id),
    { error: "", values: { body: message.body ?? "" }, success: false },
  );

  useEffect(() => {
    if (state.success) onSuccess();
  }, [onSuccess, state.success]);

  return (
    <form className="chat-message__edit" action={action}>
      <label className="visually-hidden" htmlFor={`chat-edit-${message.id}`}>
        Edit message
      </label>
      <textarea
        id={`chat-edit-${message.id}`}
        name="body"
        defaultValue={state.values.body}
        maxLength={4000}
        rows={3}
        required
      />
      {state.error ? <p className="chat__form-message" role="alert">{state.error}</p> : null}
      <div className="chat-message__actions">
        <button className="action-link action-link--primary" type="submit">Save</button>
        <button className="text-link" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ChatMessage({ scope, message, latestVisible, onEdit }: { scope: ChatScope; message: ChatMessageDto; latestVisible: boolean; onEdit: (id: string) => void }) {
  const hasActions = message.canEdit || message.canDelete || !latestVisible;
  const seenBy = message.seenBy ?? [];
  return (
    <li className={`chat-message ${message.own ? "chat-message--own" : "chat-message--other"} ${message.grouped ? "chat-message--grouped" : ""}`}>
      {!message.grouped ? (
        <UserAvatar
          userId={message.sender.userId}
          customAvatar={message.sender.customAvatar}
          size="sm"
          alt={`${message.sender.displayName} avatar`}
        />
      ) : null}
      <article className="chat-message__content">
        {!message.grouped ? (
          <header className="chat-message__header">
            <strong>{message.sender.displayName}</strong>
            <LocalDateTime iso={message.createdAt} />
          </header>
        ) : (
          <LocalDateTime iso={message.createdAt} />
        )}
        {message.body === null ? (
          <p className="chat-message__body chat-message__body--deleted">Message deleted</p>
        ) : (
          <p className="chat-message__body">{message.body}</p>
        )}
        {message.edited ? <span className="chat-message__edited">Edited</span> : null}
        {hasActions ? (
          <div className="chat-message__actions">
            {message.canEdit ? <button className="text-link" type="button" onClick={() => onEdit(message.id)}>Edit</button> : null}
            {message.canDelete ? (
              <form action={deleteChatMessageAction.bind(null, scope, message.id)}>
                <button className="text-link" type="submit">{message.own ? "Delete" : "Delete message"}</button>
              </form>
            ) : null}
            {!latestVisible ? (
              <details className="chat-message__details">
                <summary className="text-link">Seen by...</summary>
                {seenBy.length > 0 ? <ul>{seenBy.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul> : <span>No other readers yet.</span>}
              </details>
            ) : null}
          </div>
        ) : null}
        {latestVisible && (message.seenByCount ?? 0) > 0 ? <span className="chat-message__seen">Seen by {message.seenByCount}</span> : null}
      </article>
    </li>
  );
}

export function ChatPanel({ chat, title, olderHref }: { chat: ChatViewDto; title: string; olderHref: string | null }) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [state, action] = useActionState(sendChatMessageAction.bind(null, chat.scope), emptyState);
  const chatId = scopeMessageId(chat.scope);
  const newestRenderedMessageId = chat.messages.at(-1)?.id ?? null;
  const markedMessageKey = useRef<string | null>(null);
  const messageKey = chat.threadId && newestRenderedMessageId ? `${chat.threadId}:${newestRenderedMessageId}` : null;

  useEffect(() => {
    if (!messageKey || !newestRenderedMessageId || markedMessageKey.current === messageKey) return;
    markedMessageKey.current = messageKey;
    void markChatReadAction(chat.scope, newestRenderedMessageId).catch(() => undefined);
  }, [chat.scope, messageKey, newestRenderedMessageId]);

  return (
    <section className="app-page chat-page" id="chat">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">{title}</p>
            <h1>{title}</h1>
            <p className="app-page__lede">A shared plain-text conversation for this workspace.</p>
          </div>
        </header>
        <section className="chat" aria-labelledby={chatId}>
          <h2 className="visually-hidden" id={chatId}>{title} messages</h2>
          {olderHref ? (
            <Link className="chat__older" href={olderHref}>
              Older messages
            </Link>
          ) : null}
          {chat.messages.length ? (
            <ol className="chat__history" aria-label={`${title} messages`}>
              {chat.messages.map((message) => editingMessageId === message.id ? (
                <li className="chat-message" key={message.id}>
                  <ChatEditForm
                    scope={chat.scope}
                    message={message}
                    onCancel={() => setEditingMessageId(null)}
                    onSuccess={() => setEditingMessageId(null)}
                  />
                </li>
              ) : (
                <ChatMessage key={message.id} scope={chat.scope} message={message} latestVisible={message.id === chat.latestVisibleMessageId} onEdit={setEditingMessageId} />
              ))}
            </ol>
          ) : (
            <p className="chat__empty">No messages yet. Start the conversation.</p>
          )}
          {chat.canSend ? (
            <form className="chat__composer" action={action} key={`${state.values.body}\u0000${state.error}`}>
              <label htmlFor={`${chatId}-body`}>Message</label>
              <textarea id={`${chatId}-body`} name="body" defaultValue={state.values.body} maxLength={4000} rows={3} required placeholder="Write a message" />
              {state.error ? <p className="chat__form-message" role="alert">{state.error}</p> : null}
              <div className="chat__composer-actions">
                <span className="technical-label">PLAIN TEXT · 4,000 CHARACTERS</span>
                <button className="action-link action-link--primary" type="submit">Send</button>
              </div>
            </form>
          ) : (
            <p className="chat__read-only">You can read this conversation but cannot send messages.</p>
          )}
        </section>
      </div>
    </section>
  );
}
