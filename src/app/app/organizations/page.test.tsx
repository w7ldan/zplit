import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OrganizationsPage from "./page";

describe("/app/organizations", () => {
  it("renders the empty organization shell without organization data", () => {
    render(<OrganizationsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Organizations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Your organizations" })).toBeInTheDocument();
    expect(screen.getByText("No organizations yet.")).toBeInTheDocument();
    expect(document.querySelector(".organization-grid")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/schema|invite|member|accounting/i);
  });
});
