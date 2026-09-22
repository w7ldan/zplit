import Link from "next/link";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenTile } from "@/components/vnext/open-tile";
import { OverviewReveal } from "./overview-reveal";
import { OverviewRunway } from "./overview-runway";

afterEach(() => vi.unstubAllGlobals());

describe("Overview interactions", () => {
  it("keeps the whole row as one keyboard target", () => {
    render(<Link className="vnext-row" href="/app/friends/friend-a"><strong>Ari</strong><OpenTile /></Link>);

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/app/friends/friend-a");
    expect(document.querySelector(".vnext-open-tile")).toHaveAttribute("aria-hidden", "true");
  });

  it("exposes the real budget proportion to assistive technology", () => {
    render(<OverviewRunway remaining={750_000} totalBudget={1_000_000} />);

    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "75");
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuetext", "Rp 750.000 remaining of Rp 1.000.000");
    const track = document.querySelector(".overview-runway__track");
    expect(track?.querySelector(".overview-runway__seam")).toBeInTheDocument();
  });

  it("makes reduced-motion content visible without waiting for an observer", () => {
    const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("matchMedia", vi.fn(() => media));
    render(<OverviewReveal><p>Visible immediately</p></OverviewReveal>);

    expect(screen.getByText("Visible immediately").parentElement).toHaveAttribute("data-reveal", "visible");
  });
});
