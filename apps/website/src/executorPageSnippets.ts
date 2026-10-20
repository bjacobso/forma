import { elaborateEffectProgram, generateEffectProgram } from "@formalang/ts/mechanics";
import { uncheckedTsc } from "./effectPageSnippets";
import { catalogSource, programSource, turnCloseIssueSource, turnDraftSource, turnSource } from "./executorPageSources";

/** Directory, relative to the repository root, that the docs `/executor` page imports. */
export const executorSnippetDir = "docs/snippets/executor";

/**
 * Executor's approval policy for each tool: queries run, mutations ask. This is
 * host data that a real host would read from Executor; Forma does not supply it.
 */
export const toolPolicy: Readonly<Record<string, "allow" | "ask">> = {
  "GitHub.list-issues": "allow",
  "GitHub.close-issue": "ask",
  "Slack.post-message": "ask",
};

/** The turn starts after the catalog and one blank line. */
const turnOffset = catalogSource.split("\n").length + 1;

interface CheckedTurn {
  readonly diagnostics: readonly string[];
  readonly requires: ReadonlyMap<string, readonly string[]>;
}

/** Checks catalog + turn as one module and reports locations relative to the turn. */
function checkTurn(turn: string): CheckedTurn {
  const result = elaborateEffectProgram(`${catalogSource}\n\n${turn}`, { sourceId: "turn.lisp" });
  const diagnostics = result.diagnostics.map((d) => {
    const line = (d.span?.startLine ?? 0) - turnOffset;
    if (line < 1) throw new Error(`Diagnostic outside the turn: ${d.message}`);
    return `turn.lisp:${line}:${d.span?.startColumn} ${d.severity} ${d.code}\n  ${d.message}`;
  });
  const requires = new Map<string, readonly string[]>();
  for (const declaration of result.declarations) {
    const payload = declaration.payload as { kind?: string; name?: string; effect?: { requirements?: readonly string[] } };
    if (payload.kind === "EffectDef" && payload.name) requires.set(payload.name, payload.effect?.requirements ?? []);
  }
  return { diagnostics, requires };
}

function rejection(turn: string): string {
  const checked = checkTurn(turn);
  if (checked.diagnostics.length === 0) throw new Error("Expected the turn to be rejected");
  return `${checked.diagnostics.join("\n\n")}\n`;
}

/** The REPL exchange: catalog in scope, a rejected draft, then the accepted turn and its manifest. */
function transcript(): string {
  const draft = checkTurn(turnDraftSource);
  const accepted = checkTurn(turnSource);
  if (draft.diagnostics.length === 0 || accepted.diagnostics.length > 0) throw new Error("Unexpected turn verdicts");
  const manifest = accepted.requires.get("main");
  if (!manifest?.length) throw new Error("main has no requirements");
  const width = Math.max(...manifest.map((tool) => tool.length));
  const rows = manifest.map((tool) => {
    const policy = toolPolicy[tool];
    if (!policy) throw new Error(`No policy for ${tool}`);
    return `    ${tool.padEnd(width)}  ${policy}`;
  });
  const asks = manifest.filter((tool) => toolPolicy[tool] === "ask");
  const errors = (n: number) => `${n} ${n === 1 ? "error" : "errors"}`;
  return [
    "; host → agent: catalog.lisp is in scope for every turn",
    "",
    `; agent → host: turn 1 (${turnDraftSource.split("\n").length} lines)`,
    `rejected · ${errors(draft.diagnostics.length)} · nothing ran`,
    ...draft.diagnostics.flatMap((d, i) => (i === 0 ? [d] : ["", d])),
    "",
    `; agent → host: turn 2 (${turnSource.split("\n").length} lines)`,
    "accepted · 0 errors",
    `  main requires`,
    ...rows,
    `  approval: ${asks.length} question before the first tool call (${asks.join(", ")})`,
    "",
  ].join("\n");
}

/**
 * Every code sample on the `/executor` page: authored sources, the real
 * checker's verdicts and manifests, the generated module, and what `tsc` says
 * when the checker is bypassed. Regenerate with `pnpm --filter @formalang/website snippets:home`.
 */
export function executorPageSnippets(): Record<string, string> {
  const program = generateEffectProgram(programSource, { sourceId: "program.lisp" });
  if (!program.ok || !program.code || program.diagnostics.length > 0) throw new Error(JSON.stringify(program.diagnostics));
  return {
    "catalog.lisp": `${catalogSource}\n`,
    "turn.lisp": `${turnSource}\n`,
    "program.lisp": `${programSource}\n`,
    "program.ts": program.code,
    "repl.txt": transcript(),
    "close-issue.forma.txt": rejection(turnCloseIssueSource),
    "close-issue.tsc.txt": uncheckedTsc(`${catalogSource}\n\n${turnCloseIssueSource}`, "program.ts"),
  };
}
