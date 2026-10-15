import { pgTable, text, boolean, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const accounts = pgTable("cc_accounts", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(),
  active: boolean("active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  overrides: jsonb("overrides").$type<Record<string, boolean>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertAccountSchema = createInsertSchema(accounts);
export type Account = typeof accounts.$inferSelect;
export const accountSessions = pgTable("cc_account_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  csrf: text("csrf").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const accountThrottle = pgTable("cc_account_throttle", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const accountAudit = pgTable("cc_account_audit", {
  id: text("id").primaryKey(),
  actorId: text("actor_id"),
  targetId: text("target_id"),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
