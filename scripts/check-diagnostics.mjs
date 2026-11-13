import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const namespaces = new Set("abi artifact cluster descriptor edit edit-script elaborate email elm evaluation host-effect http http-api internal io lower mechanics module ontology parse read reader rpc session surface typecheck value-ref".split(" "));

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

/** Approximate source scan, backed by runtime assertions in diagnostic fixtures.
 * Scan literals, including error constructor arguments and conditional codes,
 * rather than only objects containing a property named `code`.
 */
export function diagnosticCodes() {
  const found = new Set();
  const codePattern = /^[a-z][a-z-]*\/[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\/[A-Za-z0-9_.-]+)*$/;
  const add = (value, explicit = false) => {
    if (codePattern.test(value) && (explicit || namespaces.has(value.split("/")[0]))) found.add(value);
  };
  for (const directory of ["packages/ts/src", "packages/host/src"]) for (const path of files(resolve(root, directory))) {
    if (!path.endsWith(".ts") || path.includes("/diagnostic/catalog")) continue;
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = node => {
      if (ts.isStringLiteralLike(node)) add(node.text, ts.isPropertyAssignment(node.parent) && node.parent.name.getText(source) === "code");
      // Bundled adapters construct namespaced codes from local suffixes.
      const adapter = path.match(/\/(Cluster|Elm|Email|HttpApi|Rpc)\.ts$/)?.[1];
      if (adapter && ts.isCallExpression(node) && node.expression.getText(source) === "report") {
        const prefix = { Cluster: "cluster", Elm: "elm", Email: "email", HttpApi: "http-api", Rpc: "rpc" }[adapter];
        const suffix = node.arguments[1];
        if (suffix) {
          const literal = n => {
            if (ts.isStringLiteralLike(n) && /^[a-z][a-z-]*$/.test(n.text)) add(`${prefix}/${n.text}`);
            ts.forEachChild(n, literal);
          };
          literal(suffix);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  // Legacy public error tags, finite template expansions, and ABI fallbacks.
  for (const code of ["FailError", "KernelTypeError", "ArityError", "StepLimitExceeded", "ElaborationError", "Error", "InferenceError", "ParseError"]) found.add(code);
  for (const phase of ["parse", "expand", "typecheck", "evaluate", "elaborate", "host-effect", "emit"]) found.add(`${phase}/diagnostic`);
  for (const phase of ["infer", "check", "bindings"]) found.add(`typecheck/descriptor-${phase}`);
  // Prelude-owned codes are literal data, and should be explainable too.
  for (const path of files(resolve(root, "preludes"))) {
    if (!/\.(lisp|forma)$/.test(path)) continue;
    for (const match of readFileSync(path, "utf8").matchAll(/:code\s+"([^"]+)"/g)) add(match[1], true);
  }
  return [...found].sort();
}

export function missingDiagnosticCodes(catalog) {
  return diagnosticCodes().filter(code => !catalog.some(entry => entry.code === code));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { builtinDiagnosticCatalog } = await import("../packages/ts/src/diagnostic/catalog-data.ts");
  const missing = missingDiagnosticCodes(builtinDiagnosticCatalog);
  if (missing.length) throw new Error(`Unregistered diagnostic codes:\n${missing.join("\n")}`);
  console.log(`Diagnostic catalog covers ${diagnosticCodes().length} source codes.`);
}
