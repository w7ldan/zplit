import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/personal/groups/group-a/expenses" }));

import { GroupNavigation } from "./group-detail";

describe("GroupNavigation", () => {
  it("places Expenses in the Group context navigation", () => {
    render(<GroupNavigation groupId="group-a" canManageGroup />);
    const navigation = screen.getByRole("navigation", { name: "Group navigation" });
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual(["Overview", "Expenses", "Payments", "People", "Settings"]);
    expect(within(navigation).getByRole("link", { name: "Expenses" })).toHaveAttribute("href", "/app/personal/groups/group-a/expenses");
  });
});
