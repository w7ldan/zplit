import { describe, expect, it } from "vitest";
import { normalizeNotificationMetadata, presentNotification } from "./notifications";

describe("notification catalog", () => {
  it("accepts only the bounded metadata for a known type", () => {
    expect(normalizeNotificationMetadata("system.test", { message: "  Ready  " })).toEqual({ message: "Ready" });
    expect(() => normalizeNotificationMetadata("system.test", { message: "" })).toThrow("Invalid metadata");
    expect(() => normalizeNotificationMetadata("system.test", { message: "x", unsafe: true })).toThrow("Invalid metadata");
    expect(() => normalizeNotificationMetadata("future.unknown" as never, { message: "nope" })).toThrow("Unsupported notification type");
  });

  it("falls back to escaped-by-React text for unsupported or malformed stored data", () => {
    expect(presentNotification("future.unknown", { html: "<img>" })).toEqual({ label: "Update", primary: "You have a new notification." });
    expect(presentNotification("system.test", { message: "<not html>" })).toEqual({ label: "System", primary: "<not html>" });
  });

  it("presents Friend-link requests without private account fields", () => {
    expect(presentNotification("friend.link.request", {
      requestId: "11111111-1111-4111-8111-111111111111",
      requesterDisplayName: "Owner",
      requesterUsername: "owner",
      friendName: "Office",
    })).toEqual({ label: "Friend link request", primary: "Owner @owner wants to link “Office”.", secondary: "Identity confirmation only." });
    expect(() => normalizeNotificationMetadata("friend.link.request", { requesterUsername: "owner", email: "owner@example.com" })).toThrow("Invalid metadata");
  });

  it("presents Organization invitations without accepting private fields", () => {
    const metadata = {
      invitationId: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      organizationName: "Zplit Team",
      inviterDisplayName: "Wildan",
      role: "treasurer",
      expiresAt: "2026-09-01T00:00:00.000Z",
    } as const;
    expect(presentNotification("organization.invitation", metadata)).toEqual({
      label: "Organization invitation",
      primary: "Wildan invited you to join Zplit Team as Treasurer.",
    });
    expect(() => normalizeNotificationMetadata("organization.invitation", { ...metadata, email: "private@example.com" })).toThrow("Invalid metadata");
    expect(() => normalizeNotificationMetadata("organization.invitation", { ...metadata, role: "owner" })).toThrow("Invalid metadata");
  });

  it("presents Group invitations and link requests from durable request identity", () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const groupId = "22222222-2222-4222-8222-222222222222";
    expect(presentNotification("group.invitation", {
      requestId,
      groupId,
      groupName: "Bandung Trip",
      requesterDisplayName: "Wildan",
      requesterUsername: "wildan",
      expiresAt: "2026-09-01T00:00:00.000Z",
    })).toEqual({ label: "Group invitation", primary: "Wildan @wildan invited you to join Bandung Trip." });
    expect(presentNotification("group.participant.link.request", {
      requestId,
      groupId,
      groupName: "Bandung Trip",
      requesterDisplayName: "Wildan",
      requesterUsername: "wildan",
      participantDisplayName: "Alice",
      participantLabel: "Fasilkom",
      expiresAt: "2026-09-01T00:00:00.000Z",
    })).toEqual({
      label: "Group account link",
      primary: "Wildan @wildan wants to link your Zplit account to “Alice · Fasilkom” in Bandung Trip.",
      secondary: "This links your account to an existing Group participant.",
    });
    expect(() => normalizeNotificationMetadata("group.invitation", {
      requestId,
      groupId,
      groupName: "Bandung Trip",
      requesterDisplayName: "Wildan",
      requesterUsername: "wildan",
      expiresAt: "2026-09-01T00:00:00.000Z",
      email: "private@example.com",
    })).toThrow("Invalid metadata");
  });

  it("presents Group payer claims from durable expense identity", () => {
    const metadata = {
      expenseId: "11111111-1111-4111-8111-111111111111",
      groupId: "22222222-2222-4222-8222-222222222222",
      groupName: "Bandung Trip",
      description: "Dinner",
    } as const;
    expect(presentNotification("group.expense.payer.claim", metadata)).toEqual({
      label: "Group expense confirmation",
      primary: "Review the claim that you paid “Dinner” in Bandung Trip.",
      secondary: "Confirm that you paid it or reject the claim.",
    });
    expect(() => normalizeNotificationMetadata("group.expense.payer.claim", { ...metadata, expenseId: "not-an-id" })).toThrow("Invalid metadata");
  });

  it("validates settlement confirmation identity in notification metadata", () => {
    const metadata = {
      settlementId: "11111111-1111-4111-8111-111111111111",
      groupId: "22222222-2222-4222-8222-222222222222",
      groupName: "Bandung Trip",
      senderParticipantId: "33333333-3333-4333-8333-333333333333",
      senderDisplayName: "Wildan",
    } as const;
    expect(normalizeNotificationMetadata("group.settlement.confirmation", metadata)).toEqual(metadata);
    expect(presentNotification("group.settlement.confirmation", metadata)).toEqual({
      label: "Group payment confirmation",
      primary: "Wildan recorded a payment to you in Bandung Trip.",
      secondary: "Confirmation is required.",
    });
    expect(() => normalizeNotificationMetadata("group.settlement.confirmation", { ...metadata, senderParticipantId: "not-an-id" })).toThrow("Invalid metadata");
  });

  it("presents offset confirmation with its exact Group and offset identity", () => {
    const metadata = {
      offsetId: "11111111-1111-4111-8111-111111111111",
      groupId: "22222222-2222-4222-8222-222222222222",
      groupName: "Bandung Trip",
      initiatorParticipantId: "33333333-3333-4333-8333-333333333333",
      initiatorDisplayName: "Wildan",
    } as const;
    expect(normalizeNotificationMetadata("group.offset.confirmation", metadata)).toEqual(metadata);
    expect(presentNotification("group.offset.confirmation", metadata)).toEqual({
      label: "Group offset confirmation",
      primary: "Wildan proposed an offset with you in Bandung Trip.",
      secondary: "No money moves; confirmation is required.",
    });
    expect(() => normalizeNotificationMetadata("group.offset.confirmation", { ...metadata, offsetId: "not-an-id" })).toThrow("Invalid metadata");
  });

  it("presents decision outcomes with stable object identity and no private fields", () => {
    const ids = {
      requestId: "11111111-1111-4111-8111-111111111111",
      friendId: "22222222-2222-4222-8222-222222222222",
      organizationId: "33333333-3333-4333-8333-333333333333",
      invitationId: "44444444-4444-4444-8444-444444444444",
      groupId: "55555555-5555-4555-8555-555555555555",
      expenseId: "66666666-6666-4666-8666-666666666666",
      settlementId: "77777777-7777-4777-8777-777777777777",
      offsetId: "88888888-8888-4888-8888-888888888888",
    };
    expect(normalizeNotificationMetadata("friend.link.request.outcome", { requestId: ids.requestId, friendId: ids.friendId, status: "accepted" })).toEqual({ requestId: ids.requestId, friendId: ids.friendId, status: "accepted" });
    expect(presentNotification("organization.invitation.outcome", { invitationId: ids.invitationId, organizationId: ids.organizationId, status: "declined" })).toEqual({ label: "Organization invitation outcome", primary: "Your Organization invitation was declined." });
    expect(presentNotification("group.invitation.outcome", { requestId: ids.requestId, groupId: ids.groupId, status: "accepted" })).toEqual({ label: "Group invitation outcome", primary: "Your Group invitation was accepted." });
    expect(presentNotification("group.participant.link.outcome", { requestId: ids.requestId, groupId: ids.groupId, status: "declined" })).toEqual({ label: "Group account link outcome", primary: "Your Group account link request was declined." });
    expect(presentNotification("group.expense.payer.claim.outcome", { expenseId: ids.expenseId, groupId: ids.groupId, description: "Dinner", status: "rejected" })).toEqual({ label: "Group expense outcome", primary: "Your payer claim for “Dinner” was rejected." });
    expect(presentNotification("group.settlement.outcome", { settlementId: ids.settlementId, groupId: ids.groupId, status: "confirmed" })).toEqual({ label: "Group payment outcome", primary: "Your Group payment was confirmed." });
    expect(presentNotification("group.offset.outcome", { offsetId: ids.offsetId, groupId: ids.groupId, status: "confirmed" })).toEqual({ label: "Group offset outcome", primary: "Your Group offset proposal was confirmed." });
    expect(() => normalizeNotificationMetadata("group.settlement.outcome", { settlementId: ids.settlementId, groupId: ids.groupId, status: "confirmed", email: "private@example.com" })).toThrow("Invalid metadata");
  });
});
