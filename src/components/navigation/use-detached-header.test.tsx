import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDetachedHeader } from "./use-detached-header";

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value });
}

describe("useDetachedHeader", () => {
  let frameCallback: FrameRequestCallback | undefined;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    setScrollY(0);
    frameCallback = undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false })) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalMatchMedia) Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    else delete (window as unknown as { matchMedia?: typeof window.matchMedia }).matchMedia;
  });

  it("starts from the current scroll position and batches threshold changes", () => {
    setScrollY(36);
    const { result, unmount } = renderHook(() => useDetachedHeader(32));
    expect(result.current).toBe(true);

    setScrollY(0);
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(result.current).toBe(true);
    expect(frameCallback).toBeDefined();
    act(() => frameCallback?.(1));
    expect(result.current).toBe(false);
    unmount();
  });

  it("rechecks after the browser restores the scroll position", () => {
    const { result, unmount } = renderHook(() => useDetachedHeader(32));
    expect(result.current).toBe(false);
    setScrollY(40);
    act(() => window.dispatchEvent(new Event("pageshow")));
    act(() => frameCallback?.(1));
    expect(result.current).toBe(true);
    unmount();
  });

  it("cleans a scheduled frame and changes immediately under reduced motion", () => {
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: true })) });
    const { result, unmount } = renderHook(() => useDetachedHeader());
    setScrollY(40);
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(result.current).toBe(true);
    unmount();
    expect(cancel).not.toHaveBeenCalled();
  });
});
