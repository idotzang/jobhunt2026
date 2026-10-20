import { date, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  company: text("company").notNull(),
  role: text("role").notNull(),
  link: text("link"),
  appliedOn: date("applied_on").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  status: text("status").notNull().default("applied"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Application = typeof applications.$inferSelect;
