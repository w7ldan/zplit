import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";

const mocks = vi.hoisted(() => ({
  getAuthenticatedLedger: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  setOrder: vi.fn(),
  updateUsername: vi.fn(),
  getDatabase: vi.fn(),
  getAvatar: vi.fn(),
}));

vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: mocks.getAuthenticatedLedger }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/user-avatars", () => ({ getUserAvatarMetadata: mocks.getAvatar }));
vi.mock("./actions", () => ({
  createRepaymentDestinationAction: mocks.create,
  updateRepaymentDestinationAction: mocks.update,
  deleteRepaymentDestinationAction: mocks.remove,
  setRepaymentDestinationOrderAction: mocks.setOrder,
  updateUsernameAction: mocks.updateUsername,
}));

const destinations = [
  { id: "11111111-1111-4111-8111-111111111111", type: "bank_account" as const, name: "BCA", identifier: "123456", accountName: "Wildan", note: null, shareOnBalanceLinks: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() },
  { id: "22222222-2222-4222-8222-222222222222", type: "e_wallet" as const, name: "GoPay", identifier: "0812", accountName: null, note: "Use this number", shareOnBalanceLinks: false, sortOrder: 1, createdAt: new Date(), updatedAt: new Date() },
];

describe("/app/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabase.mockReturnValue({});
    mocks.getAvatar.mockResolvedValue(null);
    mocks.getAuthenticatedLedger.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", username: "wildan", email: "owner@example.com" }, ledger: { listRepaymentDestinations: vi.fn().mockResolvedValue(destinations) } });
  });

  it("renders the two-column account workspace and repayment destinations", async () => {
    render(await SettingsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Account context" })).toBeInTheDocument();
    expect(document.querySelector(".settings-page__profile-column--identity")).toContainElement(screen.getByText("Identity", { selector: "p" }));
    expect(document.querySelector(".settings-page__profile-column--account")).toContainElement(screen.getByText("Account", { selector: "p" }));
    expect(document.querySelector(".settings-page__profile-column--account")).toContainElement(screen.getByText("Appearance", { selector: "p" }));
    expect(document.querySelectorAll(".settings-page__identity .user-avatar")).toHaveLength(1);
    expect(document.querySelector(".settings-page__identity svg")).toBeInTheDocument();
    expect(document.querySelector(".settings-page__identity > .user-avatar")).toBeInTheDocument();
    expect(document.querySelector(".settings-page__identity > .settings-page__identity-details .settings-page__avatar-control")).toBeInTheDocument();
    expect(document.querySelector(".settings-page__identity-name")).toHaveTextContent("Wildan");
    const nameTerm = screen.getByText("Name", { selector: "dt" });
    const usernameTerm = screen.getByText("Username", { selector: "dt" });
    expect(nameTerm.closest("dl")).toContainElement(screen.getByText("Wildan", { selector: "dd" }));
    expect(usernameTerm.closest("dl")).toContainElement(screen.getByText("@wildan").closest("dd"));
    expect(screen.getByText("@wildan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change photo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Repayment destinations" })).toBeInTheDocument();
    expect(screen.getByText("Sign-in email")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("BCA")).toBeInTheDocument();
    expect(screen.getByText("GoPay")).toBeInTheDocument();
    expect(screen.getByText("Shown on balance links")).toBeInTheDocument();
    expect(screen.getByText("Not shown on balance links")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move BCA up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move BCA down" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Move GoPay up" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Move GoPay down" })).toBeDisabled();
    expect(screen.getAllByText("Edit", { exact: true })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "New destination" })).toBeInTheDocument();
    expect(screen.queryByText("ADD DESTINATION")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".theme-control")).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: "Theme" })).toBeInTheDocument();
  });

  it("renders custom avatar media in the same single profile position", async () => {
    const sha256 = "a".repeat(64);
    mocks.getAvatar.mockResolvedValue({ mediaType: "image/webp", byteSize: 4, sha256 });
    render(await SettingsPage({ searchParams: Promise.resolve({}) }));
    expect(document.querySelectorAll(".settings-page__identity .user-avatar")).toHaveLength(1);
    expect(document.querySelector(".settings-page__identity img")).toHaveAttribute("src", `/app/avatar?userId=owner-a&v=${sha256}`);
    expect(screen.getByRole("button", { name: "Remove photo" })).toBeInTheDocument();
    expect(screen.getByText("@wildan")).toBeInTheDocument();
  });

  it("shows the empty destination state and save confirmation", async () => {
    mocks.getAuthenticatedLedger.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", username: null, email: "owner@example.com" }, ledger: { listRepaymentDestinations: vi.fn().mockResolvedValue([]) } });
    render(await SettingsPage({ searchParams: Promise.resolve({ saved: "1" }) }));
    expect(screen.getByText(/No repayment destinations yet\./)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Settings saved.");
    expect(screen.getByRole("button", { name: "New destination" })).toBeInTheDocument();
    expect(screen.queryByText("ADD DESTINATION")).not.toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });
});
