import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/personal/groups/group-a/expenses" }));

import { GroupNavigation } from "./group-detail";

describe("GroupNavigation", () => {
  it("places Expenses in the Group context navigation", () => {
    render(<GroupNavigation groupId="group-a" canManageGroup />);
    const navigation = screen.getByRole("navigation", { name: "Group navigation" });
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual(["Overview", "Chat", "Expenses", "Payments", "People", "Settings"]);
    expect(within(navigation).getByRole("link", { name: "Expenses" })).toHaveAttribute("href", "/app/personal/groups/group-a/expenses");
    expect(navigation.querySelector(".chat-unread-badge")).not.toBeInTheDocument();
  });

  it("shows a restrained unread badge only when Chat has unread messages", () => {
    render(<GroupNavigation groupId="group-a" canManageGroup={false} chatUnreadCount={123} />);
    const chat = within(screen.getByRole("navigation", { name: "Group navigation" })).getByRole("link", { name: "Chat, 123 unread" });
    expect(chat).toHaveTextContent("99+");
    expect(chat.querySelector(".chat-unread-badge")).toBeInTheDocument();
  });
});
