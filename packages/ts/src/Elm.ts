/** Prelude-defined Elm-style apps targeting Foldkit 0.168 / Effect 4.
 * This is an isolated TypeScript-engine prototype, not the general HM dialect.
 */
import type { PackageableDeclaration } from "./artifact/artifact.js";
import type { Diagnostic } from "./diagnostic/diagnostic.js";
import { bootstrapPreludes } from "./Preludes.js";
import { elaborateProgram, sourceLocator } from "./descriptor/elaborate.js";
import { emitFormTypeScript } from "./descriptor/form-emitter.js";
import { parse, toSExprMany } from "./reader/index.js";
import type { SExpr } from "./reader/types.js";
import { head, name, list, sym, vector, normalizeEffectProgram } from "./surface/effect.js";
import { mechanicsPackageableDeclarations } from "./mechanics/artifact.js";
import { effectProgramStrayForms } from "./mechanics/elaborate.js";
import { checkMechanicsDeclarations } from "./mechanics/check.js";
import { generateMechanicsEffectTypeScriptModule } from "./mechanics/effect-typescript.js";
import { camelIdentifier, typeName } from "./mechanics/naming.js";

export const bootstrapElmPreludes = () => bootstrapPreludes(["compiler.lisp", "elm.lisp"]);

export interface ElmProgramResult {
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
  readonly code?: string;
}

/** Check authored expressions via the mechanics IR, preserving their locations.
 * Target adapter expressions come from elm.lisp's emit hooks. No Forma runtime.
 */
export function generateElmProgram(source: string, options: { readonly sourceId?: string } = {}): ElmProgramResult {
  const sourceId = options.sourceId ?? "app.forma";
  const sourceSpan = sourceLocator(source, sourceId);
  const locate = (loc: SExpr["loc"]) => {
    const prefix = source.slice(0, loc.start);
    return sourceSpan({ ...loc, line: prefix.split("\n").length, col: loc.start - prefix.lastIndexOf("\n") });
  };
  const diagnostics: Diagnostic[] = [];
  let declarations: readonly PackageableDeclaration[] = [];
  const report = (e: SExpr, code: string, message: string) => {
    diagnostics.push({ code: `elm/${code}`, message, severity: "error", phase: "typecheck", span: locate(e.loc) });
  };
  const result = (code?: string): ElmProgramResult => ({
    ok: !diagnostics.some(d => d.severity === "error"), declarations, diagnostics,
    ...(code !== undefined && !diagnostics.some(d => d.severity === "error") ? { code } : {}),
  });
  try {
    const parsed = parse(source);
    if (parsed.errors.length) {
      for (const error of parsed.errors) report({ _tag: "Sym", name: "", loc: error.loc ?? { start: 0, end: source.length, line: 1, col: 1 } }, "parse", error.message);
      return result();
    }
    const authored = toSExprMany(parsed.redTree);
    const prelude = bootstrapElmPreludes();
    const domain = authored.filter(e => prelude.descriptions.get(head(e) ?? "")?.surface);
    // Only domain forms enter the descriptor pipeline: schemas and operations
    // belong to the existing mechanics pipeline.
    let domainSource = source;
    for (const e of [...authored].reverse()) if (!domain.includes(e))
      domainSource = domainSource.slice(0, e.loc.start) + source.slice(e.loc.start, e.loc.end).replace(/[^\r\n]/g, " ") + domainSource.slice(e.loc.end);
    const projected = elaborateProgram(domainSource, { prelude, sourceId });
    diagnostics.push(...projected.diagnostics);
    declarations = projected.declarations;
    if (!projected.ok) return result();

    const one = (kind: string): SExpr | undefined => {
      const nodes = domain.filter(e => projected.declarations.some(d =>
        d.span?.startOffset === e.loc.start && typeof d.payload === "object" && d.payload !== null && "kind" in d.payload && d.payload.kind === kind));
      if (nodes.length !== 1) report(nodes[1] ?? authored[0] ?? { _tag: "Sym", name: "", loc: { start: 0, end: 0, line: 1, col: 1 } }, "cardinality", `Expected exactly one ${kind} declaration; found ${nodes.length}.`);
      return nodes[0];
    };
    const messages = one("ElmMessages"), app = one("ElmApp"), updateForm = one("ElmUpdate"), viewForm = one("ElmView");
    if (!messages || !app || !updateForm || !viewForm || diagnostics.length) return result();
    const items = (e: SExpr) => e._tag === "List" || e._tag === "Vector" ? e.items : [];
    const call = (e: SExpr, h: string, ...args: SExpr[]) => list(e, [sym(e, h), ...args]);
    const record = (e: SExpr, fields: readonly (readonly [string, SExpr])[]): SExpr => ({
      _tag: "Map", pairs: fields.map(([k, v]) => [sym(e, `:${k}`), v]), loc: e.loc,
    });
    const option = (e: SExpr, key: string) => {
      const all = items(e), i = all.findIndex(a => name(a) === `:${key}`);
      return i < 0 ? undefined : all[i + 1];
    };
    const model = option(app, "model"), initial = option(app, "init");
    if (!model || !name(model) || !initial) { report(app, "app", "app requires a named :model and :init expression."); return result(); }
    if (items(messages).length < 2) { report(messages, "messages", "msg requires at least one message variant."); return result(); }
    const msgType = call(messages, "type", sym(messages, "Msg"), call(messages, "Tagged", ...items(messages).slice(1)));
    const commandForms = domain.filter(e => head(e) === "command");
    const commandNames = commandForms.map(e => name(items(e)[1])!);
    const lowered: SExpr[] = [...authored.filter(e => !domain.includes(e)), msgType];
    const check = (forms: readonly SExpr[]) => {
      const normalized = normalizeEffectProgram(forms);
      for (const { expr, message } of effectProgramStrayForms(normalized)) report(expr, "top-level-form", message);
      if (diagnostics.some(d => d.severity === "error")) return undefined;
      const projected = mechanicsPackageableDeclarations(normalized, sourceId, true);
      const issues = (ds: readonly { code: string; message: string; severity?: "error" | "warning"; span?: { startOffset: number; endOffset: number } }[]) => {
        for (const d of ds) diagnostics.push({ code: d.code, message: d.message
          .replace(/Function elm-view-\d+/, "View expression")
          .replace(/Function elm-update/, "Update")
          .replace(/ Give its define an Effect return signature\./, "")
          .replace(/match does not handle/, d.span?.startOffset === updateForm.loc.start ? "update does not handle" : "match does not handle"), severity: d.severity ?? "error", phase: "typecheck",
          ...(d.span ? { span: locate({ start: d.span.startOffset, end: d.span.endOffset, line: 1, col: 1 }) } : {}) });
      };
      if (!projected.ok) { issues(projected.diagnostics); return undefined; }
      const checked = checkMechanicsDeclarations(projected.declarations);
      issues(checked.diagnostics);
      return { ...checked, declarations: projected.declarations };
    };
    const base = check(lowered);
    if (!base?.ok) return result();
    const requirements = new Set<string>();
    for (const c of commandForms) {
      const op = name(items(c)[2]), signature = op ? base.info.operations.get(op) : undefined;
      const ok = option(c, "ok"), errors = option(c, "error");
      if (!signature || signature.params.length) { report(items(c)[2] ?? c, "operation", "command requires a declared zero-argument Effect value."); continue; }
      if (!ok || ok._tag !== "Vector" || ok.items.length !== 2 || !name(ok.items[0])) { report(ok ?? c, "ok", ":ok requires [value-binding message-expression]."); continue; }
      if (errors && (errors._tag !== "Vector" || errors.items.length % 2)) { report(errors, "error", ":error requires [error-pattern message-expression ...]."); continue; }
      // Typed, tag-specific recovery is required. Catch-all and or-die cannot
      // silently erase failures at the app boundary.
      const patterns = errors ? items(errors).filter((_, i) => i % 2 === 0) : [];
      for (const p of patterns) if (p._tag !== "List" || p.items.length !== 2 || !name(p.items[0]) || !name(p.items[1]))
        report(p, "error-pattern", "Map each declared error with (ErrorName binding).");
      const mapped = new Set(patterns.map(p => head(p)));
      for (const error of signature.result.errors.keys()) if (!mapped.has(error))
        report(errors ?? c, "unmapped-error", `Command ${name(items(c)[1])} must map ${error} to a message.`);
      for (const r of signature.result.requirements.keys()) requirements.add(r);
      const n = `elm-command-${name(items(c)[1])}`;
      const body = call(c, "do!", vector(ok, [ok.items[0]!, sym(items(c)[2]!, op!)]), ok.items[1]!);
      const recovered = errors && items(errors).length ? call(c, "catch", body, ...items(errors)) : body;
      const eff = call(c, "Effect", sym(c, "Msg"), vector(c, []), vector(c, [...signature.result.requirements.keys()].map(r => sym(c, r))));
      lowered.push(call(c, ":", sym(c, n), eff), call(c, "define", sym(c, n), recovered));
    }
    if (diagnostics.length) return result();
    // Named command tokens keep update pure; only the Foldkit adapter creates
    // Command values, and Foldkit executes them after update returns.
    const commandType = commandNames.length
      ? call(app, "Union", ...commandNames.map(n => sym(app, `:${n}`))) : undefined;
    lowered.push(call(app, "type", sym(app, "ElmTransition"), record(app, [
      ["model", model], ...(commandType ? [["commands", call(app, "List", commandType)] as const] : []),
    ])));
    const transition = (e: SExpr): SExpr => {
      if (head(e) === "with" && e._tag === "List") {
        if (!e.items[1]) { report(e, "with", "with requires a model expression."); return e; }
        for (const token of e.items.slice(2)) if (!commandNames.includes(name(token)?.slice(1) ?? "") || !name(token)?.startsWith(":"))
          report(token, "unknown-command", "with accepts declared command names as keywords.");
        return record(e, [["model", e.items[1]], ...(commandType ? [["commands", vector(e, e.items.slice(2))] as const] : [])]);
      }
      // Every branch explicitly returns with; preserving control flow lets the
      // ordinary checker locate wrong model types and impure update calls.
      if (e._tag === "List") return list(e, e.items.map(transition));
      if (e._tag === "Vector") return vector(e, e.items.map(transition));
      if (e._tag === "Map") return { ...e, pairs: e.pairs.map(([k, v]) => [k, transition(v)] as const) };
      return e;
    };
    const define = (e: SExpr, n: string, bindings: SExpr, returns: SExpr, body: SExpr) => {
      if (bindings._tag !== "Vector" || bindings.items.some(b => !name(b))) { report(bindings, "bindings", "Expected a vector of symbol bindings."); return; }
      const params = bindings.items.length === 2 ? [model, sym(e, "Msg")] : [model];
      lowered.push(call(e, ":", sym(e, n), call(e, "->", ...params, returns)), call(e, "define", sym(e, n), bindings, body));
    };
    const u = items(updateForm), bindings = u[1];
    if (!bindings || bindings._tag !== "Vector" || bindings.items.length !== 2 || (u.length - 2) % 2) {
      report(updateForm, "update", "update requires [model message] and pattern / with-expression pairs."); return result();
    }
    for (const p of u.slice(2).filter((_, i) => i % 2 === 0)) if (name(p) === "_" || head(p) === "_")
      report(p, "update-pattern", "update requires an explicit case for each message; wildcard cases are not supported.");
    define(updateForm, "elm-update", bindings, sym(updateForm, "ElmTransition"), call(updateForm, "match", bindings.items[1]!, ...u.slice(2).map((e, i) => i % 2 ? transition(e) : e)));
    lowered.push(call(app, ":", sym(app, "elm-initial"), sym(app, "ElmTransition")), call(app, "define", sym(app, "elm-initial"), transition(initial)));

    const v = items(viewForm), viewBindings = v[1];
    if (!viewBindings || viewBindings._tag !== "Vector" || viewBindings.items.length !== 1 || !name(viewBindings.items[0]) || v[2]?._tag !== "Vector") {
      report(viewForm, "view", "view requires [model] and a Hiccup element vector."); return result();
    }
    const vocabulary = (type: string): readonly string[] => {
      const schema = prelude.descriptions.get("view")!.surface!.types.get(type);
      if (!schema || head(schema) !== "Union") throw new Error(`Missing prelude vocabulary ${type}`);
      return items(schema).slice(1).map(e => name(e)!);
    };
    const elements = vocabulary("ElmElementTag");
    const textAttributes = vocabulary("ElmTextAttribute");
    const messageAttributes = vocabulary("ElmMessageAttribute");
    let holes = 0;
    const hole = (e: SExpr, t: string) => {
      const n = `elm-view-${holes++}`;
      define(e, n, viewBindings, sym(e, t), e);
      return `${camelIdentifier(n)}(elmModel)`;
    };
    const tree = (e: SExpr): string => {
      if (e._tag !== "Vector") return hole(e, "String");
      const tag = name(e.items[0]);
      if (!elements.includes(tag ?? "")) { report(e, "element", `Prototype view elements are ${elements.join(", ")}.`); return "null"; }
      const attributes = e.items[1]?._tag === "Map" ? e.items[1] : undefined;
      const attrs: string[] = [];
      for (const [key, value] of attributes?.pairs ?? []) {
        const attribute = name(key) ?? "";
        const type = textAttributes.includes(attribute) ? "String" : messageAttributes.includes(attribute) ? "Msg" : undefined;
        if (type) attrs.push(`elmHtml.${typeName(attribute.slice(1))}(${hole(value, type)})`);
        else report(key, "attribute", `Prototype view attributes are ${[...textAttributes, ...messageAttributes].join(", ")}.`);
      }
      if (tag === ":button") attrs.push('elmHtml.Type("button")');
      return `elmHtml.${tag!.slice(1)}([${attrs.join(", ")}], [${e.items.slice(attributes ? 2 : 1).map(tree).join(", ")}])`;
    };
    const viewCode = tree(v[2]);
    if (diagnostics.length) return result();
    const checked = check(lowered);
    declarations = [...(checked?.declarations ?? []), ...projected.declarations];
    if (!checked?.ok) return result();
    const mechanics = generateMechanicsEffectTypeScriptModule(checked.declarations, { check: checked.info }).code;
    const reserved = ["Command", "Html", "HtmlBuilder", "init", "update", "view", "elmCommands", typeName(name(items(app)[1])!)];
    const exports = new Set([...mechanics.matchAll(/^export (?:const|class|type) ([\w$]+)/gm)].map(m => m[1]!));
    for (const n of reserved) if (exports.has(n)) report(app, "name-collision", `Generated name ${n} is already in use.`);
    const tsRequirements = [...requirements].map(r => r === "Scope" ? "Scope.Scope" : typeName(r.split(".")[0]!));
    const r = [...new Set(tsRequirements)].join(" | ") || "never";
    const emitted = commandForms.map(c => {
      const d = projected.declarations.find(d => d.span.startOffset === c.loc.start)!;
      const n = `elm${typeName(name(items(c)[1])!)}`;
      if (exports.has(n) || reserved.includes(n)) report(c, "name-collision", `Generated name ${n} is already in use.`);
      exports.add(n);
      return `const ${n} = ${emitFormTypeScript(prelude.descriptions.get(d.formName)!, d.payload, prelude.descriptions.list())};`;
    });
    const appDeclaration = projected.declarations.find(d => d.span.startOffset === app.loc.start)!;
    const code = [
      mechanics.trimEnd(),
      'import * as Command from "foldkit/command";',
      'import type { Html, HtmlBuilder } from "foldkit/html";', "",
      ...emitted, "",
      ...(commandNames.length ? [
        `const elmCommands = (names: ElmTransition["commands"]): ReadonlyArray<Command.Command<Msg, never, ${r}>> => names.map(name => {`,
        "  switch (name) {",
        ...commandNames.map(n => `    case ${JSON.stringify(n)}: return elm${typeName(n)}();`),
        '    default: throw new Error("Invalid checked command name");',
        "  }", "});",
      ] : [`const elmCommands = (): ReadonlyArray<Command.Command<Msg>> => [];`]), "",
      `export const init = () => ({ model: elmInitial.model, commands: elmCommands(${commandNames.length ? "elmInitial.commands" : ""}) });`,
      `export const update = (model: ${typeName(name(model)!)}, message: Msg) => {`,
      "  const next = elmUpdate(model, message);",
      `  return { model: next.model, commands: elmCommands(${commandNames.length ? "next.commands" : ""}) };`, "};", "",
      `export const view = (${holes ? "elmModel" : "_elmModel"}: ${typeName(name(model)!)}, elmHtml: HtmlBuilder<Msg>): Html => ${viewCode};`, "",
      `export const ${typeName(name(items(app)[1])!)} = ${emitFormTypeScript(prelude.descriptions.get(appDeclaration.formName)!, appDeclaration.payload, prelude.descriptions.list())};`, "",
    ].join("\n");
    return result(code);
  } catch (error) {
    const loc = error instanceof Error && "loc" in error ? error.loc as SExpr["loc"] : { start: 0, end: source.length, line: 1, col: 1 };
    report({ _tag: "Sym", name: "", loc }, "syntax", error instanceof Error ? error.message : String(error));
    return result();
  }
}
