import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FriendShareLink } from "./friend-share-link";

const initial = { error: "", link: null, statement: null, revoked: false };

afterEach(() => vi.restoreAllMocks());

describe("FriendShareLink", () => {
  it("creates a one-time visible URL, makes Copy primary, and previews the exact URL", async () => {
    const createAction = vi.fn().mockResolvedValue({ error: "", link: { token: "11111111-1111-4111-8111-111111111111", expiresAt: "2026-08-11T00:00:00.000Z" }, statement: { friendName: "Ada", assignedAmount: 1000, repaidAmount: 0, outstandingAmount: 1000 }, revoked: false });
    const revokeAction = vi.fn().mockResolvedValue({ ...initial, revoked: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<FriendShareLink status={{ status: "none", expiresAt: null }} phoneNumber={"+62 811 1234"} createAction={createAction} revokeAction={revokeAction} />);

    expect(screen.getByText("A private, read-only view")).toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: "Create balance link" }).closest("form")!);
    await waitFor(() => expect(createAction).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Temporary balance link")).toHaveValue(`${window.location.origin}/share/11111111-1111-4111-8111-111111111111`));
    expect(document.querySelectorAll(".friend-share__result")).toHaveLength(1);
    expect(screen.getByText("Save or send this link now. Zplit cannot recover it later.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy balance link" })).toHaveClass("action-link--primary");
    fireEvent.click(screen.getByRole("button", { name: "Copy balance link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/11111111-1111-4111-8111-111111111111`));
    expect(screen.getByText("Copied")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview as friend (opens in a new tab)" }));
    expect(open).toHaveBeenCalledWith(`${window.location.origin}/share/11111111-1111-4111-8111-111111111111`, "_blank", "noopener,noreferrer");
    expect(screen.getByRole("button", { name: "Copy reminder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open WhatsApp" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy reminder" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Hi Ada")));
  });

  it("falls back to selecting the visible URL when clipboard write fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard unavailable"));
    const execCommand = vi.fn().mockReturnValue(true);
    const select = vi.spyOn(HTMLInputElement.prototype, "select");
    Object.assign(navigator, { clipboard: { writeText } });
    Object.assign(document, { execCommand });
    const createAction = vi.fn().mockResolvedValue({ error: "", link: { token: "11111111-1111-4111-8111-111111111111", expiresAt: "2026-08-11T00:00:00.000Z" }, statement: null, revoked: false });
    render(<FriendShareLink status={{ status: "none", expiresAt: null }} phoneNumber={null} createAction={createAction} revokeAction={vi.fn()} />);
    fireEvent.submit(screen.getByRole("button", { name: "Create balance link" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy balance link" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Copy balance link" }));
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
    expect(select).toHaveBeenCalled();
  });

  it("does not show a usable URL after a fresh render", () => {
    render(<FriendShareLink status={{ status: "active", expiresAt: "2026-08-11T00:00:00.000Z" }} phoneNumber={null} createAction={vi.fn()} revokeAction={vi.fn()} />);
    expect(screen.queryByLabelText("Temporary balance link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace balance link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke link" })).toBeInTheDocument();
    expect(screen.getByText(/existing link is active.*cannot recover its URL/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy balance link/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Preview as friend/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy reminder" })).not.toBeInTheDocument();
  });

  it.each(["none", "expired", "revoked"] as const)("does not expose stale link controls for %s status", (status) => {
    render(<FriendShareLink status={{ status, expiresAt: status === "none" ? null : "2026-08-11T00:00:00.000Z" }} phoneNumber={null} createAction={vi.fn()} revokeAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Copy balance link/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Preview as friend/ })).not.toBeInTheDocument();
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

  it("removes a replaced link result immediately when it is revoked", async () => {
    const createAction = vi.fn().mockResolvedValue({ error: "", link: { token: "11111111-1111-4111-8111-111111111111", expiresAt: "2026-08-11T00:00:00.000Z" }, statement: { friendName: "Ada", assignedAmount: 1000, repaidAmount: 0, outstandingAmount: 1000 }, revoked: false });
    const revokeAction = vi.fn().mockResolvedValue({ ...initial, revoked: true });
    render(<FriendShareLink status={{ status: "active", expiresAt: "2026-08-10T00:00:00.000Z" }} phoneNumber={"+62 811 1234"} createAction={createAction} revokeAction={revokeAction} />);

    fireEvent.submit(screen.getByRole("button", { name: "Replace balance link" }).closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("Temporary balance link")).toBeInTheDocument());
    fireEvent.submit(screen.getByRole("button", { name: "Revoke link" }).closest("form")!);
    await waitFor(() => expect(screen.queryByLabelText("Temporary balance link")).not.toBeInTheDocument());
    expect(screen.getByText("REVOKED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create balance link" })).toBeInTheDocument();
    expect(screen.queryByText(/Expires/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy reminder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open WhatsApp" })).not.toBeInTheDocument();
  });

  it("supports create, revoke, and create again without remounting", async () => {
    const createAction = vi.fn()
      .mockResolvedValueOnce({ error: "", link: { token: "11111111-1111-4111-8111-111111111111", expiresAt: "2026-08-11T00:00:00.000Z" }, statement: { friendName: "Ada", assignedAmount: 1000, repaidAmount: 0, outstandingAmount: 1000 }, revoked: false })
      .mockResolvedValueOnce({ error: "", link: { token: "22222222-2222-4222-8222-222222222222", expiresAt: "2026-08-12T00:00:00.000Z" }, statement: { friendName: "Ada", assignedAmount: 1000, repaidAmount: 0, outstandingAmount: 1000 }, revoked: false });
    const revokeAction = vi.fn().mockResolvedValue({ ...initial, revoked: true });
    render(<FriendShareLink status={{ status: "none", expiresAt: null }} phoneNumber={null} createAction={createAction} revokeAction={revokeAction} />);

    fireEvent.submit(screen.getByRole("button", { name: "Create balance link" }).closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("Temporary balance link")).toHaveValue(`${window.location.origin}/share/11111111-1111-4111-8111-111111111111`));
    fireEvent.submit(screen.getByRole("button", { name: "Revoke link" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create balance link" })).toBeInTheDocument());
    fireEvent.submit(screen.getByRole("button", { name: "Create balance link" }).closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("Temporary balance link")).toHaveValue(`${window.location.origin}/share/22222222-2222-4222-8222-222222222222`));
    expect(createAction).toHaveBeenCalledTimes(2);
    expect(revokeAction).toHaveBeenCalledOnce();
  });

  it("replaces the known URL and drives actions with only the new URL", async () => {
    const createAction = vi.fn()
      .mockResolvedValueOnce({ error: "", link: { token: "11111111-1111-4111-8111-111111111111", expiresAt: "2026-08-11T00:00:00.000Z" }, statement: null, revoked: false })
      .mockResolvedValueOnce({ error: "", link: { token: "22222222-2222-4222-8222-222222222222", expiresAt: "2026-08-12T00:00:00.000Z" }, statement: null, revoked: false });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<FriendShareLink status={{ status: "none", expiresAt: null }} phoneNumber={null} createAction={createAction} revokeAction={vi.fn()} />);
    fireEvent.submit(screen.getByRole("button", { name: "Create balance link" }).closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("Temporary balance link")).toHaveValue(`${window.location.origin}/share/11111111-1111-4111-8111-111111111111`));
    fireEvent.submit(screen.getByRole("button", { name: "Replace balance link" }).closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("Temporary balance link")).toHaveValue(`${window.location.origin}/share/22222222-2222-4222-8222-222222222222`));
    expect(screen.queryByDisplayValue(`${window.location.origin}/share/11111111-1111-4111-8111-111111111111`)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy balance link" }));
    fireEvent.click(screen.getByRole("button", { name: /Preview as friend/ }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/22222222-2222-4222-8222-222222222222`);
    expect(open).toHaveBeenCalledWith(`${window.location.origin}/share/22222222-2222-4222-8222-222222222222`, "_blank", "noopener,noreferrer");
  });

  it("keeps the visible link when revocation fails and shows the server error", async () => {
    const createAction = vi.fn().mockResolvedValue({ error: "", link: { token: "11111111-1111-4111-8111-111111111111", expiresAt: "2026-08-11T00:00:00.000Z" }, statement: { friendName: "Ada", assignedAmount: 1000, repaidAmount: 0, outstandingAmount: 1000 }, revoked: false });
    const revokeAction = vi.fn().mockResolvedValue({ ...initial, error: "Unable to revoke this balance link." });
    render(<FriendShareLink status={{ status: "none", expiresAt: null }} phoneNumber={null} createAction={createAction} revokeAction={revokeAction} />);
    fireEvent.submit(screen.getByRole("button", { name: "Create balance link" }).closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("Temporary balance link")).toBeInTheDocument());
    fireEvent.submit(screen.getByRole("button", { name: "Revoke link" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unable to revoke this balance link."));
    expect(screen.getByLabelText("Temporary balance link")).toBeInTheDocument();
  });

  it("keeps the known URL when replacement fails", async () => {
    const createAction = vi.fn()
      .mockResolvedValueOnce({ error: "", link: { token: "11111111-1111-4111-8111-111111111111", expiresAt: "2026-08-11T00:00:00.000Z" }, statement: null, revoked: false })
      .mockResolvedValueOnce({ ...initial, error: "Unable to update this balance link." });
    render(<FriendShareLink status={{ status: "none", expiresAt: null }} phoneNumber={null} createAction={createAction} revokeAction={vi.fn()} />);
    fireEvent.submit(screen.getByRole("button", { name: "Create balance link" }).closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("Temporary balance link")).toBeInTheDocument());
    fireEvent.submit(screen.getByRole("button", { name: "Replace balance link" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unable to update this balance link."));
    expect(screen.getByLabelText("Temporary balance link")).toHaveValue(`${window.location.origin}/share/11111111-1111-4111-8111-111111111111`);
  });

  it("sends checked receipt IDs on create and accepts authoritative selection updates", async () => {
    const receipt = { id: "11111111-1111-4111-8111-111111111111", originalFilename: "dinner.png", mediaType: "image/png", createdAt: new Date("2026-08-04T00:00:00Z") };
    const createAction = vi.fn().mockResolvedValue({ error: "", link: { token: "11111111-1111-4111-8111-111111111111", expiresAt: "2026-08-11T00:00:00.000Z" }, statement: null, revoked: false, selectedReceiptIds: [receipt.id] });
    const updateAction = vi.fn().mockResolvedValue({ error: "", link: null, statement: null, revoked: false, selectedReceiptIds: [], selectionUpdated: true });
    render(<FriendShareLink status={{ status: "none", expiresAt: null }} phoneNumber={null} createAction={createAction} revokeAction={vi.fn()} updateSelectionAction={updateAction} eligibleReceipts={[{ expenseId: "expense-a", expenseDescription: "Dinner", outingTitle: "Saturday", receipts: [receipt] }]} selectedReceiptIds={[]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /dinner\.png/ }));
    fireEvent.submit(screen.getByRole("button", { name: "Create balance link" }).closest("form")!);
    await waitFor(() => expect(createAction).toHaveBeenCalledOnce());
    expect(createAction.mock.calls[0]?.[1].getAll("selectedReceiptId")).toEqual([receipt.id]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save receipt visibility" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: /dinner\.png/ }));
    fireEvent.submit(screen.getByRole("button", { name: "Save receipt visibility" }).closest("form")!);
    await waitFor(() => expect(updateAction).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /dinner\.png/ })).not.toBeChecked());
    expect(screen.getByLabelText("Temporary balance link")).toHaveValue(`${window.location.origin}/share/11111111-1111-4111-8111-111111111111`);
  });
});
