import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("Money Trail landing", () => {
  it("renders the complete example and real invite-only entry route", () => {
    render(<HomePage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Money together.Nothing lost between.",
    );
    const hero = within(
      screen.getByRole("figure", {
        name: "Illustrative Bandung day out expense statement",
      }),
    );
    expect(hero.getByText("Rp 480.000")).toBeInTheDocument();
    expect(hero.getAllByText("Rp 160.000")).toHaveLength(3);
    expect(hero.getByText("Rp 220.000")).toBeInTheDocument();
    expect(hero.getByText("Illustrative example")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", {
      name: /Have an invite\? Open Zplit/,
    }))
      expect(link).toHaveAttribute("href", "/login");
  });

  it("offers the same section links from the compact header menu", () => {
    render(<HomePage />);
    fireEvent.click(screen.getByText("Menu"));
    const mobile = within(
      screen.getByRole("navigation", { name: "Mobile section navigation" }),
    );
    expect(mobile.getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "#record",
    );
    expect(mobile.getByRole("link", { name: "Budget" })).toHaveAttribute(
      "href",
      "#budget",
    );
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("keeps repayment cash, allocation, and balance consistent", () => {
    render(<HomePage />);
    const story = within(
      screen.getByRole("region", { name: "Follow the money" }),
    );
    fireEvent.click(story.getByRole("button", { name: /03 \/ Repayment/ }));
    expect(
      story.getByText("Rp100.000 received · Rp100.000 applied"),
    ).toBeInTheDocument();
    expect(story.getByText("Rp 220.000")).toBeInTheDocument();
    fireEvent.click(
      story.getByRole("checkbox", { name: "Show partial allocation" }),
    );
    expect(story.getByText(/Rp20.000 needs allocation/)).toBeInTheDocument();
    expect(story.getByText("Rp 240.000")).toBeInTheDocument();
    expect(story.getAllByText("Rp 80.000")).toHaveLength(2);
  });

  it("keeps Budget private and shared space statuses truthful", () => {
    render(<HomePage />);
    const budget = within(
      screen.getByRole("region", { name: "Shared money. Your own plan." }),
    );
    expect(budget.getByText("Rp 1.280.000")).toBeInTheDocument();
    fireEvent.click(
      budget.getByRole("checkbox", { name: "Count this expense in Budget" }),
    );
    expect(budget.getByText("Rp 800.000")).toBeInTheDocument();
    expect(
      budget.getByText(/Alya’s Rp60.000 and Bima’s Rp160.000 remain owed/),
    ).toBeInTheDocument();
    const spaces = within(screen.getByRole("region", { name: "TOGETHER" }));
    expect(spaces.getByText("Pending confirmation")).toBeInTheDocument();
    fireEvent.click(spaces.getByRole("tab", { name: "Organizations" }));
    expect(spaces.getByText("Organization only")).toBeInTheDocument();
    fireEvent.keyDown(spaces.getByRole("tab", { name: "Organizations" }), {
      key: "ArrowLeft",
    });
    expect(spaces.getByRole("tab", { name: "Groups" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("filters illustrative Personal records and keeps public scope narrow", () => {
    render(<HomePage />);
    const personal = within(
      screen.getByRole("region", {
        name: /Your life doesn’t happen in one transaction/,
      }),
    );
    fireEvent.change(
      personal.getByRole("searchbox", { name: "Search this example" }),
      { target: { value: "Bima" } },
    );
    expect(personal.getByText("Bima")).toBeInTheDocument();
    expect(personal.queryByText("Alya")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Alya’s temporary statement"));
    const share = within(
      screen.getByRole("article", {
        name: "Illustrative public statement for Alya",
      }),
    );
    expect(share.getByText("Rp 60.000")).toBeInTheDocument();
    expect(share.queryByText("Bima")).not.toBeInTheDocument();
  });

  it("has responsive and reduced-motion styling without old landing selectors", () => {
    const css = readFileSync("src/app/styles/75-money-trail.css", "utf8");
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain("@media (max-width: 420px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toMatch(
      /#FAF7F1|#211F1B|gradient|backdrop-filter|box-shadow/i,
    );
  });
});
