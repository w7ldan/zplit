import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatViewDto } from "@/domain/chat-contracts";

vi.mock("server-only", () => ({}));
vi.mock("@/app/app/chat-actions", () => ({
  deleteChatMessageAction: vi.fn(),
  editChatMessageAction: vi.fn(),
  markChatReadAction: vi.fn(async () => false),
  sendChatMessageAction: vi.fn(),
}));
import { editChatMessageAction, markChatReadAction } from "@/app/app/chat-actions";
import { ChatPanel } from "./chat-panel";

const chatStyles = readFileSync("src/app/styles/30-records-and-forms.css", "utf8");

const organizationChat: ChatViewDto = {
  scope: { type: "organization", id: "org-a" },
  threadId: "thread-a",
  canSend: true,
  canModerate: true,
  nextCursor: "older",
  unreadCount: 0,
  latestVisibleMessageId: "message-d",
  messages: [
    { id: "message-a", body: "Hello\nthere", deleted: false, edited: true, createdAt: "2026-08-29T10:00:00.000Z", sender: { userId: "user-a", displayName: "Alice", customAvatar: null }, own: true, grouped: false, canEdit: true, canDelete: true, seenByCount: 0, seenBy: ["Bob"] },
    { id: "message-b", body: "Second", deleted: false, edited: false, createdAt: "2026-08-29T10:01:00.000Z", sender: { userId: "user-a", displayName: "Alice", customAvatar: null }, own: true, grouped: true, canEdit: true, canDelete: true, seenByCount: 1, seenBy: ["Bob"] },
    { id: "message-c", body: null, deleted: true, edited: false, createdAt: "2026-08-29T10:02:00.000Z", sender: { userId: "user-b", displayName: "Bob", customAvatar: null }, own: false, grouped: false, canEdit: false, canDelete: false, seenByCount: 0, seenBy: [] },
    { id: "message-d", body: "Latest", deleted: false, edited: false, createdAt: "2026-08-29T10:03:00.000Z", sender: { userId: "user-b", displayName: "Bob", customAvatar: null }, own: false, grouped: false, canEdit: false, canDelete: true, seenByCount: 1, seenBy: [] },
  ],
};

describe("ChatPanel", () => {
  it("renders identity, own/other grouping, moderation, tombstones, and older history", () => {
    const { container } = render(<ChatPanel chat={organizationChat} title="General" olderHref="/app/organizations/org-a/general?before=older#chat" />);

    expect(screen.getByRole("heading", { level: 1, name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Older messages" })).toHaveAttribute("href", "/app/organizations/org-a/general?before=older#chat");
    expect(screen.getByText((text) => text.includes("Hello") && text.includes("there"))).toBeInTheDocument();
    expect(screen.getByText("Message deleted")).toBeInTheDocument();
    expect(screen.getByText("Edited")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Delete/ })).toHaveLength(3);
    expect(container.querySelectorAll(".chat-message--own")).toHaveLength(2);
    expect(container.querySelectorAll(".chat-message--other")).toHaveLength(2);
    expect(container.querySelectorAll(".chat-message--grouped")).toHaveLength(1);
    expect(container.querySelectorAll(".chat-message--grouped .user-avatar")).toHaveLength(0);
    expect(container.querySelectorAll(".user-avatar__default")).toHaveLength(3);
    expect(screen.getAllByText("Seen by...")).toHaveLength(3);
    expect(screen.getByText("Seen by 1")).toBeInTheDocument();
    expect(screen.queryByText("Seen by 0")).not.toBeInTheDocument();
  });

  it("pins the own avatar and bubble to the same CSS grid row", () => {
    expect(chatStyles).toMatch(/\.chat-message--own \.chat-message__content \{[^}]*grid-row: 1;/);
    expect(chatStyles).toMatch(/\.chat-message--own > \.user-avatar \{[^}]*grid-row: 1;/);
  });

  it("marks the newest rendered message only", async () => {
    vi.mocked(markChatReadAction).mockClear();
    render(<ChatPanel chat={organizationChat} title="General" olderHref={null} />);
    await waitFor(() => expect(markChatReadAction).toHaveBeenCalledWith(organizationChat.scope, "message-d"));

    vi.mocked(markChatReadAction).mockClear();
    const olderChat = { ...organizationChat, latestVisibleMessageId: "message-c", messages: organizationChat.messages.slice(0, 3) };
    render(<ChatPanel chat={olderChat} title="General" olderHref={null} />);
    await waitFor(() => expect(markChatReadAction).toHaveBeenCalledWith(olderChat.scope, "message-c"));
    expect(markChatReadAction).not.toHaveBeenCalledWith(olderChat.scope, "message-d");
  });

  it("renders Group Chat with a usable composer", () => {
    const chat = { ...organizationChat, scope: { type: "group", id: "group-a" } as const, canModerate: false };
    render(<ChatPanel chat={chat} title="Chat" olderHref={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Chat messages" })).getByText("Alice")).toBeInTheDocument();
  });

  it("passes an authorized custom avatar through to UserAvatar", () => {
    const avatar = { sha256: "a".repeat(64) };
    const chat = {
      ...organizationChat,
      messages: organizationChat.messages.map((message) => message.id === "message-c" ? { ...message, sender: { ...message.sender, customAvatar: avatar } } : message),
    };
    const { container } = render(<ChatPanel chat={chat} title="General" olderHref={null} />);

    expect(container.querySelector(`img[src="/app/avatar?userId=user-b&v=${avatar.sha256}"]`)).toBeInTheDocument();
  });

  it("closes Edit mode after a successful save and shows the updated message row", async () => {
    vi.mocked(editChatMessageAction).mockResolvedValueOnce({
      error: "",
      values: { body: "Updated message" },
      success: true,
    });
    const { rerender } = render(<ChatPanel chat={organizationChat} title="General" olderHref={null} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const editForm = screen.getByRole("textbox", { name: "Edit message" }).closest("form");
    if (!editForm) throw new Error("edit form is missing");
    fireEvent.change(screen.getByRole("textbox", { name: "Edit message" }), { target: { value: "Updated message" } });
    fireEvent.submit(editForm);

    await waitFor(() => expect(editChatMessageAction).toHaveBeenCalledOnce());
    expect(vi.mocked(editChatMessageAction).mock.calls[0]?.[3].get("body")).toBe("Updated message");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Edit message" })).not.toBeInTheDocument());

    const updatedChat = {
      ...organizationChat,
      messages: organizationChat.messages.map((message) => (
        message.id === "message-a" ? { ...message, body: "Updated message" } : message
      )),
    };
    rerender(<ChatPanel chat={updatedChat} title="General" olderHref={null} />);
    expect(screen.getByText("Updated message")).toBeInTheDocument();
  });

  it("keeps Edit mode open and shows the error after a failed save", async () => {
    vi.mocked(editChatMessageAction).mockResolvedValueOnce({
      error: "That message is no longer available.",
      values: { body: "Draft message" },
    });
    render(<ChatPanel chat={organizationChat} title="General" olderHref={null} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const editBox = screen.getByRole("textbox", { name: "Edit message" });
    fireEvent.change(editBox, { target: { value: "Draft message" } });
    fireEvent.submit(editBox.closest("form")!);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That message is no longer available."));
    expect(screen.getByRole("textbox", { name: "Edit message" })).toHaveValue("Draft message");
  });
});
