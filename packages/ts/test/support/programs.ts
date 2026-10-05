import fc from "fast-check";

/*
 * Generators of Forma source for property tests.
 *
 * `sources` builds programs from every token the lexer accepts, with
 * whitespace (tabs, CRLF, lone CR, none at all) and comments in every gap,
 * reader macros in every position, and optionally broken input. `program`
 * and `form` are the smaller generators the first property tests used.
 */

export const pick = <T,>(...values: T[]) => fc.constantFrom(...values);

const symbol = pick("a", "foo", "bar-baz", "&", ".", "$x", "$input.field", "->", "+", "a.b", "x?", "-", "...", "_", "<=", "Foo");
const keyword = pick(":k", ":foo-bar", ":a.b");
const number = pick("0", "42", "-1", "3.14", "-0.5", "1e3", "2.5E-2", "1.", "-7e+2");
const string = pick('""', '"s"', '"a\\"b"', '"a\\\\"', '"x\\ny"', '"; not"', '"(p"', '"two\nlines"', '"tab\there"', '"   ; x\n  y"');
const triple = pick('""""""', '"""two\nlines"""', '"""x\n; not a comment"""', '"""  a\n    b\n  c"""', '"""q "inner" q"""', '"""\n"""', '"""a\n  (b c)\n"""');
const bool = pick("true", "false");
const atom = fc.oneof(symbol, symbol, keyword, number, string, triple, bool);
const macro = pick("'", "`", "~", "~@");

export interface Knobs {
  /** Unclosed and stray delimiters, unterminated strings, `#`, odd maps, a reader macro at EOF. */
  readonly broken: boolean;
  /** Leave out the odd layouts (space after `(`, trailing spaces, lone CR) the review once needed to set aside. */
  readonly tame: boolean;
}

const newline = pick("\n", "\n", "\n", "\r\n", "\r", "\n\n", "\n  ", "\n    ", "\n\t", " \n", "\n\n  ");
const space = pick(" ", " ", "  ", "\t", "");
const wildComment = pick("; c", ";", ";; two", "; (x y)", "; trailing   ", "; ' q", "; )", ";\tc", "; c\r");
const tameComment = pick("; c", ";", ";; two", "; (x y)", "; ' q", "; )", ";\tc");
const indent = pick("", " ", "  ", "    ", "\t");

/**
 * Forma sources built from every token the lexer accepts, with whitespace
 * (tabs, CRLF, lone CR, none at all) and comments in every gap: after an
 * opening delimiter, before a closing one, between a reader macro and its
 * form, and at the end of the document without a newline.
 */
export const sources = ({ broken, tame }: Knobs): fc.Arbitrary<string> => {
  const comment = tame ? tameComment : wildComment;
  const nl = tame ? newline.filter((n) => n !== "\r" && n !== " \n" && n !== "\r\n") : newline;
  const lineBreak = fc.tuple(space, nl, indent).map(([a, b, c]) => a + b + c);
  const commentBreak = fc.tuple(space, comment, nl, indent).map(([a, b, c, d]) => a + b + c + d);
  const sep = fc.oneof({ weight: 4, arbitrary: space }, { weight: 3, arbitrary: lineBreak }, { weight: 2, arbitrary: commentBreak });
  const sep1 = fc.oneof({ weight: 4, arbitrary: space.map((x) => x || " ") }, { weight: 3, arbitrary: lineBreak }, { weight: 2, arbitrary: commentBreak });
  // What follows an opening delimiter. Tame: no horizontal whitespace (sibling S1).
  const lead = tame
    ? fc.oneof({ weight: 4, arbitrary: fc.constant("") }, fc.tuple(nl, indent).map(([a, b]) => a + b), commentBreak.map((x) => x.trimStart()))
    : fc.oneof({ weight: 3, arbitrary: fc.constant("") }, sep);
  const form = fc.letrec<{ form: string }>((tie) => {
    const items = (max: number) =>
      fc
        .tuple(lead, fc.array(tie("form"), { maxLength: max }), fc.array(sep, { minLength: max, maxLength: max }), fc.oneof(fc.constant(""), fc.constant(""), sep))
        .map(([l, xs, seps, trail]) => l + xs.map((x, i) => (i === 0 ? "" : seps[i]!) + x).join("") + trail);
    const close = (c: string) => (broken ? fc.oneof({ weight: 6, arbitrary: fc.constant(c) }, pick("", ")", "]", "}")) : fc.constant(c));
    const options: fc.WeightedArbitrary<string>[] = [
      { weight: 4, arbitrary: atom },
      { weight: 6, arbitrary: fc.tuple(items(5), close(")")).map(([x, c]) => `(${x}${c}`) },
      { weight: 1, arbitrary: fc.tuple(items(3), close("]")).map(([x, c]) => `[${x}${c}`) },
      {
        weight: 1,
        arbitrary: fc
          .tuple(lead, fc.array(fc.tuple(tie("form"), sep1, tie("form")), { maxLength: 2 }), sep1, close("}"))
          .map(([l, kvs, s, c]) => `{${l}${kvs.map(([k, s0, v], i) => (i === 0 ? "" : s) + k + s0 + v).join("")}${c}`),
      },
      // Sets: `{a b c}`.
      { weight: 1, arbitrary: fc.array(fc.tuple(symbol, space), { minLength: 1, maxLength: 3 }).map((xs) => `{${xs.map(([a, b]) => a + (b || " ")).join("")}}`) },
      // Reader macros in every position, also before a comment: `' ; c\n x`.
      {
        weight: 2,
        arbitrary: fc
          .tuple(macro, fc.oneof({ weight: 5, arbitrary: fc.constant("") }, { weight: 1, arbitrary: sep }), tie("form"))
          .map(([m, x, f]) => m + x + f),
      },
    ];
    if (broken) options.push({ weight: 1, arbitrary: pick("#", ")", "]", "}", '"open', '"""open\nx', "'", "~@", "1e", "#x", "{a}", "{:k}") });
    return { form: fc.oneof({ depthSize: "small", withCrossShrink: true }, ...options) };
  }).form;
  return fc
    .tuple(
      pick("", "", "\n", "  ", "\n\n", "\r\n", "; head\n"),
      fc.array(form, { maxLength: 4 }),
      fc.array(sep1, { minLength: 4, maxLength: 4 }),
      tame ? pick("", "", "\n; tail", " ; tail") : pick("", "", "\n", "  \n", "\n; tail", " ; tail", "\n\n", " "),
    )
    .map(([head, forms, seps, tail]) => head + forms.map((f, i) => (i === 0 ? "" : seps[i]!) + f).join("") + tail);
};

/** Every source the generators make, broken ones included. */
export const anySource = sources({ broken: true, tame: false });

/** Sources without deliberately broken input; most of them read without errors. */
export const wildProgram = sources({ broken: false, tame: false });

const smallAtom = fc.constantFrom(
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
    smallAtom,
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
    fc.tuple(smallAtom, fc.constant("; note\n")).map(([text, comment]) => `${comment}${text}`),
  ),
})).form;

export const smallProgram = fc
  .array(form, { minLength: 1, maxLength: 5 })
  .map((forms) => forms.join("\n"));

/** Small programs, programs with every token and odd layout, and broken ones. */
export const program = fc.oneof(smallProgram, wildProgram, anySource);
