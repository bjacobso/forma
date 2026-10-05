import fc from "fast-check";

const atom = fc.constantFrom(
  "a",
  "b",
  "foo",
  "bar-baz",
  "1",
  "42",
  '"s"',
  ":k",
  "true",
  '"""two\nlines"""',
);

/**
 * Small Forma-shaped programs: nested lists, vectors, and maps, reader
 * macros, multi-line literals, line breaks, and comments on their own lines
 * and after code.
 */
export const form: fc.Arbitrary<string> = fc.letrec<{ form: string }>((tie) => ({
  form: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    atom,
    fc
      .tuple(
        fc.constantFrom("(", "[", "{"),
        fc.array(tie("form"), { maxLength: 4 }),
        fc.constantFrom(" ", "\n  ", " ; why\n  "),
      )
      .map(([open, items, separator]) => {
        const close = open === "(" ? ")" : open === "[" ? "]" : "}";
        const even = open === "{" && items.length % 2 === 1 ? [...items, ":v"] : items;
        return `${open}${even.join(separator)}${close}`;
      }),
    fc.tuple(fc.constantFrom("'", "`", "~"), tie("form")).map(([prefix, inner]) => `${prefix}${inner}`),
    fc.tuple(atom, fc.constant("; note\n")).map(([text, comment]) => `${comment}${text}`),
  ),
})).form;

export const program = fc
  .array(form, { minLength: 1, maxLength: 5 })
  .map((forms) => forms.join("\n"));
