import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const suiteDir = resolve(__dirname, "../../../conformance/typed-authority");
const casesDir = join(suiteDir, "cases");

type ExpectedCase = {
  readonly author: string;
  readonly grants: Type.GrantFact[];
  readonly ok: boolean;
  readonly missing: readonly string[];
};

const expected: Record<string, ExpectedCase> = JSON.parse(
  readFileSync(join(suiteDir, "expected.json"), "utf8"),
);

const authority = (source: string) => Effect.runPromise(Type.inferAuthoritySource(source));
const check = (source: string, options: { author: string; grants: Type.GrantFact[] }) =>
  Effect.runPromise(Type.checkAuthority(source, options));

const attrs = async (source: string) => (await authority(source)).authority.attributes;

describe("@formalang/ts typed authority inference", () => {
  test("infers a literal attribute assertion effect", async () => {
    await expect(attrs('(fn [f fs] [[(nth f 0) "must" "i9"]])')).resolves.toEqual(["must"]);
  });

  test("infers multiple literal attribute assertion effects", async () => {
    await expect(
      attrs(`
        (fn [f fs]
          [[(nth f 0) "must" "i9"]
           [(nth f 0) "now" "handbook"]])
      `),
    ).resolves.toEqual(["must", "now"]);
  });

  test("does not treat a three-fact return collection as one unknown fact", async () => {
    await expect(
      attrs(`
        (fn [f fs]
          [[(nth f 0) "must" "i9"]
           [(nth f 0) "now" "handbook"]
           [(nth f 0) "type" "employee"]])
      `),
    ).resolves.toEqual(["must", "now", "type"]);
  });

  test("closes a higher-order emitter at the call site", async () => {
    await expect(
      attrs(`
        (define emitter
          (fn [attr]
            (fn [f fs]
              [[(nth f 0) attr "value"]])))

        (emitter "must")
      `),
    ).resolves.toEqual(["must"]);
  });

  test("widens a runtime-computed attribute to wildcard authority", async () => {
    await expect(
      attrs(`
        (fn [attr]
          (fn [f fs]
            [[(nth f 0) attr "value"]]))
      `),
    ).resolves.toEqual(["*"]);
  });

  test("reports prelude-shaped make-obligate and advance authority", async () => {
    await expect(
      attrs(`
        (fn [f fs]
          (map (fn [s] [s "must" "submit-i9"])
               ["alice"]))
      `),
    ).resolves.toEqual(["must"]);

    await expect(
      attrs(`
        (fn [f fs]
          (if (= (nth f 1) "completed")
            (map (fn [env] [(nth f 0) "now" "handbook"])
                 ["n"])
            []))
      `),
    ).resolves.toEqual(["now"]);
  });
});

describe("typed-authority conformance (ts-only)", () => {
  const caseNames = readdirSync(casesDir)
    .filter((f) => f.endsWith(".lisp"))
    .map((f) => f.replace(/\.lisp$/, ""))
    .sort();

  test("every case file has an expectation, and vice versa", () => {
    expect(caseNames).toEqual(Object.keys(expected).sort());
  });

  for (const name of caseNames) {
    test(name, async () => {
      const source = readFileSync(join(casesDir, `${name}.lisp`), "utf8");
      const want = expected[name]!;
      const result = await check(source, { author: want.author, grants: want.grants });

      expect(result.ok).toBe(want.ok);
      if (result.ok) {
        expect(want.missing).toEqual([]);
      } else {
        expect(result.missing).toEqual(want.missing);
      }
    });
  }
});
