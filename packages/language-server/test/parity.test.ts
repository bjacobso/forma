import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { TsLanguageHost } from "@formalang/host";

import { OcamlAbiClient } from "../src/abi.js";
import { getCompletions } from "../src/handlers/completion.js";
import { getDefinition } from "../src/handlers/definition.js";
import { getDiagnostics } from "../src/handlers/diagnostics.js";
import { formatDocument } from "../src/handlers/formatting.js";
import { getHover } from "../src/handlers/hover.js";
import { OcamlWorkspaceSession } from "../src/session.js";

interface Fixture {
  readonly id: string;
  readonly source: string;
  readonly requests: readonly FixtureRequest[];
}

type FixtureRequest =
  | { readonly kind: "diagnostics" }
  | {
      readonly kind: "hover";
      readonly position: { readonly line: number; readonly character: number };
    }
  | {
      readonly kind: "completion";
      readonly position: { readonly line: number; readonly character: number };
    }
  | {
      readonly kind: "definition";
      readonly position: { readonly line: number; readonly character: number };
    }
  | { readonly kind: "formatting" };

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("OCaml LSP parity smoke fixtures", () => {
  const tsHost = new TsLanguageHost();

  test.each(["basic/fixture.json", "errors/fixture.json"])("%s", async (fixturePath) => {
    const inspection = await OcamlAbiClient.inspectArtifact();
    if (inspection.status !== "ready") {
      console.warn(`Skipping OCaml LSP parity fixture: ${inspection.reason}`);
      return;
    }

    const fixture = JSON.parse(
      await readFile(resolve(fixturesDir, fixturePath), "utf8"),
    ) as Fixture;
    const uri = `file:///workspace/${fixture.id}.lisp`;
    const document = TextDocument.create(uri, "lisp", 1, fixture.source);
    const session = new OcamlWorkspaceSession({ preludePaths: [] });

    try {
      const tsAnalysis = await tsHost.analyzeEditor({
        sourceId: fixture.id,
        source: fixture.source,
      });
      const diagnostics = await getDiagnostics(session, document);

      for (const request of fixture.requests) {
        switch (request.kind) {
          case "diagnostics": {
            expect(normalizeDiagnosticCount(diagnostics.diagnostics.length)).toBe(
              normalizeDiagnosticCount(tsAnalysis.errors.length),
            );
            break;
          }
          case "hover": {
            const hover = await getHover(session, document, {
              textDocument: { uri },
              position: request.position,
            });
            expect(hover).not.toBeNull();
            break;
          }
          case "completion": {
            const completion = await getCompletions(session, document, {
              textDocument: { uri },
              position: request.position,
            });
            expect(completion.items.length).toBeGreaterThan(0);
            break;
          }
          case "definition": {
            const definition = await getDefinition(session, document, {
              textDocument: { uri },
              position: request.position,
            });
            expect(definition).not.toBeNull();
            break;
          }
          case "formatting": {
            const edits = await formatDocument(session, document, {
              tabSize: 2,
              insertSpaces: true,
            });
            expect(edits.length).toBeLessThanOrEqual(1);
            break;
          }
        }
      }
    } finally {
      await session.close();
    }
  });
});

function normalizeDiagnosticCount(count: number): "none" | "some" {
  return count === 0 ? "none" : "some";
}
