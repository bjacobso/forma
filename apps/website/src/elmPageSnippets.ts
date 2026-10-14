import { generateElmProgram } from "@formalang/ts/elm";
import { counterSource, missingUpdateSource, unmappedErrorSource, impureViewSource, invalidPayloadSource, elmCommandSource } from "./elmPageSources";

export const elmSnippetDir = "docs/snippets/elm";

/** Actual TS-engine output and located diagnostics; no hand-written target samples. */
export function elmPageSnippets(): Record<string, string> {
  const result = generateElmProgram(counterSource, { sourceId: "counter.lisp" });
  if (!result.ok || !result.code) throw new Error(JSON.stringify(result.diagnostics));
  const diagnostic = (source: string) => {
    const rejected = generateElmProgram(source, { sourceId: "counter.lisp" });
    if (rejected.ok || !rejected.diagnostics.length) throw new Error("Expected Elm rejection");
    return rejected.diagnostics.map(d =>
      `counter.lisp:${d.span?.startLine}:${d.span?.startColumn} ${d.severity} ${d.code}\n  ${d.message}`,
    ).join("\n\n") + "\n";
  };
  return {
    "counter.lisp": `${counterSource}\n`,
    "counter.ts": result.code,
    "missing-update.txt": diagnostic(missingUpdateSource),
    "unmapped-error.txt": diagnostic(unmappedErrorSource),
    "impure-view.txt": diagnostic(impureViewSource),
    "invalid-payload.txt": diagnostic(invalidPayloadSource),
    "command.lisp": `${elmCommandSource}\n`,
  };
}
