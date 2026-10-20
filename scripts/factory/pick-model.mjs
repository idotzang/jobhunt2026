import { fileURLToPath } from "node:url";

export const MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

export function pickModel(labels, defaultTier = "sonnet") {
  const list = Array.isArray(labels) ? labels : [];
  for (const tier of ["opus", "sonnet", "haiku"]) {
    if (list.includes(`model:${tier}`)) return MODELS[tier];
  }
  return Object.hasOwn(MODELS, defaultTier) ? MODELS[defaultTier] : MODELS.sonnet;
}

function labelsFromEnv(raw) {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(pickModel(labelsFromEnv(process.env.LABELS), process.env.DEFAULT_TIER));
}
