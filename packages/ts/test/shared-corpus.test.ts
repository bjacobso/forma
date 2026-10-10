import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, typecheck } from "../src/Engine.js";

/** OCaml remains the oracle; a divergence pins the TS result and its reason. */
for (const suite of ["reader", "typecheck"] as const) {
  const root = resolve(import.meta.dirname, `../../../conformance/fixtures/${suite}`);
  describe(`shared ${suite} corpus`, () => {
    for (const name of readdirSync(root).filter(name => suite === "typecheck" || name.endsWith("-error"))) {
      it(name, () => {
        const dir = resolve(root, name);
        const manifest = JSON.parse(readFileSync(resolve(dir, "fixture.json"), "utf8"));
        const stored = JSON.parse(readFileSync(resolve(dir, "expected.json"), "utf8"));
        const expected = stored.typescript?.expectation ?? stored.expectation;
        if (stored.typescript) expect(stored.typescript.reason.length).toBeGreaterThan(20);
        const source = manifest.source.inline ?? readFileSync(resolve(dir, manifest.source.file), "utf8");
        const sourceId = manifest.sourceId ?? `parity/${suite}-${name}`;
        const result = suite === "reader" ? parse({sourceId, source}) : typecheck({sourceId, source});
        expect(result.diagnostics.every(d => d.code !== "internal/error")).toBe(true);
        if (expected.kind === "success") {
          expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
          if (!expected.allowDiagnostics) expect(result.diagnostics).toEqual([]);
          if (suite === "typecheck") {
            expect("display" in result && result.display).toBeTruthy();
            if (stored.typescript?.numericType) expect("display" in result && result.display).toBe(stored.typescript.numericType);
          }
        } else {
          expect(result.diagnostics).toHaveLength(1);
          const d = result.diagnostics[0]!;
          expect(d).toMatchObject({
            ...(expected.diagnostic.code ? {code:expected.diagnostic.code} : {}),
            severity:expected.diagnostic.severity ?? (expected.kind === "warning" ? "warning" : "error"),
            ...(expected.diagnostic.message ? {message:expected.diagnostic.message} : {}),
            span:{sourceId,startOffset:expected.diagnostic.span.start,endOffset:expected.diagnostic.span.end},
          });
        }
      });
    }
  });
}
