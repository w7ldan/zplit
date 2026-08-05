import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  beforeEach(() => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(1);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("detaches after the shared scroll threshold while preserving navigation", () => {
    render(<SiteHeader />);
    const header = screen.getByRole("banner", { name: "Site header" });
    expect(header.querySelector(".site-header__brand")).toBeInTheDocument();
    expect(header.querySelector(".site-header__nav")).toBeInTheDocument();
    expect(header.querySelector(".site-header__actions")).toBeInTheDocument();
    expect(header).not.toHaveClass("site-header--detached");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 32 });
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(header).toHaveClass("site-header--detached");
    expect(screen.getByRole("link", { name: "Open Zplit" })).toBeInTheDocument();
  });
});
