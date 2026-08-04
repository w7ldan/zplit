import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FriendShareLink } from "./friend-share-link";

const initial = { error: "", link: null, statement: null, revoked: false };

describe("FriendShareLink", () => {
  it("shows status, creates a one-time visible URL, and copies it", async () => {
    const createAction = vi.fn().mockResolvedValue({ error: "", link: { token: "11111111-1111-4111-8111-111111111111", expiresAt: "2026-08-11T00:00:00.000Z" }, statement: { friendName: "Ada", assignedAmount: 1000, repaidAmount: 0, outstandingAmount: 1000 }, revoked: false });
    const revokeAction = vi.fn().mockResolvedValue({ ...initial, revoked: true });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<FriendShareLink status={{ status: "none", expiresAt: null }} phoneNumber={"+62 811 1234"} createAction={createAction} revokeAction={revokeAction} />);

    expect(screen.getByText("A private, read-only view")).toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: "Create balance link" }).closest("form")!);
    await waitFor(() => expect(createAction).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Temporary balance link")).toHaveValue(`${window.location.origin}/share/11111111-1111-4111-8111-111111111111`));
    expect(screen.getByText("Save or send this link now. Zplit cannot recover it later.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/share/")));
    expect(screen.getByRole("button", { name: "Copy reminder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open WhatsApp" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy reminder" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("Hi Ada")));
  });

  it("does not show a usable URL after a fresh render", () => {
    render(<FriendShareLink status={{ status: "active", expiresAt: "2026-08-11T00:00:00.000Z" }} phoneNumber={null} createAction={vi.fn()} revokeAction={vi.fn()} />);
    expect(screen.queryByLabelText("Temporary balance link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace balance link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy reminder" })).not.toBeInTheDocument();
  });

  it("opens WhatsApp only after an explicit action and omits it for local numbers", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const createAction = vi.fn().mockResolvedValue({ error: "", link: { token: "11111111-1111-4111-8111-111111111111", expiresAt: "2026-08-11T00:00:00.000Z" }, statement: { friendName: "Ada", assignedAmount: 1000, repaidAmount: 1000, outstandingAmount: 0 }, revoked: false });
    render(<FriendShareLink status={{ status: "none", expiresAt: null }} phoneNumber={"08111234"} createAction={createAction} revokeAction={vi.fn()} />);
    fireEvent.submit(screen.getByRole("button", { name: "Create balance link" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy reminder" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Open WhatsApp" })).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
