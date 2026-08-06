import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  let frameCallback: FrameRequestCallback | undefined;

  beforeEach(() => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    frameCallback = undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frameCallback = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("detaches after the shared scroll threshold while preserving navigation", () => {
    render(<SiteHeader />);
    const header = screen.getByRole("banner", { name: "Site header" });
    const panel = header.querySelector(".header-shell__panel")!;
    expect(header.querySelector(".site-header__brand")).toBeInTheDocument();
    expect(header.querySelector(".site-header__nav")).toBeInTheDocument();
    expect(header.querySelector(".site-header__actions")).toBeInTheDocument();
    expect(header).not.toHaveClass("header-shell--detached");
    expect(panel).not.toHaveClass("header-shell__panel--detached");
    expect(header).toHaveAttribute("data-detached", "false");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 32 });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frameCallback?.(1));
    expect(header).toHaveClass("header-shell--detached");
    expect(panel).toHaveClass("header-shell__panel--detached");
    expect(panel).toHaveAttribute("data-detached", "true");
    expect(screen.getByRole("link", { name: "Open Zplit" })).toBeInTheDocument();
  });

  it("mounts detached when scroll restoration already positioned the page", () => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 48 });
    render(<SiteHeader />);
    expect(screen.getByRole("banner", { name: "Site header" })).toHaveClass("header-shell--detached");
  });
});
