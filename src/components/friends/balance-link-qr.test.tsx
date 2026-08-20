import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BalanceLinkQr } from "./balance-link-qr";

const qrMock = vi.hoisted(() => ({ render: vi.fn() }));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: Record<string, unknown>) => {
    qrMock.render(props);
    return <svg data-testid="qr-code" />;
  },
}));

describe("BalanceLinkQr", () => {
  it("passes the exact balance URL to the local QR encoder", () => {
    const url = "https://zplit.example/share/11111111-1111-4111-8111-111111111111";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<BalanceLinkQr url={url} onClose={vi.fn()} />);
    expect(qrMock.render).toHaveBeenCalledWith(expect.objectContaining({ value: url, size: 256, level: "M", marginSize: 4, bgColor: "#FFFEFA", fgColor: "#111315" }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps a keyboard-accessible close action", () => {
    const onClose = vi.fn();
    render(<BalanceLinkQr url="https://zplit.example/share/token" onClose={onClose} />);
    expect(screen.getByText(/same temporary private balance statement/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close QR" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
