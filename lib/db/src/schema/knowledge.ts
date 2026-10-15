import { sql } from "drizzle-orm";
import { pgTable, text, uuid, integer, jsonb, timestamp, boolean, bigint, customType, primaryKey, index, check } from "drizzle-orm/pg-core";
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
export const knowledgeCleanup = pgTable("cc_knowledge_cleanup", {
  singleton: boolean("singleton").primaryKey().default(true),
  cursor: text("cursor"),
  lastRun: timestamp("last_run", { withTimezone: true }),
  report: jsonb("report"),
}, t => [check("cc_knowledge_cleanup_singleton_check", sql`${t.singleton}`)]);
export const knowledgeDocuments = pgTable("cc_knowledge", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(),
  title: text("title").notNull(), release: text("release").notNull(),
  topics: jsonb("topics").notNull().default([]), filename: text("filename").notNull(),
  version: integer("version").notNull().default(1), status: text("status").notNull(),
  error: text("error"), objectPath: text("object_path"), replaceId: uuid("replace_id"),
  expectedVersion: integer("expected_version"), size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("cc_knowledge_status").on(t.status)]);
export const knowledgeChunks = pgTable("cc_knowledge_chunks", {
  documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(), section: text("section").notNull(), text: text("text").notNull(),
  search: tsvector("search").generatedAlwaysAs(sql`to_tsvector('english', text)`),
}, t => [primaryKey({ columns: [t.documentId, t.ordinal] }), index("cc_knowledge_search").using("gin", t.search)]);
export const knowledgeEpoch = pgTable("cc_knowledge_epoch", {
  singleton: boolean("singleton").primaryKey().default(true), revision: bigint("revision", { mode: "number" }).notNull().default(0),
}, t => [check("cc_knowledge_epoch_singleton_check", sql`${t.singleton}`)]);
