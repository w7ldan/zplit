import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAuthenticatedOrganizationLedger: vi.fn() }));

vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedOrganizationLedger: mocks.getAuthenticatedOrganizationLedger }));

import OrganizationExportsPage from "./page";

describe("Organization exports capability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedOrganizationLedger.mockResolvedValue({});
  });

  it("authorizes the page with exports.create rather than ledger.view", async () => {
    render(await OrganizationExportsPage({ params: Promise.resolve({ organizationId: "org-a" }) }));
    expect(mocks.getAuthenticatedOrganizationLedger).toHaveBeenCalledWith("org-a", "exports.create");
    expect(screen.getByRole("heading", { name: "Exports" })).toBeInTheDocument();
  });
});
