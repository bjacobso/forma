import { describe, expect, test } from "vitest";
import fc from "fast-check";

import { joinSource, lexemes, SourceBuilder } from "../src/syntax/lexical.js";
import { runs } from "./support/runs.js";

const shape = (text: string) => lexemes(text).map((lexeme) => `${lexeme.kind}:${lexeme.text}`);

describe("joinSource", () => {
  test("breaks the line after an open comment", () => {
    expect(joinSource(["(a ; c", " (b))"])).toBe("(a ; c\n (b))");
    expect(joinSource(["(f a ; c", " d\n)"])).toBe("(f a ; c\n   d\n)");
    expect(joinSource(["; c", ")"], { breakColumn: 0 })).toBe("; c\n)");
    expect(joinSource(["; c", "\n(b)"])).toBe("; c\n(b)");
  });

  test("keeps tokens from fusing", () => {
    expect(joinSource(["a", "b"])).toBe("a b");
    expect(joinSource(['""', '"x"'])).toBe('"" "x"');
    expect(joinSource(["(f", "x)"])).toBe("(f x)");
    expect(joinSource(["(f", ")"])).toBe("(f)");
    expect(joinSource(["'", "x"])).toBe("'x");
  });

  test("does not let spaces extend a comment", () => {
    const builder = new SourceBuilder();
    builder.append("; c");
    builder.append("  ");
    builder.append("\n(x)");
    expect(builder.text).toBe("; c\n(x)");
  });

  test("reports where a piece landed", () => {
    const builder = new SourceBuilder();
    builder.append("(a ; c");
    const shift = builder.append("  (b)");
    expect(builder.text.slice(2 + shift, 5 + shift)).toBe("(b)");
  });
});

const piece = fc.oneof(
  fc.constantFrom(
    "a", "b", "foo", "1", "-2", "1.5", ":k", "true", "&", "$x", '"s"', '""', '"x"', '"""m\nn"""',
    "(", ")", "[", "]", "{", "}", "'", "`", "~", "~@", "@x",
    "; c", ";", " ", "\n", "\t", "\r\n", "\r", "  ", " ; why\n",
  ),
  fc.array(fc.constantFrom("a", " ", "(", ")", "1", '"q"', "; z", "\n"), { maxLength: 4 }).map((parts) => parts.join("")),
);

describe("joinSource properties", () => {
  test("every piece reads as it reads alone", () => {
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 8 }), (pieces) => {
        // Pieces that do not read on their own are outside the law.
        fc.pre(pieces.every((text) => lexemes(text).every((lexeme) => lexeme.kind !== "error")));
        const expected = pieces.flatMap((text) => {
          const own = shape(text);
          return own;
        });
        const joined = joinSource(pieces);
        // A comment piece followed by spaces keeps its text; spaces are not lexemes.
        expect(shape(joined)).toEqual(expected);
      }),
      { numRuns: runs(2000) },
    );
  });
});
