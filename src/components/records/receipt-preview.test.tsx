import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReceiptPreview } from "./receipt-preview";

describe("ReceiptPreview", () => {
  it("keeps the preview mounted during exit, then restores focus", () => {
    render(<><button type="button">Other</button><ReceiptPreview href="/receipt/one" filename="one.png" mediaType="image/png" /></>);
    const trigger = screen.getByRole("button", { name: "Preview one.png" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close receipt preview" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close receipt preview" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
    fireEvent.transitionEnd(screen.getByRole("dialog").querySelector(".receipt-preview__surface")!, { propertyName: "transform" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("retargets a close that interrupts entry and can reopen cleanly", () => {
    let enterFrame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      enterFrame = callback;
      return 1;
    });
    render(<ReceiptPreview href="/receipt/interruptible" filename="interruptible.png" mediaType="image/png" />);
    const trigger = screen.getByRole("button", { name: "Preview interruptible.png" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("receipt-preview--entering");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close receipt preview" }));
    expect(dialog).toHaveClass("receipt-preview--closing");
    expect(dialog).toBeInTheDocument();
    fireEvent.transitionEnd(dialog.querySelector(".receipt-preview__surface")!, { propertyName: "transform" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toHaveClass("receipt-preview--entering");
    enterFrame?.(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("uses a normal authorized link for unsupported media", () => {
    render(<ReceiptPreview href="/receipt/two" filename="two.pdf" mediaType="application/pdf" />);
    expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute("href", "/receipt/two");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("supports a custom visible trigger label", () => {
    render(<ReceiptPreview href="/receipt/custom" filename="Receipt image" mediaType="image/png" triggerLabel="Receipt image" />);
    const trigger = screen.getByRole("button", { name: "Receipt image" });
    expect(trigger).toHaveTextContent("Receipt image");
    fireEvent.click(trigger);
    expect(screen.getByRole("heading", { name: "Receipt image" })).toBeInTheDocument();
  });

  it("keeps a long filename in the preview heading and image alternative text", () => {
    const filename = "receipt-" + "x".repeat(240) + ".png";
    render(<ReceiptPreview href="/receipt/long" filename={filename} mediaType="image/png" />);
    fireEvent.click(screen.getByRole("button", { name: `Preview ${filename}` }));

    expect(screen.getByRole("heading", { name: filename })).toHaveAttribute("title", filename);
    expect(screen.getByRole("img", { name: filename })).toBeInTheDocument();
  });

  it("traps Tab in both directions and keeps the background inert", () => {
    const { container } = render(<ReceiptPreview href="/receipt/three" filename="three.png" mediaType="image/png" />);
    const trigger = screen.getByRole("button", { name: "Preview three.png" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close receipt preview" });
    const download = screen.getByRole("link", { name: "Download" });
    expect(container).toHaveAttribute("aria-hidden", "true");
    expect((container as HTMLElement & { inert: boolean }).inert).toBe(true);

    download.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(download).toHaveFocus();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("restores background state, scroll state, and focus on Escape or backdrop close", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 240 });
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "scroll";
    const { container } = render(<ReceiptPreview href="/receipt/four?token=private" filename="four.png" mediaType="image/png" />);
    container.setAttribute("aria-hidden", "false");
    (container as HTMLElement & { inert: boolean }).inert = true;
    const trigger = screen.getByRole("button", { name: "Preview four.png" });
    fireEvent.click(trigger);

    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.transitionEnd(screen.getByRole("dialog").querySelector(".receipt-preview__surface")!, { propertyName: "transform" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container).toHaveAttribute("aria-hidden", "false");
    expect((container as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect(document.body.style.overflow).toBe("auto");
    expect(document.documentElement.style.overflow).toBe("scroll");
    expect(scrollTo).toHaveBeenCalledWith(0, 240);
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.transitionEnd(screen.getByRole("dialog").querySelector(".receipt-preview__surface")!, { propertyName: "transform" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    scrollTo.mockRestore();
    vi.useRealTimers();
  });

  it("ignores repeated close attempts and closes immediately with reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }));
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "scroll";
    const { container } = render(<ReceiptPreview href="/receipt/reduced" filename="reduced.png" mediaType="image/png" />);
    const trigger = screen.getByRole("button", { name: "Preview reduced.png" });
    fireEvent.click(trigger);
    const close = screen.getByRole("button", { name: "Close receipt preview" });
    fireEvent.click(close);
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container).not.toHaveAttribute("aria-hidden", "true");
    expect(document.body.style.overflow).toBe("auto");
    expect(document.documentElement.style.overflow).toBe("scroll");
    expect(scrollTo).toHaveBeenCalledWith(0, window.scrollY);
    expect(trigger).toHaveFocus();
    scrollTo.mockRestore();
    vi.unstubAllGlobals();
  });

  it("preserves receipt authorization and download URL behavior", () => {
    render(<ReceiptPreview href="/receipt/five?token=private" filename="five.png" mediaType="image/png" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview five.png" }));

    expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute("href", "/receipt/five?token=private");
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/receipt/five?token=private&download=1");
    fireEvent.click(screen.getByRole("dialog").querySelector(".receipt-preview__surface")!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
