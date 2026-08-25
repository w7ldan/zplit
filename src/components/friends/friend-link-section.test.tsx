import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FriendLinkSection } from "./friend-link-section";

const search = vi.fn().mockResolvedValue([]);

describe("FriendLinkSection", () => {
  it("keeps the unlinked state compact and opens username-only search", () => {
    render(<FriendLinkSection status={{ status: "unlinked" }} search={search} action={vi.fn()} />);
    expect(screen.getByText("Not linked")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Link Zplit account" }));
    fireEvent.click(document.querySelector<HTMLButtonElement>(".searchable-combobox__custom button")!);
    expect(screen.getByLabelText("Search @username")).toBeInTheDocument();
    expect(screen.queryByText(/email/i)).not.toBeInTheDocument();
  });

  it("renders the pending request and owner cancellation", () => {
    const cancel = vi.fn();
    render(<FriendLinkSection status={{ status: "pending", requestId: "request-a", target: { displayName: "Alice Tan", username: "alice" } }} search={search} action={vi.fn()} cancelAction={cancel} />);
    expect(screen.getByText("Awaiting confirmation")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
  });

  it("keeps the local Friend identity separate from the confirmed account identity", () => {
    render(<FriendLinkSection status={{ status: "linked", user: { displayName: "Alice Tan", username: "alice" } }} search={search} action={vi.fn()} unlinkAction={vi.fn()} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Alice Tan")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Unlink", { selector: "summary" }));
    expect(screen.getByText("Unlink @alice?")).toBeInTheDocument();
    expect(screen.getByText(/Existing Friend balances and history remain unchanged/)).toBeInTheDocument();
  });
});
