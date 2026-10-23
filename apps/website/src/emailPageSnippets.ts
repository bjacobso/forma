import { generateEmailProgram } from "@formalang/ts/email";
import {
  warmupFallthroughSource,
  warmupLaneTypoSource,
  warmupMissingArmSource,
  warmupSource,
  warmupUnhandledBounceSource,
} from "./emailPageSources";

/** Directory, relative to the repository root, that the docs `/email` page imports. */
export const emailSnippetDir = "docs/snippets/email";

/**
 * The `/email` page's rule, generated TypeScript, and located
 * diagnostics, all from `generateEmailProgram`. Regenerate with
 * `pnpm --filter @formalang/website snippets:home`.
 */
export function emailPageSnippets(): Record<string, string> {
  const result = generateEmailProgram(warmupSource, { sourceId: "warmup.lisp" });
  if (!result.ok || !result.code) throw new Error(JSON.stringify(result.diagnostics));
  const diagnostic = (source: string) => {
    const rejected = generateEmailProgram(source, { sourceId: "warmup.lisp" });
    if (rejected.ok || !rejected.diagnostics.length) throw new Error("Expected email rejection");
    return rejected.diagnostics.map(d =>
      `warmup.lisp:${d.span?.startLine}:${d.span?.startColumn} ${d.severity} ${d.code}\n  ${d.message}`,
    ).join("\n\n") + "\n";
  };
  return {
    "rule.lisp": `${warmupSource.split("\n\n")[0]}\n`,
    "warmup.ts": result.code,
    "lane-typo.txt": diagnostic(warmupLaneTypoSource),
    "fallthrough.txt": diagnostic(warmupFallthroughSource),
    "unhandled-bounce.txt": diagnostic(warmupUnhandledBounceSource),
    "missing-arm.txt": diagnostic(warmupMissingArmSource),
  };
}
