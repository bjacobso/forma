import { Effect, Result, Schema } from "effect";
import type { Prelude } from "../09/kernel.ts";
import { compile } from "../09/run.ts";
import { showComputation } from "../09/types.ts";
import { analyze, Finding } from "./analyze.ts";
import type { Docs } from "./describe.ts";
import { format } from "./format.ts";

// #region report
// Everything the tools found out about one program, as data.
export const Report = Schema.Struct({
  formatted: Schema.NullOr(Schema.String),
  type: Schema.NullOr(Schema.String),
  findings: Schema.Array(Finding),
});
export type Report = typeof Report.Type;
export const ReportJson = Schema.fromJsonString(Report);
// #endregion report

// #region inspect
// Format, check, and analyze one program. Formatting needs only
// syntax, so a program that fails to check is still formatted, and
// the check's error becomes a finding instead of stopping the rest.
export const inspect = (
  prelude: Prelude,
  docs: Docs,
  source: string,
): Effect.Effect<Report> =>
  Effect.gen(function* () {
    const [formatting, checking] = yield* Effect.all(
      [
        Effect.result(format(source, docs)),
        Effect.result(compile(prelude, source)),
      ],
      { concurrency: "unbounded" },
    );
    const formatted = Result.getOrNull(formatting);
    if (Result.isFailure(checking)) {
      const { message, span } = checking.failure;
      const severity = "error";
      const findings = [{ severity, message, span }] as const;
      return { formatted, type: null, findings };
    }
    const { core, effects } = checking.success;
    const type = showComputation(core.type, effects);
    const findings = yield* analyze({ prelude, core });
    return { formatted, type, findings };
  });
// #endregion inspect
