import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const friends = pgTable(
  "friends",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 120 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 32 }),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("friends_name_not_blank", sql`btrim(${table.name}) <> ''`),
    uniqueIndex("friends_owner_user_id_id_uidx").on(table.ownerUserId, table.id),
    index("friends_name_idx").on(table.ownerUserId, table.name),
    index("friends_archived_at_idx").on(table.ownerUserId, table.archivedAt),
  ],
);

export const outings = pgTable(
  "outings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 160 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("outings_title_not_blank", sql`btrim(${table.title}) <> ''`),
    uniqueIndex("outings_owner_user_id_id_uidx").on(table.ownerUserId, table.id),
    index("outings_occurred_at_idx").on(table.ownerUserId, table.occurredAt),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
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
      columns: [table.ownerUserId, table.outingId],
      foreignColumns: [outings.ownerUserId, outings.id],
      name: "expenses_owner_outing_fk",
    }).onDelete("restrict"),
    uniqueIndex("expenses_owner_user_id_id_uidx").on(table.ownerUserId, table.id),
    index("expenses_outing_id_idx").on(table.ownerUserId, table.outingId),
  ],
);

export const expenseReceipts = pgTable(
  "expense_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
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
      columns: [table.ownerUserId, table.expenseId],
      foreignColumns: [expenses.ownerUserId, expenses.id],
      name: "expense_receipts_owner_expense_fk",
    }).onDelete("cascade"),
    uniqueIndex("expense_receipts_owner_expense_id_uidx").on(table.ownerUserId, table.expenseId, table.id),
    uniqueIndex("expense_receipts_owner_expense_sha256_uidx").on(table.ownerUserId, table.expenseId, table.sha256),
    index("expense_receipts_owner_expense_created_id_idx").on(table.ownerUserId, table.expenseId, table.createdAt, table.id),
  ],
);

export const expenseShares = pgTable(
  "expense_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    expenseId: uuid("expense_id").notNull(),
    friendId: uuid("friend_id").notNull(),
    amountOwed: integer("amount_owed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("expense_shares_amount_owed_positive", sql`${table.amountOwed} > 0`),
    foreignKey({
      columns: [table.ownerUserId, table.expenseId],
      foreignColumns: [expenses.ownerUserId, expenses.id],
      name: "expense_shares_owner_expense_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerUserId, table.friendId],
      foreignColumns: [friends.ownerUserId, friends.id],
      name: "expense_shares_owner_friend_fk",
    }).onDelete("restrict"),
    uniqueIndex("expense_shares_owner_user_id_id_uidx").on(table.ownerUserId, table.id),
    uniqueIndex("expense_shares_expense_friend_uidx").on(table.expenseId, table.friendId),
    index("expense_shares_friend_id_idx").on(table.ownerUserId, table.friendId),
  ],
);

export const repayments = pgTable(
  "repayments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
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
      columns: [table.ownerUserId, table.friendId],
      foreignColumns: [friends.ownerUserId, friends.id],
      name: "repayments_owner_friend_fk",
    }).onDelete("restrict"),
    uniqueIndex("repayments_owner_user_id_id_uidx").on(table.ownerUserId, table.id),
    index("repayments_friend_id_idx").on(table.ownerUserId, table.friendId),
    index("repayments_paid_at_idx").on(table.ownerUserId, table.paidAt),
  ],
);

export const repaymentAllocations = pgTable(
  "repayment_allocations",
  {
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    repaymentId: uuid("repayment_id").notNull(),
    expenseShareId: uuid("expense_share_id").notNull(),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.repaymentId, table.expenseShareId] }),
    check("repayment_allocations_amount_positive", sql`${table.amount} > 0`),
    foreignKey({
      columns: [table.ownerUserId, table.repaymentId],
      foreignColumns: [repayments.ownerUserId, repayments.id],
      name: "repayment_allocations_owner_repayment_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerUserId, table.expenseShareId],
      foreignColumns: [expenseShares.ownerUserId, expenseShares.id],
      name: "repayment_allocations_owner_expense_share_fk",
    }).onDelete("restrict"),
    index("repayment_allocations_expense_share_id_idx").on(table.ownerUserId, table.expenseShareId),
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
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
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
      columns: [table.ownerUserId, table.friendId],
      foreignColumns: [friends.ownerUserId, friends.id],
      name: "debtor_share_links_owner_friend_fk",
    }).onDelete("restrict"),
    uniqueIndex("debtor_share_links_owner_user_id_id_uidx").on(table.ownerUserId, table.id),
    uniqueIndex("debtor_share_links_token_hash_uidx").on(table.tokenHash),
    uniqueIndex("debtor_share_links_active_owner_friend_uidx")
      .on(table.ownerUserId, table.friendId)
      .where(sql`${table.revokedAt} IS NULL`),
    index("debtor_share_links_owner_friend_idx").on(table.ownerUserId, table.friendId),
    index("debtor_share_links_expires_at_idx").on(table.expiresAt),
  ],
);

export const debtorShareReceipts = pgTable(
  "debtor_share_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    debtorShareLinkId: uuid("debtor_share_link_id").notNull(),
    expenseId: uuid("expense_id").notNull(),
    expenseReceiptId: uuid("expense_receipt_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerUserId, table.debtorShareLinkId],
      foreignColumns: [debtorShareLinks.ownerUserId, debtorShareLinks.id],
      name: "debtor_share_receipts_owner_link_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerUserId, table.expenseId, table.expenseReceiptId],
      foreignColumns: [expenseReceipts.ownerUserId, expenseReceipts.expenseId, expenseReceipts.id],
      name: "debtor_share_receipts_owner_expense_receipt_fk",
    }).onDelete("cascade"),
    uniqueIndex("debtor_share_receipts_link_receipt_uidx").on(table.ownerUserId, table.debtorShareLinkId, table.expenseReceiptId),
    index("debtor_share_receipts_link_idx").on(table.ownerUserId, table.debtorShareLinkId),
    index("debtor_share_receipts_public_id_idx").on(table.id),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  createdInvitations: many(accountInvitations, { relationName: "createdInvitations" }),
  acceptedInvitations: many(accountInvitations, { relationName: "acceptedInvitations" }),
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
