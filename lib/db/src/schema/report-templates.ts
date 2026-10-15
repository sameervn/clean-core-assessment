import { pgTable, text, uuid, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { accounts } from "./accounts";
export const reportTemplates = pgTable("cc_report_templates", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull(),
  objectPath: text("object_path").notNull(),
  replaceId: uuid("replace_id"),
  expectedVersion: integer("expected_version"),
  previewed: boolean("previewed").notNull().default(false),
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("cc_report_templates_owner").on(table.ownerId),
  uniqueIndex("cc_report_templates_active").on(table.ownerId).where(sql`${table.active}`),
]);
export const insertReportTemplateSchema = createInsertSchema(reportTemplates);
export type ReportTemplate = typeof reportTemplates.$inferSelect;
export const reportTemplateGarbage = pgTable("cc_report_template_garbage", {
  objectPath: text("object_path").primaryKey(),
  deleteAfter: timestamp("delete_after", { withTimezone: true }).notNull(),
});
