import { Schema } from "effect";

// #region describe
// A description of a form, as data. The form's rule is still a
// function, but tools can read this without running anything.
export const Example = Schema.Struct({
  source: Schema.String,
  type: Schema.String,
});

export const FormDoc = Schema.Struct({
  syntax: Schema.String,
  summary: Schema.String,
  // How many parts stay on the first line when the form is split.
  head: Schema.Number.check(Schema.isInt()),
  examples: Schema.Array(Example),
});
export type FormDoc = typeof FormDoc.Type;

export const Docs = Schema.Record(Schema.String, FormDoc);
export type Docs = typeof Docs.Type;
// #endregion describe

// #region if-doc
// How if is described. Nothing here runs: it's data for tools.
const ifDoc = {
  syntax: "(if test yes no)",
  summary: "yes unless test is 0, then no. Both have one type.",
  head: 1,
  examples: [{ source: "(if (< 1 2) 10 20)", type: "Num" }],
};
// #endregion if-doc

// The standard prelude's forms, described. This could as well be a
// JSON file: decoding checks every entry's shape.
export const standardDocs: Docs = Schema.decodeUnknownSync(Docs)({
  defmacro: {
    syntax: "(defmacro name (pattern template) ...)",
    summary: "Define a macro, before the program's expression.",
    head: 1,
    examples: [],
  },
  quote: {
    syntax: "(quote datum)",
    summary: "The datum itself, as data. Short form: 'datum.",
    head: 1,
    examples: [{ source: "'(a b)", type: "Data" }],
  },
  lambda: {
    syntax: "(lambda (param ...) body)",
    summary: "A function. Calling it does what its body does.",
    head: 1,
    examples: [
      {
        source: "(lambda (x) (print x))",
        type: "('a) -> 'a ! {Output}",
      },
    ],
  },
  let: {
    syntax: "(let ((name value) ...) body)",
    summary: "Bind names in order, generalizing each type.",
    head: 1,
    examples: [
      {
        source: "(let ((id (lambda (x) x))) ((id id) 1))",
        type: "Num",
      },
    ],
  },
  if: ifDoc,
  do: {
    syntax: "(do expr ... last)",
    summary: "Run each expression in order. The value is last's.",
    head: 0,
    examples: [
      { source: "(do (print 1) 2)", type: "Num ! {Output}" },
    ],
  },
  when: {
    syntax: "(when test body)",
    summary: "Run body unless test is 0. The value is unit.",
    head: 1,
    examples: [
      {
        source: "(when (< 1 2) (print 1))",
        type: "Unit ! {Output}",
      },
    ],
  },
  catch: {
    syntax: "(catch body fallback)",
    summary: "body, or fallback if body divides by zero.",
    head: 0,
    examples: [{ source: "(catch (/ 1 0) 0)", type: "Num" }],
  },
  race: {
    syntax: "(race a b)",
    summary: "Run a and b at once. The first to succeed wins.",
    head: 0,
    examples: [
      {
        source: "(race (sleep 5) (sleep 10))",
        type: "Unit ! {Async}",
      },
    ],
  },
});
