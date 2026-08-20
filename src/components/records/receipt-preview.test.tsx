import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReceiptPreview } from "./receipt-preview";

describe("ReceiptPreview", () => {
  it("restores focus to the exact trigger after closing", () => {
    render(<><button type="button">Other</button><ReceiptPreview href="/receipt/one" filename="one.png" mediaType="image/png" /></>);
    const trigger = screen.getByRole("button", { name: "Preview one.png" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close receipt preview" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close receipt preview" }));
    expect(trigger).toHaveFocus();
  });

  it("uses a normal authorized link for unsupported media", () => {
    render(<ReceiptPreview href="/receipt/two" filename="two.pdf" mediaType="application/pdf" />);
    expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute("href", "/receipt/two");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container).toHaveAttribute("aria-hidden", "false");
    expect((container as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect(document.body.style.overflow).toBe("auto");
    expect(document.documentElement.style.overflow).toBe("scroll");
    expect(scrollTo).toHaveBeenCalledWith(0, 240);
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    scrollTo.mockRestore();
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
