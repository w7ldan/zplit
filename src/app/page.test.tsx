import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("public Zplit page", () => {
  it("renders the product story without motion-dependent content", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Record shared money. See what remains." })).toBeInTheDocument();
    const navigation = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    for (const [name, href] of [["The record", "#record"], ["Contexts", "#contexts"], ["Privacy", "#private"]] as const) {
      expect(navigation.getByRole("link", { name })).toHaveAttribute("href", href);
      expect(document.querySelector(href)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("link", { name: "Open Zplit" })).toHaveLength(3);
    for (const link of screen.getAllByRole("link", { name: "Open Zplit" })) expect(link).toHaveAttribute("href", "/app");
    expect(screen.getByRole("heading", { level: 2, name: "One record. Clearly followed." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Use the structure the money needs." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Keep the question attached to the record." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "The ledger stays private by default." })).toBeInTheDocument();
    expect(screen.getByText("Personal", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Groups", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Organizations", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Budget stays private/)).toBeInTheDocument();
    expect(screen.getByText(/receipt supports context/i)).toBeInTheDocument();
    expect(screen.getByText(/temporary, read-only link/i)).toBeInTheDocument();
    expect(document.querySelectorAll(".public-vnext__flow-step")).toHaveLength(4);
    expect(document.querySelectorAll(".public-vnext__money").length).toBeGreaterThan(4);
  });

  it("keeps the public implementation static, scoped, and motion-safe", () => {
    const landingSource = readFileSync(path.resolve(process.cwd(), "src/components/editorial/public-landing.tsx"), "utf8");
    const styles = readFileSync(path.resolve(process.cwd(), "src/app/styles/70-public-auth-vnext.css"), "utf8");
    expect(landingSource).not.toMatch(/PublicMotion|ScrollTrigger|Observer|ScrollToPlugin|Flip|gsap|wheel|pointermove|mousemove/);
    expect(styles).toContain(".public-vnext");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).not.toMatch(/gradient|backdrop-filter|box-shadow:\s*0|perspective|Three\.js/i);
  });
});
