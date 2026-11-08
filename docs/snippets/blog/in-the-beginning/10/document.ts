import { Effect, Schema } from "effect";
import type { Prelude } from "../09/kernel.ts";
import { compile } from "../09/run.ts";
import { showComputation, showType } from "../09/types.ts";
import type { Docs } from "./describe.ts";

// #region stale
// Documentation that no longer matches the language.
export class StaleDocs extends Schema.TaggedError<StaleDocs>()(
  "StaleDocs",
  { form: Schema.String, problem: Schema.String },
) {
  override get message() {
    return `${this.form}: ${this.problem}`;
  }
}
// #endregion stale

// #region document
// A Markdown reference for a prelude. Values are documented from
// their type schemes, so they can't go stale. Forms are documented
// from their descriptions, and every example is checked against
// the form's real rule before it's printed.
export const document = (prelude: Prelude, docs: Docs) =>
  Effect.gen(function* () {
    const out = ["## Forms"];
    for (const name of prelude.forms.keys()) {
      const doc = docs[name];
      if (!doc) {
        const problem = "has no description";
        return yield* new StaleDocs({ form: name, problem });
      }
      out.push(`### \`${doc.syntax}\``, doc.summary);
      for (const { source, type } of doc.examples) {
        const checked = yield* example(prelude, name, source);
        if (checked !== type) {
          const problem = `${source} is documented as ${type}, `
            + `but checks as ${checked}`;
          return yield* new StaleDocs({ form: name, problem });
        }
        out.push(`    ${source} : ${type}`);
      }
    }
    out.push("## Values");
    for (const [name, { scheme }] of prelude.values) {
      out.push(`- \`${name} : ${showType(scheme.type)}\``);
    }
    return out.join("\n\n");
  });

// An example that doesn't check at all is stale too.
const example = (prelude: Prelude, form: string, source: string) =>
  compile(prelude, source).pipe(
    Effect.map(({ core, effects }) =>
      showComputation(core.type, effects),
    ),
    Effect.mapError(({ message }) =>
      new StaleDocs({ form, problem: `${source}: ${message}` }),
    ),
  );
// #endregion document
