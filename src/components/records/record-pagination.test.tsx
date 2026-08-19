import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecordPagination } from "./record-pagination";

describe("RecordPagination", () => {
  it("shows a bounded range and preserves filters and unrelated params", () => {
    render(<RecordPagination page={2} pageSize={20} totalItems={73} totalPages={4} href="/app/expenses?q=Dinner&assignment=assigned&create=1" />);

    expect(screen.getByRole("navigation", { name: "Record pages" })).toHaveTextContent("Page 2 of 4");
    expect(screen.getByText("21–40 of 73")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/app/expenses?q=Dinner&assignment=assigned&create=1&page=1#record-list");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/app/expenses?q=Dinner&assignment=assigned&create=1&page=3#record-list");
  });

  it("uses noninteractive text at page boundaries and stays hidden for one page", () => {
    const { rerender } = render(<RecordPagination page={1} pageSize={20} totalItems={21} totalPages={2} href="/app/friends" />);
    expect(screen.queryByRole("link", { name: "Previous" })).not.toBeInTheDocument();
    expect(screen.getByText("Previous")).toHaveAttribute("aria-disabled", "true");
    rerender(<RecordPagination page={1} pageSize={20} totalItems={20} totalPages={1} href="/app/friends" />);
    expect(screen.queryByRole("navigation", { name: "Record pages" })).not.toBeInTheDocument();
  });

  it("can write a detail-page parameter without changing the default", () => {
    render(<RecordPagination page={1} pageSize={20} totalItems={21} totalPages={2} href="/app/friends/123?repaymentPage=3" anchor="friend-expense-shares" pageParam="expensePage" />);

    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/app/friends/123?repaymentPage=3&expensePage=2#friend-expense-shares");
  });
});
