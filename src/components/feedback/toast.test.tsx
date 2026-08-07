import { act, fireEvent, render, screen } from "@testing-library/react";
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

describe("ToastProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("marks timeout dismissal as exiting before removing after 160ms", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    const toast = screen.getByRole("status");
    expect(toast).toHaveAttribute("aria-live", "polite");
    act(() => vi.advanceTimersByTime(8000));
    expect(toast).toHaveClass("toast--exiting");
    expect(toast).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(159));
    expect(toast).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
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
    act(() => vi.advanceTimersByTime(160));
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
    act(() => vi.advanceTimersByTime(160));
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
    act(() => vi.advanceTimersByTime(160));
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
