import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingStoryMotion } from "./landing-reveal";

afterEach(() => vi.unstubAllGlobals());

describe("LandingStoryMotion", () => {
  it("keeps the narrative available while the isolated renderer chunk loads", async () => {
    const { container } = render(<LandingStoryMotion><section data-spatial-scene="model">Model</section></LandingStoryMotion>);
    expect(container.querySelector("main")).toHaveTextContent("Model");
    expect(container.querySelector(".landing-narrative")).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector("main")).toBeInTheDocument());
  });

  it("marks reduced motion while keeping the complete DOM path available", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) });
    const { container } = render(<LandingStoryMotion><section data-spatial-scene="model">Model content</section></LandingStoryMotion>);
    expect(container).toHaveTextContent("Model content");
    expect(container.querySelector("[data-three-landing-canvas]")).not.toBeInTheDocument();
  });
});
