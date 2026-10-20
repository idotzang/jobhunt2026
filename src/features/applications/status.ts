import { z } from "zod";

export const STATUSES = ["applied", "screening", "interview", "offer", "rejected", "withdrawn"] as const;

export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const ACTIVE_STATUSES: readonly Status[] = ["applied", "screening", "interview", "offer"];

export const statusSchema = z.enum(STATUSES);
