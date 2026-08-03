import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("home page", () => {
  it("renders the foundation screen without starter branding", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Zplit" })).toBeInTheDocument();
    expect(screen.getByText("Keep track of what friends owe you.")).toBeInTheDocument();
    expect(screen.getByText(/personal expense and repayment tracker/i)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.body).not.toHaveTextContent(/get started by editing page\.tsx|vercel|next\.js/i);
  });
});
