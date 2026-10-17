import { fileURLToPath } from "node:url";

export const MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

export function pickModel(labels) {
  for (const tier of ["opus", "sonnet", "haiku"]) {
    if (labels.includes(`model:${tier}`)) return MODELS[tier];
  }
  return MODELS.sonnet;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(pickModel(JSON.parse(process.env.LABELS ?? "[]")));
}
