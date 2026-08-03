import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("public editorial page", () => {
  it("renders the public design contract without application controls", () => {
    render(<HomePage />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Keep track of what friends owe you." })).toBeInTheDocument();

    for (const label of ["Method", "Ledger", "System"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }

    for (const chapter of ["0", "1", "2", "3"]) {
      expect(screen.getByLabelText(new RegExp(`^Chapter ${chapter}:`))).toBeInTheDocument();
    }

    expect(screen.getByRole("link", { name: "Read the method" })).toHaveAttribute("href", "#method");
    expect(screen.getByRole("link", { name: "View the ledger study" })).toHaveAttribute("href", "#ledger");
    expect(screen.getByText("ILLUSTRATIVE INTERFACE DATA")).toBeInTheDocument();

    for (const value of ["Dinner", "Rani", "Rp 84.000", "OPEN", "Taxi", "Dimas", "Rp 42.500", "PART-PAID", "Tickets", "Naya", "Rp 160.000", "SETTLED"]) {
      expect(screen.getByText(value, { exact: true })).toBeInTheDocument();
    }

    expect(document.body).not.toHaveTextContent(/sign in|registration|register|log in/i);
    expect(document.body).not.toHaveTextContent(/get started by editing page\.tsx|vercel|next\.js/i);
  });
});
