import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FriendShareLink } from "./friend-share-link";

const initial = { error: "", link: null, revoked: false };

describe("FriendShareLink", () => {
  it("shows status, creates a one-time visible URL, and copies it", async () => {
    const createAction = vi.fn().mockResolvedValue({ error: "", link: { token: "11111111-1111-4111-8111-111111111111", expiresAt: "2026-08-11T00:00:00.000Z" }, revoked: false });
    const revokeAction = vi.fn().mockResolvedValue({ ...initial, revoked: true });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<FriendShareLink status={{ status: "none", expiresAt: null }} createAction={createAction} revokeAction={revokeAction} />);

    expect(screen.getByText("A private, read-only view")).toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: "Create balance link" }).closest("form")!);
    await waitFor(() => expect(createAction).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Temporary balance link")).toHaveValue(`${window.location.origin}/share/11111111-1111-4111-8111-111111111111`));
    expect(screen.getByText("Save or send this link now. Zplit cannot recover it later.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/share/")));
  });

  it("does not show a usable URL after a fresh render", () => {
    render(<FriendShareLink status={{ status: "active", expiresAt: "2026-08-11T00:00:00.000Z" }} createAction={vi.fn()} revokeAction={vi.fn()} />);
    expect(screen.queryByLabelText("Temporary balance link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace balance link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke link" })).toBeInTheDocument();
  });
});
