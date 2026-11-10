import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { builtinDiagnosticCatalog } from "../packages/ts/src/diagnostic/catalog-data.ts";
import { missingDiagnosticCodes } from "./check-diagnostics.mjs";

test("every source diagnostic is registered, and removing an emitted code fails", () => {
  assert.deepEqual(missingDiagnosticCodes(builtinDiagnosticCatalog), []);
  assert.ok(missingDiagnosticCodes(builtinDiagnosticCatalog.filter(e => e.code !== "elaborate/hole-type")).includes("elaborate/hole-type"));
});

test("diagnostic expectations in conformance data are registered", () => {
  const known = new Set(builtinDiagnosticCatalog.map(e => e.code));
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (typeof value.code === "string" && typeof value.severity === "string") assert.ok(known.has(value.code) || value.code.startsWith("mechanics/fail/"), value.code);
    for (const child of Object.values(value)) visit(child);
  };
  const directory = path => {
    for (const entry of readdirSync(path, {withFileTypes:true})) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) directory(child);
      else if (child.endsWith(".json")) visit(JSON.parse(readFileSync(child, "utf8")));
    }
  };
  directory(resolve(import.meta.dirname, "../conformance"));
});
