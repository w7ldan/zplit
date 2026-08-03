import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppPage from "./page";

describe("/app", () => {
  it("renders a concise ledger index with direct friends, outings, and expenses actions", () => {
    render(<AppPage />);

    expect(screen.getByText("06 / LEDGER INDEX")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Your private record." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage friends" })).toHaveAttribute("href", "/app/friends");
    expect(screen.getByRole("link", { name: "Manage outings" })).toHaveAttribute("href", "/app/outings");
    expect(screen.getByRole("link", { name: "Manage expenses" })).toHaveAttribute("href", "/app/expenses");
    expect(document.body).not.toHaveTextContent(/balance|analytics|dashboard|chart/i);
  });
});
