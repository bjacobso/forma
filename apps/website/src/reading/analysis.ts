/**
 * The reader's language services over a set of files. Each open file gets an
 * AnalysisWorkspace whose preludes are the bundled preludes followed by the
 * files it imports, in dependency order. Import and export forms are resolved
 * here and blanked (keeping every offset) before analysis; the module graph
 * reports import errors such as a missing file or an unexported name.
 */
import { AnalysisWorkspace } from "@formalang/ts/analysis";
import { formSlots } from "@formalang/ts/editor";
import { expand } from "@formalang/ts/engine";
import { formatSExpr, formatSExprMany } from "@formalang/ts/formatter";
import { ModuleError, relativeModuleId, resolveModuleGraph, sourceModuleResolver } from "@formalang/ts/modules";
import { preludeSources } from "@formalang/ts/preludes";
import { parse as read, toSExprMany } from "@formalang/ts/reader";
import type {
  Analysis, CompletionEntry, Completions, Inspection, Location, Problems, ReadingDiagnostic, SnippetEntry, SourceFile,
} from "./protocol";

const BUNDLED = ["kernel.lisp", "compiler.lisp", "rpc.lisp", "http-api.lisp", "cluster.lisp"] as const;
type Bundled = (typeof BUNDLED)[number];
const isPrelude = (id: string) => id.startsWith("forma:");
const preludeText = (id: string): string => preludeSources[id.slice("forma:".length) as Bundled] ?? "";
const fileLabel = (id: string) => id.replace(/^forma:/, "");

/** Kernel forms whose second element is the name they define. */
const DEFINING = new Set(["define", "type", "error", "service", "class", "macro", "typeclass", "instance", "layer", ":"]);

/** Snippets for kernel forms, written without the surrounding parentheses. */
const KERNEL_SNIPPETS: Readonly<Record<string, string>> = {
  define: "define ${name} [${args}]\n  ${body}",
  ":": ": ${name} (-> ${In} ${Out})",
  let: "let [${name} ${value}]\n  ${body}",
  fn: "fn [${args}] ${body}",
  if: "if ${test}\n  ${then}\n  ${else}",
  match: "match ${value}\n  ${pattern} ${result}",
  "do!": "do! [${name} ${effect}]\n  ${body}",
  type: "type ${Name} {:${field} ${Type}}",
  error: "error ${Name} {:${field} ${Type}}",
  service: "service ${Name}\n  (: ${operation} (-> ${In} (Effect ${Out} [] [])))",
};

// ---------------------------------------------------------------------------
// Files and imports
// ---------------------------------------------------------------------------

interface Expr { readonly _tag: string; readonly items?: readonly Expr[]; readonly name?: string; readonly value?: unknown; readonly loc: { readonly start: number; readonly end: number } }

function topLevel(source: string): readonly Expr[] {
  try { return toSExprMany(read(source).redTree) as unknown as readonly Expr[]; } catch { return []; }
}

const headOf = (expr: Expr) => expr._tag === "List" && expr.items?.[0]?._tag === "Sym" ? expr.items[0].name : undefined;

function withoutModuleForms(source: string): string {
  let out = source;
  for (const expr of topLevel(source)) {
    if (headOf(expr) !== "import" && headOf(expr) !== "export") continue;
    out = out.slice(0, expr.loc.start) + out.slice(expr.loc.start, expr.loc.end).replace(/[^\n]/g, " ") + out.slice(expr.loc.end);
  }
  return out;
}

function importsOf(file: SourceFile): string[] {
  return topLevel(file.source).flatMap(expr => {
    const specifier = expr.items?.[1];
    return headOf(expr) === "import" && specifier?._tag === "Str" && typeof specifier.value === "string" && /^\.\.?\//.test(specifier.value)
      ? [relativeModuleId(specifier.value, file.id)] : [];
  });
}

/** The files `id` imports, directly or not, dependencies first. */
function dependencies(files: ReadonlyMap<string, SourceFile>, id: string): string[] {
  const order: string[] = [];
  const seen = new Set<string>([id]);
  const visit = (file: SourceFile) => {
    for (const dep of importsOf(file)) {
      const target = files.get(dep);
      if (!target || seen.has(dep)) continue;
      seen.add(dep);
      visit(target);
      order.push(dep);
    }
  };
  const root = files.get(id);
  if (root) visit(root);
  return order;
}

const workspaces = new Map<string, AnalysisWorkspace>();

function bundledWorkspace(): AnalysisWorkspace {
  const workspace = new AnalysisWorkspace();
  for (const name of BUNDLED) workspace.setPrelude(`forma:${name}`, preludeSources[name]);
  return workspace;
}

/** The workspace that analyzes `file` with its imports in scope. */
function open(files: readonly SourceFile[], file: string): { readonly ws: AnalysisWorkspace; readonly text: string } {
  const key = isPrelude(file) ? "" : file;
  let ws = workspaces.get(key);
  if (!ws) { ws = bundledWorkspace(); workspaces.set(key, ws); }
  if (isPrelude(file)) return { ws, text: preludeText(file) };
  const byId = new Map(files.filter(f => !isPrelude(f.id)).map(f => [f.id, f] as const));
  const deps = dependencies(byId, file);
  const current = ws.preludeIds.filter(id => !isPrelude(id));
  if (current.join("\0") !== deps.join("\0")) for (const id of current) ws.removePrelude(id);
  for (const id of deps) ws.setPrelude(id, withoutModuleForms(byId.get(id)!.source));
  const text = byId.get(file)?.source ?? "";
  ws.setDocument(file, withoutModuleForms(text));
  return { ws, text };
}

const descriptorsOf = (ws: AnalysisWorkspace) => ws.preludeScopes().scope.prelude?.descriptions.list() ?? [];

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function moduleDiagnostics(files: readonly SourceFile[], file: string, text: string): ReadingDiagnostic[] {
  if (isPrelude(file) || !topLevel(text).some(e => headOf(e) === "import" || headOf(e) === "export")) return [];
  try {
    resolveModuleGraph({ id: file, source: text }, sourceModuleResolver(files.filter(f => !isPrelude(f.id))));
    return [];
  } catch (error) {
    if (!(error instanceof ModuleError)) return [];
    return error.diagnostics.filter(d => d.span?.sourceId === file).map(d => ({
      from: d.span!.startOffset, to: d.span!.endOffset, severity: "error" as const, code: d.code, message: d.message,
      ...(d.help ? { help: d.help } : {}),
    }));
  }
}

export function analyze(files: readonly SourceFile[], file: string): Analysis {
  const started = performance.now();
  const { ws, text } = open(files, file);
  const analysis = ws.analysis(file);
  // Hole candidates: helpers the bundled preludes define for themselves are not useful fills.
  const bundledOnly = new Set(ws.symbols().definitions.filter(d => d.scope === "global" && isPrelude(d.sourceId)).map(d => d.name));
  for (const d of ws.symbols().definitions) if (!isPrelude(d.sourceId)) bundledOnly.delete(d.name);
  const diagnostics = analysis.diagnostics.map((d): ReadingDiagnostic => {
    const details = (d.details ?? {}) as Record<string, unknown>;
    const from = d.span?.startOffset ?? 0;
    const candidates = Array.isArray(details.candidates) ? details.candidates.map(String).filter(name => !bundledOnly.has(name)).slice(0, 8) : undefined;
    return {
      from,
      to: Math.max(from, d.span?.endOffset ?? from),
      severity: d.severity === "warning" ? "warning" : d.severity === "error" ? "error" : "info",
      code: d.code,
      message: candidates && d.code === "typecheck/hole" ? d.message.replace(/; candidates: .*$/, "") : d.message,
      ...(d.help ? { help: d.help } : {}),
      ...(candidates ? { candidates } : {}),
      ...(typeof details.expected === "string" ? { expected: details.expected } : {}),
      ...(d.fix?.length ? { fix: d.fix.map(edit => ({ from: edit.span.startOffset, to: edit.span.endOffset, insert: edit.newText })) } : {}),
    };
  });
  // Bundled preludes are checked by `pnpm check:preludes`; analyzed in the workspace that already
  // loads them, they would report their own forms as declared twice.
  if (isPrelude(file)) diagnostics.length = 0;
  for (const extra of moduleDiagnostics(files, file, text)) {
    if (!diagnostics.some(d => d.from === extra.from && d.message === extra.message)) diagnostics.push(extra);
  }
  return {
    file,
    source: text,
    typed: analysis.typedSpans.map(span => ({ from: span.start, to: span.end, type: span.type, tag: span.exprTag })),
    diagnostics,
    durationMs: performance.now() - started,
  };
}

export function problems(files: readonly SourceFile[]): Problems {
  const counts: Record<string, { errors: number; warnings: number }> = {};
  for (const file of files) {
    if (isPrelude(file.id)) continue;
    const { diagnostics } = analyze(files, file.id);
    counts[file.id] = { errors: diagnostics.filter(d => d.severity === "error").length, warnings: diagnostics.filter(d => d.severity === "warning").length };
  }
  return counts;
}

export async function inspect(files: readonly SourceFile[], file: string, from: number, to: number): Promise<Inspection> {
  const { ws, text: source } = open(files, file);
  const all = descriptorsOf(ws);
  let form: Inspection["form"];
  const slots = formSlots({ source, offset: from, descriptors: all, descriptorSources: [] });
  if (slots && slots.form.span.start <= from && to <= slots.form.span.end) {
    const descriptor = all.find(candidate => candidate.name === slots.form.name);
    const holes = descriptor?.surface?.holes;
    const pattern = descriptor?.surface ? `(${[slots.form.name, ...descriptor.surface.pattern.map(item => formatSExpr(item).trim())].join(" ")})`.replace(/\s+/g, " ") : undefined;
    form = {
      name: slots.form.name,
      ...(preludeOf(slots.form.name) ? { prelude: preludeOf(slots.form.name) } : {}),
      from: slots.form.span.start,
      to: slots.form.span.end,
      ...(slots.form.doc ? { doc: tidy(slots.form.doc) } : {}),
      ...(descriptor?.produces ? { produces: descriptor.produces } : {}),
      ...(pattern ? { pattern } : {}),
      ...(descriptor?.examples?.[0] ? { example: descriptor.examples[0] } : {}),
      ...(slots.activeSlot ? { activeSlot: slots.activeSlot } : {}),
      identifiers: slots.identifiers.map(identifier => ({ name: identifier.name, ...(identifier.span ? { value: source.slice(identifier.span.start, identifier.span.end) } : {}) })),
      slots: slots.slots.map(slot => {
        const hole = holes?.get(slot.name);
        const type = slot.type ?? (hole ? formatSExpr(hole).trim() : undefined);
        return {
          name: slot.name,
          ...(type ? { type } : {}),
          ...(slot.doc ? { doc: slot.doc } : {}),
          required: slot.required,
          many: slot.many,
          missing: slot.missing,
          filled: !slot.empty,
          values: slot.occurrences.flatMap(occurrence => occurrence.values).map(value => ({ from: value.span.start, to: value.span.end, text: source.slice(value.span.start, value.span.end) })),
        };
      }),
    };
  }

  // The name at the selection: a list's head, or for a definition such as (define older …), the name it defines.
  const syntax = ws.syntax(file);
  const at = syntax.at(from);
  const children = at?.kind === "List" && at.span.start === from ? syntax.children(at.id).filter(child => child.kind !== "Comment") : [];
  const head = children[0] ? source.slice(children[0].span.start, children[0].span.end) : "";
  const defines = DEFINING.has(head) || all.some(descriptor => descriptor.name === head && descriptor.identifiers.some(identifier => identifier.declaration));
  const candidates = children.length ? children.slice(0, defines ? 2 : 1) : [at];
  let definition: Inspection["definition"];
  for (const node of candidates) {
    if (definition || node?.kind !== "Symbol") continue;
    const offset = node.span.start;
    const name = source.slice(node.span.start, node.span.end);
    const found = ws.definition(file, offset);
    const references = ws.references(file, offset).length;
    const type = ws.analysis(file).bindingDisplay(name, offset);
    if (found) {
      definition = {
        name,
        kind: found.kind,
        form: found.form,
        local: found.scope === "local",
        at: offset,
        here: found.sourceId === file && found.span.start === offset,
        ...(found.sourceId !== file ? { file: found.sourceId, elsewhere: fileLabel(found.sourceId) } : {}),
        references,
        ...(type ? { type } : {}),
      };
    } else if (!all.some(candidate => candidate.name === name) && type) {
      definition = { name, kind: "builtin", form: "builtin", local: false, at: offset, here: false, elsewhere: "builtins", references, type };
    }
  }
  const expansion = from < to ? await expansionOf(source.slice(from, to)).catch(() => undefined) : undefined;
  return { ...(form ? { form } : {}), ...(definition ? { definition } : {}), ...(expansion ? { expansion } : {}) };
}

/** Where the name at `offset` is defined: a workspace definition, or the prelude `form` that declares a form head. */
export function definition(files: readonly SourceFile[], file: string, offset: number): Location | null {
  const { ws, text } = open(files, file);
  const found = ws.definition(file, offset);
  const located = (target: string, from: number, to: number): Location => {
    const syntax = ws.syntax(target);
    const node = syntax.at(from);
    const top = node ? syntax.ancestors(node.id).at(-1) ?? node : undefined;
    return { file: target, from, to, formFrom: top?.span.start ?? from, formTo: top?.span.end ?? to, ...(isPrelude(target) ? { source: preludeText(target) } : {}) };
  };
  if (found) return located(found.sourceId, found.span.start, found.span.end);
  const node = ws.syntax(file).at(offset);
  if (node?.kind !== "Symbol") return null;
  const name = text.slice(node.span.start, node.span.end);
  const prelude = preludeOf(name);
  if (!prelude) return null;
  const source = preludeSources[prelude];
  const start = source.search(new RegExp(`\\(form \\(${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s)]`));
  if (start < 0) return null;
  const from = start + "(form (".length;
  return located(`forma:${prelude}`, from, from + name.length);
}

export function complete(files: readonly SourceFile[], file: string, offset: number): Completions | null {
  if (isPrelude(file)) return null;
  const { ws, text } = open(files, file);
  const items = ws.completions(file, offset);
  if (!items.length) return null;
  const from = items[0]!.replace.start;
  const afterParen = text[from - 1] === "(";
  const wrap = (template: string) => afterParen ? template : `(${template})`;
  const all = descriptorsOf(ws);
  const entries = items.slice(0, 300).map((item): CompletionEntry => {
    const descriptor = item.kind === "form" ? all.find(d => d.name === item.label) : undefined;
    const isType = item.kind === "form" && /^[A-Z]/.test(item.label);
    const template = descriptor && !isType ? formTemplate(descriptor) : KERNEL_SNIPPETS[item.label];
    const prelude = descriptor && !isType ? preludeOf(item.label) : undefined;
    return {
      label: item.label,
      kind: isType ? "type" : item.kind,
      ...(item.detail || prelude ? { detail: prelude ? `form · ${prelude}` : item.detail } : {}),
      ...(item.documentation ? { info: item.documentation } : {}),
      ...(template ? { template: wrap(template) } : {}),
      boost: item.sortText.startsWith("0") ? 3 : item.sortText.startsWith("1") ? 2 : prelude ? 1 : 0,
    };
  });
  return { from, entries };
}

/** Templates for every prelude form in scope, then the kernel forms. */
export function snippets(files: readonly SourceFile[], file: string): SnippetEntry[] {
  const { ws } = open(files, file);
  const forms = descriptorsOf(ws).flatMap((descriptor): SnippetEntry[] => {
    const group = preludeOf(descriptor.name);
    const template = group ? formTemplate(descriptor) : undefined;
    return group && group !== "compiler.lisp" && template
      ? [{ label: descriptor.name, group, template, ...(descriptor.doc ? { doc: tidy(descriptor.doc).split(/(?<=[.!?])\s/)[0] } : {}) }]
      : [];
  });
  const kernel = Object.entries(KERNEL_SNIPPETS).map(([label, template]) => ({ label, group: "kernel", template }));
  return [...forms, ...kernel];
}

type Descriptor = ReturnType<typeof descriptorsOf>[number];

/** A snippet from a form's surface pattern: its identifiers inline, then each required slot on its own line. */
function formTemplate(descriptor: Descriptor): string | undefined {
  const pattern = descriptor.surface?.pattern as unknown as readonly (Expr & { readonly pairs?: readonly (readonly [Expr, Expr])[] })[] | undefined;
  if (!pattern) return undefined;
  const inline = [descriptor.name];
  const lines: string[] = [];
  pattern.forEach((item, index) => {
    if (item._tag === "Sym" && item.name !== "...") {
      const rest = pattern[index + 1]?._tag === "Sym" && pattern[index + 1]?.name === "...";
      (rest ? lines : inline).push(`\${${item.name}}`);
    } else if (item._tag === "Map") {
      const keys = item.pairs?.find(([key]) => key.name === ":keys")?.[1];
      for (const key of keys?.items ?? []) {
        const slot = descriptor.slots.find(candidate => candidate.name === key.name);
        if (slot?.required) lines.splice(lines.length, 0, `:${key.name} \${${key.name}}`);
      }
    }
  });
  // Keyword slots come before rest forms such as an entity's messages.
  const rest = lines.filter(line => !line.startsWith(":"));
  return [inline.join(" "), ...lines.filter(line => line.startsWith(":")), ...rest].join("\n  ");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AstNode {
  readonly kind: string;
  readonly value?: unknown;
  readonly items?: readonly AstNode[];
  readonly entries?: readonly { readonly key: AstNode; readonly value: AstNode }[];
}

function printAst(node: AstNode): string {
  switch (node.kind) {
    case "list": return `(${(node.items ?? []).map(printAst).join(" ")})`;
    case "vector": return `[${(node.items ?? []).map(printAst).join(" ")}]`;
    case "map": return `{${(node.entries ?? []).map(entry => `${printAst(entry.key)} ${printAst(entry.value)}`).join(" ")}}`;
    case "string": return JSON.stringify(node.value);
    case "nil": return "nil";
    default: return String(node.value);
  }
}

/** The form after kernel macros run, when a macro changed it. */
async function expansionOf(text: string): Promise<string | undefined> {
  if (!text.startsWith("(")) return undefined;
  const result = await expand({ sourceId: "selection", source: text });
  if (result.diagnostics.some(d => d.severity === "error") || result.ast.length !== 1) return undefined;
  // Compare both sides as the formatter prints them, so layout and string escapes do not count as a rewrite.
  const formatted = (source: string) => formatSExprMany(toSExprMany(read(source).redTree)).trim();
  const expanded = formatted(printAst(result.ast[0] as AstNode));
  return expanded === formatted(text) ? undefined : expanded;
}

/** Which bundled prelude declares a form. */
function preludeOf(name: string): Bundled | undefined {
  return BUNDLED.find(prelude => preludeSources[prelude].includes(`(form (${name} `) || preludeSources[prelude].includes(`(form (${name})`));
}

/** Docstrings keep their source indentation; reflow them into paragraphs. */
function tidy(doc: string): string {
  return doc.split(/\n\s*\n/).map(paragraph => paragraph.replace(/\s*\n\s*/g, " ").trim()).join("\n\n");
}

/** Analyze the bundled preludes now, so the first document check is fast. */
export function warm(): void {
  open([], "forma:kernel.lisp").ws.preludeScopes();
}
