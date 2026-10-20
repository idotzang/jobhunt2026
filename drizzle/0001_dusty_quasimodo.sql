ALTER TABLE "applications" ADD COLUMN "status" text DEFAULT 'applied' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "applications" SET "status_changed_at" = "created_at";