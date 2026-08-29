import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatViewDto } from "@/domain/chat-contracts";

vi.mock("server-only", () => ({}));
vi.mock("@/app/app/chat-actions", () => ({
  deleteChatMessageAction: vi.fn(),
  editChatMessageAction: vi.fn(),
  sendChatMessageAction: vi.fn(),
}));
vi.mock("@/components/realtime/realtime-provider", () => ({
  useRealtime: () => ({ openCount: 0, subscribe: vi.fn(() => () => {}) }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { editChatMessageAction } from "@/app/app/chat-actions";
import { ChatPanel } from "./chat-panel";

const organizationChat: ChatViewDto = {
  scope: { type: "organization", id: "org-a" },
  threadId: "thread-a",
  canSend: true,
  canModerate: true,
  nextCursor: "older",
  messages: [
    { id: "message-a", body: "Hello\nthere", deleted: false, edited: true, createdAt: "2026-08-29T10:00:00.000Z", sender: { displayName: "Alice", avatarSeed: "user-a" }, own: true, grouped: false, canEdit: true, canDelete: true },
    { id: "message-b", body: "Second", deleted: false, edited: false, createdAt: "2026-08-29T10:01:00.000Z", sender: { displayName: "Alice", avatarSeed: "user-a" }, own: true, grouped: true, canEdit: true, canDelete: true },
    { id: "message-c", body: "Please remove", deleted: false, edited: false, createdAt: "2026-08-29T10:02:00.000Z", sender: { displayName: "Bob", avatarSeed: "user-b" }, own: false, grouped: false, canEdit: false, canDelete: true },
    { id: "message-d", body: null, deleted: true, edited: false, createdAt: "2026-08-29T10:03:00.000Z", sender: { displayName: "Bob", avatarSeed: "user-b" }, own: false, grouped: false, canEdit: false, canDelete: false },
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
    expect(screen.queryByText(/unread|seen by|receipt/i)).not.toBeInTheDocument();
  });

  it("renders Group Chat with a usable composer", () => {
    const chat = { ...organizationChat, scope: { type: "group", id: "group-a" } as const, canModerate: false };
    render(<ChatPanel chat={chat} title="Chat" olderHref={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Chat messages" })).getByText("Alice")).toBeInTheDocument();
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
