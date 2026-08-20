import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
