import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingReveal } from "./landing-reveal";

afterEach(() => vi.unstubAllGlobals());

describe("LandingReveal", () => {
  it("uses a one-shot observer and disconnects it on cleanup", () => {
    let callback: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    class MockIntersectionObserver {
      constructor(next: IntersectionObserverCallback) { callback = next; }
      observe = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    render(<LandingReveal><p>Supporting copy</p></LandingReveal>);
    const target = screen.getByText("Supporting copy").parentElement!;
    expect(target).toHaveClass("landing-reveal--ready");
    expect(target).not.toHaveClass("landing-reveal--visible");
    act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(target).toHaveClass("landing-reveal--visible");
    act(() => callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(target).toHaveClass("landing-reveal--visible");
    expect(disconnect).toHaveBeenCalled();
  });

  it("reveals immediately when reduced motion is preferred", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: true })) });
    render(<LandingReveal><p>Immediate copy</p></LandingReveal>);
    expect(screen.getByText("Immediate copy").parentElement).toHaveClass("landing-reveal--visible");
  });
});
