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
import { formatDiagnostics } from "./cli/diagnostic-text.js";

const STEP_LIMIT = 1_000_000;
const MAX_SESSIONS = 16;
const ENTRY = "__repl";
// An unknown success type leaves the body's inference unconstrained; only the first pass uses it.
const PLACEHOLDER = "(Effect __Infer)";

const helpText = (runNote: string) => `Forma REPL. Send Forma code, or one command per call.

Pure Forma (definitions persist in the session):
  <code>                 Check, then evaluate. Returns value, type and diagnostics.
  :type <expr>           Type of an expression without running it.
  :load <prelude.lisp>   Load a bundled prelude into the pure session.

Evolving the language (pure session):
  :prelude <name> <src>  Define or replace a session prelude: macros, forms, types and
                         functions. The session reloads its preludes in order and
                         replays earlier inputs; inputs that no longer check are dropped.
  :prelude [name]        List session preludes, or show one.  :unload <name>  Remove one.
  :describe              Forms, functions and types the session's preludes provide.
  <form applications>    Input made only of session prelude forms is declared, not run:
                         it elaborates to IR, is kept, and later declarations can refer
                         to it. Redeclaring a name replaces it.

Effect programs (a separate, declarations-only program in the same session):
  :effect <forms>        Add or replace declarations (type, error, service, signature,
                         define, layer, import "forma:effect"). The whole program is
                         checked; a cell with errors is not kept. Reports each
                         definition's declared and inferred type.
  :infer <expr>          Inferred type of an expression, e.g. (Effect User [NotFound] [Users.find]).
  :run <expr>            Run an effect, such as (provide (find-user "u-1") UsersLive).
                         Requirements must be provided by layers defined in the program.
  :ts                    The generated Effect TypeScript module.
  :expand <forms>        Expand forma:effect macros (do, bind, pure, service, error).
  :program               The current Effect program.

Discovery:
  :doc <name>            Docs for a macro, prelude form, definition or diagnostic code.
  :modules               Bundled modules (forma:effect, ...) and preludes.
  :source <name>         Source of a bundled module or prelude.
  :examples [filter]     Effect conformance programs; :example <name> shows one.
  :reset                 Clear this session.  :help  This text.

Pure evaluation has no host capabilities and a step limit. ${runNote}`;

/** The MCP tool definition, as plain JSON so this module needs no MCP SDK. */
export const replTool = {
  name: "repl",
  description: "Code-mode Forma REPL. Send Forma code to evaluate it in a persistent session, or a :command (start with :help). Explore Effect programs with :effect, :infer, :run, :ts and :expand; discover the language with :doc, :modules, :source and :examples.",
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
}
type Result = Record<string, unknown> & { ok: boolean; diagnostics: readonly Diagnostic[] };
export interface ReplReply { readonly result: Result; readonly text: string }

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
    const { phase: _phase, span, ...rest } = d;
    const segment = span && segments.find(s => span.startOffset >= s.at && span.startOffset <= s.at + s.form.end - s.form.start);
    if (!span || !segment) return rest;
    const shift = segment.form.start - segment.at;
    const end = Math.min(span.endOffset + shift, segment.form.end);
    return { ...rest, span: spanIn(segment.form.sourceId, segment.form.cell, span.startOffset + shift, end) };
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

/** `;; name — summary` doc blocks in bundled modules and preludes. */
function docBlocks(name: string) {
  const sources = [
    ...Object.entries(bundledModuleSources).map(([id, text]) => [`forma:${id}`, text] as const),
    ...Object.entries(preludeSources),
  ];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return sources.flatMap(([source, text]) => {
    const lines = text.split("\n");
    const start = lines.findIndex(line => new RegExp(`^;;\\s*${escaped}\\s+—`, "u").test(line));
    if (start < 0) return [];
    let end = start + 1;
    while (end < lines.length && lines[end]!.startsWith(";;")) end++;
    const definition = lines.slice(end).find(line => line.trim()) ?? "";
    return [{ source, doc: lines.slice(start, end).map(line => line.replace(/^;;\s?/u, "")).join("\n").trim(), definition: definition.trim() }];
  });
}

function sourceSummary(text: string): string {
  const purpose = text.match(/^;+\s*Purpose:\s*(.+)$/mu)?.[1];
  if (purpose) return purpose.trim();
  return text.split("\n").filter(line => line.startsWith(";")).map(line => line.replace(/^;+\s?/u, "").trim())
    .find(line => line && !/^-+$/u.test(line) && !/\.lisp$/u.test(line) && !line.startsWith("Generated")) ?? "";
}

export function createRepl(abi: JsonAbi, options: ReplOptions = {}) {
  const help = helpText(options.runNote ?? "");
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
      const start = d.span.startOffset - offset + expr.loc.start, end = d.span.endOffset - offset + expr.loc.start;
      const { span: _span, ...rest } = d;
      return start >= expr.loc.start && end <= expr.loc.end ? { ...rest, span: spanIn(sourceId, cell, start, end) } : rest;
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
    const content = ("artifacts" in emitted ? emitted.artifacts[0]?.content : undefined) as { declarations?: { formName: string; payload: unknown; span?: { startOffset: number } }[] } | undefined;
    return { ok: !hasErrors(diagnostics), diagnostics, declarations: content?.declarations ?? [] };
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
    const { value, printed, type, diagnostics } = submitted.result;
    if (!hasErrors(diagnostics)) state.history.push({ sourceId, source: input });
    return { ok: !hasErrors(diagnostics), kind: "value", value, printed: printed ?? null, type: type?.display ?? null, diagnostics };
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
        return { ok: !hasErrors(described.diagnostics), kind: "describe", ...described };
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
        if (!options.run) return { ok: false, kind: "run", type, diagnostics: [error("repl/run-unavailable", options.runUnavailable ?? "This server cannot run effects.")] };
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
        const docs: Record<string, unknown>[] = [];
        const entry = diagnosticCatalog.get(rest);
        if (entry) docs.push({ kind: "diagnostic", ...entry });
        for (const block of docBlocks(rest)) docs.push({ kind: "doc", ...block });
        const declared = state.effect.filter(f => f.key.endsWith(` ${rest}`));
        if (declared.length) docs.push({ kind: "effect-program", source: declared.map(f => f.cell.slice(f.start, f.end)).join("\n") });
        if (/^[^\s()[\]{}":;]+$/u.test(rest)) {
          const checked = await abi.host.typecheck({ sessionId: state.sessionId, source: rest });
          if (!hasErrors(checked.diagnostics)) docs.push({ kind: "type", type: checked.type?.display ?? checked.display });
        }
        return docs.length ? { ok: true, kind: "doc", name: rest, docs, diagnostics: [] }
          : { ok: false, kind: "doc", name: rest, docs, diagnostics: [error("repl/no-docs", `No docs for ${rest}. Try :modules, :source <module>, or :examples ${rest}.`)] };
      }
      case "modules": return {
        ok: true, kind: "modules", diagnostics: [],
        modules: Object.entries(bundledModuleSources).map(([id, text]) => ({ name: `forma:${id}`, exports: text.match(/^\(export ([^)]*)\)/mu)?.[1]?.split(/\s+/u) ?? [], summary: sourceSummary(text) })),
        preludes: Object.entries(preludeSources).map(([name, text]) => ({ name, summary: sourceSummary(text) })),
      };
      case "source": {
        const id = rest.replace(/^forma:/u, "");
        const text = (bundledModuleSources as Record<string, string>)[id] ?? (preludeSources as Record<string, string>)[rest] ?? (preludeSources as Record<string, string>)[`${rest}.lisp`];
        return text === undefined ? { ok: false, kind: "source", diagnostics: [error("repl/unknown-module", `No bundled module or prelude ${rest}; see :modules.`)] }
          : { ok: true, kind: "source", name: rest, source: text, diagnostics: [] };
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
      case "doc": for (const d of r.docs) lines.push(d.kind === "diagnostic" ? `${d.code}: ${d.summary}\n${d.explanation}` : d.kind === "doc" ? `${d.source}\n${d.doc}\n${d.definition}` : d.kind === "type" ? `type ${d.type}` : `in the Effect program:\n${d.source}`); break;
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
    if (match?.[1] === "example" && body === "") result = await command(state, "examples", "", sourceId);
    else if (match) result = await command(state, match[1]!, body, sourceId);
    else if (!input) result = { ok: false, kind: "value", diagnostics: [error("repl/empty", "Send Forma code or a :command; :help lists them.")] };
    else result = await evaluate(state, sourceId, args.input);
    return { result, text: render(result, state) };
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
