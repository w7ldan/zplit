import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderShell } from "./header-shell";

describe("HeaderShell", () => {
  beforeEach(() => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("provides labeled accessible slots and shared attached state", () => {
    render(
      <HeaderShell
        ariaLabel="Example header"
        navigationLabel="Example navigation"
        brand={<a href="#top">Brand</a>}
        navigation={<a href="/one">One</a>}
        actions={<button type="button">Action</button>}
        className="example-header"
        panelClassName="example-panel"
        brandClassName="example-brand"
        navigationClassName="example-nav"
        actionsClassName="example-actions"
      />,
    );

    const header = screen.getByRole("banner", { name: "Example header" });
    expect(header).toHaveClass("header-shell", "example-header");
    expect(header).toHaveAttribute("data-detached", "false");
    expect(screen.getByRole("navigation", { name: "Example navigation" })).toHaveClass("header-shell__nav", "example-nav");
    expect(header.querySelector(".header-shell__panel")).toHaveAttribute("data-detached", "false");
    expect(header.querySelector(".example-brand")).toContainElement(screen.getByRole("link", { name: "Brand" }));
    expect(header.querySelector(".example-actions")).toContainElement(screen.getByRole("button", { name: "Action" }));
  });
});
