/**
 * RFC 0027 (Stages 1–2): Directional contract diffs and checked pure payload migrations.
 *
 * Browser-safe: zero `node:*` imports.
 */

export * from "./types.js";
export { combineVerdicts, diffContractSnapshots } from "./diff.js";
export { checkPureMigration, validateValueAgainstType } from "./migrations.js";
