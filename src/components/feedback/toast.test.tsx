import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./toast";

function Trigger() {
  const { showToast } = useToast();
  return (
    <>
      <button type="button" onClick={() => showToast({ message: "Friend archived", action: { label: "Undo", onAction: () => undefined } })}>Show</button>
      <button type="button" onClick={() => {
        showToast({ message: "One" });
        showToast({ message: "Two" });
        showToast({ message: "Three" });
      }}>Show three</button>
    </>
  );
}

function StackTrigger() {
  const { dismissToast, showToast } = useToast();
  const firstId = useRef<string | null>(null);
  return (
    <>
      <button type="button" onClick={() => { firstId.current = showToast({ message: "First" }); }}>Add first</button>
      <button type="button" onClick={() => showToast({ message: "Second" })}>Add second</button>
      <button type="button" onClick={() => showToast({ message: "Third" })}>Add third</button>
      <button type="button" onClick={() => { if (firstId.current) dismissToast(firstId.current); }}>Dismiss first</button>
    </>
  );
}

describe("ToastProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("marks timeout dismissal as exiting before removing after 220ms", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    const toast = screen.getByRole("status");
    expect(toast).toHaveAttribute("aria-live", "polite");
    act(() => vi.advanceTimersByTime(8000));
    expect(toast).toHaveClass("toast--exiting");
    expect(toast).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(219));
    expect(toast).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("can dismiss safely while entry is still in progress", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    const toast = screen.getByRole("status");
    fireEvent.click(within(toast).getByRole("button", { name: "Dismiss notification" }));
    expect(toast).toHaveClass("toast--exiting");
    act(() => vi.advanceTimersByTime(220));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("uses the same exit lifecycle for manual dismissal and does not duplicate exit work", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    const timersAfterFirstDismiss = vi.getTimerCount();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.getByRole("status")).toHaveClass("toast--exiting");
    expect(vi.getTimerCount()).toBe(timersAfterFirstDismiss);
    act(() => vi.advanceTimersByTime(220));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("pauses dismissal while hovered or keyboard-focused", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    const toast = screen.getByRole("status");
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(4000));
    const undo = screen.getByRole("button", { name: "Undo" });
    undo.focus();
    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(8000));
    expect(toast).toBeInTheDocument();
    fireEvent.blur(undo, { relatedTarget: null });
    act(() => vi.advanceTimersByTime(7999));
    expect(toast).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(toast).toHaveClass("toast--exiting");
    act(() => vi.advanceTimersByTime(220));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("pauses dismissal while an Undo action is pending", async () => {
    const onAction = vi.fn(() => new Promise<void>(() => undefined));
    function PendingTrigger() {
      const { showToast } = useToast();
      return <button type="button" onClick={() => showToast({ message: "Friend archived", action: { label: "Undo", onAction } })}>Show pending</button>;
    }
    render(<ToastProvider><PendingTrigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show pending" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => undefined);
    act(() => vi.advanceTimersByTime(80_000));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("keeps Undo keyboard accessible and exits after successful Undo", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    function ActionTrigger() {
      const { showToast } = useToast();
      return <button type="button" onClick={() => showToast({ message: "Friend archived", action: { label: "Undo", onAction } })}>Show action</button>;
    }
    render(<ToastProvider><ActionTrigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show action" }));
    const undo = screen.getByRole("button", { name: "Undo" });
    undo.focus();
    fireEvent.click(undo);
    await act(async () => undefined);
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveClass("toast--exiting");
    act(() => vi.advanceTimersByTime(220));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows no more than two visible toasts", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show three" }));
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.queryByText("One")).not.toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    expect(screen.getByText("Three")).toBeInTheDocument();
  });

  it("keeps remaining toast order through rapid add and remove", () => {
    render(<ToastProvider><StackTrigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Add first" }));
    fireEvent.click(screen.getByRole("button", { name: "Add second" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss first" }));
    act(() => vi.advanceTimersByTime(220));
    fireEvent.click(screen.getByRole("button", { name: "Add third" }));
    expect(screen.getAllByRole("status").map((toast) => toast.querySelector(".toast__message")?.textContent)).toEqual(["Second", "Third"]);
  });

  it("clears stack FLIP offsets after the next frame", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const element = this as HTMLElement;
      const siblings = Array.from(element.parentElement?.querySelectorAll<HTMLElement>("[data-toast-id]") ?? []);
      return { top: 100 - Math.max(0, siblings.indexOf(element)) * 50 } as DOMRect;
    });

    render(<ToastProvider><StackTrigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Add first" }));
    fireEvent.click(screen.getByRole("button", { name: "Add second" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss first" }));
    act(() => vi.advanceTimersByTime(220));

    const remaining = screen.getByRole("status").parentElement as HTMLElement;
    expect(remaining.style.getPropertyValue("--toast-layout-offset")).toBe("-50px");
    act(() => {
      for (const callback of frames.values()) callback(0);
      frames.clear();
    });
    expect(remaining.style.getPropertyValue("--toast-layout-offset")).toBe("");
  });

  it("keeps a failed Undo visible with an explanation", async () => {
    function FailureTrigger() {
      const { showToast } = useToast();
      return <button type="button" onClick={() => showToast({ message: "Friend archived", action: { label: "Undo", onAction: () => "Undo unavailable: this friend changed." } })}>Show failure</button>;
    }
    render(<ToastProvider><FailureTrigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show failure" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => undefined);
    expect(screen.getByRole("status")).toHaveTextContent("Undo unavailable: this friend changed.");
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(80_000));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("removes immediately when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
