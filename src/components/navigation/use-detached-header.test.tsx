import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDetachedHeader } from "./use-detached-header";

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value });
}

describe("useDetachedHeader", () => {
  let frameCallback: FrameRequestCallback | undefined;
  let frameId = 0;

  beforeEach(() => {
    setScrollY(0);
    frameCallback = undefined;
    frameId = 0;
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frameCallback = callback;
      return ++frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("mounts detached from the restored scroll position and batches threshold changes", () => {
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

  it("rechecks after delayed browser scroll restoration", () => {
    const { result, unmount } = renderHook(() => useDetachedHeader(32));
    act(() => frameCallback?.(1));
    expect(result.current).toBe(false);

    setScrollY(40);
    act(() => vi.runAllTimers());
    act(() => frameCallback?.(1));
    expect(result.current).toBe(true);
    unmount();
  });

  it("rechecks on pageshow, resize, and visibility changes", () => {
    const { result, unmount } = renderHook(() => useDetachedHeader());
    act(() => frameCallback?.(1));

    for (const target of [
      () => window.dispatchEvent(new Event("pageshow")),
      () => window.dispatchEvent(new Event("resize")),
      () => document.dispatchEvent(new Event("visibilitychange")),
    ]) {
      setScrollY(40);
      act(target);
      act(() => frameCallback?.(1));
      expect(result.current).toBe(true);
      setScrollY(0);
      act(() => window.dispatchEvent(new Event("scroll")));
      act(() => frameCallback?.(1));
      expect(result.current).toBe(false);
    }

    unmount();
  });

  it("uses a passive scroll listener and cleans timers and frames", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    const { unmount } = renderHook(() => useDetachedHeader());
    expect(addEventListener.mock.calls).toContainEqual(["scroll", expect.any(Function), { passive: true }]);
    unmount();
    expect(clearTimeout).toHaveBeenCalled();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });
});
