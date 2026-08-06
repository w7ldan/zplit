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
  afterEach(() => vi.useRealTimers());

  it("announces a toast and dismisses it after eight seconds", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Friend archived");
    expect(toast).toHaveAttribute("aria-live", "polite");
    act(() => vi.advanceTimersByTime(7999));
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("pauses dismissal while hovered or keyboard-focused", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    const toast = screen.getByRole("status");
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(4000));
    expect(toast).toBeInTheDocument();
    const undo = screen.getByRole("button", { name: "Undo" });
    undo.focus();
    expect(document.activeElement).toBe(undo);
    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(8000));
    expect(toast).toBeInTheDocument();
    fireEvent.blur(undo, { relatedTarget: null });
    act(() => vi.advanceTimersByTime(7999));
    expect(toast).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps Undo keyboard accessible and removes the toast after success", async () => {
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
});
