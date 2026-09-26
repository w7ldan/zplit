import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("public Zplit page", () => {
  it("shows one Bandung money trail and real navigation routes", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Money together.*Nothing lost between/,
      }),
    ).toBeInTheDocument();
    const hero = within(
      screen.getByRole("figure", {
        name: "Illustrative Bandung day out expense statement",
      }),
    );
    expect(hero.getByText("Rp 480.000")).toBeInTheDocument();
    expect(hero.getAllByText("Rp 160.000")).toHaveLength(3);
    expect(hero.getByText("Rp 220.000")).toBeInTheDocument();
    for (const href of ["#record", "#personal", "#groups", "#budget"]) {
      expect(document.querySelector(href)).toBeInTheDocument();
      expect(
        within(
          screen.getByRole("navigation", { name: "Primary navigation" }),
        ).getByRole("link", {
          name: {
            "#record": "How it works",
            "#personal": "Personal",
            "#groups": "Groups",
            "#budget": "Budget",
          }[href],
        }),
      ).toHaveAttribute("href", href);
    }
    for (const link of screen.getAllByRole("link", {
      name: /Have an invite\? Open Zplit/,
    }))
      expect(link).toHaveAttribute("href", "/login");
  });

  it("keeps cash, allocation, and remaining balance consistent", () => {
    render(<HomePage />);
    const story = within(
      screen.getByRole("region", { name: "Follow the money." }),
    );
    fireEvent.click(story.getByRole("button", { name: /03 Repayment/ }));
    expect(
      story.getByText("Rp100.000 received · Rp100.000 applied"),
    ).toBeInTheDocument();
    expect(story.getByText("Rp 220.000")).toBeInTheDocument();
    fireEvent.click(
      story.getByRole("checkbox", { name: "Show partial allocation" }),
    );
    expect(
      story.getByText(
        "Rp100.000 received · Rp80.000 applied · Rp20.000 needs allocation",
      ),
    ).toBeInTheDocument();
    expect(story.getByText("Rp 240.000")).toBeInTheDocument();
    expect(story.getAllByText("Rp 80.000")).toHaveLength(2);
    fireEvent.click(story.getByRole("button", { name: /04 Remaining/ }));
    expect(story.getAllByText(/Together that is Rp240.000/)).toHaveLength(2);
  });

  it("keeps Budget private and switches between shared spaces", () => {
    render(<HomePage />);
    const budget = within(
      screen.getByRole("region", { name: /Shared money.*Your own plan/ }),
    );
    expect(budget.getByText("Rp 1.720.000")).toBeInTheDocument();
    fireEvent.click(
      budget.getByRole("checkbox", { name: "Count this expense in Budget" }),
    );
    expect(budget.getByText("Rp 2.200.000")).toBeInTheDocument();
    expect(
      budget.getByText(/Rp220.000 still owed do not change/),
    ).toBeInTheDocument();
    const spaces = within(screen.getByRole("region", { name: "TOGETHER" }));
    expect(spaces.getByText("Pending confirmation")).toBeInTheDocument();
    fireEvent.click(spaces.getByRole("tab", { name: "Organizations" }));
    expect(spaces.getByText("Organization only")).toBeInTheDocument();
    expect(spaces.getByRole("tab", { name: "Organizations" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(spaces.getByRole("tab", { name: "Organizations" }), {
      key: "ArrowLeft",
    });
    expect(spaces.getByRole("tab", { name: "Groups" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("filters only the illustrative Personal rows", () => {
    render(<HomePage />);
    const personal = within(
      screen.getByRole("region", {
        name: /Your life doesn’t happen in one transaction/,
      }),
    );
    fireEvent.change(
      personal.getByRole("searchbox", { name: "Search this example" }),
      {
        target: { value: "Bima" },
      },
    );
    expect(personal.getByText("Bima")).toBeInTheDocument();
    expect(personal.queryByText("Alya")).not.toBeInTheDocument();
  });

  it("preserves the broad canvas and reduced-motion styles", () => {
    const styles = readFileSync(
      path.resolve(process.cwd(), "src/app/styles/70-public-auth-vnext.css"),
      "utf8",
    );
    expect(styles).toMatch(
      /\.public-vnext \.editorial-shell\s*\{[^}]*max-width: none;/,
    );
    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).toContain("@media (max-width: 420px)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).not.toMatch(
      /#FAF7F1|#211F1B|gradient|backdrop-filter|box-shadow:\s*0/i,
    );
  });
});
