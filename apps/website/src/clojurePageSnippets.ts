import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diagnosticFromUnknown, type Diagnostic } from "@formalang/ts/diagnostic";
import {
  checkModuleGraph,
  resolveModuleGraph,
  sourceModuleResolver,
  ModuleError,
  type ModuleCheckResult,
  type ModuleSource,
} from "@formalang/ts/modules";

/** Directory, relative to the repository root, that the docs `/clojure` page imports. */
export const clojureSnippetDir = "docs/snippets/clojure";

const repoRoot = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");
/** The page and the conformance fixtures read the same files. */
const fixture = (name: string) =>
  read(`conformance/clojure-spellings/${name}`);
const preludes: readonly ModuleSource[] = ["clojure.lisp", "kernel.lisp"].map(
  (name) => ({ id: name, source: read(`preludes/modules/${name}`) }),
);

function check(id: string, source: string): ModuleCheckResult {
  const entry = { id, source };
  return checkModuleGraph(
    resolveModuleGraph(entry, sourceModuleResolver([...preludes, entry])),
  );
}

/** Type syntax, as an author would write it: `(-> Int (Option Int) String)`. */
function showType(type: unknown): string {
  return Array.isArray(type)
    ? `(${type.map(showType).join(" ")})`
    : String(type);
}

/** The checked interface of the example module, in Forma's signature syntax. */
function checkedInterface(name: string): string {
  const source = fixture(name);
  const result = check(name, source);
  if (result.diagnostics.length > 0) {
    throw new Error(`${name}: ${JSON.stringify(result.diagnostics)}`);
  }
  const exports = result.interfaces.at(-1)?.exports ?? [];
  const lines = exports.map((binding) => {
    const signature = `(: ${binding.name} ${showType(binding.scheme?.type)})`;
    // A constant export is evaluated while the module is checked.
    return binding.data === undefined
      ? signature
      : `${signature}   ; = ${JSON.stringify(binding.data.value)}`;
  });
  return `${lines.join("\n")}\n`;
}

/**
 * One located diagnostic, in the format the other guide pages use. The
 * engine repeats the span as "(at offset N)" in its message; the line and
 * column above already carry it, so the suffix is dropped.
 */
function locate(source: string, id: string, diagnostic: Diagnostic): string {
  const start = diagnostic.span?.startOffset ?? 0;
  const line = source.slice(0, start).split("\n").length;
  const column = start - source.lastIndexOf("\n", start - 1);
  const message = diagnostic.message.replace(/ \(at offset \d+\)$/u, "");
  return `${id}:${line}:${column} ${diagnostic.severity} ${diagnostic.code}\n  ${message}\n`;
}

/** A source the engine must reject, rendered as the diagnostic it reports. */
function rejection(id: string, source: string): string {
  let diagnostics: readonly Diagnostic[];
  try {
    diagnostics = check(id, source).diagnostics;
  } catch (error) {
    // Reader failures and retired spellings are thrown, as they are for a host.
    diagnostics = [
      error instanceof ModuleError
        ? error.diagnostic
        : diagnosticFromUnknown(error, "typecheck", id),
    ];
  }
  if (diagnostics.length === 0) throw new Error(`${id} was not rejected`);
  return diagnostics.map((d) => locate(source, id, d)).join("\n");
}

/**
 * The hero shows one definition rather than the whole fixture. Slicing it
 * out here keeps the two in step: rename either marker and this throws.
 */
function excerpt(name: string, from: string, until: string): string {
  const lines = fixture(name).split("\n");
  const start = lines.findIndex((line) => line.startsWith(from));
  const end = lines.findIndex((line) => line.startsWith(until));
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`${name} has no ${from} … ${until} excerpt`);
  }
  return `${lines.slice(start, end).join("\n").trimEnd()}\n`;
}

const setLiteralSource = [
  '(import "./clojure.lisp" [def])',
  "(export tags)",
  '(def tags #{"new" "vip"})',
].join("\n");

/**
 * Every code block on the `/clojure` page that is not a checked-in source
 * file: the example's inferred interface and the diagnostics for the Clojure
 * habits the library does not carry over. Regenerate with
 * `pnpm --filter @formalang/website snippets:home`.
 */
export function clojurePageSnippets(): Record<string, string> {
  return {
    "orders.excerpt.lisp": excerpt("orders.lisp", "(: quote-for", "(define receipt"),
    "orders.checked.txt": checkedInterface("orders.lisp"),
    "truthiness.txt": rejection("truthiness.lisp", fixture("truthiness.lisp")),
    "nil-punning.txt": rejection("nil-punning.lisp", fixture("nil-punning.lisp")),
    "keyword-access.txt": rejection(
      "keyword-access.lisp",
      fixture("keyword-access.lisp"),
    ),
    "set-literal.txt": rejection("tags.lisp", setLiteralSource),
    "unimported.txt": rejection("report.lisp", "(defn report [x] x)"),
  };
}
