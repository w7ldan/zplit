import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
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
    outingId: uuid("outing_id").references(() => outings.id, { onDelete: "set null" }),
    description: varchar("description", { length: 200 }).notNull(),
    amount: integer("amount").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("expenses_description_not_blank", sql`btrim(${table.description}) <> ''`),
    check("expenses_amount_positive", sql`${table.amount} > 0`),
    uniqueIndex("expenses_owner_user_id_id_uidx").on(table.ownerUserId, table.id),
    index("expenses_outing_id_idx").on(table.ownerUserId, table.outingId),
    index("expenses_occurred_at_idx").on(table.ownerUserId, table.occurredAt),
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

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
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
