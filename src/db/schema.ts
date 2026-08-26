import { relations, sql } from "drizzle-orm";
import type { NotificationMetadata, NotificationType } from "@/domain/notifications";
import type { GroupRole } from "@/domain/group-permissions";
import type { OrganizationCapability, OrganizationInvitationRole } from "@/domain/organization-permissions";
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  username: varchar("username", { length: 20 }),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [
  check("users_username_lowercase", sql`${table.username} IS NULL OR ${table.username} = lower(${table.username})`),
  check("users_username_shape", sql`${table.username} IS NULL OR (length(${table.username}) BETWEEN 3 AND 20 AND ${table.username} ~ '^[a-z0-9][a-z0-9._]*[a-z0-9]$' AND ${table.username} !~ '[._]{2}')`),
  uniqueIndex("users_username_uidx").on(table.username).where(sql`${table.username} IS NOT NULL`),
]);

export const userAvatars = pgTable("user_avatars", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  mediaType: varchar("media_type", { length: 32 }).notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  content: bytea("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("user_avatars_media_type_allowed", sql`${table.mediaType} = 'image/webp'`),
  check("user_avatars_byte_size_valid", sql`${table.byteSize} BETWEEN 1 AND 5242880`),
  check("user_avatars_content_size_matches", sql`octet_length(${table.content}) = ${table.byteSize}`),
  check("user_avatars_sha256_hex", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
]);

export const friends = pgTable(
  "friends",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
      .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    linkedUserId: text("linked_user_id").references(() => users.id, { onDelete: "set null" }),
    name: varchar("name", { length: 120 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 32 }),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("friends_name_not_blank", sql`btrim(${table.name}) <> ''`),
    uniqueIndex("friends_ledger_scope_id_id_uidx").on(table.ledgerScopeId, table.id),
    uniqueIndex("friends_ledger_scope_linked_user_uidx")
      .on(table.ledgerScopeId, table.linkedUserId)
      .where(sql`${table.linkedUserId} IS NOT NULL`),
    index("friends_name_idx").on(table.ledgerScopeId, table.name),
    index("friends_linked_user_idx").on(table.ledgerScopeId, table.linkedUserId),
    index("friends_archived_at_idx").on(table.ledgerScopeId, table.archivedAt),
  ],
);

export const friendLinkRequests = pgTable(
  "friend_link_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    friendId: uuid("friend_id").notNull(),
    friendLedgerScopeId: uuid("friend_ledger_scope_id").notNull(),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    check("friend_link_requests_status_allowed", sql`${table.status} IN ('pending', 'accepted', 'declined', 'cancelled')`),
    check(
      "friend_link_requests_transition_timestamps",
      sql`(${table.status} = 'pending' AND ${table.acceptedAt} IS NULL AND ${table.declinedAt} IS NULL AND ${table.cancelledAt} IS NULL) OR (${table.status} = 'accepted' AND ${table.acceptedAt} IS NOT NULL AND ${table.declinedAt} IS NULL AND ${table.cancelledAt} IS NULL) OR (${table.status} = 'declined' AND ${table.acceptedAt} IS NULL AND ${table.declinedAt} IS NOT NULL AND ${table.cancelledAt} IS NULL) OR (${table.status} = 'cancelled' AND ${table.acceptedAt} IS NULL AND ${table.declinedAt} IS NULL AND ${table.cancelledAt} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [table.friendLedgerScopeId, table.friendId],
      foreignColumns: [friends.ledgerScopeId, friends.id],
      name: "friend_link_requests_owner_friend_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.friendLedgerScopeId, table.ownerUserId],
      foreignColumns: [ledgerScopes.id, ledgerScopes.userId],
      name: "friend_link_requests_personal_scope_fk",
    }).onDelete("restrict"),
    uniqueIndex("friend_link_requests_pending_owner_friend_uidx")
      .on(table.ownerUserId, table.friendId)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("friend_link_requests_pending_owner_target_uidx")
      .on(table.ownerUserId, table.targetUserId)
      .where(sql`${table.status} = 'pending'`),
    index("friend_link_requests_owner_friend_idx").on(table.ownerUserId, table.friendId),
    index("friend_link_requests_target_status_idx").on(table.targetUserId, table.status),
  ],
);

export const friendConnections = pgTable(
  "friend_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userAId: text("user_a_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    userBId: text("user_b_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 16 }).default("connected").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("friend_connections_distinct_users", sql`${table.userAId} <> ${table.userBId}`),
    check("friend_connections_canonical_pair", sql`${table.userAId} < ${table.userBId}`),
    check("friend_connections_status_allowed", sql`${table.status} IN ('connected', 'disconnected')`),
    check(
      "friend_connections_transition_timestamps",
      sql`(${table.status} = 'connected' AND ${table.connectedAt} IS NOT NULL AND ${table.disconnectedAt} IS NULL) OR (${table.status} = 'disconnected' AND ${table.connectedAt} IS NOT NULL AND ${table.disconnectedAt} IS NOT NULL)`,
    ),
    uniqueIndex("friend_connections_pair_uidx").on(table.userAId, table.userBId),
    index("friend_connections_user_a_idx").on(table.userAId),
    index("friend_connections_user_b_idx").on(table.userBId),
  ],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("organizations_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("organizations_description_not_blank", sql`${table.description} IS NULL OR btrim(${table.description}) <> ''`),
    index("organizations_name_idx").on(table.name),
  ],
);

export type LedgerScopeKind = "personal" | "organization";

export const ledgerScopes = pgTable(
  "ledger_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: varchar("kind", { length: 16 }).$type<LedgerScopeKind>().notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("ledger_scopes_kind_allowed", sql`${table.kind} IN ('personal', 'organization')`),
    check("ledger_scopes_subject_xor", sql`(${table.kind} = 'personal' AND ${table.userId} IS NOT NULL AND ${table.organizationId} IS NULL) OR (${table.kind} = 'organization' AND ${table.userId} IS NULL AND ${table.organizationId} IS NOT NULL)`),
    uniqueIndex("ledger_scopes_id_user_uidx").on(table.id, table.userId),
    uniqueIndex("ledger_scopes_personal_user_uidx").on(table.userId).where(sql`${table.kind} = 'personal'`),
    uniqueIndex("ledger_scopes_organization_uidx").on(table.organizationId).where(sql`${table.kind} = 'organization'`),
  ],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: varchar("role", { length: 32 }).default("member").notNull(),
    customCapabilities: jsonb("custom_capabilities").$type<OrganizationCapability[]>().notNull().default([]),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    check("organization_memberships_role_allowed", sql`${table.role} IN ('owner', 'admin', 'treasurer', 'member', 'custom')`),
    index("organization_memberships_user_idx").on(table.userId),
  ],
);

export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: varchar("role", { length: 32 }).$type<OrganizationInvitationRole>().notNull(),
    status: varchar("status", { length: 16 }).default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
  },
  (table) => [
    check("organization_invitations_target_not_inviter", sql`${table.targetUserId} <> ${table.invitedByUserId}`),
    check("organization_invitations_role_allowed", sql`${table.role} IN ('admin', 'treasurer', 'member')`),
    check("organization_invitations_status_allowed", sql`${table.status} IN ('pending', 'accepted', 'declined', 'revoked', 'expired')`),
    check("organization_invitations_expires_after_created", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "organization_invitations_transition_timestamps",
      sql`(${table.status} = 'pending' AND ${table.acceptedAt} IS NULL AND ${table.declinedAt} IS NULL AND ${table.revokedAt} IS NULL AND ${table.expiredAt} IS NULL) OR (${table.status} = 'accepted' AND ${table.acceptedAt} IS NOT NULL AND ${table.declinedAt} IS NULL AND ${table.revokedAt} IS NULL AND ${table.expiredAt} IS NULL) OR (${table.status} = 'declined' AND ${table.acceptedAt} IS NULL AND ${table.declinedAt} IS NOT NULL AND ${table.revokedAt} IS NULL AND ${table.expiredAt} IS NULL) OR (${table.status} = 'revoked' AND ${table.acceptedAt} IS NULL AND ${table.declinedAt} IS NULL AND ${table.revokedAt} IS NOT NULL AND ${table.expiredAt} IS NULL) OR (${table.status} = 'expired' AND ${table.acceptedAt} IS NULL AND ${table.declinedAt} IS NULL AND ${table.revokedAt} IS NULL AND ${table.expiredAt} IS NOT NULL)`,
    ),
    uniqueIndex("organization_invitations_pending_organization_target_uidx")
      .on(table.organizationId, table.targetUserId)
      .where(sql`${table.status} = 'pending'`),
    index("organization_invitations_organization_status_idx").on(table.organizationId, table.status),
    index("organization_invitations_target_status_idx").on(table.targetUserId, table.status),
    index("organization_invitations_expires_at_idx").on(table.expiresAt),
  ],
);

export const organizationAvatars = pgTable("organization_avatars", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  mediaType: varchar("media_type", { length: 32 }).notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  content: bytea("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("organization_avatars_media_type_allowed", sql`${table.mediaType} = 'image/webp'`),
  check("organization_avatars_byte_size_valid", sql`${table.byteSize} BETWEEN 1 AND 5242880`),
  check("organization_avatars_content_size_matches", sql`octet_length(${table.content}) = ${table.byteSize}`),
  check("organization_avatars_sha256_hex", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
]);

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("groups_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("groups_description_not_blank", sql`${table.description} IS NULL OR btrim(${table.description}) <> ''`),
    index("groups_name_idx").on(table.name),
    index("groups_created_by_user_idx").on(table.createdByUserId),
  ],
);

export const groupParticipants = pgTable(
  "group_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "restrict" }),
    displayName: varchar("display_name", { length: 160 }),
    label: varchar("label", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("group_participants_identity_shape", sql`(${table.userId} IS NOT NULL AND ${table.displayName} IS NULL) OR (${table.userId} IS NULL AND ${table.displayName} IS NOT NULL AND btrim(${table.displayName}) <> '')`),
    check("group_participants_label_not_blank", sql`${table.label} IS NULL OR btrim(${table.label}) <> ''`),
    unique("group_participants_group_id_id_unique").on(table.groupId, table.id),
    unique("group_participants_group_user_id_unique").on(table.groupId, table.userId, table.id),
    uniqueIndex("group_participants_registered_user_uidx").on(table.groupId, table.userId).where(sql`${table.userId} IS NOT NULL`),
    index("group_participants_group_idx").on(table.groupId),
  ],
);

export const groupMemberships = pgTable(
  "group_memberships",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    participantId: uuid("participant_id").notNull(),
    role: varchar("role", { length: 16 }).$type<GroupRole>().default("member").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    check("group_memberships_role_allowed", sql`${table.role} IN ('owner', 'admin', 'member')`),
    foreignKey({
      columns: [table.groupId, table.participantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.id],
      name: "group_memberships_participant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.groupId, table.userId, table.participantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.userId, groupParticipants.id],
      name: "group_memberships_registered_participant_fk",
    }).onDelete("restrict"),
    uniqueIndex("group_memberships_group_participant_uidx").on(table.groupId, table.participantId),
    uniqueIndex("group_memberships_one_owner_uidx").on(table.groupId).where(sql`${table.role} = 'owner'`),
    index("group_memberships_user_idx").on(table.userId),
  ],
);

export const groupAvatars = pgTable("group_avatars", {
  groupId: uuid("group_id")
    .primaryKey()
    .references(() => groups.id, { onDelete: "cascade" }),
  mediaType: varchar("media_type", { length: 32 }).notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  content: bytea("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("group_avatars_media_type_allowed", sql`${table.mediaType} = 'image/webp'`),
  check("group_avatars_byte_size_valid", sql`${table.byteSize} BETWEEN 1 AND 5242880`),
  check("group_avatars_content_size_matches", sql`octet_length(${table.content}) = ${table.byteSize}`),
  check("group_avatars_sha256_hex", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
]);

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
      .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 160 }).notNull(),
    startsOn: date("starts_on", { mode: "string" }),
    endsOn: date("ends_on", { mode: "string" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("trips_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("trips_date_range_valid", sql`${table.endsOn} IS NULL OR ${table.startsOn} IS NULL OR ${table.endsOn} >= ${table.startsOn}`),
    uniqueIndex("trips_ledger_scope_id_id_uidx").on(table.ledgerScopeId, table.id),
    index("trips_ledger_scope_id_name_idx").on(table.ledgerScopeId, table.name),
    index("trips_ledger_scope_id_dates_idx").on(table.ledgerScopeId, table.startsOn, table.endsOn),
  ],
);

export const outings = pgTable(
  "outings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
      .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    tripId: uuid("trip_id"),
    title: varchar("title", { length: 160 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("outings_title_not_blank", sql`btrim(${table.title}) <> ''`),
    foreignKey({
      columns: [table.ledgerScopeId, table.tripId],
      foreignColumns: [trips.ledgerScopeId, trips.id],
      name: "outings_owner_trip_fk",
    }).onDelete("restrict"),
    uniqueIndex("outings_ledger_scope_id_id_uidx").on(table.ledgerScopeId, table.id),
    index("outings_occurred_at_idx").on(table.ledgerScopeId, table.occurredAt),
    index("outings_ledger_scope_id_trip_id_idx").on(table.ledgerScopeId, table.tripId),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
      .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    outingId: uuid("outing_id").notNull(),
    description: varchar("description", { length: 200 }).notNull(),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("expenses_description_not_blank", sql`btrim(${table.description}) <> ''`),
    check("expenses_amount_positive", sql`${table.amount} > 0`),
    foreignKey({
      columns: [table.ledgerScopeId, table.outingId],
      foreignColumns: [outings.ledgerScopeId, outings.id],
      name: "expenses_owner_outing_fk",
    }).onDelete("cascade"),
    uniqueIndex("expenses_ledger_scope_id_id_uidx").on(table.ledgerScopeId, table.id),
    index("expenses_outing_id_idx").on(table.ledgerScopeId, table.outingId),
  ],
);

export const expenseReceipts = pgTable(
  "expense_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
      .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    expenseId: uuid("expense_id").notNull(),
    originalFilename: varchar("original_filename", { length: 160 }).notNull(),
    mediaType: varchar("media_type", { length: 32 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    content: bytea("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("expense_receipts_media_type_allowed", sql`${table.mediaType} IN ('image/jpeg', 'image/png', 'image/webp')`),
    check("expense_receipts_byte_size_valid", sql`${table.byteSize} BETWEEN 1 AND 5242880`),
    check("expense_receipts_content_size_matches", sql`octet_length(${table.content}) = ${table.byteSize}`),
    check("expense_receipts_filename_not_blank", sql`btrim(${table.originalFilename}) <> ''`),
    check("expense_receipts_sha256_hex", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    foreignKey({
      columns: [table.ledgerScopeId, table.expenseId],
      foreignColumns: [expenses.ledgerScopeId, expenses.id],
      name: "expense_receipts_owner_expense_fk",
    }).onDelete("cascade"),
    uniqueIndex("expense_receipts_owner_expense_id_uidx").on(table.ledgerScopeId, table.expenseId, table.id),
    uniqueIndex("expense_receipts_owner_expense_sha256_uidx").on(table.ledgerScopeId, table.expenseId, table.sha256),
    index("expense_receipts_owner_expense_created_id_idx").on(table.ledgerScopeId, table.expenseId, table.createdAt, table.id),
  ],
);

export const expenseShares = pgTable(
  "expense_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
      .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    expenseId: uuid("expense_id").notNull(),
    friendId: uuid("friend_id").notNull(),
    baseAmount: integer("base_amount").notNull(),
    amountOwed: integer("amount_owed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("expense_shares_base_amount_positive", sql`${table.baseAmount} > 0`),
    check("expense_shares_amount_owed_positive", sql`${table.amountOwed} > 0`),
    foreignKey({
      columns: [table.ledgerScopeId, table.expenseId],
      foreignColumns: [expenses.ledgerScopeId, expenses.id],
      name: "expense_shares_owner_expense_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerScopeId, table.friendId],
      foreignColumns: [friends.ledgerScopeId, friends.id],
      name: "expense_shares_owner_friend_fk",
    }).onDelete("restrict"),
    uniqueIndex("expense_shares_ledger_scope_id_id_uidx").on(table.ledgerScopeId, table.id),
    uniqueIndex("expense_shares_owner_expense_id_id_uidx").on(table.ledgerScopeId, table.expenseId, table.id),
    uniqueIndex("expense_shares_expense_friend_uidx").on(table.expenseId, table.friendId),
    index("expense_shares_friend_id_idx").on(table.ledgerScopeId, table.friendId),
  ],
);

export const expenseCharges = pgTable(
  "expense_charges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
      .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    expenseId: uuid("expense_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    percentageBasisPoints: integer("percentage_basis_points").notNull(),
    scope: varchar("scope", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("expense_charges_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("expense_charges_percentage_basis_points_valid", sql`${table.percentageBasisPoints} BETWEEN 0 AND 1000000`),
    check("expense_charges_scope_valid", sql`${table.scope} IN ('all', 'selected')`),
    foreignKey({
      columns: [table.ledgerScopeId, table.expenseId],
      foreignColumns: [expenses.ledgerScopeId, expenses.id],
      name: "expense_charges_owner_expense_fk",
    }).onDelete("cascade"),
    uniqueIndex("expense_charges_ledger_scope_id_id_uidx").on(table.ledgerScopeId, table.id),
    uniqueIndex("expense_charges_owner_expense_id_id_uidx").on(table.ledgerScopeId, table.expenseId, table.id),
    index("expense_charges_owner_expense_id_idx").on(table.ledgerScopeId, table.expenseId),
  ],
);

export const expenseChargeTargets = pgTable(
  "expense_charge_targets",
  {
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
      .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    expenseId: uuid("expense_id").notNull(),
    expenseChargeId: uuid("expense_charge_id").notNull(),
    expenseShareId: uuid("expense_share_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ledgerScopeId, table.expenseChargeId, table.expenseShareId] }),
    foreignKey({
      columns: [table.ledgerScopeId, table.expenseId, table.expenseChargeId],
      foreignColumns: [expenseCharges.ledgerScopeId, expenseCharges.expenseId, expenseCharges.id],
      name: "expense_charge_targets_owner_charge_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerScopeId, table.expenseId, table.expenseShareId],
      foreignColumns: [expenseShares.ledgerScopeId, expenseShares.expenseId, expenseShares.id],
      name: "expense_charge_targets_owner_share_fk",
    }).onDelete("cascade"),
    index("expense_charge_targets_owner_charge_idx").on(table.ledgerScopeId, table.expenseChargeId),
    index("expense_charge_targets_owner_share_idx").on(table.ledgerScopeId, table.expenseShareId),
  ],
);

export const repayments = pgTable(
  "repayments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
      .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    friendId: uuid("friend_id").notNull(),
    amount: integer("amount").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    paymentMethod: varchar("payment_method", { length: 40 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("repayments_amount_positive", sql`${table.amount} > 0`),
    check(
      "repayments_payment_method_not_blank",
      sql`${table.paymentMethod} IS NULL OR btrim(${table.paymentMethod}) <> ''`,
    ),
    foreignKey({
      columns: [table.ledgerScopeId, table.friendId],
      foreignColumns: [friends.ledgerScopeId, friends.id],
      name: "repayments_owner_friend_fk",
    }).onDelete("restrict"),
    uniqueIndex("repayments_ledger_scope_id_id_uidx").on(table.ledgerScopeId, table.id),
    index("repayments_friend_id_idx").on(table.ledgerScopeId, table.friendId),
    index("repayments_paid_at_idx").on(table.ledgerScopeId, table.paidAt),
  ],
);

export const repaymentDestinations = pgTable(
  "repayment_destinations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
    .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    type: varchar("type", { length: 16 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    accountName: varchar("account_name", { length: 120 }),
    note: varchar("note", { length: 1000 }),
    shareOnBalanceLinks: boolean("share_on_balance_links").default(false).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("repayment_destinations_type_allowed", sql`${table.type} IN ('bank_account', 'e_wallet', 'other')`),
    check("repayment_destinations_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("repayment_destinations_identifier_not_blank", sql`btrim(${table.identifier}) <> ''`),
    check("repayment_destinations_account_name_not_blank", sql`${table.accountName} IS NULL OR btrim(${table.accountName}) <> ''`),
    check("repayment_destinations_note_not_blank", sql`${table.note} IS NULL OR btrim(${table.note}) <> ''`),
    check("repayment_destinations_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
    index("repayment_destinations_owner_order_idx").on(table.ledgerScopeId, table.sortOrder, table.id),
  ],
);

export const repaymentProofs = pgTable(
  "repayment_proofs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
      .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    repaymentId: uuid("repayment_id").notNull(),
    originalFilename: varchar("original_filename", { length: 160 }).notNull(),
    mediaType: varchar("media_type", { length: 32 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    content: bytea("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("repayment_proofs_media_type_allowed", sql`${table.mediaType} IN ('image/jpeg', 'image/png', 'image/webp')`),
    check("repayment_proofs_byte_size_valid", sql`${table.byteSize} BETWEEN 1 AND 5242880`),
    check("repayment_proofs_content_size_matches", sql`octet_length(${table.content}) = ${table.byteSize}`),
    check("repayment_proofs_filename_not_blank", sql`btrim(${table.originalFilename}) <> ''`),
    check("repayment_proofs_sha256_hex", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    foreignKey({
      columns: [table.ledgerScopeId, table.repaymentId],
      foreignColumns: [repayments.ledgerScopeId, repayments.id],
      name: "repayment_proofs_owner_repayment_fk",
    }).onDelete("cascade"),
    uniqueIndex("repayment_proofs_owner_repayment_uidx").on(table.ledgerScopeId, table.repaymentId),
  ],
);

export const repaymentAllocations = pgTable(
  "repayment_allocations",
  {
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
      .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    repaymentId: uuid("repayment_id").notNull(),
    expenseShareId: uuid("expense_share_id").notNull(),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ledgerScopeId, table.repaymentId, table.expenseShareId] }),
    check("repayment_allocations_amount_positive", sql`${table.amount} > 0`),
    foreignKey({
      columns: [table.ledgerScopeId, table.repaymentId],
      foreignColumns: [repayments.ledgerScopeId, repayments.id],
      name: "repayment_allocations_owner_repayment_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerScopeId, table.expenseShareId],
      foreignColumns: [expenseShares.ledgerScopeId, expenseShares.id],
      name: "repayment_allocations_owner_expense_share_fk",
    }).onDelete("cascade"),
    index("repayment_allocations_expense_share_id_idx").on(table.ledgerScopeId, table.expenseShareId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("sessions_userId_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("accounts_userId_idx").on(table.userId),
    uniqueIndex("accounts_provider_account_uidx").on(table.providerId, table.accountId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 64 }).notNull(),
    metadata: jsonb("metadata").$type<NotificationMetadata[NotificationType]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    dedupeKey: varchar("dedupe_key", { length: 160 }),
  },
  (table) => [
    check("notifications_type_not_blank", sql`btrim(${table.type}) <> ''`),
    check("notifications_metadata_bounded", sql`pg_column_size(${table.metadata}) <= 2048`),
    index("notifications_recipient_created_idx").on(table.recipientUserId, table.createdAt, table.id),
    index("notifications_unread_recipient_idx").on(table.recipientUserId).where(sql`${table.readAt} IS NULL`),
    index("notifications_recipient_dedupe_idx").on(table.recipientUserId, table.type, table.dedupeKey),
  ],
);

export const accountInvitations = pgTable(
  "account_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    email: varchar("email", { length: 254 }).notNull(),
    suggestedName: varchar("suggested_name", { length: 120 }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: text("accepted_user_id").references(() => users.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    check("account_invitations_token_hash_hex", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("account_invitations_email_lowercase", sql`${table.email} = lower(${table.email})`),
    check(
      "account_invitations_suggested_name_not_blank",
      sql`${table.suggestedName} IS NULL OR btrim(${table.suggestedName}) <> ''`,
    ),
    check("account_invitations_expires_after_created", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "account_invitations_claimed_after_created",
      sql`${table.claimedAt} IS NULL OR ${table.claimedAt} >= ${table.createdAt}`,
    ),
    check(
      "account_invitations_accepted_pair",
      sql`(${table.acceptedAt} IS NULL) = (${table.acceptedUserId} IS NULL)`,
    ),
    check(
      "account_invitations_accepted_not_revoked",
      sql`${table.acceptedAt} IS NULL OR ${table.revokedAt} IS NULL`,
    ),
    check(
      "account_invitations_accepted_after_claimed",
      sql`${table.acceptedAt} IS NULL OR (${table.claimedAt} IS NOT NULL AND ${table.acceptedAt} >= ${table.claimedAt})`,
    ),
    check(
      "account_invitations_revoked_after_created",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`,
    ),
    uniqueIndex("account_invitations_token_hash_uidx").on(table.tokenHash),
    index("account_invitations_created_by_user_id_idx").on(table.createdByUserId),
    index("account_invitations_email_idx").on(table.email),
    index("account_invitations_expires_at_idx").on(table.expiresAt),
    index("account_invitations_accepted_user_id_idx").on(table.acceptedUserId),
    index("account_invitations_active_email_expires_idx")
      .on(table.email, table.expiresAt)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
  ],
);

export const debtorShareLinks = pgTable(
  "debtor_share_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
      .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    friendId: uuid("friend_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    check("debtor_share_links_token_hash_hex", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("debtor_share_links_expires_after_created", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "debtor_share_links_revoked_after_created",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`,
    ),
    foreignKey({
      columns: [table.ledgerScopeId, table.friendId],
      foreignColumns: [friends.ledgerScopeId, friends.id],
      name: "debtor_share_links_owner_friend_fk",
    }).onDelete("restrict"),
    uniqueIndex("debtor_share_links_ledger_scope_id_id_uidx").on(table.ledgerScopeId, table.id),
    uniqueIndex("debtor_share_links_token_hash_uidx").on(table.tokenHash),
    uniqueIndex("debtor_share_links_active_owner_friend_uidx")
      .on(table.ledgerScopeId, table.friendId)
      .where(sql`${table.revokedAt} IS NULL`),
    index("debtor_share_links_owner_friend_idx").on(table.ledgerScopeId, table.friendId),
    index("debtor_share_links_expires_at_idx").on(table.expiresAt),
  ],
);

export const debtorShareReceipts = pgTable(
  "debtor_share_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ledgerScopeId: uuid("ledger_scope_id")
      .notNull()
      .references(() => ledgerScopes.id, { onDelete: "restrict" }),
    debtorShareLinkId: uuid("debtor_share_link_id").notNull(),
    expenseId: uuid("expense_id").notNull(),
    expenseReceiptId: uuid("expense_receipt_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerScopeId, table.debtorShareLinkId],
      foreignColumns: [debtorShareLinks.ledgerScopeId, debtorShareLinks.id],
      name: "debtor_share_receipts_owner_link_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerScopeId, table.expenseId, table.expenseReceiptId],
      foreignColumns: [expenseReceipts.ledgerScopeId, expenseReceipts.expenseId, expenseReceipts.id],
      name: "debtor_share_receipts_owner_expense_receipt_fk",
    }).onDelete("cascade"),
    uniqueIndex("debtor_share_receipts_link_receipt_uidx").on(table.ledgerScopeId, table.debtorShareLinkId, table.expenseReceiptId),
    index("debtor_share_receipts_link_idx").on(table.ledgerScopeId, table.debtorShareLinkId),
    index("debtor_share_receipts_public_id_idx").on(table.id),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  notifications: many(notifications),
  linkedFriends: many(friends, { relationName: "linkedFriends" }),
  ledgerScopes: many(ledgerScopes),
  friendLinkRequestOwners: many(friendLinkRequests, { relationName: "friendLinkRequestOwners" }),
  friendLinkRequestTargets: many(friendLinkRequests, { relationName: "friendLinkRequestTargets" }),
  friendConnectionsA: many(friendConnections, { relationName: "friendConnectionsA" }),
  friendConnectionsB: many(friendConnections, { relationName: "friendConnectionsB" }),
  createdInvitations: many(accountInvitations, { relationName: "createdInvitations" }),
  acceptedInvitations: many(accountInvitations, { relationName: "acceptedInvitations" }),
  organizationMemberships: many(organizationMemberships),
  groupMemberships: many(groupMemberships),
  groupParticipants: many(groupParticipants),
  organizationInvitationsReceived: many(organizationInvitations, { relationName: "organizationInvitationTargets" }),
  organizationInvitationsSent: many(organizationInvitations, { relationName: "organizationInvitationInviters" }),
}));

export const friendsRelations = relations(friends, ({ one, many }) => ({
  scope: one(ledgerScopes, {
    fields: [friends.ledgerScopeId],
    references: [ledgerScopes.id],
  }),
  linkedUser: one(users, {
    fields: [friends.linkedUserId],
    references: [users.id],
    relationName: "linkedFriends",
  }),
  linkRequests: many(friendLinkRequests),
}));

export const friendLinkRequestsRelations = relations(friendLinkRequests, ({ one }) => ({
  owner: one(users, {
    fields: [friendLinkRequests.ownerUserId],
    references: [users.id],
    relationName: "friendLinkRequestOwners",
  }),
  friend: one(friends, {
    fields: [friendLinkRequests.friendLedgerScopeId, friendLinkRequests.friendId],
    references: [friends.ledgerScopeId, friends.id],
  }),
  target: one(users, {
    fields: [friendLinkRequests.targetUserId],
    references: [users.id],
    relationName: "friendLinkRequestTargets",
  }),
}));

export const friendConnectionsRelations = relations(friendConnections, ({ one }) => ({
  userA: one(users, {
    fields: [friendConnections.userAId],
    references: [users.id],
    relationName: "friendConnectionsA",
  }),
  userB: one(users, {
    fields: [friendConnections.userBId],
    references: [users.id],
    relationName: "friendConnectionsB",
  }),
}));

export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  memberships: many(organizationMemberships),
  invitations: many(organizationInvitations),
  avatar: one(organizationAvatars),
  ledgerScope: one(ledgerScopes),
}));

export const ledgerScopesRelations = relations(ledgerScopes, ({ one }) => ({
  user: one(users, {
    fields: [ledgerScopes.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [ledgerScopes.organizationId],
    references: [organizations.id],
  }),
}));

export const organizationMembershipsRelations = relations(organizationMemberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMemberships.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [organizationMemberships.userId],
    references: [users.id],
  }),
}));

export const organizationInvitationsRelations = relations(organizationInvitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationInvitations.organizationId],
    references: [organizations.id],
  }),
  target: one(users, {
    fields: [organizationInvitations.targetUserId],
    references: [users.id],
    relationName: "organizationInvitationTargets",
  }),
  inviter: one(users, {
    fields: [organizationInvitations.invitedByUserId],
    references: [users.id],
    relationName: "organizationInvitationInviters",
  }),
}));

export const organizationAvatarsRelations = relations(organizationAvatars, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationAvatars.organizationId],
    references: [organizations.id],
  }),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  creator: one(users, { fields: [groups.createdByUserId], references: [users.id] }),
  participants: many(groupParticipants),
  memberships: many(groupMemberships),
  avatar: one(groupAvatars),
}));

export const groupParticipantsRelations = relations(groupParticipants, ({ one }) => ({
  group: one(groups, { fields: [groupParticipants.groupId], references: [groups.id] }),
  user: one(users, { fields: [groupParticipants.userId], references: [users.id] }),
  membership: one(groupMemberships),
}));

export const groupMembershipsRelations = relations(groupMemberships, ({ one }) => ({
  group: one(groups, { fields: [groupMemberships.groupId], references: [groups.id] }),
  user: one(users, { fields: [groupMemberships.userId], references: [users.id] }),
  participant: one(groupParticipants, { fields: [groupMemberships.groupId, groupMemberships.participantId], references: [groupParticipants.groupId, groupParticipants.id] }),
}));

export const groupAvatarsRelations = relations(groupAvatars, ({ one }) => ({
  group: one(groups, { fields: [groupAvatars.groupId], references: [groups.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  users: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  users: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, {
    fields: [notifications.recipientUserId],
    references: [users.id],
  }),
}));

export const accountInvitationsRelations = relations(accountInvitations, ({ one }) => ({
  createdBy: one(users, {
    fields: [accountInvitations.createdByUserId],
    references: [users.id],
    relationName: "createdInvitations",
  }),
  acceptedUser: one(users, {
    fields: [accountInvitations.acceptedUserId],
    references: [users.id],
    relationName: "acceptedInvitations",
  }),
}));
