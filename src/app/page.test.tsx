import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

describe("Money Trail landing", () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it("reveals the ledger in order and keeps partial allocation consistent", () => {
    render(<HomePage />);
    const story = within(
      screen.getByRole("region", { name: "Follow the money" }),
    );
    const ledger = story.getByRole("article", {
      name: "Illustrative Bandung day out ledger",
    });
    const shares = ledger.querySelectorAll(".trail-story-record-row:nth-child(-n + 3)");
    const repayment = ledger.querySelector(".trail-story-repayment");
    const applied = ledger.querySelector(".trail-story-applied");
    const settlement = ledger.querySelector(".trail-story-settlement");
    const balance = ledger.querySelector(".trail-story-balance");
    expect(within(ledger).getByText("Bandung day out")).toBeInTheDocument();
    expect(within(ledger).getByText("Rp 480.000")).toBeInTheDocument();
    expect(shares).toHaveLength(3);
    for (const share of shares) expect(share).toHaveAttribute("aria-hidden", "true");
    expect(repayment).toHaveAttribute("aria-hidden", "true");
    expect(balance).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(story.getByRole("button", { name: /02 \/ Shares/ }));
    for (const share of shares) expect(share).toHaveAttribute("aria-hidden", "false");
    for (const share of shares)
      expect(within(share as HTMLElement).getByText("Rp 160.000")).toBeInTheDocument();
    expect(repayment).toHaveAttribute("aria-hidden", "true");
    expect(balance).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(story.getByRole("button", { name: /03 \/ Repayment/ }));
    expect(repayment).toHaveAttribute("aria-hidden", "false");
    expect(applied).toHaveAttribute("aria-hidden", "false");
    expect(settlement).toHaveAttribute("aria-hidden", "false");
    expect(balance).toHaveAttribute("aria-hidden", "true");
    expect(
      story.getByText("Rp100.000 received · Rp100.000 applied"),
    ).toBeInTheDocument();
    fireEvent.click(
      story.getByRole("checkbox", { name: "Show partial allocation" }),
    );
    expect(story.getByText(/Rp20.000 needs allocation/)).toBeInTheDocument();
    expect(within(applied as HTMLElement).getByText("Rp 80.000")).toBeInTheDocument();

    fireEvent.click(story.getByRole("button", { name: /04 \/ Remaining/ }));
    expect(balance).toHaveAttribute("aria-hidden", "false");
    expect(within(balance as HTMLElement).getByText("Rp 80.000")).toBeInTheDocument();
    expect(within(balance as HTMLElement).getByText("Rp 160.000")).toBeInTheDocument();
    expect(within(balance as HTMLElement).getByText("Rp 240.000")).toBeInTheDocument();
    fireEvent.click(story.getByRole("checkbox", { name: "Show partial allocation" }));
    expect(within(balance as HTMLElement).getByText("Rp 60.000")).toBeInTheDocument();
    expect(within(balance as HTMLElement).getByText("Rp 220.000")).toBeInTheDocument();
  });

  it("advances the desktop story under reduced motion", () => {
    let onIntersect: IntersectionObserverCallback = () => undefined;
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) {
        onIntersect = callback;
      }
      observe() {}
      disconnect() {}
    });
    render(<HomePage />);
    const story = screen.getByRole("region", { name: "Follow the money" });
    const repaymentStep = story.querySelector<HTMLElement>('[data-story-step="2"]');
    expect(repaymentStep).not.toBeNull();
    act(() => onIntersect([
      {
        isIntersecting: true,
        intersectionRatio: 1,
        target: repaymentStep as HTMLElement,
        boundingClientRect: repaymentStep!.getBoundingClientRect(),
        intersectionRect: repaymentStep!.getBoundingClientRect(),
        rootBounds: null,
        time: 0,
      },
    ], {} as IntersectionObserver));
    const ledger = within(story).getByRole("article", {
      name: "Illustrative Bandung day out ledger",
    });
    expect(ledger).toHaveClass("trail-story-paper-step-2");
    expect(ledger.querySelector(".trail-story-repayment")).toHaveAttribute("aria-hidden", "false");
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
    expect(css).toMatch(/\.trail-story-record-row\[aria-hidden="true"\],[\s\S]*?visibility: hidden;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important;[\s\S]*?transition: none !important;/);
    expect(css).toMatch(/\.trail-button-primary\s*\{\s*border-color: var\(--vnext-accent-strong\);\s*background: var\(--vnext-accent-strong\);\s*color: var\(--vnext-text-on-accent\) !important;/);
    expect(css).toMatch(/\.trail-button-primary:hover\s*\{\s*border-color: var\(--vnext-accent-deep\);/);
    expect(css).toMatch(/\.trail-spaces\s*\{[^}]*--vnext-text-soft: #b4b9b2;[^}]*--vnext-text-quiet: #878d86;/);
    expect(css).not.toMatch(
      /#FAF7F1|#211F1B|gradient|backdrop-filter|box-shadow/i,
    );
  });
});
