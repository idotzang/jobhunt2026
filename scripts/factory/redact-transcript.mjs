// Strips known secrets from a transcript before it is uploaded as an artifact.
// GitHub does not mask secrets inside artifacts and the agent has unrestricted
// Bash, so the PAT (also base64 in .git/config) and the OAuth token could leak.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIN_LENGTH = 8;
const b64 = (s) => Buffer.from(s).toString("base64");

export function redact(text, secrets) {
  const needles = new Set();
  for (const s of secrets ?? []) {
    if (typeof s !== "string" || s.length < MIN_LENGTH) continue;
    needles.add(s);
    needles.add(b64(`x-access-token:${s}`));
    needles.add(b64(s));
  }
  let out = text;
  for (const n of [...needles].sort((a, b) => b.length - a.length)) {
    out = out.split(n).join("***");
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const file = process.argv[2];
    if (!file) throw new Error("usage: redact-transcript.mjs <file>");
    const secrets = [process.env.FACTORY_GH_TOKEN, process.env.CLAUDE_CODE_OAUTH_TOKEN];
    writeFileSync(file, redact(readFileSync(file, "utf8"), secrets));
  } catch (err) {
    console.error(`redact-transcript failed: ${err.message}`);
    process.exit(1);
  }
}
