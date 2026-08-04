import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OfflinePage from "./page";

describe("offline page", () => {
  it("explains the unavailable server without private ledger data", () => {
    render(<OfflinePage />);

    expect(screen.getByRole("heading", { name: "Zplit is offline." })).toBeInTheDocument();
    expect(screen.getByText(/cannot reach the server/i)).toBeInTheDocument();
    expect(screen.getByText(/financial records cannot be viewed or changed offline/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute("href", "/");
    expect(document.body).not.toHaveTextContent(/Rp|signed in|total|balance/i);
  });
});
