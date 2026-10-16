CREATE TABLE "applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"role" text NOT NULL,
	"link" text,
	"applied_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
