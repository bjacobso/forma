import { Context, Effect, Ref, Schema } from "effect";
import { Span } from "../02/sexp.ts";
import { Output, recordedOutput } from "../04/capabilities.ts";
import { display } from "../06/execute.ts";
import type { Prelude } from "../09/kernel.ts";
import { run } from "../09/run.ts";
import { typeAt } from "../10/analyze.ts";
import type { Docs } from "../10/describe.ts";
import { inspect, Report } from "../10/inspect.ts";
import { replace } from "./edit.ts";
import { check } from "./meaning.ts";
import { rename } from "./rename.ts";

// #region workspace
// The file the agent is working on. Tools read and write it through
// a service, so a test, an editor, or a disk can provide it.
export class Workspace extends Context.Service<
  Workspace,
  { readonly file: Ref.Ref<string> }
>()("Workspace") {}

export const inMemory = (source: string) =>
  Effect.map(Ref.make(source), (file) => ({ file }));
// #endregion workspace

// #region tool
// A tool is a name, a description, and schemas for what goes in and
// what comes out. Every failure is a problem: a message and a span.
export interface Problem {
  readonly message: string;
  readonly span: Span;
}
interface Tool<I, O> {
  readonly name: string;
  readonly description: string;
  readonly input: Schema.Codec<I>;
  readonly output: Schema.Codec<O>;
  readonly run: (input: I) => Effect.Effect<O, Problem, Workspace>;
}
const tool = <I, O>(t: Tool<I, O>) => t;
// #endregion tool

const Offset = Schema.Int.annotate({
  description: "A position in the file, counting from 0",
});
const Edited = Schema.Struct({ source: Schema.String, report: Report });

export const toolsFor = (prelude: Prelude, docs: Docs) => {
  const file = Effect.gen(function* () {
    const workspace = yield* Workspace;
    return yield* Ref.get(workspace.file);
  });
  // Save an edit, and report on the result.
  const save = (source: string) =>
    Effect.gen(function* () {
      const workspace = yield* Workspace;
      yield* Ref.set(workspace.file, source);
      return { source, report: yield* inspect(prelude, docs, source) };
    });

  // #region tools
  return [
    tool({
      name: "read",
      description: "The file, with its type and findings.",
      input: Schema.Struct({}),
      output: Edited,
      run: () =>
        Effect.flatMap(file, (source) =>
          Effect.map(inspect(prelude, docs, source), (report) => ({
            source,
            report,
          })),
        ),
    }),
    tool({
      name: "type_at",
      description: "The type of the expression at a position.",
      input: Schema.Struct({ at: Offset }),
      output: Schema.Struct({ type: Schema.NullOr(Schema.String) }),
      run: ({ at }) =>
        Effect.gen(function* () {
          const core = yield* check(prelude, yield* file);
          return { type: typeAt(core, at) ?? null };
        }),
    }),
    tool({
      name: "rename",
      description:
        "Rename the name at a position, and every reference to it. "
        + "Refused if the program's meaning would change.",
      input: Schema.Struct({ at: Offset, to: Schema.String }),
      output: Edited,
      run: ({ at, to }) =>
        Effect.flatMap(file, (source) =>
          Effect.flatMap(rename(prelude, source, at, to), save),
        ),
    }),
    tool({
      name: "replace",
      description:
        "Replace the expression from start to end with another.",
      input: Schema.Struct({
        start: Offset,
        end: Offset,
        with: Schema.String,
      }),
      output: Edited,
      run: ({ start, end, with: text }) =>
        Effect.flatMap(file, (source) =>
          Effect.flatMap(
            replace(docs, source, { start, end }, text),
            save,
          ),
        ),
    }),
    tool({
      name: "evaluate",
      description:
        "Run an expression. It may print and divide, nothing else.",
      input: Schema.Struct({ expression: Schema.String }),
      output: Schema.Struct({
        value: Schema.String,
        printed: Schema.Array(Schema.String),
      }),
      run: ({ expression }) => evaluate(prelude, expression),
    }),
  ];
  // #endregion tools
};

// #region evaluate
// The REPL is a host from Part 9. It allows Output and DivByZero,
// so a program that needs anything else is refused before it runs.
// What it prints is recorded and returned.
const evaluate = (prelude: Prelude, expression: string) =>
  Effect.suspend(() => {
    const { lines, output } = recordedOutput();
    return run(prelude, expression, ["Output", "DivByZero"]).pipe(
      Effect.provideService(Output, output),
      Effect.map((value) => ({
        value: display(value),
        printed: lines,
      })),
    );
  });
// #endregion evaluate

// #region call
// What the agent sends is JSON text, and what it gets back is JSON
// text. The input schema rejects a malformed call before any tool
// runs, and every problem comes back as data.
type AnyTool = Tool<any, any>;

export const call = (
  tools: ReadonlyArray<AnyTool>,
  name: string,
  json: string,
): Effect.Effect<string, never, Workspace> => {
  const found = tools.find((t) => t.name === name);
  if (!found) {
    return Effect.succeed(problem(`no tool named ${name}`));
  }
  const input = Schema.fromJsonString(found.input);
  const output = Schema.fromJsonString(found.output);
  return Schema.decodeEffect(input)(json).pipe(
    Effect.mapError((e): Problem => ({ message: e.message, span })),
    Effect.flatMap(found.run),
    Effect.flatMap((o) =>
      Effect.orDie(Schema.encodeEffect(output)(o)),
    ),
    Effect.catch((p: Problem) =>
      Effect.succeed(problem(p.message, p.span)),
    ),
  );
};

const span = { start: 0, end: 0 };
const problem = (message: string, at: Span = span) =>
  JSON.stringify({ error: { message, span: at } });
// #endregion call

// #region manifest
// What the agent is told about the tools: names, descriptions, and
// a JSON Schema for each input, derived from the Effect Schema.
export const manifest = (tools: ReadonlyArray<AnyTool>) =>
  tools.map(({ name, description, input }) => ({
    name,
    description,
    input: Schema.toJsonSchemaDocument(input).schema,
  }));
// #endregion manifest
