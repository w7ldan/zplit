import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("public Zplit page", () => {
  it("renders the motion piece's essential narrative independently of animation", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Make the number make sense." })).toBeInTheDocument();
    const navigation = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    expect(navigation.getByRole("link", { name: "The record" })).toHaveAttribute("href", "#record-flow");
    expect(navigation.getByRole("link", { name: "Contexts" })).toHaveAttribute("href", "#contexts");
    expect(navigation.getByRole("link", { name: "Together" })).toHaveAttribute("href", "#collaboration");
    expect(within(document.querySelector(".site-header__actions")!).getByRole("link", { name: /Open Zplit/ })).toHaveAttribute("href", "/app");
    for (const link of navigation.getAllByRole("link")) expect(document.querySelector(link.getAttribute("href")!)).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 2, name: "Follow the amount." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Same clarity. Different money worlds." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Talk around it. Keep it accounted for." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "A number can carry its proof." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /The record can travel/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /No loose ends/ })).toBeInTheDocument();
    expect(screen.getByText("Personal / private ledger", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Group / peer-to-peer accounting", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Organization / operated ledger", { exact: true })).toBeInTheDocument();
  });

  it("keeps illustrative controls native and responsive", () => {
    render(<HomePage />);

    const participant = screen.getByRole("button", { name: /Sari/ });
    fireEvent.click(participant);
    expect(participant).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".collaboration-demo")).toHaveAttribute("data-selected-person", "sari");

    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "train" } });
    expect(screen.getByRole("button", { name: /Train home/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Market \+ picnic/ })).not.toBeInTheDocument();

    const sharedView = screen.getByRole("button", { name: "Shared view" });
    fireEvent.click(sharedView);
    expect(sharedView).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".private-demo")).toHaveAttribute("data-private-view", "shared");
  });

  it("keeps motion public-only and explicitly supports reduced motion", () => {
    const publicStyles = readFileSync(path.resolve(process.cwd(), "src/app/styles/10-public.css"), "utf8");
    const motionSource = readFileSync(path.resolve(process.cwd(), "src/components/editorial/public-motion.tsx"), "utf8");
    expect(publicStyles).toMatch(/\.public-home\b/);
    expect(publicStyles).not.toMatch(/\.journey-|\.landing-reveal|\.story-motion/);
    expect(motionSource).toMatch(/prefers-reduced-motion/);
    expect(motionSource).toMatch(/gsap\.matchMedia/);
    expect(motionSource).toMatch(/context\.revert/);
    expect(document.querySelectorAll(".chat-message")).toHaveLength(0);
  });
});
