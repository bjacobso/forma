/**
 * The `repl` tool: a code-mode session. A model writes Forma, or a `:command`,
 * and reads back values, types, diagnostics, generated Effect TypeScript and docs.
 * Each session holds a pure Forma evaluation session and an Effect program.
 * This module has no Node dependencies: `forma mcp` and the hosted server at
 * forma-lang.com/mcp both use it, and each supplies its own way to run effects.
 */
import { diagnosticCatalog } from "@formalang/ts/diagnostic";
import { printSExpr } from "@formalang/ts/evaluator";
import { formatLispSource } from "@formalang/ts/formatter";
import {
  elaborateEffectProgram, expandEffectDeclarations, expandEffectLibrary, generateEffectProgram, showMechanicsType,
  type EffectProgramDiagnostic, type EffectProgramElaboration, type MechanicsType,
} from "@formalang/ts/mechanics";
import { bundledModuleSources } from "@formalang/ts/modules";
import { preludeSources } from "@formalang/ts/preludes";
import { parse, toSExprMany, type SExpr } from "@formalang/ts/reader";
import { Effect } from "effect";
import type { JsonAbi } from "./json-abi.js";
import type { Diagnostic } from "./types.js";
import { effectExamples } from "./cli/examples.generated.js";
import { allBundledDocs, builtinDocs, bundledSources, effectKeywordDocs, effectSignatures, firstSentence, outlineSource, sourceDocs, type SourceDoc } from "./repl-docs.js";
import { formatDiagnostics } from "./cli/diagnostic-text.js";

const STEP_LIMIT = 1_000_000;
const MAX_SESSIONS = 16;
const ENTRY = "__repl";
// An unknown success type leaves the body's inference unconstrained; only the first pass uses it.
const PLACEHOLDER = "(Effect __Infer)";

const PAGE_CHARS = 8_000;

const helpText = (runNote: string, unavailable: string | undefined) => `Forma REPL. Send Forma code, or one command per call.
${unavailable ? `
This server cannot run programs: :run is unavailable. ${unavailable}
` : ""}
Start here:
  :outline [name]        What the session provides, or a map of a bundled module or prelude.
  :doc <name>            Signature, options and an example for a form, macro, Effect keyword,
                         builtin, definition or diagnostic code.
  :examples [filter]     Effect conformance programs; :example <name> shows one.

Long results come in pages of ${PAGE_CHARS / 1000}K characters; :more shows the next page, :more all the rest.

Pure Forma (definitions persist in the session):
  <code>                 Check, then evaluate. Returns value, type and diagnostics.
  :type <expr>           Type of an expression without running it.
  :load <prelude.lisp>   Load a bundled prelude into the pure session.

Evolving the language (pure session):
  :prelude <name> <src>  Define or replace a session prelude: macros, forms, types and
                         functions. The session reloads its preludes in order and
                         replays earlier inputs; inputs that no longer check are dropped.
  :prelude [name]        List session preludes, or show one.  :unload <name>  Remove one.
  :describe [name]       Forms, functions and types the session's preludes provide, or one
                         of them in full, with its examples.
  <form applications>    Input made only of session prelude forms is declared, not run:
                         it elaborates to IR, is kept, and later declarations can refer
                         to it. Redeclaring a name replaces it.
  :ir                    Every declaration in the session (form applications and the
                         Effect program) as one JSON document. :export is the same.

Effect programs (a separate, declarations-only program in the same session):
  :effect <forms>        Add or replace declarations (type, error, service, signature,
                         define, layer, import "forma:effect"). The whole program is
                         checked; a cell with errors is not kept. Reports each
                         definition's declared and inferred type.
  :infer <expr>          Inferred type of an expression, e.g. (Effect User [NotFound] [Users.find]).
  :run <expr>            ${unavailable ? "Not available on this server." : `Run an effect, such as (provide (find-user "u-1") UsersLive).
                         Requirements must be provided by layers defined in the program.`}
  :ts                    The generated Effect TypeScript module.
  :expand <forms>        Expand forma:effect macros (do, bind, pure, service, error).
  :program               The current Effect program.

Discovery:
  :modules               Bundled modules (forma:effect, ...) and preludes.
  :source <name> [a-b]   Source of a bundled module or prelude, or lines a to b of it.
  :reset                 Clear this session.  :help  This text.

Pure evaluation has no host capabilities and a step limit.${unavailable ? "" : ` ${runNote}`}`;

/** The MCP tool definition, as plain JSON so this module needs no MCP SDK. */
export const replTool = {
  name: "repl",
  description: "Code-mode Forma REPL. Send Forma code to evaluate it in a persistent session, or a :command (start with :help). Discover the language with :outline, :doc, :modules, :source and :examples; build Effect programs with :effect, :infer, :ts and :expand, and :run them where the server can run effects (:help says whether it can); export declarations with :ir.",
  inputSchema: {
    type: "object",
    properties: {
      input: { type: "string", description: "Forma code or a :command." },
      session: { type: "string", description: "Session name; defaults to \"default\". Sessions keep definitions between calls." },
    },
    required: ["input"],
    additionalProperties: false,
  },
} as const;

/** Runs a generated Effect module whose `__repl` export is the effect; returns the Exit as JSON. */
export type EffectRunner = (code: string) => Promise<Record<string, unknown>>;
export interface ReplOptions {
  /** Runs generated Effect code for :run; without it, :run reports `runUnavailable`. */
  readonly run?: EffectRunner;
  /** What running can touch, for :help. */
  readonly runNote?: string;
  /** Why :run is unavailable. */
  readonly runUnavailable?: string;
}
/** Everything a session accepted, as JSON; `restore` rebuilds the session from it. */
export interface ReplSnapshot {
  readonly inputs: number;
  readonly preludes: readonly (readonly [string, string])[];
  readonly history: readonly { readonly sourceId: string; readonly source: string }[];
  readonly effect: readonly EffectForm[];
  readonly declarations: readonly EffectForm[];
}

interface EffectForm { readonly key: string; readonly sourceId: string; readonly cell: string; readonly start: number; readonly end: number }
interface Session {
  sessionId: string;
  inputs: number;
  effect: EffectForm[];
  readonly sources: Map<string, string>;
  /** Preludes in load order; a change rebuilds the pure session from them and `history`. */
  preludes: Map<string, string>;
  /** Pure inputs that checked and ran, replayed after a prelude change. */
  history: { readonly sourceId: string; readonly source: string }[];
  /** Forms the session's preludes define; input made only of them is declared, not run. */
  forms: ReadonlySet<string>;
  /** Accepted form applications, elaborated together so later ones can refer to earlier ones. */
  declarations: EffectForm[];
  /** The rest of a paged result, for :more. */
  more?: Paged | undefined;
}
type Result = Record<string, unknown> & { ok: boolean; diagnostics: readonly Diagnostic[] };
export interface ReplReply { readonly result: Result; readonly text: string }
/** A long result split into pages of whole lines; `lines[i]` is the first line of page i. */
interface Paged { readonly result: Result; readonly command: string; readonly pages: readonly string[]; readonly lines: readonly number[]; next: number }

function paginate(text: string): { pages: string[]; lines: number[] } {
  const pages: string[] = [], lines: number[] = [];
  let current: string[] = [], size = 0, first = 1;
  const flush = () => { if (current.length) { pages.push(current.join("\n")); lines.push(first); } current = []; size = 0; };
  text.split("\n").forEach((line, index) => {
    if (size + line.length + 1 > PAGE_CHARS) flush();
    if (!current.length) first = index + 1;
    // A line longer than a page is cut into page-sized pieces.
    for (; line.length > PAGE_CHARS; line = line.slice(PAGE_CHARS)) { pages.push(line.slice(0, PAGE_CHARS)); lines.push(index + 1); }
    current.push(line);
    size += line.length + 1;
  });
  flush();
  return { pages, lines };
}

/**
 * Page `index` of a paged result. Its structured result keeps the short fields
 * and names the long ones it leaves out; `:more all` returns them.
 */
function page(paged: Paged, index: number): ReplReply {
  const kept = Object.entries(paged.result).filter(([key, value]) => key === "diagnostics" || value === null || (typeof value !== "object" && !(typeof value === "string" && value.length > 200)));
  const omitted = Object.keys(paged.result).filter(key => !kept.some(([k]) => k === key));
  const lineCount = paged.lines.at(-1)! + paged.pages.at(-1)!.split("\n").length - 1;
  const last = index + 1 < paged.pages.length ? Math.max(paged.lines[index]!, paged.lines[index + 1]! - 1) : lineCount;
  const hint = paged.result.kind === "source" ? ` :outline ${paged.result.name} maps it; :source ${paged.result.name} <from>-<to> shows a range.`
    : paged.result.kind === "describe" ? " :outline lists the names; :describe <name> shows one." : "";
  const more = index + 1 < paged.pages.length ? " :more shows the next page, :more all the rest." : " That is the end.";
  const footer = `[${paged.command}: page ${index + 1} of ${paged.pages.length}, lines ${paged.lines[index]}-${last} of ${lineCount}.${more}${hint}]`;
  return {
    result: { ...Object.fromEntries(kept), ok: paged.result.ok, diagnostics: paged.result.diagnostics, page: { page: index + 1, pages: paged.pages.length, omitted, ...(index + 1 < paged.pages.length ? { more: ":more" } : {}) } },
    text: `${paged.pages[index]}\n${footer}`,
  };
}

const error = (code: string, message: string): Diagnostic => ({ code, severity: "error", message });
const hasErrors = (diagnostics: readonly { severity: string }[]) => diagnostics.some(d => d.severity === "error");
const head = (e: SExpr | undefined) => e?._tag === "List" && e.items[0]?._tag === "Sym" ? e.items[0].name : undefined;
const symbol = (e: SExpr | undefined) => e?._tag === "Sym" ? e.name : undefined;

function lineColumn(text: string, offset: number) {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length, column: before.at(-1)!.length + 1 };
}
function spanIn(sourceId: string, text: string, startOffset: number, endOffset: number) {
  const start = lineColumn(text, startOffset), end = lineColumn(text, endOffset);
  return { sourceId, startOffset, endOffset, startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column };
}

/** Read a cell's top-level forms with their offsets. */
function readForms(sourceId: string, cell: string): { forms: readonly SExpr[]; diagnostics: Diagnostic[] } {
  try {
    const parsed = parse(cell);
    if (parsed.errors.length) return { forms: [], diagnostics: parsed.errors.map(e => ({ ...error("read/syntax", e.message), ...(e.loc ? { span: spanIn(sourceId, cell, e.loc.start, e.loc.end) } : {}) })) };
    return { forms: toSExprMany(parsed.redTree, sourceId), diagnostics: [] };
  } catch (e) {
    return { forms: [], diagnostics: [error("read/syntax", e instanceof Error ? e.message : String(e))] };
  }
}

/** Replacement key: a new signature, definition or declaration replaces the one with the same name. */
function formKey(form: SExpr, cell: string): string {
  const h = head(form), name = form._tag === "List" ? symbol(form.items[1]) : undefined;
  if (h === "import") return `import ${cell.slice(form.loc.start, form.loc.end)}`;
  if (h && name) return `${h === ":" ? "signature" : h === "define" ? "define" : "declaration"} ${name}`;
  return `form ${cell.slice(form.loc.start, form.loc.end)}`;
}

/**
 * The program text for a list of forms, and a function that moves engine spans
 * back to the cell each form came from.
 */
function assemble(forms: readonly EffectForm[]) {
  let text = "";
  const segments: { form: EffectForm; at: number }[] = [];
  for (const form of forms) {
    if (text) text += "\n";
    segments.push({ form, at: text.length });
    text += form.cell.slice(form.start, form.end);
  }
  const locate = (d: EffectProgramDiagnostic): Diagnostic => {
    const { phase: _phase, span, fix, ...rest } = d as EffectProgramDiagnostic & Pick<Diagnostic, "fix">;
    const segment = span && segments.find(s => span.startOffset >= s.at && span.startOffset <= s.at + s.form.end - s.form.start);
    if (!span || !segment) return rest;
    const shift = segment.form.start - segment.at;
    const end = Math.min(span.endOffset + shift, segment.form.end);
    // A repair moves with its diagnostic when it edits the same cell's form.
    const inForm = (s: { startOffset: number; endOffset: number }) => s.startOffset + shift >= segment.form.start && s.endOffset + shift <= segment.form.end;
    const moved = fix?.every(edit => inForm(edit.span))
      ? fix.map(edit => ({ ...edit, span: spanIn(segment.form.sourceId, segment.form.cell, edit.span.startOffset + shift, edit.span.endOffset + shift) }))
      : undefined;
    return { ...rest, span: spanIn(segment.form.sourceId, segment.form.cell, span.startOffset + shift, end), ...(moved ? { fix: moved } : {}) };
  };
  return { text, locate };
}

/** Forma source for a checker type, when it has one; literals widen to their primitive. */
function typeSource(type: MechanicsType): string | undefined {
  const all = (types: readonly MechanicsType[]) => {
    const printed = types.map(typeSource);
    return printed.every((p): p is string => p !== undefined) ? printed.join(" ") : undefined;
  };
  const names = (set: ReadonlyMap<string, unknown>) => `[${[...set.keys()].join(" ")}]`;
  const wrap = (prefix: string, types: readonly MechanicsType[], suffix = "") => { const inner = all(types); return inner === undefined ? undefined : `(${prefix} ${inner}${suffix})`; };
  switch (type.kind) {
    case "prim": return type.name;
    case "named": case "brand": case "error": case "class": return type.name;
    case "literal": return typeof type.value === "string" ? "String" : typeof type.value === "boolean" ? "Bool" : type.numericKind === "float" ? "Float" : "Int";
    case "struct": {
      const fields = type.fields.map(f => { const t = typeSource(f.type); return t === undefined ? undefined : `:${f.name} ${f.optional ? `(Option ${t})` : t}`; });
      return fields.every(f => f !== undefined) ? `{${fields.join(" ")}}` : undefined;
    }
    case "array": return wrap("List", [type.item]);
    case "map": return type.key ? wrap("Map", [type.key, type.value]) : wrap("Map String", [type.value]);
    case "tuple": return wrap("Tuple", type.items);
    case "union": return type.members.every(m => m.kind === "literal" && typeof m.value === "string")
      ? `(Union ${type.members.map(m => `:${(m as { value: string }).value}`).join(" ")})` : wrap("Union", type.members);
    case "option": return wrap("Option", [type.item]);
    case "result": return wrap("Result", [type.success, type.failure]);
    case "ref": return wrap("Ref", [type.item]);
    case "effect": return wrap("Effect", [type.success], ` ${names(type.errors)} ${names(type.requirements)}`);
    case "fiber": return wrap("Fiber", [type.success], ` ${names(type.errors)}`);
    case "stream": return wrap("Stream", [type.item], ` ${names(type.errors)} ${names(type.requirements)}`);
    case "function": return wrap("->", [...type.params, type.result]);
    default: return undefined;
  }
}

/** The body type of the definition named `name`, from a checked elaboration. */
function bodyType(elaboration: EffectProgramElaboration, name: string): MechanicsType | undefined {
  const declaration = elaboration.declarations.find(d => d.summary.name === name);
  const body = (declaration?.payload as { body?: object } | undefined)?.body;
  return body && elaboration.check ? elaboration.check.effectTypes.get(body) ?? elaboration.check.valueTypes.get(body) : undefined;
}

function contracts(elaboration: EffectProgramElaboration, names: ReadonlySet<string>) {
  const check = elaboration.check;
  if (!check) return [];
  return elaboration.declarations.flatMap(d => {
    const name = d.summary.name;
    const signature = name && names.has(name) ? check.operations.get(name) ?? check.functions.get(name) : undefined;
    const constant = name && names.has(name) ? check.constants.get(name) : undefined;
    if (!name || (!signature && !constant)) return [];
    const declared = signature ? showMechanicsType({ kind: "function", params: signature.params.map(p => p.type), result: signature.result }) : showMechanicsType(constant!);
    const inferred = bodyType(elaboration, name);
    return [{ name, declared, inferred: inferred ? showMechanicsType(inferred) : undefined }];
  });
}

function sourceSummary(text: string): string {
  const purpose = text.match(/^;+\s*Purpose:\s*(.+)$/mu)?.[1];
  if (purpose) return purpose.trim();
  return text.split("\n").filter(line => line.startsWith(";")).map(line => line.replace(/^;+\s?/u, "").trim())
    .find(line => line && !/^-+$/u.test(line) && !/\.lisp$/u.test(line) && !line.startsWith("Generated")) ?? "";
}

/** IR without source offsets, which change with every edit and would swamp a diff. */
const withoutSpans = (value: unknown): unknown => Array.isArray(value) ? value.map(withoutSpans)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "span").map(([key, inner]) => [key, withoutSpans(inner)]))
  : value;
const indent = (text: string) => text.split("\n").map(line => `  ${line}`).join("\n");
const slotList = (slots: readonly { name: string; type?: string }[], prefix = "") => slots.map(s => `${prefix}${s.name}${s.type ? ` ${s.type}` : ""}`).join(", ");

function renderDoc(d: any): string {
  const out: string[] = [];
  const example = (examples: readonly string[], how?: string) => { for (const e of examples) out.push(`Example${how ? ` (try it with ${how})` : ""}:`, indent(e)); };
  switch (d.kind) {
    case "diagnostic": return `${d.code}: ${d.summary}\n${d.explanation}`;
    case "type": return `type ${d.type}`;
    case "effect-program": return `in the Effect program:\n${d.source}`;
    case "effect":
      out.push(`${d.name} — Effect program keyword`, indent(d.signature), d.summary);
      if (d.options) out.push("Option keys:", ...Object.entries(d.options).map(([key, what]) => `  ${key} — ${what}`));
      example([d.example], `${d.try} <example>`);
      break;
    case "builtin":
      out.push(`${d.name} — builtin function`);
      if (d.usage) out.push(indent(d.usage));
      if (d.type) out.push(`  type ${d.type}`);
      for (const signature of d.effect) out.push(`  in Effect programs ${signature}`);
      if (d.summary) out.push(d.summary);
      if (d.example) example([d.example]);
      break;
    default:
      out.push(`${d.name} — ${d.kind} in ${d.source}, line ${d.line}; ${d.use}`, indent(d.signature));
      if (d.summary) out.push(d.summary);
      if (d.doc) out.push(d.doc);
      if (d.arguments?.length) out.push(`Arguments: ${slotList(d.arguments)}`);
      if (d.options?.length) out.push(`Option keys: ${slotList(d.options, ":")}`);
      if (d.ir) out.push(`Produces: ${d.ir}`);
      example(d.examples);
  }
  return out.join("\n");
}

function describeForm(f: any): string {
  const required = f.slots.filter((s: any) => s.required), optional = f.slots.filter((s: any) => !s.required);
  const slot = (s: any) => `${s.name}${s.many ? "..." : ""}${s.type ? ` ${s.type}` : ""}`;
  const out = [`form (${[f.name, ...f.identifiers.map((i: any) => i.name), ...f.slots.map((s: any) => `${s.name}${s.many ? "..." : ""}`)].join(" ")}) from ${f.sourceId}`];
  if (f.doc) out.push(f.doc);
  if (f.identifiers.length) out.push(`Names: ${f.identifiers.map((i: any) => `${i.name} ${i.kind}`).join(", ")}`);
  if (required.length) out.push(`Required: ${required.map(slot).join(", ")}`);
  if (optional.length) out.push(`Optional: ${optional.map(slot).join(", ")}`);
  out.push(`Result: ${f.result.kind === "constant" ? f.result.type : "computed"}${f.ir ? `; IR ${f.ir}` : ""}`);
  for (const e of f.examples) out.push("Example:", indent(e));
  return out.join("\n");
}

export function createRepl(abi: JsonAbi, options: ReplOptions = {}) {
  const unavailable = options.run ? undefined : options.runUnavailable ?? "This server cannot run effects.";
  const help = helpText(options.runNote ?? "", unavailable);
  const sessions = new Map<string, Session>();

  async function session(name: string): Promise<Session> {
    const existing = sessions.get(name);
    if (existing) { sessions.delete(name); sessions.set(name, existing); return existing; }
    if (sessions.size >= MAX_SESSIONS) {
      const [oldest, state] = sessions.entries().next().value!;
      sessions.delete(oldest);
      await abi.host.closeSession({ sessionId: state.sessionId });
    }
    const created: Session = { sessionId: (await abi.host.openSession()).sessionId, inputs: 0, effect: [], sources: new Map(), preludes: new Map(), history: [], forms: new Set(), declarations: [] };
    sessions.set(name, created);
    return created;
  }

  function elaborate(forms: readonly EffectForm[]) {
    const { text, locate } = assemble(forms);
    const elaboration = elaborateEffectProgram(text, { sourceId: "<program>" });
    return { text, elaboration, diagnostics: elaboration.diagnostics.map(locate) };
  }

  /** Check `expr` as the body of a synthesized definition; its signature comes from the inferred type. */
  function inferExpression(state: Session, sourceId: string, cell: string) {
    const read = readForms(sourceId, cell);
    if (read.diagnostics.length) return { diagnostics: read.diagnostics };
    if (read.forms.length !== 1) return { diagnostics: [error("repl/expression", "Give exactly one expression.")] };
    const expr = read.forms[0]!;
    const prefix = (signature: string) => `(: ${ENTRY} ${signature})\n(define ${ENTRY} `;
    // A synthesized definition; `relocate` maps spans inside the expression back to its cell.
    const at = (signature: string): EffectForm => {
      const text = `${prefix(signature)}${cell.slice(expr.loc.start, expr.loc.end)})`;
      return { key: "entry", sourceId: `${sourceId}#synthetic`, cell: text, start: 0, end: text.length };
    };
    const first = elaborate([...state.effect, at(PLACEHOLDER)]);
    const inferred = bodyType(first.elaboration, ENTRY);
    const relocate = (d: Diagnostic, signature: string): Diagnostic => {
      if (!d.span || d.span.sourceId !== `${sourceId}#synthetic`) return d;
      const offset = prefix(signature).length;
      const move = (s: { startOffset: number; endOffset: number }) => {
        const start = s.startOffset - offset + expr.loc.start, end = s.endOffset - offset + expr.loc.start;
        return start >= expr.loc.start && end <= expr.loc.end ? spanIn(sourceId, cell, start, end) : undefined;
      };
      const { span, fix, ...rest } = d;
      const moved = move(span), edits = fix?.map(edit => ({ ...edit, span: move(edit.span) }));
      const located = edits?.every(edit => edit.span) ? edits as Diagnostic["fix"] : undefined;
      return moved ? { ...rest, span: moved, ...(located ? { fix: located } : {}) } : rest;
    };
    // The first pass's own errors, without those its placeholder signature causes.
    const firstErrors = () => first.diagnostics.map(d => relocate(d, PLACEHOLDER)).filter(d => !d.message.includes(ENTRY) && !d.message.includes("__Infer"));
    if (!inferred) return { diagnostics: firstErrors() };
    const signature = typeSource(inferred);
    if (!signature) return { type: inferred, diagnostics: firstErrors() };
    const second = elaborate([...state.effect, at(signature)]);
    return { type: inferred, signature, program: second.text, diagnostics: second.diagnostics.map(d => relocate(d, signature)) };
  }

  /**
   * Rebuild the pure session with `preludes`: load them in order, then replay the
   * session's earlier inputs. A prelude that fails leaves the session unchanged;
   * an input that no longer checks is dropped and reported as a warning.
   */
  async function rebuild(state: Session, preludes: Map<string, string>): Promise<{ ok: boolean; diagnostics: Diagnostic[]; dropped: string[] }> {
    const { sessionId } = await abi.host.openSession();
    const diagnostics: Diagnostic[] = [];
    for (const [name, source] of preludes) {
      state.sources.set(name, source);
      const loaded = await abi.host.loadSource({ sessionId, sourceId: name, source, kind: "prelude" });
      diagnostics.push(...loaded.diagnostics);
      if (hasErrors(loaded.diagnostics)) {
        await abi.host.closeSession({ sessionId });
        return { ok: false, diagnostics, dropped: [] };
      }
    }
    const kept: Session["history"] = [], dropped: string[] = [];
    for (const input of state.history) {
      const replayed = await abi.host.replSubmit({ sessionId, sourceId: input.sourceId, source: input.source, stepLimit: STEP_LIMIT });
      const failures = replayed.status === "failed" ? replayed.diagnostics : replayed.status === "completed" ? replayed.result.diagnostics.filter(d => d.severity === "error") : [error("abi/invalid-request", "REPL evaluation does not grant host capabilities.")];
      if (replayed.status === "completed" && !failures.length) { kept.push(input); continue; }
      dropped.push(input.sourceId);
      diagnostics.push(...failures.map(d => ({ ...d, severity: "warning" as const, message: `${input.sourceId} no longer checks and was dropped: ${d.message}` })));
    }
    await abi.host.closeSession({ sessionId: state.sessionId });
    const forms = new Set((await abi.host.describe({ sessionId })).forms.map(form => form.name));
    Object.assign(state, { sessionId, preludes, history: kept, forms });
    const orphaned = state.declarations.filter(f => !forms.has(f.key.split(" ")[0]!));
    for (const f of orphaned) {
      dropped.push(f.sourceId);
      diagnostics.push({ ...error("repl/form-removed", `The session's preludes no longer define ${f.key.split(" ")[0]}; dropped ${f.cell.slice(f.start, f.end)}.`), severity: "warning", span: spanIn(f.sourceId, f.cell, f.start, f.end) });
    }
    state.declarations = state.declarations.filter(f => !orphaned.includes(f));
    if (state.declarations.length) {
      const checked = await elaborateDeclarations(state, state.declarations);
      if (!checked.ok) {
        const located = (f: EffectForm) => checked.diagnostics.some(d => d.severity === "error" && d.span?.sourceId === f.sourceId && d.span.startOffset >= f.start && d.span.startOffset <= f.end);
        // Without a located error, drop them all rather than keep a set that does not check.
        const broken = state.declarations.some(located) ? state.declarations.filter(located) : state.declarations;
        state.declarations = state.declarations.filter(f => !broken.includes(f));
        dropped.push(...new Set(broken.map(f => f.sourceId)));
        diagnostics.push(...checked.diagnostics.map(d => ({ ...d, severity: "warning" as const, message: `A declaration no longer checks and was dropped: ${d.message}` })));
      }
    }
    return { ok: true, diagnostics, dropped };
  }

  /** Elaborate form applications against the session's preludes; spans point back into their cells. */
  async function elaborateDeclarations(state: Session, forms: readonly EffectForm[]) {
    const { text, locate } = assemble(forms);
    const emitted = await abi.host.emit({ sessionId: state.sessionId, source: text, sourceId: "<declarations>" });
    const diagnostics = emitted.diagnostics.map(d => locate({ ...d, phase: "check" } as unknown as EffectProgramDiagnostic));
    const content = ("artifacts" in emitted ? emitted.artifacts[0]?.content : undefined) as { declarations?: { formName: string; declarationId?: string; payload: unknown; span?: { startOffset: number } }[] } | undefined;
    return { ok: !hasErrors(diagnostics), diagnostics, declarations: content?.declarations ?? [] };
  }

  /** A session prelude, or a bundled module or prelude: `effect` and `forma:effect` both name the module. */
  function findSource(state: Session, name: string) {
    const own = state.preludes.get(name);
    if (own !== undefined) return { name, text: own, bundled: (preludeSources as Record<string, string>)[name] === own };
    const lookup = (key: string) => bundledSources.find(([source]) => source === key);
    const found = lookup(name) ?? lookup(`forma:${name}`) ?? lookup(`${name}.lisp`);
    return found && { name: found[0], text: found[1], bundled: true };
  }

  /** Docs from the session's own preludes; bundled ones loaded unchanged are already in `allBundledDocs`. */
  const sessionDocs = (state: Session): SourceDoc[] => [...state.preludes]
    .filter(([name, text]) => (preludeSources as Record<string, string>)[name] !== text)
    .flatMap(([name, text]) => sourceDocs(name, text, false));

  /** Names only, grouped, so a session with a large prelude still fits on a page. */
  async function sessionOutline(state: Session): Promise<string> {
    const wrap = (label: string, items: readonly string[], separator = " ") => {
      if (!items.length) return [];
      const rows: string[] = [];
      for (const item of items) {
        if (rows.length && rows.at(-1)!.length + separator.length + item.length <= 98) rows[rows.length - 1] += `${separator}${item}`;
        else rows.push(`  ${item}`);
      }
      return [`${label} (${items.length}):`, ...rows];
    };
    const out: string[] = [];
    if (state.preludes.size) {
      const described = await abi.host.describe({ sessionId: state.sessionId });
      out.push(`Session preludes: ${[...state.preludes.keys()].join(", ")}.`);
      for (const source of new Set(described.forms.map(f => f.sourceId)))
        out.push(...wrap(`Forms from ${source}`, described.forms.filter(f => f.sourceId === source).map(f => f.name)));
      out.push(...wrap("Functions", described.functions.map(f => f.name)), ...wrap("Types", described.types.map(t => t.name)));
    } else out.push(`No session preludes. Bundled preludes (:load <name>, or :outline <name> to map one first): ${Object.keys(preludeSources).join(", ")}.`);
    if (state.history.length) out.push(`Pure inputs kept: ${state.history.length}.`);
    out.push(...wrap("Declarations", state.declarations.map(f => f.key), ", "), ...wrap("Effect program", state.effect.map(f => f.key), ", "));
    out.push(":describe <name> or :doc <name> shows one; :outline <module|prelude> maps a bundled source; :ir exports the declarations.");
    return out.join("\n");
  }

  async function declare(state: Session, sourceId: string, input: string, read: readonly SExpr[]): Promise<Result> {
    const next = [...state.declarations];
    for (const form of read) {
      const h = head(form)!, name = form._tag === "List" ? symbol(form.items[1]) : undefined;
      const entry: EffectForm = { key: name ? `${h} ${name}` : `${h} ${input.slice(form.loc.start, form.loc.end)}`, sourceId, cell: input, start: form.loc.start, end: form.loc.end };
      const index = next.findIndex(f => f.key === entry.key);
      if (index >= 0) next[index] = entry; else next.push(entry);
    }
    const checked = await elaborateDeclarations(state, next);
    if (checked.ok) state.declarations = next;
    // Report the declarations this input made, in the order the program lists them.
    const { text } = assemble(next);
    const mine = new Set(read.map(f => input.slice(f.loc.start, f.loc.end)));
    const declarations = checked.declarations
      .filter(d => d.span && [...mine].some(source => text.indexOf(source) === d.span!.startOffset))
      .map(d => ({ form: d.formName, payload: d.payload }));
    return { ok: checked.ok, kind: "declarations", kept: checked.ok, declarations, diagnostics: checked.diagnostics };
  }

  async function evaluate(state: Session, sourceId: string, input: string): Promise<Result> {
    if (state.forms.size) {
      const read = readForms(sourceId, input);
      if (!read.diagnostics.length && read.forms.length && read.forms.every(f => state.forms.has(head(f) ?? ""))) return declare(state, sourceId, input, read.forms);
    }
    const submitted = await abi.host.replSubmit({ sessionId: state.sessionId, sourceId, source: input, stepLimit: STEP_LIMIT });
    if (submitted.status === "host-call") {
      await abi.host.abortEvaluation({ sessionId: state.sessionId, evaluationId: submitted.call.evaluationId, reason: "no host capabilities" });
      return { ok: false, kind: "value", diagnostics: [error("abi/invalid-request", "REPL evaluation does not grant host capabilities.")] };
    }
    if (submitted.status === "failed") return { ok: false, kind: "value", diagnostics: submitted.diagnostics };
    const { printed, type, diagnostics } = submitted.result;
    if (!hasErrors(diagnostics)) state.history.push({ sourceId, source: input });
    // The printed value is the value; the ABI's tagged JSON tree would repeat it.
    return { ok: !hasErrors(diagnostics), kind: "value", printed: printed ?? null, type: type?.display ?? null, diagnostics };
  }

  async function command(state: Session, name: string, rest: string, sourceId: string): Promise<Result> {
    switch (name) {
      case "help": return { ok: true, kind: "help", help, diagnostics: [] };
      case "reset": {
        await abi.host.closeSession({ sessionId: state.sessionId });
        for (const [key, value] of sessions) if (value === state) sessions.delete(key);
        return { ok: true, kind: "reset", diagnostics: [] };
      }
      case "type": {
        const checked = await abi.host.typecheck({ sessionId: state.sessionId, sourceId, source: rest });
        return { ok: !hasErrors(checked.diagnostics), kind: "type", type: checked.type?.display ?? checked.display ?? null, diagnostics: checked.diagnostics };
      }
      case "load": {
        const source = (preludeSources as Record<string, string>)[rest];
        if (source === undefined) return { ok: false, kind: "load", diagnostics: [error("repl/unknown-prelude", `No bundled prelude ${rest}. Bundled preludes: ${Object.keys(preludeSources).join(", ")}.`)] };
        const rebuilt = await rebuild(state, new Map([...state.preludes, [rest, source]]));
        return { ok: rebuilt.ok, kind: "prelude", prelude: rest, changed: rebuilt.ok ? "loaded" : "rejected", dropped: rebuilt.dropped, diagnostics: rebuilt.diagnostics };
      }
      case "prelude": {
        const [, name, source = ""] = /^(\S*)\s*([\s\S]*)$/u.exec(rest)!;
        if (!name) return { ok: true, kind: "preludes", preludes: [...state.preludes.keys()], diagnostics: [] };
        if (!source.trim()) {
          const text = state.preludes.get(name!);
          return text === undefined ? { ok: false, kind: "source", diagnostics: [error("repl/unknown-prelude", `This session has no prelude ${name}; :prelude lists them.`)] } : { ok: true, kind: "source", name, source: text, diagnostics: [] };
        }
        // The prelude's own diagnostics point into its text under its name.
        state.sources.set(name!, source);
        const replaced = state.preludes.has(name!);
        const rebuilt = await rebuild(state, new Map([...state.preludes, [name!, source]]));
        return { ok: rebuilt.ok, kind: "prelude", prelude: name, changed: rebuilt.ok ? (replaced ? "replaced" : "added") : "rejected", dropped: rebuilt.dropped, diagnostics: rebuilt.diagnostics };
      }
      case "unload": {
        if (!state.preludes.has(rest)) return { ok: false, kind: "prelude", diagnostics: [error("repl/unknown-prelude", `This session has no prelude ${rest}; :prelude lists them.`)] };
        const rebuilt = await rebuild(state, new Map([...state.preludes].filter(([name]) => name !== rest)));
        return { ok: rebuilt.ok, kind: "prelude", prelude: rest, changed: "removed", dropped: rebuilt.dropped, diagnostics: rebuilt.diagnostics };
      }
      case "describe": {
        const described = await abi.host.describe({ sessionId: state.sessionId });
        if (!rest) return { ok: !hasErrors(described.diagnostics), kind: "describe", ...described };
        const named = <T extends { name: string }>(list: readonly T[]) => list.filter(item => item.name === rest);
        const one = { forms: named(described.forms), functions: named(described.functions), types: named(described.types) };
        return one.forms.length || one.functions.length || one.types.length ? { ok: true, kind: "describe", name: rest, ...one, diagnostics: [] }
          : { ok: false, kind: "describe", name: rest, ...one, diagnostics: [error("repl/unknown-name", `The session's preludes define no form, function or type ${rest}. :outline lists what they define; :doc ${rest} also searches bundled modules and preludes.`)] };
      }
      case "outline": {
        if (!rest) return { ok: true, kind: "outline", outline: await sessionOutline(state), diagnostics: [] };
        const found = findSource(state, rest);
        return found ? { ok: true, kind: "outline", name: found.name, outline: outlineSource(found.name, found.text, found.bundled), diagnostics: [] }
          : { ok: false, kind: "outline", diagnostics: [error("repl/unknown-module", `No session prelude, bundled module or prelude ${rest}; see :modules.`)] };
      }
      case "ir": case "export": {
        const forms = state.declarations.length ? (await elaborateDeclarations(state, state.declarations)).declarations : [];
        const program = state.effect.length ? elaborate(state.effect).elaboration.declarations : [];
        const ir = {
          preludes: [...state.preludes.keys()],
          declarations: forms.map(d => ({ id: d.declarationId ?? null, form: d.formName, payload: d.payload })),
          effect: program.map(d => ({ id: `${d.summary.kind}:${d.summary.name}`, payload: withoutSpans(d.payload) })),
        };
        return { ok: true, kind: "ir", ir, diagnostics: [] };
      }
      case "effect": {
        const read = readForms(sourceId, rest);
        if (read.diagnostics.length) return { ok: false, kind: "effect", diagnostics: read.diagnostics };
        const next = [...state.effect];
        const added: string[] = [], replaced: string[] = [];
        for (const form of read.forms) {
          const entry: EffectForm = { key: formKey(form, rest), sourceId, cell: rest, start: form.loc.start, end: form.loc.end };
          const index = next.findIndex(f => f.key === entry.key);
          if (index >= 0) { next[index] = entry; replaced.push(entry.key); } else { next.push(entry); added.push(entry.key); }
        }
        const { elaboration, diagnostics } = elaborate(next);
        const ok = !hasErrors(diagnostics);
        if (ok) state.effect = next;
        const names = new Set(read.forms.flatMap(f => f._tag === "List" && symbol(f.items[1]) ? [symbol(f.items[1])!] : []));
        return { ok, kind: "effect", kept: ok, added, replaced, contracts: contracts(elaboration, names), diagnostics };
      }
      case "infer": {
        const inferred = inferExpression(state, sourceId, rest);
        return { ok: !hasErrors(inferred.diagnostics) && inferred.type !== undefined, kind: "infer", type: inferred.type ? showMechanicsType(inferred.type) : null, diagnostics: inferred.diagnostics };
      }
      case "run": {
        // Fail before checking: building a program and its layers only to learn it cannot run wastes the work.
        if (!options.run) return { ok: false, kind: "run", diagnostics: [error("repl/run-unavailable", unavailable!)] };
        const inferred = inferExpression(state, sourceId, rest);
        const type = inferred.type ? showMechanicsType(inferred.type) : null;
        if (hasErrors(inferred.diagnostics) || !inferred.type) return { ok: false, kind: "run", type, diagnostics: inferred.diagnostics };
        if (!inferred.signature) return { ok: false, kind: "run", type, diagnostics: [error("repl/unnamed-type", `Cannot write the type ${type} as a signature. Bind the expression in a typed definition with :effect and run its name.`)] };
        const requirements = inferred.type.kind === "effect" || inferred.type.kind === "stream" ? [...inferred.type.requirements.keys()] : [];
        if (requirements.length) {
          const layers = state.effect.filter(f => f.key.startsWith("declaration ") && /^\(layer\s/u.test(f.cell.slice(f.start, f.end))).map(f => f.key.slice("declaration ".length));
          return { ok: false, kind: "run", type, diagnostics: [{ ...error("repl/unprovided-requirements", `This effect requires ${requirements.join(", ")}. Provide them with a layer, as in (provide ${rest.trim()} SomeLayer).`), help: layers.length ? `Layers in this session: ${layers.join(", ")}.` : "Define a layer with :effect (layer Name :provides Service (define method [args] ...))." }] };
        }
        const generated = generateEffectProgram(inferred.program!, { sourceId: "<program>" });
        if (!generated.code) return { ok: false, kind: "run", type, diagnostics: generated.diagnostics.map(({ phase: _phase, span: _span, ...d }) => d) };
        const run = await options.run(generated.code);
        return { ok: run.exit === "success", kind: "run", type, ...run, diagnostics: [] };
      }
      case "ts": {
        if (!state.effect.length) return { ok: false, kind: "ts", diagnostics: [error("repl/empty-program", "The Effect program is empty; add declarations with :effect.")] };
        const generated = generateEffectProgram(assemble(state.effect).text, { sourceId: "<program>" });
        return { ok: generated.code !== undefined, kind: "ts", code: generated.code ?? null, diagnostics: generated.diagnostics.map(({ phase: _phase, span: _span, ...d }) => d) };
      }
      case "program": return { ok: true, kind: "program", source: assemble(state.effect).text, diagnostics: [] };
      case "expand": {
        const read = readForms(sourceId, rest);
        if (read.diagnostics.length) return { ok: false, kind: "expand", diagnostics: read.diagnostics };
        const imported = read.forms.some(f => head(f) === "import" && f._tag === "List" && f.items[1]?._tag === "Str" && f.items[1].value === "forma:effect");
        const implicit = imported ? [] : readForms("<implicit>", `(import "forma:effect" [do bind pure])`).forms;
        const library = expandEffectLibrary([...implicit, ...read.forms], sourceId);
        if (!library.ok) return { ok: false, kind: "expand", diagnostics: library.diagnostics };
        let lowered: readonly SExpr[];
        try { lowered = expandEffectDeclarations(library.exprs); } catch (e) { return { ok: false, kind: "expand", diagnostics: [error("surface/invalid-form", e instanceof Error ? e.message : String(e))] }; }
        const printed = lowered.map(printSExpr).join("\n");
        const formatted = await Effect.runPromise(Effect.result(formatLispSource(printed)));
        return { ok: true, kind: "expand", source: formatted._tag === "Success" ? formatted.success : printed, diagnostics: [] };
      }
      case "doc": {
        if (!rest) return { ok: false, kind: "doc", docs: [], diagnostics: [error("repl/no-docs", "Give a name, as in :doc entity. :outline lists what the session provides.")] };
        const docs: Record<string, unknown>[] = [];
        const entry = diagnosticCatalog.get(rest);
        if (entry) docs.push({ kind: "diagnostic", ...entry });
        const sourced = [...sessionDocs(state), ...allBundledDocs()];
        docs.push(...sourced.filter(d => d.name === rest).map(d => ({ ...d })));
        const keyword = effectKeywordDocs.find(k => k.name === rest);
        if (keyword) docs.push({ kind: "effect", ...keyword, try: /^\((type|class|error|service|:|define|layer|import)\s/u.test(keyword.example) ? ":effect" : ":infer" });
        const declared = state.effect.filter(f => f.key.endsWith(` ${rest}`));
        if (declared.length) docs.push({ kind: "effect-program", source: declared.map(f => f.cell.slice(f.start, f.end)).join("\n") });
        let type: string | undefined;
        if (/^[^\s()[\]{}":;]+$/u.test(rest)) {
          const checked = await abi.host.typecheck({ sessionId: state.sessionId, source: rest });
          if (!hasErrors(checked.diagnostics)) type = checked.type?.display ?? checked.display;
        }
        const builtin = builtinDocs.find(b => b.name === rest), effect = effectSignatures(rest);
        if (builtin || effect.length) docs.push({ kind: "builtin", name: rest, ...builtin, ...(type ? { type } : {}), effect });
        else if (type && type !== "Unknown" && !docs.length) docs.push({ kind: "type", type });
        if (docs.length) return { ok: true, kind: "doc", name: rest, docs, diagnostics: [] };
        // Nothing by that name: point at the names whose docs mention it.
        const word = rest.toLowerCase();
        const related = [
          ...sourced.filter(d => d.kind === "form" || d.kind === "macro").map(d => ({ name: d.name, kind: d.kind, source: d.source, summary: d.summary ?? "" })),
          ...effectKeywordDocs.map(k => ({ name: k.name, kind: "effect", source: "Effect programs", summary: k.summary })),
          ...builtinDocs.map(b => ({ name: b.name, kind: "builtin", source: "builtins", summary: b.summary })),
        ].filter(d => d.name.includes(rest) || d.summary.toLowerCase().includes(word)).slice(0, 10);
        return { ok: false, kind: "doc", name: rest, docs, related, diagnostics: [error("repl/no-docs", `No docs for ${rest}.${related.length ? ` Related: ${related.map(d => d.name).join(", ")}.` : ""} Try :outline, :modules, or :examples ${rest}.`)] };
      }
      case "modules": return {
        ok: true, kind: "modules", diagnostics: [],
        modules: Object.entries(bundledModuleSources).map(([id, text]) => ({ name: `forma:${id}`, exports: text.match(/^\(export ([^)]*)\)/mu)?.[1]?.split(/\s+/u) ?? [], summary: sourceSummary(text) })),
        preludes: Object.entries(preludeSources).map(([name, text]) => ({ name, summary: sourceSummary(text) })),
      };
      case "source": {
        const [, name = "", from, to] = /^(\S*)(?:\s+(\d+)(?:\s*-\s*(\d+))?)?\s*$/u.exec(rest) ?? [];
        const found = name ? findSource(state, name) : undefined;
        if (!found) return { ok: false, kind: "source", diagnostics: [error("repl/unknown-module", `No bundled module or prelude ${rest}; see :modules. A range is :source <name> <from>-<to>.`)] };
        if (!from) return { ok: true, kind: "source", name: found.name, source: found.text, diagnostics: [] };
        const lines = found.text.split("\n"), first = Number(from), last = Math.min(Number(to ?? from), lines.length);
        return { ok: true, kind: "source", name: found.name, lines: [first, last], source: lines.slice(first - 1, last).join("\n"), diagnostics: [] };
      }
      case "examples": return {
        ok: true, kind: "examples", diagnostics: [],
        examples: effectExamples.filter(e => !rest || e.name.includes(rest) || e.summary.toLowerCase().includes(rest.toLowerCase()) || e.program.includes(rest))
          .map(({ name, outcome, summary }) => ({ name, outcome, summary })),
      };
      case "example": {
        const example = effectExamples.find(e => e.name === rest);
        return example ? { ok: true, kind: "example", ...example, diagnostics: [] }
          : { ok: false, kind: "example", diagnostics: [error("repl/unknown-example", `No example ${rest}; see :examples.`)] };
      }
      default: return { ok: false, kind: "command", diagnostics: [error("repl/unknown-command", `Unknown command :${name}. Send :help for the list.`)] };
    }
  }

  function render(result: Result, state: Session): string {
    const lines: string[] = [];
    const r = result as Record<string, any>;
    switch (r.kind) {
      case "help": lines.push(r.help); break;
      case "value": if (result.ok) lines.push(`${r.printed ?? "nil"} : ${r.type ?? "?"}`); break;
      case "type": case "infer": if (r.type) lines.push(r.type); break;
      case "effect":
        lines.push(r.kept ? `Kept. ${[...r.added.map((k: string) => `+ ${k}`), ...r.replaced.map((k: string) => `~ ${k}`)].join(", ")}` : "Not kept: the program has errors.");
        for (const c of r.contracts) lines.push(`${c.name}\n  declared ${c.declared}${c.inferred ? `\n  inferred ${c.inferred}` : ""}`);
        break;
      case "run":
        if (r.type) lines.push(`: ${r.type}`);
        for (const log of r.logs ?? []) lines.push(`log ${log}`);
        if (r.exit === "success") lines.push(`=> ${JSON.stringify(r.value)}`);
        else if (r.exit) lines.push(`${r.exit}${r.errors?.length ? ` with ${r.errors.map((e: unknown) => JSON.stringify(e)).join(", ")}` : ""}${r.defects?.length ? `\ndefect ${r.defects.join("\ndefect ")}` : ""}${r.interrupted ? " (interrupted)" : ""}`);
        break;
      case "ts": if (r.code) lines.push(r.code); break;
      case "program": case "expand": case "source": lines.push(r.source || "(empty)"); break;
      case "outline": lines.push(r.outline); break;
      case "ir": lines.push(JSON.stringify(r.ir, null, 2)); break;
      case "doc":
        lines.push(r.docs.map(renderDoc).join("\n\n"));
        if (r.related?.length) lines.push("Related:", ...r.related.map((d: any) => `  ${d.name} (${d.kind}, ${d.source}) ${firstSentence(d.summary)}`));
        break;
      case "modules":
        lines.push("Modules (import in file modules; forma:effect also in :effect):", ...r.modules.map((m: any) => `  ${m.name} [${m.exports.join(" ")}] ${m.summary}`));
        lines.push("Preludes (:load in the pure session):", ...r.preludes.map((p: any) => `  ${p.name} ${p.summary}`));
        break;
      case "examples": lines.push(...r.examples.map((e: any) => `${e.name} (${e.outcome}) ${e.summary}`)); break;
      case "example":
        lines.push(`;; ${r.name}: ${r.outcome === "runs" ? "checks, generates and runs" : "rejected by the checker"}`, r.program);
        for (const d of r.diagnostics ?? []) lines.push(`expected ${d.code} at ${d.line}:${d.column}: ${d.message}`);
        break;
      case "prelude":
        lines.push(r.changed === "rejected" ? `Prelude ${r.prelude} rejected; the session is unchanged.` : `Prelude ${r.prelude} ${r.changed}; the session was rebuilt.${r.dropped?.length ? ` Dropped: ${r.dropped.join(", ")}.` : ""}`);
        break;
      case "declarations":
        if (r.kept) for (const d of r.declarations) lines.push(`${d.form} ${JSON.stringify(d.payload)}`);
        else lines.push("Not kept: the declarations have errors.");
        break;
      case "preludes": lines.push(r.preludes.length ? r.preludes.join("\n") : "No session preludes. Define one with :prelude <name> <source>."); break;
      case "describe":
        if (r.name) {
          for (const f of r.forms) lines.push(describeForm(f));
          for (const f of r.functions) lines.push(`${f.name} : ${f.signature}${f.doc ? `\n${f.doc}` : ""}\nfrom ${f.sourceId}`);
          for (const t of r.types) lines.push(`type ${t.name} ${t.signature}${t.doc ? `\n${t.doc}` : ""}\nfrom ${t.sourceId}`);
          break;
        }
        for (const f of r.forms) {
          const typed = f.slots.filter((slot: any) => slot.type).map((slot: any) => `:${slot.name} ${slot.type}`);
          lines.push(`form (${[f.name, ...f.identifiers.map((i: any) => i.name), ...f.slots.map((slot: any) => `${slot.name}${slot.many ? "..." : ""}`)].join(" ")})${typed.length ? ` {${typed.join(" ")}}` : ""}${f.doc ? ` ; ${f.doc}` : ""}`);
        }
        for (const f of r.functions) lines.push(`${f.name} : ${f.signature}${f.doc ? ` ; ${f.doc}` : ""}`);
        for (const t of r.types) lines.push(`type ${t.name} ${t.signature}`);
        if (!r.forms.length && !r.functions.length && !r.types.length) lines.push("The session's preludes define no forms, functions or types.");
        break;
      case "reset": lines.push("Session cleared."); break;
    }
    if (r.kind !== "example" && result.diagnostics.length) lines.push(formatDiagnostics(result.diagnostics, id => state.sources.get(id)).trimEnd());
    return lines.join("\n");
  }

  async function call(args: { input: string; session?: string }): Promise<ReplReply> {
    const state = await session(args.session ?? "default");
    const input = args.input.trim();
    const sourceId = `<repl:${++state.inputs}>`;
    const match = /^:([a-z-]+)\b\s*([\s\S]*)$/u.exec(input);
    const body = match ? match[2]!.trim() : args.input;
    // Diagnostics name the text they point into, so record it before checking.
    state.sources.set(sourceId, body);
    let result: Result;
    if (match?.[1] === "more") return more(state, body);
    if (match?.[1] === "example" && body === "") result = await command(state, "examples", "", sourceId);
    else if (match) result = await command(state, match[1]!, body, sourceId);
    else if (!input) result = { ok: false, kind: "value", diagnostics: [error("repl/empty", "Send Forma code or a :command; :help lists them.")] };
    else result = await evaluate(state, sourceId, args.input);
    let reply: ReplReply = { result, text: render(result, state) };
    if (reply.text.length > PAGE_CHARS) {
      const { pages, lines } = paginate(reply.text);
      state.more = { result, pages, lines, next: 1, command: input.length > 60 ? `${input.slice(0, 57)}...` : input };
      reply = page(state.more, 0);
    }
    // A session's first reply says up front that this server cannot run programs.
    if (state.inputs !== 1 || !unavailable || result.kind === "help") return reply;
    const notice = `This server cannot run programs: :run is unavailable. ${unavailable}`;
    return { result: { ...reply.result, notice }, text: `${notice}\n\n${reply.text}` };
  }

  /** The next page of the last long result, or with `all` the rest of it and its full structured result. */
  function more(state: Session, rest: string): ReplReply {
    const pending = state.more;
    if (!pending) {
      const result: Result = { ok: false, kind: "more", diagnostics: [error("repl/no-more", "Nothing more to show: :more continues a result that came in pages.")] };
      return { result, text: render(result, state) };
    }
    if (rest === "all") {
      state.more = undefined;
      return { result: pending.result, text: pending.pages.slice(pending.next).join("\n") };
    }
    const index = pending.next++;
    if (pending.next >= pending.pages.length) state.more = undefined;
    return page(pending, index);
  }

  function snapshot(name = "default"): ReplSnapshot | undefined {
    const state = sessions.get(name);
    return state && { inputs: state.inputs, preludes: [...state.preludes], history: state.history, effect: state.effect, declarations: state.declarations };
  }

  /** Rebuild a session from a snapshot, replaying its preludes, inputs and declarations. */
  async function restore(name: string, saved: ReplSnapshot): Promise<void> {
    const state = await session(name);
    Object.assign(state, { inputs: saved.inputs, history: [...saved.history], effect: [...saved.effect], declarations: [...saved.declarations] });
    for (const form of [...saved.effect, ...saved.declarations]) state.sources.set(form.sourceId, form.cell);
    for (const input of saved.history) state.sources.set(input.sourceId, input.source);
    await rebuild(state, new Map(saved.preludes));
  }

  return { call, snapshot, restore };
}
