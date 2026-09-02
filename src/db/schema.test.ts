import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

const domainTables = [
  "chat_messages",
  "chat_thread_reads",
  "chat_threads",
  "expense_charge_targets",
  "expense_charges",
  "expense_receipts",
  "expense_shares",
  "expenses",
  "friend_connections",
  "friend_link_requests",
  "friends",
  "group_avatars",
  "group_expense_lifecycle_events",
  "group_expense_receipts",
  "group_expense_shares",
  "group_expenses",
  "group_join_requests",
  "group_memberships",
  "group_obligations",
  "group_offset_applications",
  "group_offset_settlements",
  "group_participants",
  "group_settlement_applications",
  "group_settlement_proofs",
  "group_settlements",
  "groups",
  "ledger_scopes",
  "notifications",
  "organization_avatars",
  "organization_invitations",
  "organization_memberships",
  "organization_participants",
  "organizations",
  "outings",
  "repayment_allocations",
  "repayment_destinations",
  "repayment_proofs",
  "repayments",
  "trips",
];

const authTables = [schema.users, schema.sessions, schema.accounts, schema.verifications];

function columnNames(columns: readonly unknown[]) {
  return columns.flatMap((column) => {
    if (typeof column === "object" && column !== null && "name" in column && typeof column.name === "string") {
      return [column.name];
    }
    return [];
  });
}

function indexColumns(table: unknown, name: string) {
  const index = getTableConfig(table as never).indexes.find((candidate) => candidate.config.name === name);
  return index ? columnNames(index.config.columns) : undefined;
}

function foreignKeyShape(table: unknown) {
  return getTableConfig(table as never).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();
    return {
      from: columnNames(reference.columns),
      to: getTableConfig(reference.foreignTable).name,
      target: columnNames(reference.foreignColumns),
      onDelete: foreignKey.onDelete,
    };
  });
}

describe("database schema", () => {
  it("defines one nullable-by-absence normalized avatar per user", () => {
    const table = getTableConfig(schema.userAvatars);
    expect(table.name).toBe("user_avatars");
    expect(table.columns.map((column) => column.name)).toEqual(["user_id", "media_type", "byte_size", "sha256", "content", "created_at", "updated_at"]);
    expect(table.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "user_avatars_media_type_allowed",
      "user_avatars_byte_size_valid",
      "user_avatars_content_size_matches",
      "user_avatars_sha256_hex",
    ]));
    expect(foreignKeyShape(schema.userAvatars)).toEqual([{ from: ["user_id"], to: "users", target: ["id"], onDelete: "cascade" }]);
  });

  it("exports the domain tables and four auth tables", () => {
    expect(
      [schema.chatMessages, schema.chatThreadReads, schema.chatThreads, schema.friends, schema.friendConnections, schema.friendLinkRequests, schema.outings, schema.trips, schema.expenses, schema.expenseShares, schema.expenseCharges, schema.expenseChargeTargets, schema.expenseReceipts, schema.repayments, schema.repaymentProofs, schema.repaymentAllocations, schema.repaymentDestinations, schema.notifications, schema.organizations, schema.organizationParticipants, schema.organizationMemberships, schema.organizationInvitations, schema.organizationAvatars, schema.ledgerScopes, schema.groups, schema.groupParticipants, schema.groupMemberships, schema.groupAvatars, schema.groupJoinRequests, schema.groupExpenses, schema.groupExpenseShares, schema.groupObligations, schema.groupSettlementProofs, schema.groupSettlements, schema.groupSettlementApplications, schema.groupOffsetSettlements, schema.groupOffsetApplications, schema.groupExpenseReceipts, schema.groupExpenseLifecycleEvents]
        .map((table) => getTableConfig(table).name)
        .sort(),
    ).toEqual(domainTables);
    expect(authTables.map((table) => getTableConfig(table).name).sort()).toEqual([
      "accounts",
      "sessions",
      "users",
      "verifications",
    ]);
  });

  it("defines one scoped chat thread and durable tombstone messages", () => {
    const threads = getTableConfig(schema.chatThreads);
    expect(threads.columns.map((column) => column.name)).toEqual(["id", "organization_id", "group_id", "created_at", "updated_at"]);
    expect(threads.checks.map((check) => check.name)).toContain("chat_threads_parent_xor");
    expect(foreignKeyShape(schema.chatThreads)).toEqual(expect.arrayContaining([
      { from: ["organization_id"], to: "organizations", target: ["id"], onDelete: "cascade" },
      { from: ["group_id"], to: "groups", target: ["id"], onDelete: "cascade" },
    ]));
    expect(indexColumns(schema.chatThreads, "chat_threads_organization_uidx")).toEqual(["organization_id"]);
    expect(indexColumns(schema.chatThreads, "chat_threads_group_uidx")).toEqual(["group_id"]);

    const messages = getTableConfig(schema.chatMessages);
    expect(messages.columns.map((column) => column.name)).toEqual([
      "id", "thread_id", "organization_id", "group_id", "sender_user_id", "sender_participant_id", "body", "created_at", "edited_at", "deleted_at", "deleted_by_user_id",
    ]);
    expect(messages.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "chat_messages_body_not_blank",
      "chat_messages_body_length_valid",
      "chat_messages_parent_xor",
      "chat_messages_participant_scope",
      "chat_messages_deleted_identity_shape",
    ]));
    expect(foreignKeyShape(schema.chatMessages)).toEqual(expect.arrayContaining([
      { from: ["thread_id"], to: "chat_threads", target: ["id"], onDelete: "cascade" },
      { from: ["thread_id", "organization_id"], to: "chat_threads", target: ["id", "organization_id"], onDelete: "cascade" },
      { from: ["thread_id", "group_id"], to: "chat_threads", target: ["id", "group_id"], onDelete: "cascade" },
      { from: ["group_id", "sender_user_id", "sender_participant_id"], to: "group_participants", target: ["group_id", "user_id", "id"], onDelete: "restrict" },
    ]));
    expect(indexColumns(schema.chatMessages, "chat_messages_thread_created_idx")).toEqual(["thread_id", "created_at", "id"]);

    const reads = getTableConfig(schema.chatThreadReads);
    expect(reads.columns.map((column) => column.name)).toEqual(["thread_id", "user_id", "last_read_message_id", "created_at", "updated_at"]);
    expect(foreignKeyShape(schema.chatThreadReads)).toEqual(expect.arrayContaining([
      { from: ["thread_id"], to: "chat_threads", target: ["id"], onDelete: "cascade" },
      { from: ["user_id"], to: "users", target: ["id"], onDelete: "restrict" },
      { from: ["thread_id", "last_read_message_id"], to: "chat_messages", target: ["thread_id", "id"], onDelete: "cascade" },
    ]));
  });

  it("defines Group expenses, shares, obligations, and private receipt storage with same-Group keys", () => {
    const expenses = getTableConfig(schema.groupExpenses);
    expect(expenses.columns.map((column) => column.name)).toEqual(["id", "group_id", "creator_participant_id", "payer_participant_id", "description", "occurred_at", "total_amount", "state", "confirmed_at", "created_at", "updated_at"]);
    expect(expenses.checks.map((check) => check.name)).toEqual(expect.arrayContaining(["group_expenses_total_amount_positive", "group_expenses_state_allowed", "group_expenses_confirmation_timestamp_shape"]));
    expect(foreignKeyShape(schema.groupExpenses)).toEqual(expect.arrayContaining([
      { from: ["group_id", "creator_participant_id"], to: "group_participants", target: ["group_id", "id"], onDelete: "restrict" },
      { from: ["group_id", "payer_participant_id"], to: "group_participants", target: ["group_id", "id"], onDelete: "restrict" },
    ]));
    const shares = getTableConfig(schema.groupExpenseShares);
    expect(shares.checks.map((check) => check.name)).toContain("group_expense_shares_amount_positive");
    expect(foreignKeyShape(schema.groupExpenseShares)).toEqual(expect.arrayContaining([
      { from: ["group_id", "expense_id"], to: "group_expenses", target: ["group_id", "id"], onDelete: "restrict" },
      { from: ["group_id", "participant_id"], to: "group_participants", target: ["group_id", "id"], onDelete: "restrict" },
    ]));
    const obligations = getTableConfig(schema.groupObligations);
    expect(obligations.checks.map((check) => check.name)).toEqual(expect.arrayContaining(["group_obligations_original_amount_positive", "group_obligations_no_self_debt"]));
    expect(foreignKeyShape(schema.groupObligations)).toEqual(expect.arrayContaining([
      { from: ["group_id", "source_expense_id", "source_share_id"], to: "group_expense_shares", target: ["group_id", "expense_id", "id"], onDelete: "restrict" },
      { from: ["group_id", "debtor_participant_id"], to: "group_participants", target: ["group_id", "id"], onDelete: "restrict" },
      { from: ["group_id", "creditor_participant_id"], to: "group_participants", target: ["group_id", "id"], onDelete: "restrict" },
    ]));
    expect(getTableConfig(schema.groupExpenseReceipts).checks.map((check) => check.name)).toEqual(expect.arrayContaining(["group_expense_receipts_content_size_matches", "group_expense_receipts_sha256_hex"]));
    const lifecycleEvents = getTableConfig(schema.groupExpenseLifecycleEvents);
    expect(lifecycleEvents.columns.map((column) => column.name)).toEqual(["id", "group_id", "expense_id", "event_type", "actor_user_id", "from_state", "to_state", "created_at"]);
    expect(lifecycleEvents.checks.map((check) => check.name)).toEqual(expect.arrayContaining(["group_expense_lifecycle_events_type_allowed", "group_expense_lifecycle_events_transition_shape"]));
  });

  it("defines stable Group participants and membership scope constraints", () => {
    const group = getTableConfig(schema.groups);
    expect(group.columns.map((column) => column.name)).toEqual(["id", "name", "description", "created_by_user_id", "created_at", "updated_at"]);
    const participants = getTableConfig(schema.groupParticipants);
    expect(participants.columns.map((column) => column.name)).toEqual([
      "id", "group_id", "user_id", "source_personal_friend_id", "display_name", "label", "created_at", "updated_at",
    ]);
    expect(participants.checks.map((check) => check.name)).toEqual(expect.arrayContaining(["group_participants_identity_shape", "group_participants_label_not_blank"]));
    expect(indexColumns(schema.groupParticipants, "group_participants_registered_user_uidx")).toEqual(["group_id", "user_id"]);
    expect(indexColumns(
      schema.groupParticipants,
      "group_participants_group_source_personal_friend_uidx",
    )).toEqual(["group_id", "source_personal_friend_id"]);
    const memberships = getTableConfig(schema.groupMemberships);
    expect(memberships.columns.map((column) => column.name)).toEqual(["group_id", "user_id", "participant_id", "role", "joined_at"]);
    expect(memberships.checks.map((check) => check.name)).toContain("group_memberships_role_allowed");
    expect(indexColumns(schema.groupMemberships, "group_memberships_one_owner_uidx")).toEqual(["group_id"]);
    expect(foreignKeyShape(schema.groupMemberships)).toEqual(expect.arrayContaining([
      { from: ["group_id", "participant_id"], to: "group_participants", target: ["group_id", "id"], onDelete: "restrict" },
      { from: ["group_id", "user_id", "participant_id"], to: "group_participants", target: ["group_id", "user_id", "id"], onDelete: "restrict" },
    ]));
    expect(foreignKeyShape(schema.groupParticipants)).toContainEqual({
      from: ["source_personal_friend_id"],
      to: "friends",
      target: ["id"],
      onDelete: "restrict",
    });
    expect(getTableConfig(schema.groupAvatars).checks.map((check) => check.name)).toEqual(expect.arrayContaining(["group_avatars_media_type_allowed", "group_avatars_content_size_matches"]));
  });

  it("defines immutable Group settlements and separate proof storage", () => {
    const settlements = getTableConfig(schema.groupSettlements);
    expect(settlements.columns.map((column) => column.name)).toEqual([
      "id", "group_id", "sender_participant_id", "recipient_participant_id", "amount", "payment_method", "state", "created_at", "confirmed_at",
    ]);
    expect(settlements.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "group_settlements_amount_positive",
      "group_settlements_state_allowed",
      "group_settlements_no_self_payment",
      "group_settlements_confirmation_timestamp_shape",
    ]));
    expect(indexColumns(schema.groupSettlements, "group_settlements_group_sender_recipient_idx")).toEqual([
      "group_id", "sender_participant_id", "recipient_participant_id", "created_at", "id",
    ]);
    expect(indexColumns(schema.groupSettlements, "group_settlements_pending_recipient_idx")).toEqual([
      "group_id", "recipient_participant_id", "created_at", "id",
    ]);
    expect(foreignKeyShape(schema.groupSettlements)).toEqual(expect.arrayContaining([
      { from: ["group_id", "sender_participant_id"], to: "group_participants", target: ["group_id", "id"], onDelete: "restrict" },
      { from: ["group_id", "recipient_participant_id"], to: "group_participants", target: ["group_id", "id"], onDelete: "restrict" },
    ]));
    expect(foreignKeyShape(schema.groupSettlementProofs)).toContainEqual({
      from: ["group_id", "settlement_id"],
      to: "group_settlements",
      target: ["group_id", "id"],
      onDelete: "restrict",
    });
  });

  it("defines immutable reciprocal Group offsets with Group-safe applications", () => {
    const offsets = getTableConfig(schema.groupOffsetSettlements);
    expect(offsets.columns.map((column) => column.name)).toEqual([
      "id", "group_id", "initiator_participant_id", "counterparty_participant_id", "amount", "state", "created_at", "confirmed_at",
    ]);
    expect(offsets.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "group_offset_settlements_amount_positive",
      "group_offset_settlements_state_allowed",
      "group_offset_settlements_no_self_offset",
      "group_offset_settlements_confirmation_timestamp_shape",
    ]));
    expect(foreignKeyShape(schema.groupOffsetSettlements)).toEqual(expect.arrayContaining([
      { from: ["group_id", "initiator_participant_id"], to: "group_participants", target: ["group_id", "id"], onDelete: "restrict" },
      { from: ["group_id", "counterparty_participant_id"], to: "group_participants", target: ["group_id", "id"], onDelete: "restrict" },
    ]));
    const applications = getTableConfig(schema.groupOffsetApplications);
    expect(applications.columns.map((column) => column.name)).toEqual([
      "id", "group_id", "offset_settlement_id", "obligation_id", "applied_amount", "created_at",
    ]);
    expect(foreignKeyShape(schema.groupOffsetApplications)).toEqual(expect.arrayContaining([
      { from: ["group_id", "offset_settlement_id"], to: "group_offset_settlements", target: ["group_id", "id"], onDelete: "restrict" },
      { from: ["group_id", "obligation_id"], to: "group_obligations", target: ["group_id", "id"], onDelete: "restrict" },
    ]));
  });

  it("constrains Group join request identity, state, and cross-Group participants", () => {
    const requests = getTableConfig(schema.groupJoinRequests);
    expect(requests.columns.map((column) => column.name)).toEqual([
      "id", "group_id", "kind", "participant_id", "participant_display_name_snapshot", "participant_label_snapshot", "target_user_id", "requester_user_id", "status", "expires_at", "created_at", "updated_at", "accepted_at", "declined_at", "revoked_at", "expired_at",
    ]);
    expect(requests.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "group_join_requests_kind_participant_shape",
      "group_join_requests_status_allowed",
      "group_join_requests_transition_timestamps",
    ]));
    expect(indexColumns(schema.groupJoinRequests, "group_join_requests_pending_group_target_uidx")).toEqual(["group_id", "target_user_id"]);
    expect(indexColumns(schema.groupJoinRequests, "group_join_requests_pending_group_participant_uidx")).toEqual(["group_id", "participant_id"]);
    expect(foreignKeyShape(schema.groupJoinRequests)).toEqual(expect.arrayContaining([
      { from: ["group_id", "participant_id"], to: "group_participants", target: ["group_id", "id"], onDelete: "set null" },
      { from: ["target_user_id"], to: "users", target: ["id"], onDelete: "cascade" },
      { from: ["requester_user_id"], to: "users", target: ["id"], onDelete: "restrict" },
    ]));
  });

  it("keeps Friend identity linking nullable and request state constrained", () => {
    const friend = getTableConfig(schema.friends);
    expect(friend.columns.find((column) => column.name === "linked_user_id")?.notNull).toBe(false);
    expect(foreignKeyShape(schema.friends)).toEqual(expect.arrayContaining([
      { from: ["linked_user_id"], to: "users", target: ["id"], onDelete: "set null" },
      { from: ["source_personal_friend_id"], to: "friends", target: ["id"], onDelete: "restrict" },
    ]));
    expect(indexColumns(schema.friends, "friends_ledger_scope_linked_user_uidx")).toEqual(["ledger_scope_id", "linked_user_id"]);
    expect(indexColumns(
      schema.friends,
      "friends_ledger_scope_source_personal_friend_uidx",
    )).toEqual(["ledger_scope_id", "source_personal_friend_id"]);
    const requests = getTableConfig(schema.friendLinkRequests);
    expect(requests.columns.map((column) => column.name)).toEqual([
      "id", "owner_user_id", "friend_id", "friend_ledger_scope_id", "target_user_id", "status", "created_at", "accepted_at", "declined_at", "cancelled_at",
    ]);
    expect(requests.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "friend_link_requests_status_allowed",
      "friend_link_requests_transition_timestamps",
    ]));
    expect(foreignKeyShape(schema.friendLinkRequests)).toEqual(expect.arrayContaining([
      { from: ["friend_ledger_scope_id", "friend_id"], to: "friends", target: ["ledger_scope_id", "id"], onDelete: "restrict" },
      { from: ["friend_ledger_scope_id", "owner_user_id"], to: "ledger_scopes", target: ["id", "user_id"], onDelete: "restrict" },
      { from: ["owner_user_id"], to: "users", target: ["id"], onDelete: "restrict" },
      { from: ["target_user_id"], to: "users", target: ["id"], onDelete: "cascade" },
    ]));
    expect(indexColumns(schema.friendLinkRequests, "friend_link_requests_pending_owner_friend_uidx")).toEqual(["owner_user_id", "friend_id"]);
    expect(indexColumns(schema.friendLinkRequests, "friend_link_requests_pending_owner_target_uidx")).toEqual(["owner_user_id", "target_user_id"]);
    const connections = getTableConfig(schema.friendConnections);
    expect(connections.columns.map((column) => column.name)).toEqual(["id", "user_a_id", "user_b_id", "status", "created_at", "connected_at", "disconnected_at", "updated_at"]);
    expect(connections.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "friend_connections_distinct_users",
      "friend_connections_canonical_pair",
      "friend_connections_status_allowed",
      "friend_connections_transition_timestamps",
    ]));
    expect(foreignKeyShape(schema.friendConnections)).toEqual(expect.arrayContaining([
      { from: ["user_a_id"], to: "users", target: ["id"], onDelete: "restrict" },
      { from: ["user_b_id"], to: "users", target: ["id"], onDelete: "restrict" },
    ]));
  });

  it("defines organizations with capability-bearing memberships and normalized avatar storage", () => {
    const organization = getTableConfig(schema.organizations);
    expect(organization.columns.map((column) => column.name)).toEqual(["id", "name", "description", "created_at", "updated_at"]);
    expect(organization.checks.map((check) => check.name)).toEqual(expect.arrayContaining(["organizations_name_not_blank"]));
    const memberships = getTableConfig(schema.organizationMemberships);
    expect(memberships.columns.map((column) => column.name)).toEqual(["organization_id", "user_id", "participant_id", "role", "custom_capabilities", "joined_at"]);
    expect(memberships.columns.find((column) => column.name === "custom_capabilities")?.notNull).toBe(true);
    expect(memberships.checks.map((check) => check.name)).toContain("organization_memberships_role_allowed");
    expect(foreignKeyShape(schema.organizationMemberships)).toEqual(expect.arrayContaining([
      { from: ["organization_id"], to: "organizations", target: ["id"], onDelete: "cascade" },
      { from: ["user_id"], to: "users", target: ["id"], onDelete: "restrict" },
      { from: ["organization_id", "participant_id"], to: "organization_participants", target: ["organization_id", "id"], onDelete: "restrict" },
    ]));
    const participants = getTableConfig(schema.organizationParticipants);
    expect(participants.columns.map((column) => column.name)).toEqual(["id", "organization_id", "user_id", "source_personal_friend_id", "display_name", "label", "created_by_user_id", "created_at", "updated_at"]);
    expect(participants.checks.map((check) => check.name)).toEqual(expect.arrayContaining(["organization_participants_identity_shape", "organization_participants_label_not_blank"]));
    expect(indexColumns(schema.organizationParticipants, "organization_participants_registered_user_uidx")).toEqual(["organization_id", "user_id"]);
    expect(indexColumns(schema.organizationParticipants, "organization_participants_source_personal_friend_uidx")).toEqual(["organization_id", "source_personal_friend_id"]);
    expect(getTableConfig(schema.organizationAvatars).checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "organization_avatars_media_type_allowed",
      "organization_avatars_content_size_matches",
    ]));
    const invitations = getTableConfig(schema.organizationInvitations);
    expect(invitations.columns.map((column) => column.name)).toEqual(["id", "organization_id", "target_user_id", "participant_id", "invited_by_user_id", "role", "status", "created_at", "expires_at", "updated_at", "accepted_at", "declined_at", "revoked_at", "expired_at"]);
    expect(invitations.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "organization_invitations_target_not_inviter",
      "organization_invitations_role_allowed",
      "organization_invitations_status_allowed",
      "organization_invitations_transition_timestamps",
    ]));
    expect(indexColumns(schema.organizationInvitations, "organization_invitations_pending_organization_target_uidx")).toEqual(["organization_id", "target_user_id"]);
    expect(indexColumns(schema.organizationInvitations, "organization_invitations_pending_organization_participant_uidx")).toEqual(["organization_id", "participant_id"]);
    expect(foreignKeyShape(schema.organizationInvitations)).toContainEqual({ from: ["organization_id", "participant_id"], to: "organization_participants", target: ["organization_id", "id"], onDelete: "set null" });
  });

  it("defines ledger scopes with subject XOR and one-scope-per-subject indexes", () => {
    const table = getTableConfig(schema.ledgerScopes);
    expect(table.columns.map((column) => column.name)).toEqual(["id", "kind", "user_id", "organization_id", "created_at"]);
    expect(table.checks.map((check) => check.name)).toEqual(expect.arrayContaining(["ledger_scopes_kind_allowed", "ledger_scopes_subject_xor"]));
    expect(indexColumns(schema.ledgerScopes, "ledger_scopes_personal_user_uidx")).toEqual(["user_id"]);
    expect(indexColumns(schema.ledgerScopes, "ledger_scopes_organization_uidx")).toEqual(["organization_id"]);
    expect(foreignKeyShape(schema.ledgerScopes)).toEqual(expect.arrayContaining([
      { from: ["user_id"], to: "users", target: ["id"], onDelete: "restrict" },
      { from: ["organization_id"], to: "organizations", target: ["id"], onDelete: "restrict" },
    ]));
  });

  it("keeps notifications recipient-owned, bounded, and queryable by unread/newest state", () => {
    const table = getTableConfig(schema.notifications);
    expect(table.name).toBe("notifications");
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "recipient_user_id",
      "type",
      "metadata",
      "created_at",
      "read_at",
      "dedupe_key",
    ]);
    expect(table.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "notifications_type_not_blank",
      "notifications_metadata_bounded",
    ]));
    expect(foreignKeyShape(schema.notifications)).toEqual([
      { from: ["recipient_user_id"], to: "users", target: ["id"], onDelete: "cascade" },
    ]);
    expect(indexColumns(schema.notifications, "notifications_recipient_created_idx")).toEqual(["recipient_user_id", "created_at", "id"]);
    expect(indexColumns(schema.notifications, "notifications_unread_recipient_idx")).toEqual(["recipient_user_id"]);
  });

  it("defines owner-editable repayment destinations with safe bounds", () => {
    const table = getTableConfig(schema.repaymentDestinations);
    expect(table.name).toBe("repayment_destinations");
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "ledger_scope_id",
      "type",
      "name",
      "identifier",
      "account_name",
      "note",
      "share_on_balance_links",
      "sort_order",
      "created_at",
      "updated_at",
    ]);
    expect(table.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "repayment_destinations_type_allowed",
      "repayment_destinations_name_not_blank",
      "repayment_destinations_identifier_not_blank",
      "repayment_destinations_sort_order_nonnegative",
    ]));
    expect(foreignKeyShape(schema.repaymentDestinations)).toEqual(expect.arrayContaining([
      { from: ["ledger_scope_id"], to: "ledger_scopes", target: ["id"], onDelete: "restrict" },
    ]));
    expect(indexColumns(schema.repaymentDestinations, "repayment_destinations_owner_order_idx")).toEqual(["ledger_scope_id", "sort_order", "id"]);
  });

  it("defines one owner-private payment proof per repayment", () => {
    const table = getTableConfig(schema.repaymentProofs);
    expect(table.name).toBe("repayment_proofs");
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "ledger_scope_id",
      "repayment_id",
      "original_filename",
      "media_type",
      "byte_size",
      "sha256",
      "content",
      "created_at",
    ]);
    expect(table.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "repayment_proofs_media_type_allowed",
      "repayment_proofs_byte_size_valid",
      "repayment_proofs_content_size_matches",
      "repayment_proofs_filename_not_blank",
      "repayment_proofs_sha256_hex",
    ]));
    expect(foreignKeyShape(schema.repaymentProofs)).toEqual(expect.arrayContaining([
      { from: ["ledger_scope_id"], to: "ledger_scopes", target: ["id"], onDelete: "restrict" },
      { from: ["ledger_scope_id", "repayment_id"], to: "repayments", target: ["ledger_scope_id", "id"], onDelete: "cascade" },
    ]));
    expect(indexColumns(schema.repaymentProofs, "repayment_proofs_owner_repayment_uidx")).toEqual(["ledger_scope_id", "repayment_id"]);
  });

  it("defines private receipt storage constraints and indexes", () => {
    const table = getTableConfig(schema.expenseReceipts);
    expect(table.name).toBe("expense_receipts");
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "ledger_scope_id",
      "expense_id",
      "original_filename",
      "media_type",
      "byte_size",
      "sha256",
      "content",
      "created_at",
    ]);
    expect((table.columns.find((column) => column.name === "original_filename") as unknown as { config: { length: number } }).config.length).toBe(160);
    expect((table.columns.find((column) => column.name === "media_type") as unknown as { config: { length: number } }).config.length).toBe(32);
    expect((table.columns.find((column) => column.name === "sha256") as unknown as { config: { length: number } }).config.length).toBe(64);
    expect(table.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "expense_receipts_media_type_allowed",
      "expense_receipts_byte_size_valid",
      "expense_receipts_content_size_matches",
      "expense_receipts_filename_not_blank",
      "expense_receipts_sha256_hex",
    ]));
    expect(foreignKeyShape(schema.expenseReceipts)).toEqual(expect.arrayContaining([
      { from: ["ledger_scope_id"], to: "ledger_scopes", target: ["id"], onDelete: "restrict" },
      { from: ["ledger_scope_id", "expense_id"], to: "expenses", target: ["ledger_scope_id", "id"], onDelete: "cascade" },
    ]));
    expect(indexColumns(schema.expenseReceipts, "expense_receipts_owner_expense_sha256_uidx")).toEqual(["ledger_scope_id", "expense_id", "sha256"]);
    expect(indexColumns(schema.expenseReceipts, "expense_receipts_owner_expense_created_id_idx")).toEqual(["ledger_scope_id", "expense_id", "created_at", "id"]);
  });

  it("defines one-time account invitations with bounded, linked fields", () => {
    const table = getTableConfig(schema.accountInvitations);
    expect(table.name).toBe("account_invitations");
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "token_hash",
      "email",
      "suggested_name",
      "created_by_user_id",
      "created_at",
      "expires_at",
      "claimed_at",
      "accepted_at",
      "accepted_user_id",
      "revoked_at",
    ]);
    expect((table.columns.find((column) => column.name === "token_hash") as unknown as { config: { length: number } }).config.length).toBe(64);
    expect((table.columns.find((column) => column.name === "email") as unknown as { config: { length: number } }).config.length).toBe(254);
    expect((table.columns.find((column) => column.name === "suggested_name") as unknown as { config: { length: number } }).config.length).toBe(120);
    expect(table.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "account_invitations_token_hash_uidx",
        "account_invitations_created_by_user_id_idx",
        "account_invitations_expires_at_idx",
        "account_invitations_accepted_user_id_idx",
        "account_invitations_active_email_expires_idx",
      ]),
    );
    expect(foreignKeyShape(schema.accountInvitations)).toEqual(
      expect.arrayContaining([
        { from: ["created_by_user_id"], to: "users", target: ["id"], onDelete: "restrict" },
        { from: ["accepted_user_id"], to: "users", target: ["id"], onDelete: "restrict" },
      ]),
    );
    expect(table.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "account_invitations_token_hash_hex",
        "account_invitations_email_lowercase",
        "account_invitations_expires_after_created",
        "account_invitations_accepted_pair",
        "account_invitations_accepted_not_revoked",
      ]),
    );
  });

  it("defines owner-bound temporary debtor share links", () => {
    const table = getTableConfig(schema.debtorShareLinks);
    expect(table.name).toBe("debtor_share_links");
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "token_hash",
      "ledger_scope_id",
      "friend_id",
      "created_at",
      "expires_at",
      "revoked_at",
    ]);
    expect((table.columns.find((column) => column.name === "token_hash") as unknown as { config: { length: number } }).config.length).toBe(64);
    expect(table.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "debtor_share_links_token_hash_uidx",
        "debtor_share_links_active_owner_friend_uidx",
        "debtor_share_links_owner_friend_idx",
        "debtor_share_links_expires_at_idx",
      ]),
    );
    expect(foreignKeyShape(schema.debtorShareLinks)).toEqual(
      expect.arrayContaining([
        { from: ["ledger_scope_id"], to: "ledger_scopes", target: ["id"], onDelete: "restrict" },
        { from: ["ledger_scope_id", "friend_id"], to: "friends", target: ["ledger_scope_id", "id"], onDelete: "restrict" },
      ]),
    );
    expect(table.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "debtor_share_links_token_hash_hex",
        "debtor_share_links_expires_after_created",
        "debtor_share_links_revoked_after_created",
      ]),
    );
  });

  it("keeps canonical Better Auth fields and lookup indexes", () => {
    expect(schema.users.email.isUnique).toBe(true);
    expect(schema.sessions.token.isUnique).toBe(true);
    expect(
      authTables.flatMap((table) => getTableConfig(table).indexes.map((index) => index.config.name)),
    ).toEqual(
      expect.arrayContaining([
        "sessions_userId_idx",
        "accounts_userId_idx",
        "accounts_provider_account_uidx",
        "verifications_identifier_idx",
      ]),
    );
    expect(getTableConfig(schema.sessions).foreignKeys[0].onDelete).toBe("cascade");
    expect(getTableConfig(schema.accounts).foreignKeys[0].onDelete).toBe("cascade");
  });

  it("adds required owner columns, restrictions, and composite targets", () => {
    const domainTables = [
      schema.friends,
      schema.outings,
      schema.trips,
      schema.expenses,
      schema.expenseShares,
      schema.expenseCharges,
      schema.expenseChargeTargets,
      schema.expenseReceipts,
      schema.repayments,
      schema.repaymentAllocations,
    ];
    for (const table of domainTables) {
      const ownerColumn = getTableConfig(table).columns.find((column) => column.name === "ledger_scope_id");
      expect(ownerColumn).toBeDefined();
      expect(ownerColumn?.notNull).toBe(true);
      expect(ownerColumn?.columnType).toBe(schema.ledgerScopes.id.columnType);
      expect(
        foreignKeyShape(table).some(
          ({ from, to, target, onDelete }) =>
            from.join(",") === "ledger_scope_id" && to === "ledger_scopes" && target.join(",") === "id" && onDelete === "restrict",
        ),
      ).toBe(true);
    }

    for (const [table, name] of [
      [schema.friends, "friends_ledger_scope_id_id_uidx"],
      [schema.outings, "outings_ledger_scope_id_id_uidx"],
      [schema.expenses, "expenses_ledger_scope_id_id_uidx"],
      [schema.expenseShares, "expense_shares_ledger_scope_id_id_uidx"],
      [schema.expenseCharges, "expense_charges_ledger_scope_id_id_uidx"],
      [schema.repayments, "repayments_ledger_scope_id_id_uidx"],
      [schema.trips, "trips_ledger_scope_id_id_uidx"],
    ] as const) {
      expect(indexColumns(table, name)).toEqual(["ledger_scope_id", "id"]);
    }
  });

  it("uses owner-aware composite foreign keys for domain relationships", () => {
    const references = [
      [schema.expenseShares, ["ledger_scope_id", "expense_id"], "expenses", ["ledger_scope_id", "id"], "cascade"],
      [schema.expenseChargeTargets, ["ledger_scope_id", "expense_id", "expense_charge_id"], "expense_charges", ["ledger_scope_id", "expense_id", "id"], "cascade"],
      [schema.expenseChargeTargets, ["ledger_scope_id", "expense_id", "expense_share_id"], "expense_shares", ["ledger_scope_id", "expense_id", "id"], "cascade"],
      [schema.outings, ["ledger_scope_id", "trip_id"], "trips", ["ledger_scope_id", "id"], "restrict"],
      [schema.expenseShares, ["ledger_scope_id", "friend_id"], "friends", ["ledger_scope_id", "id"], "restrict"],
      [schema.repayments, ["ledger_scope_id", "friend_id"], "friends", ["ledger_scope_id", "id"], "restrict"],
      [schema.repaymentAllocations, ["ledger_scope_id", "repayment_id"], "repayments", ["ledger_scope_id", "id"], "cascade"],
      [schema.repaymentAllocations, ["ledger_scope_id", "expense_share_id"], "expense_shares", ["ledger_scope_id", "id"], "cascade"],
    ] as const;
    for (const [table, from, to, target, onDelete] of references) {
      expect(foreignKeyShape(table)).toEqual(expect.arrayContaining([{ from, to, target, onDelete }]));
    }
  });

  it("uses integer money columns and positive amount checks", () => {
    for (const column of [
      schema.expenses.amount,
      schema.expenseShares.amountOwed,
      schema.expenseShares.baseAmount,
      schema.repayments.amount,
      schema.repaymentAllocations.amount,
    ]) {
      expect(column.columnType).toBe("PgInteger");
    }

    const checks = [
      ...getTableConfig(schema.expenses).checks,
      ...getTableConfig(schema.expenseShares).checks,
      ...getTableConfig(schema.expenseCharges).checks,
      ...getTableConfig(schema.repayments).checks,
      ...getTableConfig(schema.repaymentAllocations).checks,
    ].map((check) => check.name);
    expect(checks).toEqual(
      expect.arrayContaining([
        "expenses_amount_positive",
        "expense_shares_amount_owed_positive",
        "expense_shares_base_amount_positive",
        "expense_charges_percentage_basis_points_valid",
        "repayments_amount_positive",
        "repayment_allocations_amount_positive",
      ]),
    );
  });

  it("defines share uniqueness and allocation composite identity", () => {
    const shareIndexes = getTableConfig(schema.expenseShares).indexes;
    expect(
      shareIndexes.some(
        (index) =>
          index.config.unique &&
          columnNames(index.config.columns).join(",") === "expense_id,friend_id",
      ),
    ).toBe(true);

    const allocationPrimaryKey = getTableConfig(schema.repaymentAllocations).primaryKeys[0];
    expect(columnNames(allocationPrimaryKey.columns)).toEqual(["ledger_scope_id", "repayment_id", "expense_share_id"]);
  });

  it("defines owner-bound receipt visibility mappings with cascading cleanup", () => {
    const table = getTableConfig(schema.debtorShareReceipts);
    expect(table.name).toBe("debtor_share_receipts");
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "ledger_scope_id",
      "debtor_share_link_id",
      "expense_id",
      "expense_receipt_id",
      "created_at",
    ]);
    expect(foreignKeyShape(schema.debtorShareReceipts)).toEqual(expect.arrayContaining([
      { from: ["ledger_scope_id", "debtor_share_link_id"], to: "debtor_share_links", target: ["ledger_scope_id", "id"], onDelete: "cascade" },
      { from: ["ledger_scope_id", "expense_id", "expense_receipt_id"], to: "expense_receipts", target: ["ledger_scope_id", "expense_id", "id"], onDelete: "cascade" },
    ]));
    expect(indexColumns(schema.debtorShareReceipts, "debtor_share_receipts_link_idx")).toEqual(["ledger_scope_id", "debtor_share_link_id"]);
    expect(indexColumns(schema.debtorShareReceipts, "debtor_share_receipts_public_id_idx")).toEqual(["id"]);
    expect(indexColumns(schema.debtorShareLinks, "debtor_share_links_ledger_scope_id_id_uidx")).toEqual(["ledger_scope_id", "id"]);
    expect(indexColumns(schema.expenseReceipts, "expense_receipts_owner_expense_id_uidx")).toEqual(["ledger_scope_id", "expense_id", "id"]);
  });

  it("defines the required foreign-key delete actions", () => {
    const actions = [
      ...foreignKeyShape(schema.expenses),
      ...foreignKeyShape(schema.expenseShares),
      ...foreignKeyShape(schema.expenseCharges),
      ...foreignKeyShape(schema.expenseChargeTargets),
      ...foreignKeyShape(schema.repayments),
      ...foreignKeyShape(schema.repaymentAllocations),
    ];
    expect(actions).toEqual(
      expect.arrayContaining([
        { from: ["ledger_scope_id", "outing_id"], to: "outings", target: ["ledger_scope_id", "id"], onDelete: "cascade" },
        { from: ["ledger_scope_id", "expense_id"], to: "expenses", target: ["ledger_scope_id", "id"], onDelete: "cascade" },
        { from: ["ledger_scope_id", "friend_id"], to: "friends", target: ["ledger_scope_id", "id"], onDelete: "restrict" },
        { from: ["ledger_scope_id", "repayment_id"], to: "repayments", target: ["ledger_scope_id", "id"], onDelete: "cascade" },
        { from: ["ledger_scope_id", "expense_share_id"], to: "expense_shares", target: ["ledger_scope_id", "id"], onDelete: "cascade" },
        { from: ["ledger_scope_id", "expense_id"], to: "expenses", target: ["ledger_scope_id", "id"], onDelete: "cascade" },
        { from: ["ledger_scope_id", "expense_id", "expense_charge_id"], to: "expense_charges", target: ["ledger_scope_id", "expense_id", "id"], onDelete: "cascade" },
        { from: ["ledger_scope_id", "expense_id", "expense_share_id"], to: "expense_shares", target: ["ledger_scope_id", "expense_id", "id"], onDelete: "cascade" },
      ]),
    );
    expect(actions.filter(({ from, to }) => from.join(",") === "ledger_scope_id,friend_id" && to === "friends")).toHaveLength(2);
  });

  it("keeps the ownership cascade graph exact", () => {
    expect(foreignKeyShape(schema.expenses)).toEqual([
      { from: ["ledger_scope_id"], to: "ledger_scopes", target: ["id"], onDelete: "restrict" },
      { from: ["ledger_scope_id", "outing_id"], to: "outings", target: ["ledger_scope_id", "id"], onDelete: "cascade" },
    ]);
    expect(foreignKeyShape(schema.expenseShares)).toEqual([
      { from: ["ledger_scope_id"], to: "ledger_scopes", target: ["id"], onDelete: "restrict" },
      { from: ["ledger_scope_id", "expense_id"], to: "expenses", target: ["ledger_scope_id", "id"], onDelete: "cascade" },
      { from: ["ledger_scope_id", "friend_id"], to: "friends", target: ["ledger_scope_id", "id"], onDelete: "restrict" },
    ]);
    expect(foreignKeyShape(schema.repaymentAllocations)).toEqual([
      { from: ["ledger_scope_id"], to: "ledger_scopes", target: ["id"], onDelete: "restrict" },
      { from: ["ledger_scope_id", "repayment_id"], to: "repayments", target: ["ledger_scope_id", "id"], onDelete: "cascade" },
      { from: ["ledger_scope_id", "expense_share_id"], to: "expense_shares", target: ["ledger_scope_id", "id"], onDelete: "cascade" },
    ]);
  });

  it("defines the expected lookup indexes", () => {
    const indexes = [
      [schema.friends, "friends_name_idx", ["ledger_scope_id", "name"]],
      [schema.friends, "friends_archived_at_idx", ["ledger_scope_id", "archived_at"]],
      [schema.outings, "outings_occurred_at_idx", ["ledger_scope_id", "occurred_at"]],
      [schema.outings, "outings_ledger_scope_id_trip_id_idx", ["ledger_scope_id", "trip_id"]],
      [schema.trips, "trips_ledger_scope_id_name_idx", ["ledger_scope_id", "name"]],
      [schema.trips, "trips_ledger_scope_id_dates_idx", ["ledger_scope_id", "starts_on", "ends_on"]],
      [schema.expenses, "expenses_outing_id_idx", ["ledger_scope_id", "outing_id"]],
      [schema.expenseShares, "expense_shares_friend_id_idx", ["ledger_scope_id", "friend_id"]],
      [schema.expenseCharges, "expense_charges_owner_expense_id_idx", ["ledger_scope_id", "expense_id"]],
      [schema.expenseChargeTargets, "expense_charge_targets_owner_share_idx", ["ledger_scope_id", "expense_share_id"]],
      [schema.repayments, "repayments_friend_id_idx", ["ledger_scope_id", "friend_id"]],
      [schema.repayments, "repayments_paid_at_idx", ["ledger_scope_id", "paid_at"]],
      [schema.repaymentAllocations, "repayment_allocations_expense_share_id_idx", ["ledger_scope_id", "expense_share_id"]],
    ] as const;
    for (const [table, name, columns] of indexes) expect(indexColumns(table, name)).toEqual(columns);
  });

  it("binds every expense to a required outing without an independent occurrence time", () => {
    const expenseColumns = getTableConfig(schema.expenses).columns;
    expect(expenseColumns.find((column) => column.name === "outing_id")?.notNull).toBe(true);
    expect(expenseColumns.some((column) => column.name === "occurred_at")).toBe(false);
    expect(getTableConfig(schema.expenses).indexes.some((index) => index.config.name === "expenses_occurred_at_idx")).toBe(false);
    expect(foreignKeyShape(schema.expenses)).toEqual(
      expect.arrayContaining([
        { from: ["ledger_scope_id", "outing_id"], to: "outings", target: ["ledger_scope_id", "id"], onDelete: "cascade" },
      ]),
    );
  });

  it("defines Trip fields and constraints as calendar-date organizational data", () => {
    const table = getTableConfig(schema.trips);
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "ledger_scope_id",
      "name",
      "starts_on",
      "ends_on",
      "notes",
      "created_at",
      "updated_at",
    ]);
    expect(table.columns.find((column) => column.name === "name")?.columnType).toBe("PgVarchar");
    expect((table.columns.find((column) => column.name === "name") as unknown as { config: { length: number } }).config.length).toBe(160);
    expect(table.columns.find((column) => column.name === "starts_on")?.columnType).toBe("PgDateString");
    expect(table.columns.find((column) => column.name === "ends_on")?.columnType).toBe("PgDateString");
    expect(table.checks.map((check) => check.name)).toEqual(expect.arrayContaining(["trips_name_not_blank", "trips_date_range_valid"]));
    expect(foreignKeyShape(schema.trips)).toEqual(expect.arrayContaining([
      { from: ["ledger_scope_id"], to: "ledger_scopes", target: ["id"], onDelete: "restrict" },
    ]));
    expect(foreignKeyShape(schema.outings)).toEqual(expect.arrayContaining([
      { from: ["ledger_scope_id", "trip_id"], to: "trips", target: ["ledger_scope_id", "id"], onDelete: "restrict" },
    ]));
    expect(getTableConfig(schema.outings).columns.find((column) => column.name === "trip_id")?.notNull).toBe(false);
  });
});
