import { bootstrapFromSources, elaborateProgram } from "@formalang/ts/descriptor";
import type { RunRequest, RunResult } from "./protocol";

export function compilePreludeDemo(request: RunRequest): RunResult {
  const prelude = bootstrapFromSources("", request.prelude ?? "");
  const result = elaborateProgram(request.source, { prelude, sourceId: request.sourceId });
  return {
    id: request.id,
    sourceId: request.sourceId,
    passResults: [],
    diagnostics: result.diagnostics,
    declarations: result.declarations.map(declaration => declaration.payload),
  };
}
