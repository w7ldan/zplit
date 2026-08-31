import { relations, sql } from "drizzle-orm";
import type { NotificationMetadata, NotificationType } from "@/domain/notifications";
import type { GroupRole } from "@/domain/group-permissions";
import type { GroupExpenseLifecycleEventType, GroupExpenseState } from "@/domain/group-accounting";
import type { GroupOffsetSettlementState } from "@/domain/group-offsets";
import type { GroupSettlementState } from "@/domain/group-settlements";
import type { GroupJoinRequestKind, GroupJoinRequestStatus } from "@/domain/group-join-requests";
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

export type { GroupExpenseState };

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
    sourcePersonalFriendId: uuid("source_personal_friend_id"),
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
    uniqueIndex("friends_ledger_scope_source_personal_friend_uidx")
      .on(table.ledgerScopeId, table.sourcePersonalFriendId)
      .where(sql`${table.sourcePersonalFriendId} IS NOT NULL`),
    foreignKey({
      columns: [table.sourcePersonalFriendId],
      foreignColumns: [table.id],
      name: "friends_source_personal_friend_id_friends_id_fk",
    }).onDelete("restrict"),
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

export const organizationParticipants = pgTable(
  "organization_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "restrict" }),
    sourcePersonalFriendId: uuid("source_personal_friend_id").references(() => friends.id, { onDelete: "restrict" }),
    displayName: varchar("display_name", { length: 160 }),
    label: varchar("label", { length: 120 }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("organization_participants_identity_shape", sql`(${table.userId} IS NOT NULL AND ${table.displayName} IS NULL) OR (${table.userId} IS NULL AND ${table.displayName} IS NOT NULL AND btrim(${table.displayName}) <> '')`),
    check("organization_participants_label_not_blank", sql`${table.label} IS NULL OR btrim(${table.label}) <> ''`),
    unique("organization_participants_organization_id_id_unique").on(table.organizationId, table.id),
    uniqueIndex("organization_participants_registered_user_uidx")
      .on(table.organizationId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    uniqueIndex("organization_participants_source_personal_friend_uidx")
      .on(table.organizationId, table.sourcePersonalFriendId)
      .where(sql`${table.sourcePersonalFriendId} IS NOT NULL`),
    index("organization_participants_organization_idx").on(table.organizationId),
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
    participantId: uuid("participant_id").notNull(),
    role: varchar("role", { length: 32 }).default("member").notNull(),
    customCapabilities: jsonb("custom_capabilities").$type<OrganizationCapability[]>().notNull().default([]),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    check("organization_memberships_role_allowed", sql`${table.role} IN ('owner', 'admin', 'treasurer', 'member', 'custom')`),
    foreignKey({
      columns: [table.organizationId, table.participantId],
      foreignColumns: [organizationParticipants.organizationId, organizationParticipants.id],
      name: "organization_memberships_participant_fk",
    }).onDelete("restrict"),
    uniqueIndex("organization_memberships_participant_uidx").on(table.organizationId, table.participantId),
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
    participantId: uuid("participant_id"),
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
    foreignKey({
      columns: [table.organizationId, table.participantId],
      foreignColumns: [organizationParticipants.organizationId, organizationParticipants.id],
      name: "organization_invitations_participant_fk",
    }).onDelete("set null"),
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
    sourcePersonalFriendId: uuid("source_personal_friend_id").references(() => friends.id, { onDelete: "restrict" }),
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
    uniqueIndex("group_participants_group_source_personal_friend_uidx")
      .on(table.groupId, table.sourcePersonalFriendId)
      .where(sql`${table.sourcePersonalFriendId} IS NOT NULL`),
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

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("chat_threads_parent_xor", sql`(${table.organizationId} IS NOT NULL AND ${table.groupId} IS NULL) OR (${table.organizationId} IS NULL AND ${table.groupId} IS NOT NULL)`),
    unique("chat_threads_id_organization_unique").on(table.id, table.organizationId),
    unique("chat_threads_id_group_unique").on(table.id, table.groupId),
    uniqueIndex("chat_threads_organization_uidx").on(table.organizationId),
    uniqueIndex("chat_threads_group_uidx").on(table.groupId),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id"),
    groupId: uuid("group_id"),
    senderUserId: text("sender_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    senderParticipantId: uuid("sender_participant_id"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    check("chat_messages_body_not_blank", sql`btrim(${table.body}) <> ''`),
    check("chat_messages_body_length_valid", sql`length(${table.body}) <= 4000`),
    check("chat_messages_parent_xor", sql`(${table.organizationId} IS NOT NULL AND ${table.groupId} IS NULL) OR (${table.organizationId} IS NULL AND ${table.groupId} IS NOT NULL)`),
    check("chat_messages_participant_scope", sql`(${table.groupId} IS NULL AND ${table.senderParticipantId} IS NULL) OR (${table.groupId} IS NOT NULL AND ${table.senderParticipantId} IS NOT NULL)`),
    check("chat_messages_deleted_identity_shape", sql`(${table.deletedAt} IS NULL AND ${table.deletedByUserId} IS NULL) OR (${table.deletedAt} IS NOT NULL AND ${table.deletedByUserId} IS NOT NULL)`),
    foreignKey({
      columns: [table.threadId, table.organizationId],
      foreignColumns: [chatThreads.id, chatThreads.organizationId],
      name: "chat_messages_organization_thread_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.threadId, table.groupId],
      foreignColumns: [chatThreads.id, chatThreads.groupId],
      name: "chat_messages_group_thread_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.groupId, table.senderUserId, table.senderParticipantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.userId, groupParticipants.id],
      name: "chat_messages_sender_participant_fk",
    }).onDelete("restrict"),
    unique("chat_messages_thread_id_id_unique").on(table.threadId, table.id),
    index("chat_messages_thread_created_idx").on(table.threadId, table.createdAt, table.id),
  ],
);

export const chatThreadReads = pgTable(
  "chat_thread_reads",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    lastReadMessageId: uuid("last_read_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.userId] }),
    foreignKey({
      columns: [table.threadId, table.lastReadMessageId],
      foreignColumns: [chatMessages.threadId, chatMessages.id],
      name: "chat_thread_reads_message_scope_fk",
    }).onDelete("cascade"),
    index("chat_thread_reads_user_idx").on(table.userId),
  ],
);

export const groupJoinRequests = pgTable(
  "group_join_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32 }).$type<GroupJoinRequestKind>().notNull(),
    participantId: uuid("participant_id"),
    participantDisplayNameSnapshot: varchar("participant_display_name_snapshot", { length: 160 }),
    participantLabelSnapshot: varchar("participant_label_snapshot", { length: 120 }),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 16 }).$type<GroupJoinRequestStatus>().default("pending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
  },
  (table) => [
    check("group_join_requests_target_not_requester", sql`${table.targetUserId} <> ${table.requesterUserId}`),
    check("group_join_requests_kind_participant_shape", sql`(${table.kind} = 'member_invitation' AND ${table.participantId} IS NULL AND ${table.participantDisplayNameSnapshot} IS NULL AND ${table.participantLabelSnapshot} IS NULL) OR (${table.kind} = 'participant_link' AND ${table.participantDisplayNameSnapshot} IS NOT NULL AND btrim(${table.participantDisplayNameSnapshot}) <> '' AND (${table.participantId} IS NOT NULL OR ${table.status} <> 'pending'))`),
    check("group_join_requests_kind_allowed", sql`${table.kind} IN ('member_invitation', 'participant_link')`),
    check("group_join_requests_status_allowed", sql`${table.status} IN ('pending', 'accepted', 'declined', 'revoked', 'expired')`),
    check("group_join_requests_expires_after_created", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "group_join_requests_transition_timestamps",
      sql`(${table.status} = 'pending' AND ${table.acceptedAt} IS NULL AND ${table.declinedAt} IS NULL AND ${table.revokedAt} IS NULL AND ${table.expiredAt} IS NULL) OR (${table.status} = 'accepted' AND ${table.acceptedAt} IS NOT NULL AND ${table.declinedAt} IS NULL AND ${table.revokedAt} IS NULL AND ${table.expiredAt} IS NULL) OR (${table.status} = 'declined' AND ${table.acceptedAt} IS NULL AND ${table.declinedAt} IS NOT NULL AND ${table.revokedAt} IS NULL AND ${table.expiredAt} IS NULL) OR (${table.status} = 'revoked' AND ${table.acceptedAt} IS NULL AND ${table.declinedAt} IS NULL AND ${table.revokedAt} IS NOT NULL AND ${table.expiredAt} IS NULL) OR (${table.status} = 'expired' AND ${table.acceptedAt} IS NULL AND ${table.declinedAt} IS NULL AND ${table.revokedAt} IS NULL AND ${table.expiredAt} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [table.groupId, table.participantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.id],
      name: "group_join_requests_participant_fk",
    }).onDelete("set null"),
    uniqueIndex("group_join_requests_pending_group_target_uidx")
      .on(table.groupId, table.targetUserId)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("group_join_requests_pending_group_participant_uidx")
      .on(table.groupId, table.participantId)
      .where(sql`${table.status} = 'pending' AND ${table.participantId} IS NOT NULL`),
    index("group_join_requests_group_status_idx").on(table.groupId, table.status),
    index("group_join_requests_target_status_idx").on(table.targetUserId, table.status),
    index("group_join_requests_expires_at_idx").on(table.expiresAt),
  ],
);

export const groupExpenses = pgTable(
  "group_expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    creatorParticipantId: uuid("creator_participant_id").notNull(),
    payerParticipantId: uuid("payer_participant_id").notNull(),
    description: varchar("description", { length: 200 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    totalAmount: integer("total_amount").notNull(),
    state: varchar("state", { length: 16 }).$type<GroupExpenseState>().default("pending").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("group_expenses_description_not_blank", sql`btrim(${table.description}) <> ''`),
    check("group_expenses_total_amount_positive", sql`${table.totalAmount} > 0`),
    check("group_expenses_state_allowed", sql`${table.state} IN ('pending', 'confirmed', 'rejected', 'voided')`),
    check("group_expenses_confirmation_timestamp_shape", sql`(${table.state} IN ('pending', 'rejected') AND ${table.confirmedAt} IS NULL) OR (${table.state} IN ('confirmed', 'voided') AND ${table.confirmedAt} IS NOT NULL)`),
    foreignKey({
      columns: [table.groupId, table.creatorParticipantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.id],
      name: "group_expenses_creator_participant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.groupId, table.payerParticipantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.id],
      name: "group_expenses_payer_participant_fk",
    }).onDelete("restrict"),
    unique("group_expenses_group_id_id_unique").on(table.groupId, table.id),
    index("group_expenses_group_occurred_at_idx").on(table.groupId, table.occurredAt, table.id),
    index("group_expenses_group_state_idx").on(table.groupId, table.state),
  ],
);

export const groupExpenseShares = pgTable(
  "group_expense_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    expenseId: uuid("expense_id").notNull(),
    participantId: uuid("participant_id").notNull(),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("group_expense_shares_amount_positive", sql`${table.amount} > 0`),
    foreignKey({
      columns: [table.groupId, table.expenseId],
      foreignColumns: [groupExpenses.groupId, groupExpenses.id],
      name: "group_expense_shares_expense_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.groupId, table.participantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.id],
      name: "group_expense_shares_participant_fk",
    }).onDelete("restrict"),
    unique("group_expense_shares_group_id_id_unique").on(table.groupId, table.id),
    unique("group_expense_shares_group_expense_id_unique").on(table.groupId, table.expenseId, table.id),
    unique("group_expense_shares_expense_participant_unique").on(table.expenseId, table.participantId),
    index("group_expense_shares_group_expense_idx").on(table.groupId, table.expenseId, table.id),
    index("group_expense_shares_group_participant_idx").on(table.groupId, table.participantId),
  ],
);

export const groupObligations = pgTable(
  "group_obligations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    sourceExpenseId: uuid("source_expense_id").notNull(),
    sourceShareId: uuid("source_share_id").notNull(),
    debtorParticipantId: uuid("debtor_participant_id").notNull(),
    creditorParticipantId: uuid("creditor_participant_id").notNull(),
    originalAmount: integer("original_amount").notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("group_obligations_original_amount_positive", sql`${table.originalAmount} > 0`),
    check("group_obligations_no_self_debt", sql`${table.debtorParticipantId} <> ${table.creditorParticipantId}`),
    foreignKey({
      columns: [table.groupId, table.sourceExpenseId],
      foreignColumns: [groupExpenses.groupId, groupExpenses.id],
      name: "group_obligations_expense_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.groupId, table.sourceExpenseId, table.sourceShareId],
      foreignColumns: [groupExpenseShares.groupId, groupExpenseShares.expenseId, groupExpenseShares.id],
      name: "group_obligations_source_share_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.groupId, table.debtorParticipantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.id],
      name: "group_obligations_debtor_participant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.groupId, table.creditorParticipantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.id],
      name: "group_obligations_creditor_participant_fk",
    }).onDelete("restrict"),
    unique("group_obligations_group_id_id_unique").on(table.groupId, table.id),
    unique("group_obligations_source_share_unique").on(table.groupId, table.sourceShareId),
    index("group_obligations_group_expense_idx").on(table.groupId, table.sourceExpenseId, table.id),
    index("group_obligations_group_debtor_idx").on(table.groupId, table.debtorParticipantId),
    index("group_obligations_group_creditor_idx").on(table.groupId, table.creditorParticipantId),
  ],
);

export const groupSettlements = pgTable(
  "group_settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    senderParticipantId: uuid("sender_participant_id").notNull(),
    recipientParticipantId: uuid("recipient_participant_id").notNull(),
    amount: integer("amount").notNull(),
    paymentMethod: varchar("payment_method", { length: 40 }).notNull(),
    state: varchar("state", { length: 16 }).$type<GroupSettlementState>().default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => [
    check("group_settlements_amount_positive", sql`${table.amount} > 0`),
    check("group_settlements_payment_method_not_blank", sql`btrim(${table.paymentMethod}) <> ''`),
    check("group_settlements_state_allowed", sql`${table.state} IN ('pending', 'confirmed')`),
    check("group_settlements_no_self_payment", sql`${table.senderParticipantId} <> ${table.recipientParticipantId}`),
    check("group_settlements_confirmation_timestamp_shape", sql`(${table.state} = 'pending' AND ${table.confirmedAt} IS NULL) OR (${table.state} = 'confirmed' AND ${table.confirmedAt} IS NOT NULL)`),
    foreignKey({
      columns: [table.groupId, table.senderParticipantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.id],
      name: "group_settlements_sender_participant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.groupId, table.recipientParticipantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.id],
      name: "group_settlements_recipient_participant_fk",
    }).onDelete("restrict"),
    unique("group_settlements_group_id_id_unique").on(table.groupId, table.id),
    index("group_settlements_group_created_idx").on(table.groupId, table.createdAt, table.id),
    index("group_settlements_group_sender_recipient_idx").on(table.groupId, table.senderParticipantId, table.recipientParticipantId, table.createdAt, table.id),
    index("group_settlements_pending_recipient_idx").on(table.groupId, table.recipientParticipantId, table.createdAt, table.id).where(sql`${table.state} = 'pending'`),
  ],
);

export const groupSettlementApplications = pgTable(
  "group_settlement_applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    settlementId: uuid("settlement_id").notNull(),
    obligationId: uuid("obligation_id").notNull(),
    appliedAmount: integer("applied_amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("group_settlement_applications_amount_positive", sql`${table.appliedAmount} > 0`),
    foreignKey({
      columns: [table.groupId, table.settlementId],
      foreignColumns: [groupSettlements.groupId, groupSettlements.id],
      name: "group_settlement_applications_settlement_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.groupId, table.obligationId],
      foreignColumns: [groupObligations.groupId, groupObligations.id],
      name: "group_settlement_applications_obligation_fk",
    }).onDelete("restrict"),
    unique("group_settlement_applications_group_id_id_unique").on(table.groupId, table.id),
    unique("group_settlement_applications_settlement_obligation_unique").on(table.groupId, table.settlementId, table.obligationId),
    index("group_settlement_applications_group_settlement_idx").on(table.groupId, table.settlementId, table.createdAt, table.id),
    index("group_settlement_applications_group_obligation_idx").on(table.groupId, table.obligationId, table.createdAt, table.id),
  ],
);

export const groupOffsetSettlements = pgTable(
  "group_offset_settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    initiatorParticipantId: uuid("initiator_participant_id").notNull(),
    counterpartyParticipantId: uuid("counterparty_participant_id").notNull(),
    amount: integer("amount").notNull(),
    state: varchar("state", { length: 16 }).$type<GroupOffsetSettlementState>().default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => [
    check("group_offset_settlements_amount_positive", sql`${table.amount} > 0`),
    check("group_offset_settlements_state_allowed", sql`${table.state} IN ('pending', 'confirmed')`),
    check("group_offset_settlements_no_self_offset", sql`${table.initiatorParticipantId} <> ${table.counterpartyParticipantId}`),
    check("group_offset_settlements_confirmation_timestamp_shape", sql`(${table.state} = 'pending' AND ${table.confirmedAt} IS NULL) OR (${table.state} = 'confirmed' AND ${table.confirmedAt} IS NOT NULL)`),
    foreignKey({
      columns: [table.groupId, table.initiatorParticipantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.id],
      name: "group_offset_settlements_initiator_participant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.groupId, table.counterpartyParticipantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.id],
      name: "group_offset_settlements_counterparty_participant_fk",
    }).onDelete("restrict"),
    unique("group_offset_settlements_group_id_id_unique").on(table.groupId, table.id),
    index("group_offset_settlements_group_created_idx").on(table.groupId, table.createdAt, table.id),
    index("group_offset_settlements_pending_counterparty_idx").on(table.groupId, table.counterpartyParticipantId, table.createdAt, table.id).where(sql`${table.state} = 'pending'`),
    uniqueIndex("group_offset_settlements_pending_pair_uidx")
      .on(table.groupId, sql`LEAST(${table.initiatorParticipantId}, ${table.counterpartyParticipantId})`, sql`GREATEST(${table.initiatorParticipantId}, ${table.counterpartyParticipantId})`)
      .where(sql`${table.state} = 'pending'`),
  ],
);

export const groupOffsetApplications = pgTable(
  "group_offset_applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    offsetSettlementId: uuid("offset_settlement_id").notNull(),
    obligationId: uuid("obligation_id").notNull(),
    appliedAmount: integer("applied_amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("group_offset_applications_amount_positive", sql`${table.appliedAmount} > 0`),
    foreignKey({
      columns: [table.groupId, table.offsetSettlementId],
      foreignColumns: [groupOffsetSettlements.groupId, groupOffsetSettlements.id],
      name: "group_offset_applications_offset_settlement_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.groupId, table.obligationId],
      foreignColumns: [groupObligations.groupId, groupObligations.id],
      name: "group_offset_applications_obligation_fk",
    }).onDelete("restrict"),
    unique("group_offset_applications_group_id_id_unique").on(table.groupId, table.id),
    unique("group_offset_applications_offset_obligation_unique").on(table.groupId, table.offsetSettlementId, table.obligationId),
    index("group_offset_applications_group_offset_idx").on(table.groupId, table.offsetSettlementId, table.createdAt, table.id),
    index("group_offset_applications_group_obligation_idx").on(table.groupId, table.obligationId, table.createdAt, table.id),
  ],
);

export const groupSettlementProofs = pgTable(
  "group_settlement_proofs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    settlementId: uuid("settlement_id").notNull(),
    originalFilename: varchar("original_filename", { length: 160 }).notNull(),
    mediaType: varchar("media_type", { length: 32 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    content: bytea("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("group_settlement_proofs_media_type_allowed", sql`${table.mediaType} IN ('image/jpeg', 'image/png', 'image/webp')`),
    check("group_settlement_proofs_byte_size_valid", sql`${table.byteSize} BETWEEN 1 AND 5242880`),
    check("group_settlement_proofs_content_size_matches", sql`octet_length(${table.content}) = ${table.byteSize}`),
    check("group_settlement_proofs_filename_not_blank", sql`btrim(${table.originalFilename}) <> ''`),
    check("group_settlement_proofs_sha256_hex", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    foreignKey({
      columns: [table.groupId, table.settlementId],
      foreignColumns: [groupSettlements.groupId, groupSettlements.id],
      name: "group_settlement_proofs_settlement_fk",
    }).onDelete("restrict"),
    unique("group_settlement_proofs_group_id_id_unique").on(table.groupId, table.id),
    unique("group_settlement_proofs_settlement_sha256_unique").on(table.groupId, table.settlementId, table.sha256),
    uniqueIndex("group_settlement_proofs_settlement_uidx").on(table.groupId, table.settlementId),
  ],
);

export const groupExpenseLifecycleEvents = pgTable(
  "group_expense_lifecycle_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    expenseId: uuid("expense_id").notNull(),
    eventType: varchar("event_type", { length: 32 }).$type<GroupExpenseLifecycleEventType>().notNull(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    fromState: varchar("from_state", { length: 16 }).$type<GroupExpenseState>(),
    toState: varchar("to_state", { length: 16 }).$type<GroupExpenseState>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.groupId, table.expenseId],
      foreignColumns: [groupExpenses.groupId, groupExpenses.id],
      name: "group_expense_lifecycle_events_expense_fk",
    }).onDelete("restrict"),
    check("group_expense_lifecycle_events_type_allowed", sql`${table.eventType} IN ('created', 'payer_confirmed', 'payer_rejected', 'voided')`),
    check("group_expense_lifecycle_events_transition_shape", sql`(${table.eventType} = 'created' AND ${table.fromState} IS NULL AND ${table.toState} IN ('pending', 'confirmed')) OR (${table.eventType} = 'payer_confirmed' AND ${table.fromState} = 'pending' AND ${table.toState} = 'confirmed') OR (${table.eventType} = 'payer_rejected' AND ${table.fromState} = 'pending' AND ${table.toState} = 'rejected') OR (${table.eventType} = 'voided' AND ${table.fromState} = 'confirmed' AND ${table.toState} = 'voided')`),
    index("group_expense_lifecycle_events_expense_created_idx").on(table.groupId, table.expenseId, table.createdAt, table.id),
  ],
);

export const groupExpenseReceipts = pgTable(
  "group_expense_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    expenseId: uuid("expense_id").notNull(),
    originalFilename: varchar("original_filename", { length: 160 }).notNull(),
    mediaType: varchar("media_type", { length: 32 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    content: bytea("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("group_expense_receipts_media_type_allowed", sql`${table.mediaType} IN ('image/jpeg', 'image/png', 'image/webp')`),
    check("group_expense_receipts_byte_size_valid", sql`${table.byteSize} BETWEEN 1 AND 5242880`),
    check("group_expense_receipts_content_size_matches", sql`octet_length(${table.content}) = ${table.byteSize}`),
    check("group_expense_receipts_filename_not_blank", sql`btrim(${table.originalFilename}) <> ''`),
    check("group_expense_receipts_sha256_hex", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    foreignKey({
      columns: [table.groupId, table.expenseId],
      foreignColumns: [groupExpenses.groupId, groupExpenses.id],
      name: "group_expense_receipts_expense_fk",
    }).onDelete("restrict"),
    unique("group_expense_receipts_group_id_id_unique").on(table.groupId, table.id),
    unique("group_expense_receipts_expense_sha256_unique").on(table.groupId, table.expenseId, table.sha256),
    index("group_expense_receipts_expense_created_id_idx").on(table.groupId, table.expenseId, table.createdAt, table.id),
  ],
);

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
  organizationParticipants: many(organizationParticipants),
  groupMemberships: many(groupMemberships),
  groupParticipants: many(groupParticipants),
  groupJoinRequestTargets: many(groupJoinRequests, { relationName: "groupJoinRequestTargets" }),
  groupJoinRequestRequesters: many(groupJoinRequests, { relationName: "groupJoinRequestRequesters" }),
  organizationInvitationsReceived: many(organizationInvitations, { relationName: "organizationInvitationTargets" }),
  organizationInvitationsSent: many(organizationInvitations, { relationName: "organizationInvitationInviters" }),
  chatMessageSenders: many(chatMessages, { relationName: "chatMessageSenders" }),
  chatMessageDeleters: many(chatMessages, { relationName: "chatMessageDeleters" }),
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
  participants: many(organizationParticipants),
  invitations: many(organizationInvitations),
  avatar: one(organizationAvatars),
  ledgerScope: one(ledgerScopes),
  chatThreads: many(chatThreads),
}));

export const organizationParticipantsRelations = relations(organizationParticipants, ({ one, many }) => ({
  organization: one(organizations, { fields: [organizationParticipants.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [organizationParticipants.userId], references: [users.id] }),
  sourcePersonalFriend: one(friends, { fields: [organizationParticipants.sourcePersonalFriendId], references: [friends.id] }),
  membership: one(organizationMemberships),
  invitations: many(organizationInvitations),
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
  participant: one(organizationParticipants, {
    fields: [organizationMemberships.organizationId, organizationMemberships.participantId],
    references: [organizationParticipants.organizationId, organizationParticipants.id],
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
  participant: one(organizationParticipants, {
    fields: [organizationInvitations.organizationId, organizationInvitations.participantId],
    references: [organizationParticipants.organizationId, organizationParticipants.id],
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
  joinRequests: many(groupJoinRequests),
  expenses: many(groupExpenses),
  expenseShares: many(groupExpenseShares),
  obligations: many(groupObligations),
  settlements: many(groupSettlements),
  settlementApplications: many(groupSettlementApplications),
  offsetSettlements: many(groupOffsetSettlements),
  offsetApplications: many(groupOffsetApplications),
  settlementProofs: many(groupSettlementProofs),
  expenseReceipts: many(groupExpenseReceipts),
  chatThreads: many(chatThreads),
}));

export const groupParticipantsRelations = relations(groupParticipants, ({ one, many }) => ({
  group: one(groups, { fields: [groupParticipants.groupId], references: [groups.id] }),
  user: one(users, { fields: [groupParticipants.userId], references: [users.id] }),
  membership: one(groupMemberships),
  createdExpenses: many(groupExpenses, { relationName: "groupExpenseCreators" }),
  paidExpenses: many(groupExpenses, { relationName: "groupExpensePayers" }),
  expenseShares: many(groupExpenseShares),
  debtorObligations: many(groupObligations, { relationName: "groupObligationDebtors" }),
  creditorObligations: many(groupObligations, { relationName: "groupObligationCreditors" }),
  sentSettlements: many(groupSettlements, { relationName: "groupSettlementSenders" }),
  receivedSettlements: many(groupSettlements, { relationName: "groupSettlementRecipients" }),
  initiatedOffsets: many(groupOffsetSettlements, { relationName: "groupOffsetInitiators" }),
  receivedOffsets: many(groupOffsetSettlements, { relationName: "groupOffsetCounterparties" }),
  chatMessages: many(chatMessages),
}));

export const groupMembershipsRelations = relations(groupMemberships, ({ one }) => ({
  group: one(groups, { fields: [groupMemberships.groupId], references: [groups.id] }),
  user: one(users, { fields: [groupMemberships.userId], references: [users.id] }),
  participant: one(groupParticipants, { fields: [groupMemberships.groupId, groupMemberships.participantId], references: [groupParticipants.groupId, groupParticipants.id] }),
}));

export const groupAvatarsRelations = relations(groupAvatars, ({ one }) => ({
  group: one(groups, { fields: [groupAvatars.groupId], references: [groups.id] }),
}));

export const chatThreadsRelations = relations(chatThreads, ({ one, many }) => ({
  organization: one(organizations, { fields: [chatThreads.organizationId], references: [organizations.id] }),
  group: one(groups, { fields: [chatThreads.groupId], references: [groups.id] }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  thread: one(chatThreads, { fields: [chatMessages.threadId], references: [chatThreads.id] }),
  sender: one(users, { fields: [chatMessages.senderUserId], references: [users.id], relationName: "chatMessageSenders" }),
  senderParticipant: one(groupParticipants, { fields: [chatMessages.groupId, chatMessages.senderUserId, chatMessages.senderParticipantId], references: [groupParticipants.groupId, groupParticipants.userId, groupParticipants.id] }),
  deletedBy: one(users, { fields: [chatMessages.deletedByUserId], references: [users.id], relationName: "chatMessageDeleters" }),
}));

export const groupJoinRequestsRelations = relations(groupJoinRequests, ({ one }) => ({
  group: one(groups, { fields: [groupJoinRequests.groupId], references: [groups.id] }),
  participant: one(groupParticipants, { fields: [groupJoinRequests.groupId, groupJoinRequests.participantId], references: [groupParticipants.groupId, groupParticipants.id] }),
  target: one(users, { fields: [groupJoinRequests.targetUserId], references: [users.id], relationName: "groupJoinRequestTargets" }),
  requester: one(users, { fields: [groupJoinRequests.requesterUserId], references: [users.id], relationName: "groupJoinRequestRequesters" }),
}));

export const groupExpensesRelations = relations(groupExpenses, ({ one, many }) => ({
  group: one(groups, { fields: [groupExpenses.groupId], references: [groups.id] }),
  creator: one(groupParticipants, { fields: [groupExpenses.groupId, groupExpenses.creatorParticipantId], references: [groupParticipants.groupId, groupParticipants.id], relationName: "groupExpenseCreators" }),
  payer: one(groupParticipants, { fields: [groupExpenses.groupId, groupExpenses.payerParticipantId], references: [groupParticipants.groupId, groupParticipants.id], relationName: "groupExpensePayers" }),
  shares: many(groupExpenseShares),
  obligations: many(groupObligations),
  receipts: many(groupExpenseReceipts),
  lifecycleEvents: many(groupExpenseLifecycleEvents),
}));

export const groupExpenseSharesRelations = relations(groupExpenseShares, ({ one }) => ({
  group: one(groups, { fields: [groupExpenseShares.groupId], references: [groups.id] }),
  expense: one(groupExpenses, { fields: [groupExpenseShares.groupId, groupExpenseShares.expenseId], references: [groupExpenses.groupId, groupExpenses.id] }),
  participant: one(groupParticipants, { fields: [groupExpenseShares.groupId, groupExpenseShares.participantId], references: [groupParticipants.groupId, groupParticipants.id] }),
  obligation: one(groupObligations),
}));

export const groupObligationsRelations = relations(groupObligations, ({ one, many }) => ({
  group: one(groups, { fields: [groupObligations.groupId], references: [groups.id] }),
  expense: one(groupExpenses, { fields: [groupObligations.groupId, groupObligations.sourceExpenseId], references: [groupExpenses.groupId, groupExpenses.id] }),
  sourceShare: one(groupExpenseShares, { fields: [groupObligations.groupId, groupObligations.sourceExpenseId, groupObligations.sourceShareId], references: [groupExpenseShares.groupId, groupExpenseShares.expenseId, groupExpenseShares.id] }),
  debtor: one(groupParticipants, { fields: [groupObligations.groupId, groupObligations.debtorParticipantId], references: [groupParticipants.groupId, groupParticipants.id], relationName: "groupObligationDebtors" }),
  creditor: one(groupParticipants, { fields: [groupObligations.groupId, groupObligations.creditorParticipantId], references: [groupParticipants.groupId, groupParticipants.id], relationName: "groupObligationCreditors" }),
  settlementApplications: many(groupSettlementApplications),
  offsetApplications: many(groupOffsetApplications),
}));

export const groupSettlementsRelations = relations(groupSettlements, ({ one, many }) => ({
  group: one(groups, { fields: [groupSettlements.groupId], references: [groups.id] }),
  sender: one(groupParticipants, { fields: [groupSettlements.groupId, groupSettlements.senderParticipantId], references: [groupParticipants.groupId, groupParticipants.id], relationName: "groupSettlementSenders" }),
  recipient: one(groupParticipants, { fields: [groupSettlements.groupId, groupSettlements.recipientParticipantId], references: [groupParticipants.groupId, groupParticipants.id], relationName: "groupSettlementRecipients" }),
  proof: one(groupSettlementProofs),
  applications: many(groupSettlementApplications),
}));

export const groupSettlementApplicationsRelations = relations(groupSettlementApplications, ({ one }) => ({
  group: one(groups, { fields: [groupSettlementApplications.groupId], references: [groups.id] }),
  settlement: one(groupSettlements, { fields: [groupSettlementApplications.groupId, groupSettlementApplications.settlementId], references: [groupSettlements.groupId, groupSettlements.id] }),
  obligation: one(groupObligations, { fields: [groupSettlementApplications.groupId, groupSettlementApplications.obligationId], references: [groupObligations.groupId, groupObligations.id] }),
}));

export const groupOffsetSettlementsRelations = relations(groupOffsetSettlements, ({ one, many }) => ({
  group: one(groups, { fields: [groupOffsetSettlements.groupId], references: [groups.id] }),
  initiator: one(groupParticipants, { fields: [groupOffsetSettlements.groupId, groupOffsetSettlements.initiatorParticipantId], references: [groupParticipants.groupId, groupParticipants.id], relationName: "groupOffsetInitiators" }),
  counterparty: one(groupParticipants, { fields: [groupOffsetSettlements.groupId, groupOffsetSettlements.counterpartyParticipantId], references: [groupParticipants.groupId, groupParticipants.id], relationName: "groupOffsetCounterparties" }),
  applications: many(groupOffsetApplications),
}));

export const groupOffsetApplicationsRelations = relations(groupOffsetApplications, ({ one }) => ({
  group: one(groups, { fields: [groupOffsetApplications.groupId], references: [groups.id] }),
  offsetSettlement: one(groupOffsetSettlements, { fields: [groupOffsetApplications.groupId, groupOffsetApplications.offsetSettlementId], references: [groupOffsetSettlements.groupId, groupOffsetSettlements.id] }),
  obligation: one(groupObligations, { fields: [groupOffsetApplications.groupId, groupOffsetApplications.obligationId], references: [groupObligations.groupId, groupObligations.id] }),
}));

export const groupSettlementProofsRelations = relations(groupSettlementProofs, ({ one }) => ({
  group: one(groups, { fields: [groupSettlementProofs.groupId], references: [groups.id] }),
  settlement: one(groupSettlements, { fields: [groupSettlementProofs.groupId, groupSettlementProofs.settlementId], references: [groupSettlements.groupId, groupSettlements.id] }),
}));

export const groupExpenseReceiptsRelations = relations(groupExpenseReceipts, ({ one }) => ({
  group: one(groups, { fields: [groupExpenseReceipts.groupId], references: [groups.id] }),
  expense: one(groupExpenses, { fields: [groupExpenseReceipts.groupId, groupExpenseReceipts.expenseId], references: [groupExpenses.groupId, groupExpenses.id] }),
}));

export const groupExpenseLifecycleEventsRelations = relations(groupExpenseLifecycleEvents, ({ one }) => ({
  group: one(groups, { fields: [groupExpenseLifecycleEvents.groupId], references: [groups.id] }),
  expense: one(groupExpenses, { fields: [groupExpenseLifecycleEvents.groupId, groupExpenseLifecycleEvents.expenseId], references: [groupExpenses.groupId, groupExpenses.id] }),
  actor: one(users, { fields: [groupExpenseLifecycleEvents.actorUserId], references: [users.id] }),
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
