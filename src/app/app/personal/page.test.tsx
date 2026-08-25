import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PersonalPage from "./page";

describe("/app/personal", () => {
  it("keeps the existing ledger destinations under Personal and leaves Groups empty", () => {
    render(<PersonalPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Personal" })).toBeInTheDocument();
    for (const [name, href] of [["Friends", "/app/friends"], ["Outings", "/app/outings"], ["Expenses", "/app/expenses"], ["Repayments", "/app/repayments"]]) {
      expect(screen.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href);
    }
    expect(screen.getByRole("heading", { level: 2, name: "Groups" })).toBeInTheDocument();
    expect(screen.getByText("Groups will live here when group accounting is available.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/organization record|member count|permission/i);
  });
});
