import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("public Zplit page", () => {
  it("shows the record-led story and keeps navigation anchored", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: /Record shared money.*See what remains/ })).toBeInTheDocument();
    const navigation = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    for (const [name, href] of [["The record", "#record"], ["Contexts", "#contexts"], ["Privacy", "#private"]] as const) {
      expect(navigation.getByRole("link", { name })).toHaveAttribute("href", href);
      expect(document.querySelector(href)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("link", { name: "Open Zplit" })).toHaveLength(3);
    for (const link of screen.getAllByRole("link", { name: "Open Zplit" })) expect(link).toHaveAttribute("href", "/app");
    expect(screen.getByRole("heading", { level: 2, name: /One payment.*The whole story/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Money moves differently.*with different people/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Your record.*Their balance/ })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(8);
    expect(document.querySelectorAll(".public-vnext__step")).toHaveLength(3);
    expect(document.querySelectorAll(".public-vnext__context")).toHaveLength(3);
  });

  it("keeps the Saturday market figures consistent from hero to public balance", () => {
    render(<HomePage />);
    const hero = within(screen.getByRole("article", { name: "Illustrative personal expense record" }));
    expect(hero.getByText("Rp 360.000")).toBeInTheDocument();
    expect(hero.getByText("Rp 120.000")).toBeInTheDocument();
    expect(hero.getAllByText("Rp 90.000")).toHaveLength(2);
    expect(hero.getByText("Rp 150.000")).toBeInTheDocument();
    expect(hero.getByText("Still owes you")).toBeInTheDocument();
    const comparison = within(screen.getByLabelText("Illustrative owner view and Sari balance link"));
    expect(comparison.getByText("Your private view")).toBeInTheDocument();
    expect(comparison.getByText("Sari’s public balance link")).toBeInTheDocument();
    expect(comparison.getByText("No sign-in needed.", { exact: false })).toBeInTheDocument();
    expect(comparison.getByText("Other Personal records")).toBeInTheDocument();
  });

  it("keeps the public implementation static and motion-safe", () => {
    const landingSource = readFileSync(path.resolve(process.cwd(), "src/components/editorial/public-landing.tsx"), "utf8");
    const styles = readFileSync(path.resolve(process.cwd(), "src/app/styles/70-public-auth-vnext.css"), "utf8");
    expect(landingSource).not.toMatch(/PublicMotion|ScrollTrigger|Observer|ScrollToPlugin|Flip|gsap|wheel|pointermove|mousemove/);
    expect(styles).toContain(".public-vnext");
    expect(styles).toContain("@media (max-width: 420px)");
    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("background: var(--vnext-surface)");
    expect(styles).not.toMatch(/#FAF7F1|#211F1B/i);
    expect(styles).not.toMatch(/gradient|backdrop-filter|box-shadow:\s*0|perspective|Three\.js/i);
  });
});
