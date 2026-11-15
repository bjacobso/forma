/**
 * The reader's language services over a set of files. Each open file gets an
 * AnalysisWorkspace whose preludes are the bundled preludes followed by the
 * files it imports, in dependency order. Import and export forms are resolved
 * here and blanked (keeping every offset) before analysis; the module graph
 * reports import errors such as a missing file or an unexported name.
 */
import { AnalysisWorkspace } from "@formalang/ts/analysis";
import { formSlots } from "@formalang/ts/editor";
import { defaultBuiltins } from "@formalang/ts/builtins";
import { generateEffectSystem } from "@formalang/ts/effect-system";
import { expandMacroOnce, expandProgramSync } from "@formalang/ts/expander";
import { formatSExpr, formatSExprMany } from "@formalang/ts/formatter";
import { ModuleError, relativeModuleId, resolveModuleGraph, sourceModuleResolver } from "@formalang/ts/modules";
import { preludeSources } from "@formalang/ts/preludes";
import { parse as read, toSExprMany } from "@formalang/ts/reader";
import { EARLIER_FILE, PRELUDE_STACKS } from "./protocol";
import type {
  Analysis, CompletionEntry, Completions, ExpansionStep, FileSymbol, FormInfo, Generated, GeneratedChunk, GeneratedDeclaration, Inspection, Location, Occurrence, PreludeStack, Problems, ReaderSetup, ReadingDiagnostic, References, RenameEdits, SnippetEntry, SourceFile,
} from "./protocol";

const isPrelude = (id: string) => id.startsWith("forma:");
export const preludeText = (id: string): string => id === EARLIER_FILE ? setup.before ?? "" : (preludeSources as Readonly<Record<string, string>>)[id.slice("forma:".length)] ?? "";
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

/**
 * Several readers can share one worker, such as the blocks of a docs page. Each
 * request names its reader and its setup. The two only pick a cache entry: `open`
 * loads the requested files into it either way. A reader with earlier code has
 * workspaces of its own, which `dispose` drops.
 */
let scope = "";
let setup: ReaderSetup = { preludes: "effect" };
export function inScope(name: string, reader: ReaderSetup = { preludes: "effect" }): void { scope = name; setup = reader; }

function bundledWorkspace(): AnalysisWorkspace {
  const workspace = new AnalysisWorkspace();
  for (const name of PRELUDE_STACKS[setup.preludes]) workspace.setPrelude(`forma:${name}`, preludeSources[name]);
  if (setup.before) workspace.setPrelude(EARLIER_FILE, setup.before);
  return workspace;
}

/** The workspace that analyzes `file` with its imports in scope. */
function open(files: readonly SourceFile[], file: string): { readonly ws: AnalysisWorkspace; readonly text: string } {
  // Rebuilding the preludes is the slow part (a second or so for the larger stacks); setting a
  // document is fast. So readers with the same preludes and no earlier code, such as a docs
  // page's blocks, share a workspace per file id: each request sets the file and its imports.
  const key = setup.before ? `${scope}\0${file}` : `\0${setup.preludes}\0${isPrelude(file) ? "" : file}`;
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
  const bundledOnly = new Set(ws.symbols().definitions.filter(d => d.scope === "global" && isPrelude(d.sourceId) && d.sourceId !== EARLIER_FILE).map(d => d.name));
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

export function inspect(files: readonly SourceFile[], file: string, from: number, to: number): Inspection {
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
  // How the selection lowers: an Effect or prelude declaration to its IR and TypeScript, else kernel macros one at a time.
  let steps: ExpansionStep[] = [];
  if (from < to) {
    try { steps = loweringSteps(files, file, source, from, to, form); } catch { steps = []; }
    if (!steps.length) try { steps = macroSteps(ws, source, from, to); } catch { steps = []; }
  }
  return { ...(form ? { form } : {}), ...(definition ? { definition } : {}), ...(steps.length ? { steps } : {}) };
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
// References, rename, and symbols across the open files
// ---------------------------------------------------------------------------

const projectFiles = (files: readonly SourceFile[]) => files.filter(f => !isPrelude(f.id));

function occurrence(files: readonly SourceFile[], file: string, from: number, to: number, role: Occurrence["role"]): Occurrence {
  const text = files.find(f => f.id === file)?.source ?? (isPrelude(file) ? preludeText(file) : "");
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const lineEnd = text.indexOf("\n", from);
  return {
    file, from, to, role,
    line: text.slice(0, from).split("\n").length,
    preview: text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd),
    column: from - lineStart,
  };
}

/** Where a name defined in `defFile` is listed by `export` there, or by `import` in the files that import it. */
function moduleMentions(files: readonly SourceFile[], defFile: string, name: string): { file: string; from: number; to: number }[] {
  const out: { file: string; from: number; to: number }[] = [];
  for (const file of projectFiles(files)) {
    for (const expr of topLevel(file.source)) {
      const head = headOf(expr);
      const specifier = expr.items?.[1];
      const listed = head === "export" && file.id === defFile ? expr.items?.slice(1)
        : head === "import" && specifier?._tag === "Str" && typeof specifier.value === "string" && /^\.\.?\//.test(specifier.value)
          && relativeModuleId(specifier.value, file.id) === defFile ? expr.items?.[2]?.items
        : undefined;
      for (const item of listed ?? []) if (item._tag === "Sym" && item.name === name) out.push({ file: file.id, from: item.loc.start, to: item.loc.end });
    }
  }
  return out;
}

/**
 * Every occurrence of the name at `offset` across the open files. A name defined in a
 * file is found in that file and in each file whose workspace imports it; a form head,
 * builtin, or unresolved name is matched by name and resolution.
 */
export function references(files: readonly SourceFile[], file: string, offset: number): References {
  const { ws, text } = open(files, file);
  const node = ws.syntax(file).at(offset);
  if (node?.kind !== "Symbol") return { name: "", kind: "none", occurrences: [], renamable: false };
  const name = text.slice(node.span.start, node.span.end);
  const def = ws.definition(file, offset);
  const out: Occurrence[] = [];
  const seen = new Set<string>();
  const push = (o: Occurrence) => { const key = `${o.file}:${o.from}`; if (!seen.has(key)) { seen.add(key); out.push(o); } };
  if (def) {
    if (!isPrelude(def.sourceId)) push(occurrence(files, def.sourceId, def.span.start, def.span.end, "definition"));
    for (const mention of isPrelude(def.sourceId) ? [] : moduleMentions(files, def.sourceId, def.name)) push(occurrence(files, mention.file, mention.from, mention.to, "module"));
    for (const target of projectFiles(files)) {
      const { ws: other } = open(files, target.id);
      if (target.id !== def.sourceId && !other.preludeIds.includes(def.sourceId)) continue;
      for (const span of other.references(def.sourceId, def.span.start)) {
        if (span.sourceId === target.id) push(occurrence(files, target.id, span.startOffset, span.endOffset, "use"));
      }
    }
  } else if (preludeOf(name)) {
    // Form heads are not in the symbol index: find the lists they start.
    const walk = (target: string, expr: Expr) => {
      if (expr._tag !== "List" && expr._tag !== "Vector" && expr._tag !== "Map") return;
      const head = expr.items?.[0];
      if (expr._tag === "List" && head?._tag === "Sym" && head.name === name) push(occurrence(files, target, head.loc.start, head.loc.end, "use"));
      for (const item of expr.items ?? []) walk(target, item);
      for (const pair of (expr as { pairs?: readonly (readonly [Expr, Expr])[] }).pairs ?? []) pair.forEach(item => walk(target, item));
    };
    for (const target of projectFiles(files)) for (const expr of topLevel(target.source)) walk(target.id, expr);
  } else {
    const here = ws.symbols().references.find(r => r.sourceId === file && r.span.start <= offset && offset <= r.span.end);
    for (const target of projectFiles(files)) {
      const { ws: other } = open(files, target.id);
      for (const r of other.symbols().references) {
        if (r.sourceId === target.id && r.name === name && r.resolution === (here?.resolution ?? "form")) push(occurrence(files, target.id, r.span.start, r.span.end, "use"));
      }
    }
  }
  const order = new Map(files.map((f, index) => [f.id, index] as const));
  out.sort((a, b) => (order.get(a.file) ?? 0) - (order.get(b.file) ?? 0) || a.from - b.from);
  const kind = def ? "definition" : preludeOf(name) ? "form" : ws.symbols().references.some(r => r.name === name && r.resolution === "builtin") ? "builtin" : "none";
  return {
    name, kind, occurrences: out,
    renamable: Boolean(def && !isPrelude(def.sourceId)),
    ...(def ? { definedIn: def.sourceId } : {}),
  };
}

/** Rename the name at `offset` everywhere it resolves to the same definition, including import and export lists. */
export function rename(files: readonly SourceFile[], file: string, offset: number, newName: string): RenameEdits {
  const { ws } = open(files, file);
  const def = ws.definition(file, offset);
  if (!def) return { ok: false, message: "Only names defined in these files can be renamed." };
  if (isPrelude(def.sourceId)) return { ok: false, message: `${def.name} is defined in ${def.sourceId}, which is read-only.` };
  const edits: Record<string, { from: number; to: number; insert: string }[]> = {};
  const add = (target: string, from: number, to: number) => {
    const list = (edits[target] ??= []);
    if (!list.some(edit => edit.from === from)) list.push({ from, to, insert: newName });
  };
  for (const target of projectFiles(files)) {
    const { ws: other } = open(files, target.id);
    if (target.id !== def.sourceId && !other.preludeIds.includes(def.sourceId)) continue;
    const result = other.rename(def.sourceId, def.span.start, newName);
    if (!result.ok) return { ok: false, message: result.message };
    for (const edit of result.edits) if (edit.span.sourceId === target.id) add(target.id, edit.span.startOffset, edit.span.endOffset);
  }
  for (const mention of moduleMentions(files, def.sourceId, def.name)) add(mention.file, mention.from, mention.to);
  return { ok: true, name: def.name, edits };
}

/** The top-level definitions of every open file, with their types and how often the other forms use them. */
export function symbols(files: readonly SourceFile[]): FileSymbol[] {
  const out: FileSymbol[] = [];
  for (const target of projectFiles(files)) {
    const { ws } = open(files, target.id);
    const analysis = ws.analysis(target.id);
    for (const symbol of ws.documentSymbols(target.id)) {
      const formFrom = symbol.span.startOffset;
      const formTo = symbol.span.endOffset;
      const typed = analysis.typedSpans.find(span => span.start === formFrom && span.end === formTo && span.exprTag !== "TypeDef");
      const type = typed?.type ?? analysis.bindingDisplay(symbol.name, symbol.selectionSpan.startOffset);
      const uses = references(files, target.id, symbol.selectionSpan.startOffset).occurrences.filter(o => o.role === "use").length;
      out.push({
        file: target.id, name: symbol.name, kind: symbol.kind, form: symbol.form,
        from: symbol.selectionSpan.startOffset, to: symbol.selectionSpan.endOffset, formFrom, formTo, uses,
        ...(type ? { type } : {}),
      });
    }
  }
  return out;
}

/** Forget the workspaces of a reader that closed. */
export function dispose(scope: string): void {
  for (const key of workspaces.keys()) if (key.startsWith(`${scope}\0`)) workspaces.delete(key);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SExpr = ReturnType<typeof toSExprMany>[number];

/** The macros in scope for a file: the kernel's and the preludes', then the file's own `macro` forms. */
function macrosFor(ws: AnalysisWorkspace, text: string) {
  const own = toSExprMany(read(withoutModuleForms(text)).redTree).filter(expr => expr._tag === "List" && expr.items[0]?._tag === "Sym" && expr.items[0].name === "macro");
  const env = ws.preludeScopes().scope.macroEnv;
  return expandProgramSync(own, { builtins: defaultBuiltins, ...(env ? { env } : {}) }).env;
}

/** Expand the leftmost-outermost macro call in `expr` once. */
function stepOnce(expr: SExpr, env: ReturnType<typeof macrosFor>): { readonly expr: SExpr; readonly macro: string } | undefined {
  const once = expandMacroOnce(expr, env);
  if (once) return once;
  if (expr._tag === "List" && expr.items[0]?._tag === "Sym" && (expr.items[0].name === "quote" || expr.items[0].name === "quasiquote")) return undefined;
  const items = expr._tag === "List" || expr._tag === "Vector" ? expr.items : undefined;
  for (let index = 0; items && index < items.length; index++) {
    const next = stepOnce(items[index]!, env);
    if (next) return { macro: next.macro, expr: { ...expr, items: items.map((item, at) => (at === index ? next.expr : item)) } as SExpr };
  }
  return undefined;
}

/** The selected form, one macro at a time, while a macro still applies. */
function macroSteps(ws: AnalysisWorkspace, text: string, from: number, to: number): ExpansionStep[] {
  const selected = text.slice(from, to);
  if (!selected.startsWith("(")) return [];
  const exprs = toSExprMany(read(selected).redTree);
  if (exprs.length !== 1) return [];
  const env = macrosFor(ws, text);
  const steps: ExpansionStep[] = [];
  let expr = exprs[0]!;
  for (let count = 0; count < 24; count++) {
    const next = stepOnce(expr, env);
    if (!next) break;
    expr = next.expr;
    steps.push({ kind: "macro", label: next.macro, text: formatSExpr(expr).trim() });
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Generated Effect TypeScript, and how each prelude form lowers
// ---------------------------------------------------------------------------

const EXPORTED = /^(?:export\s+)?(?:declare\s+)?(?:const|let|class|type|interface|function)\s+([A-Za-z_$][\w$]*)/;
let lastGenerated: { readonly key: string; readonly value: Generated } | undefined;

/**
 * The Effect TypeScript a file generates, split into top-level statements. Each
 * statement is attributed to the declaration whose name starts its exported name,
 * such as `Counter` for `CounterLive`; the emitters keep no finer source map.
 */
export function generated(files: readonly SourceFile[], file: string): Generated {
  const none = (message: string): Generated => ({ ok: false, message, code: "", chunks: [], declarations: [] });
  if (isPrelude(file)) return none("A bundled prelude generates nothing by itself; the forms that use it do.");
  const project = projectFiles(files);
  const text = project.find(f => f.id === file)?.source ?? "";
  const key = JSON.stringify([file, project]);
  if (lastGenerated?.key === key) return lastGenerated.value;
  let value: Generated;
  try {
    const modular = topLevel(text).some(e => headOf(e) === "import" || headOf(e) === "export");
    const input = modular ? resolveModuleGraph({ id: file, source: text }, sourceModuleResolver(project)) : text;
    const result = generateEffectSystem(input, { sourceId: file });
    const code = (result.modules ? (result.modules.find(m => m.moduleId === file) ?? result.modules.at(-1))?.code : result.code) ?? "";
    if (!result.ok || !code) {
      const first = result.diagnostics.find(d => d.severity === "error");
      value = none(`Only Effect declarations generate TypeScript: types, errors, services, effects, and the RPC, HTTP API, and Cluster forms.${first ? ` The generator stopped at: ${first.message}` : ""}`);
    } else {
      const declarations = result.declarations.filter(d => d.sourceId === file && d.span).map((d): GeneratedDeclaration => ({
        name: (d.summary.name ?? "").split("__forma_")[0]!,
        kind: d.summary.kind,
        from: d.span!.startOffset,
        to: d.span!.endOffset,
        payload: d.payload,
        sourceMap: (d.sourceMap ?? []).filter(entry => entry.span.sourceId === file).map(entry => ({ path: entry.path, from: entry.span.startOffset, to: entry.span.endOffset })),
      }));
      const chunks: GeneratedChunk[] = [];
      let offset = 0;
      for (const line of code.split("\n")) {
        const name = EXPORTED.exec(line)?.[1];
        if (name || line.startsWith("import ")) chunks.push({ from: offset, to: offset, name: name ?? "" });
        if (chunks.length) chunks[chunks.length - 1] = { ...chunks.at(-1)!, to: offset + line.length };
        offset += line.length + 1;
      }
      value = {
        ok: true, message: "", code, declarations,
        chunks: chunks.map(chunk => {
          let best = -1;
          declarations.forEach((d, index) => {
            if (d.name && chunk.name.toLowerCase().startsWith(d.name.toLowerCase()) && (best < 0 || d.name.length > declarations[best]!.name.length)) best = index;
          });
          return best < 0 ? chunk : { ...chunk, declaration: best };
        }),
      };
    }
  } catch (error) {
    value = none(error instanceof Error ? error.message : String(error));
  }
  lastGenerated = { key, value };
  return value;
}

/** An IR payload in Forma's own notation, for reading next to the source. */
function printPayload(value: unknown): string {
  const print = (item: unknown): string => {
    if (item === null || item === undefined) return "nil";
    if (Array.isArray(item)) return `[${item.map(print).join(" ")}]`;
    if (typeof item === "object") {
      return `{${Object.entries(item as Record<string, unknown>).filter(([key]) => key !== "span").map(([key, entry]) => `:${key} ${print(entry)}`).join(" ")}}`;
    }
    return typeof item === "string" ? JSON.stringify(item) : String(item);
  };
  const text = print(value);
  try { return formatSExprMany(toSExprMany(read(text).redTree)).trim(); } catch { return text; }
}

/** A prelude form's lowering: the IR record it elaborates to, then the TypeScript generated from it. */
function loweringSteps(files: readonly SourceFile[], file: string, source: string, from: number, to: number, form: FormInfo | undefined): ExpansionStep[] {
  const own = form && form.from === from && form.to === to ? form : undefined;
  const produces = own?.produces;
  // The name a prelude sub-form gives itself after its head, such as "ReserveSeats" or Increment.
  const name = own ? /^\(\S+\s+"?([^\s()[\]{}"]+)/.exec(source.slice(from, to))?.[1] : undefined;
  const output = generated(files, file);
  if (!output.ok) return [];
  const around = output.declarations.map((d, at) => ({ d, at })).filter(({ d }) => d.from <= from && to <= d.to);
  if (!around.length) return [];
  const size = ({ d }: { d: GeneratedDeclaration }) => d.to - d.from;
  // The IR: a library declaration that is exactly the selection, else a named sub-form's
  // record inside the smallest library declaration around it, such as /messages/0 for an
  // entity's command, else an ordinary Effect declaration that is exactly the selection.
  // Library declarations are the ones with a source map.
  const exact = around.filter(({ d }) => d.from === from && d.to === to).sort((a, b) => b.d.sourceMap.length - a.d.sourceMap.length);
  let ir: { readonly d: GeneratedDeclaration; readonly path: string } | undefined =
    exact[0]?.d.sourceMap.length ? { d: exact[0].d, path: "" } : undefined;
  // Library declarations map only their root to source, so find a named sub-form, such
  // as (rpc "ReserveSeats" …), by the record in the IR that carries the same :name.
  const find = (value: unknown, path: string): string | undefined => {
    if (!value || typeof value !== "object") return undefined;
    if (!Array.isArray(value) && (value as Record<string, unknown>).name === name && path) return path;
    for (const [key, entry] of Object.entries(value)) {
      const found = find(entry, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
      if (found) return found;
    }
    return undefined;
  };
  for (const { d } of [...around].filter(({ d }) => d.sourceMap.length).sort((a, b) => size(a) - size(b))) {
    if (ir) break;
    const path = name ? find(d.payload, "") : undefined;
    if (path) ir = { d, path };
  }
  if (!ir && exact[0]) ir = { d: exact[0].d, path: "" };
  if (!ir) return [];
  let payload: unknown = ir.d.payload;
  for (const part of ir.path.split("/").slice(1)) payload = (payload as Record<string, unknown> | undefined)?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  // The TypeScript: what the smallest declaration around the selection generates, with
  // every declaration that shares its span, such as an entity's schema and handlers.
  const smallest = [...around].sort((a, b) => size(a) - size(b))[0]!.d;
  const sameSpan = new Set(around.filter(({ d }) => d.from === smallest.from && d.to === smallest.to).map(({ at }) => at));
  const code = output.chunks.filter(chunk => chunk.declaration !== undefined && sameSpan.has(chunk.declaration)).map(chunk => output.code.slice(chunk.from, chunk.to)).join("\n");
  const library = ir.d.sourceMap.length > 0;
  return [
    { kind: "ir", label: ir.path ? `IR at ${ir.path}` : library && produces ? `IR · ${produces}` : `IR · ${ir.d.kind}`, text: printPayload(payload) },
    ...(code ? [{ kind: "code" as const, label: !ir.path ? "TypeScript" : `TypeScript · ${smallest.name}`, text: code }] : []),
  ];
}

/** Which bundled prelude declares a form. */
function preludeOf(name: string): (typeof PRELUDE_STACKS)[PreludeStack][number] | undefined {
  return PRELUDE_STACKS[setup.preludes].find(prelude => preludeSources[prelude].includes(`(form (${name} `) || preludeSources[prelude].includes(`(form (${name})`));
}

/** Docstrings keep their source indentation; reflow them into paragraphs. */
function tidy(doc: string): string {
  return doc.split(/\n\s*\n/).map(paragraph => paragraph.replace(/\s*\n\s*/g, " ").trim()).join("\n\n");
}

/** Analyze the bundled preludes now, so the first document check is fast. */
export function warm(): void {
  open([], "forma:kernel.lisp").ws.preludeScopes();
}
