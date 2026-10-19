// Pure selection of Neon preview branches to delete. No I/O.
const PREFIX = "preview/";
const VALID_REF = /^[A-Za-z0-9._/-]{1,200}$/;

export function previewBranchName(headRef) {
  if (
    typeof headRef !== "string" ||
    !VALID_REF.test(headRef) ||
    headRef.includes("..") ||
    headRef.startsWith("/") ||
    headRef.endsWith("/")
  ) {
    throw new Error("invalid head ref");
  }
  return PREFIX + headRef;
}

function deletable(branch) {
  return (
    branch &&
    typeof branch.name === "string" &&
    branch.name.startsWith(PREFIX) &&
    branch.name.length > PREFIX.length &&
    branch.name !== "main" &&
    branch.name !== "dev" &&
    branch.default !== true &&
    branch.protected !== true
  );
}

export function selectForPr(branches, headRef) {
  const name = previewBranchName(headRef);
  const hit = branches.find((b) => deletable(b) && b.name === name);
  return hit ? [hit] : [];
}

export function selectOrphans(branches, liveGitRefs) {
  const live = new Set(liveGitRefs);
  return branches.filter((b) => deletable(b) && !live.has(b.name.slice(PREFIX.length)));
}
