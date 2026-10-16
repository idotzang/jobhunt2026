import { z } from "zod";

export const newApplicationSchema = z.object({
  company: z.string().trim().min(1, "Company is required").max(200),
  role: z.string().trim().min(1, "Role is required").max(200),
  link: z.union([z.literal(""), z.url({ protocol: /^https?$/, error: "Link must be a valid URL" })]).transform((v) => v || null),
  appliedOn: z.iso.date("Applied date must be YYYY-MM-DD"),
});

export type NewApplication = z.infer<typeof newApplicationSchema>;

export function parseNewApplication(formData: FormData) {
  const field = (name: string) => String(formData.get(name) ?? "");
  return newApplicationSchema.safeParse({
    company: field("company"),
    role: field("role"),
    link: field("link").trim(),
    appliedOn: field("appliedOn"),
  });
}
