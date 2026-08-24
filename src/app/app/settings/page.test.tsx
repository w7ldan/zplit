import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";

const mocks = vi.hoisted(() => ({
  getAuthenticatedLedger: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
}));

vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: mocks.getAuthenticatedLedger }));
vi.mock("./actions", () => ({
  createRepaymentDestinationAction: mocks.create,
  updateRepaymentDestinationAction: mocks.update,
  deleteRepaymentDestinationAction: mocks.remove,
  reorderRepaymentDestinationsAction: mocks.reorder,
}));

const destinations = [
  { id: "11111111-1111-4111-8111-111111111111", type: "bank_account" as const, name: "BCA", identifier: "123456", accountName: "Wildan", note: null, shareOnBalanceLinks: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() },
  { id: "22222222-2222-4222-8222-222222222222", type: "e_wallet" as const, name: "GoPay", identifier: "0812", accountName: null, note: "Use this number", shareOnBalanceLinks: false, sortOrder: 1, createdAt: new Date(), updatedAt: new Date() },
];

describe("/app/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedLedger.mockResolvedValue({ user: { name: "Wildan", email: "owner@example.com" }, ledger: { listRepaymentDestinations: vi.fn().mockResolvedValue(destinations) } });
  });

  it("renders modular profile, repayment, and appearance sections", async () => {
    render(await SettingsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Account context" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Repayment destinations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Theme" })).toBeInTheDocument();
    expect(screen.getByText("BCA")).toBeInTheDocument();
    expect(screen.getByText("GoPay")).toBeInTheDocument();
    expect(screen.getByText("Shown on balance links")).toBeInTheDocument();
    expect(screen.getByText("Not shown on balance links")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move BCA up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move BCA down" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Move GoPay up" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Move GoPay down" })).toBeDisabled();
    expect(screen.getAllByText("Edit", { exact: true })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add destination" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Theme" })).toBeInTheDocument();
  });

  it("shows the empty destination state and save confirmation", async () => {
    mocks.getAuthenticatedLedger.mockResolvedValue({ user: { name: "Wildan", email: "owner@example.com" }, ledger: { listRepaymentDestinations: vi.fn().mockResolvedValue([]) } });
    render(await SettingsPage({ searchParams: Promise.resolve({ saved: "1" }) }));
    expect(screen.getByText("No repayment destinations yet.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Settings saved.");
    expect(screen.getByRole("button", { name: "Add destination" })).toBeInTheDocument();
  });
});
