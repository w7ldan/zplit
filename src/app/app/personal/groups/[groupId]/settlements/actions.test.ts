import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TestGroupSettlementError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  class TestGroupOffsetError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    requireSession: vi.fn(),
    getDatabase: vi.fn(),
    createSettlement: vi.fn(),
    confirmSettlement: vi.fn(),
    createProof: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new Error(`redirect:${path}`);
    }),
    GroupSettlementError: TestGroupSettlementError,
    GroupOffsetError: TestGroupOffsetError,
  };
});

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/group-settlements", () => ({
  createGroupSettlement: mocks.createSettlement,
  confirmGroupSettlement: mocks.confirmSettlement,
  GroupSettlementError: mocks.GroupSettlementError,
}));
vi.mock("@/server/group-offsets", () => ({
  createGroupOffset: vi.fn(),
  confirmGroupOffset: vi.fn(),
  GroupOffsetError: mocks.GroupOffsetError,
}));
vi.mock("@/server/group-settlement-proofs", () => ({
  createGroupSettlementProof: mocks.createProof,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  confirmGroupSettlementAction,
  createGroupSettlementAction,
  type GroupSettlementActionState,
} from "./actions";

const groupId = "11111111-1111-4111-8111-111111111111";
const senderParticipantId = "22222222-2222-4222-8222-222222222222";
const recipientParticipantId = "33333333-3333-4333-8333-333333333333";
const settlementId = "44444444-4444-4444-8444-444444444444";
const emptyState: GroupSettlementActionState = {
  fieldErrors: {},
  formError: "",
  values: {
    recipientParticipantId: "",
    amountRupiah: "",
    paymentMethodChoice: "",
    paymentMethodOther: "",
  },
};

function paymentForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("recipientParticipantId", recipientParticipantId);
  form.set("amountRupiah", "70000");
  form.set("paymentMethodChoice", "Cash");
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

describe("Group settlement actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createSettlement.mockResolvedValue({ id: settlementId });
    mocks.confirmSettlement.mockResolvedValue({ state: "confirmed" });
  });

  it("uses the authenticated sender and redirects to the new pending payment", async () => {
    await expect(
      createGroupSettlementAction(
        groupId,
        senderParticipantId,
        emptyState,
        paymentForm(),
      ),
    ).rejects.toThrow(`redirect:/app/personal/groups/${groupId}/settlements/${settlementId}?created=1`);
    expect(mocks.createSettlement).toHaveBeenCalledWith(
      "database",
      groupId,
      "user-a",
      expect.objectContaining({
        senderParticipantId,
        recipientParticipantId,
        amount: 70000,
        paymentMethod: "Cash",
      }),
    );
  });

  it("validates the amount before touching accounting", async () => {
    const result = await createGroupSettlementAction(
      groupId,
      senderParticipantId,
      emptyState,
      paymentForm({ amountRupiah: "0" }),
    );
    expect(result.fieldErrors.amountRupiah).toBe("Use a positive whole-rupiah amount.");
    expect(mocks.createSettlement).not.toHaveBeenCalled();
  });

  it("attaches one optional proof after creating the payment", async () => {
    const form = paymentForm();
    form.set(
      "proof",
      new File(
        [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        "transfer.png",
        { type: "image/png" },
      ),
    );
    await expect(
      createGroupSettlementAction(
        groupId,
        senderParticipantId,
        emptyState,
        form,
      ),
    ).rejects.toThrow("redirect:");
    expect(mocks.createProof).toHaveBeenCalledWith(
      "database",
      groupId,
      settlementId,
      "user-a",
      expect.objectContaining({ originalFilename: "transfer.png", mediaType: "image/png" }),
    );
  });

  it("maps current-debt conflicts to an actionable form error", async () => {
    mocks.createSettlement.mockRejectedValue(new mocks.GroupSettlementError("debt_exceeded"));
    const result = await createGroupSettlementAction(
      groupId,
      senderParticipantId,
      emptyState,
      paymentForm(),
    );
    expect(result.formError).toContain("current debt");
  });

  it("confirms only through the authenticated recipient action", async () => {
    const result = await confirmGroupSettlementAction(
      groupId,
      settlementId,
      { error: "" },
      new FormData(),
    );
    expect(result.success).toContain("canonical Group balance");
    expect(mocks.confirmSettlement).toHaveBeenCalledWith(
      "database",
      groupId,
      settlementId,
      "user-a",
    );

    mocks.confirmSettlement.mockRejectedValue(new mocks.GroupSettlementError("forbidden"));
    await expect(
      confirmGroupSettlementAction(groupId, settlementId, { error: "" }, new FormData()),
    ).resolves.toEqual({ error: "Only the payment recipient can confirm this payment." });
  });
});
