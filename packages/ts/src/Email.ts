/** Prelude-defined email automation rules targeting Effect 4.
 * This is an isolated TypeScript-engine prototype, not the general HM dialect.
 */
import type { PackageableDeclaration } from "./artifact/artifact.js";
import type { Diagnostic } from "./diagnostic/diagnostic.js";
import { bootstrapPreludes, preludeSource } from "./Preludes.js";
import { elaborateProgram, sourceLocator } from "./descriptor/elaborate.js";
import { emitFormTypeScript } from "./descriptor/form-emitter.js";
import { parse, toSExprMany } from "./reader/index.js";
import type { SExpr } from "./reader/types.js";
import { head, name, list, sym, normalizeEffectProgram } from "./surface/effect.js";
import { mechanicsPackageableDeclarations } from "./mechanics/artifact.js";
import { effectProgramStrayForms } from "./mechanics/elaborate.js";
import { checkMechanicsDeclarations, type CheckInfo } from "./mechanics/check.js";
import { generateMechanicsEffectTypeScriptModule } from "./mechanics/effect-typescript.js";
import { typeName } from "./mechanics/naming.js";

export const bootstrapEmailPreludes = () => bootstrapPreludes(["compiler.lisp", "email.lisp"]);

export interface EmailProgramResult {
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
  readonly check?: CheckInfo;
  readonly code?: string;
}

/** Duration suffixes read directly after a whole number, as in 6h or 2d. */
const hoursPerUnit: Readonly<Record<string, number>> = { h: 1, d: 24 };

/** Lower one rule through the mechanics IR, preserving authored locations.
 * Contacts, decisions, and predicates are ordinary definitions in email.lisp;
 * the linker adds the rule's lanes and passes its contact to predicates.
 */
export function generateEmailProgram(source: string, options: { readonly sourceId?: string } = {}): EmailProgramResult {
  const sourceId = options.sourceId ?? "rules.forma";
  const sourceSpan = sourceLocator(source, sourceId);
  const locate = (loc: SExpr["loc"]) => {
    const prefix = source.slice(0, loc.start);
    return sourceSpan({ ...loc, line: prefix.split("\n").length, col: loc.start - prefix.lastIndexOf("\n") });
  };
  const diagnostics: Diagnostic[] = [];
  let declarations: readonly PackageableDeclaration[] = [];
  let check: CheckInfo | undefined;
  const report = (e: SExpr, code: string, message: string) => {
    diagnostics.push({ code: `email/${code}`, message, severity: "error", phase: code === "parse" ? "parse" : "typecheck", span: locate(e.loc) });
  };
  const result = (code?: string): EmailProgramResult => ({
    ok: !diagnostics.some(d => d.severity === "error"), declarations, diagnostics, ...(check ? { check } : {}),
    ...(code !== undefined && !diagnostics.some(d => d.severity === "error") ? { code } : {}),
  });
  try {
    const parsed = parse(source);
    if (parsed.errors.length) {
      for (const error of parsed.errors) report({ _tag: "Sym", name: "", loc: error.loc ?? { start: 0, end: source.length, line: 1, col: 1 } }, "parse", error.message);
      return result();
    }
    const authored = toSExprMany(parsed.redTree);
    const prelude = bootstrapEmailPreludes();
    const domain = authored.filter(e => prelude.descriptions.get(head(e) ?? "")?.surface);
    // Only domain forms enter the descriptor pipeline: schemas, services, and
    // operations belong to the existing mechanics pipeline.
    let domainSource = source;
    for (const e of [...authored].reverse()) if (!domain.includes(e))
      domainSource = domainSource.slice(0, e.loc.start) + source.slice(e.loc.start, e.loc.end).replace(/[^\r\n]/g, " ") + domainSource.slice(e.loc.end);
    const projected = elaborateProgram(domainSource, { prelude, sourceId });
    diagnostics.push(...projected.diagnostics);
    declarations = projected.declarations;
    if (!projected.ok) return result();

    if (domain.length !== 1) {
      report(domain[1] ?? authored[0] ?? { _tag: "Sym", name: "", loc: { start: 0, end: 0, line: 1, col: 1 } }, "cardinality", `Expected exactly one rule; found ${domain.length}.`);
      return result();
    }
    const rule = domain[0]!;
    const [, nameNode, lanesForm, ...clauses] = rule._tag === "List" ? rule.items : [];
    const ruleName = nameNode?._tag === "Str" ? nameNode.value : "";
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(ruleName))
      report(nameNode ?? rule, "rule-name", 'Name a rule with lowercase words joined by hyphens, such as "launch-warmup-3".');

    const lanes: (readonly [SExpr, string, number])[] = [];
    if (head(lanesForm) !== "lanes" || lanesForm?._tag !== "List" || lanesForm.items.length < 2) {
      report(lanesForm ?? rule, "lanes", 'Start a rule with (lanes (lane "name" :per-hour n) ...).');
    } else for (const lane of lanesForm.items.slice(1)) {
      const parts = lane._tag === "List" ? lane.items : [];
      const [, laneName, key, rate] = parts;
      if (head(lane) !== "lane" || parts.length !== 4 || laneName?._tag !== "Str" || name(key) !== ":per-hour") {
        report(lane, "lane", 'Declare a lane as (lane "name" :per-hour n).');
      } else if (rate?._tag !== "Num" || !Number.isSafeInteger(rate.value) || rate.value < 1) {
        report(rate ?? lane, "per-hour", "A lane's :per-hour rate must be a positive whole number.");
      } else if (lanes.some(([, n]) => n === laneName.value)) {
        report(laneName, "duplicate-lane", `Lane "${laneName.value}" is declared more than once.`);
      } else lanes.push([laneName, laneName.value, rate.value]);
    }

    // Clauses apply top to bottom; the last one decides for everyone else.
    clauses.forEach((clause, i) => {
      const last = i === clauses.length - 1;
      if (head(clause) === "when") {
        if (clause._tag !== "List" || clause.items.length !== 3) report(clause, "when", "Write a condition as (when predicate decision).");
        if (last) report(clause, "fallthrough", "End a rule with a decision for every remaining contact: send, defer, or skip.");
      } else if (!last) {
        report(clauses[i + 1]!, "unreachable", "This clause never applies: the decision before it covers every remaining contact.");
      }
    });
    if (!clauses.length) report(rule, "fallthrough", "End a rule with a decision for every remaining contact: send, defer, or skip.");
    if (diagnostics.length) return result();

    // The prelude's typed definitions are the vocabulary. They are located at
    // the rule, since that is where the author asked for them. Descriptor IR
    // types describe the rule form itself and stay out of the program.
    const relocate = (e: SExpr): SExpr =>
      e._tag === "List" || e._tag === "Vector" ? { ...e, items: e.items.map(relocate), loc: rule.loc }
      : e._tag === "Map" ? { ...e, pairs: e.pairs.map(([k, v]) => [relocate(k), relocate(v)] as const), loc: rule.loc }
      : { ...e, loc: rule.loc };
    const vocabulary = toSExprMany(parse(preludeSource("email.lisp")).redTree)
      .filter(e => ["type", ":", "define"].includes(head(e) ?? "") && !/IR$/.test(name((e as { items?: SExpr[] }).items?.[1]) ?? ""))
      .map(relocate);
    const predicates = new Set(vocabulary.flatMap(e => {
      const [, n, signature] = e._tag === "List" ? e.items : [];
      const params = head(signature) === "->" && signature?._tag === "List" ? signature.items : [];
      return head(e) === ":" && name(params[1]) === "EmailContact" ? [name(n)!] : [];
    }));

    const contact = (e: SExpr) => sym(e, "contact");
    const lower = (e: SExpr): SExpr => {
      if (e._tag === "Map") return { ...e, pairs: e.pairs.map(([k, v]) => [lower(k), lower(v)] as const) };
      if (e._tag !== "List" && e._tag !== "Vector") return e;
      const items: SExpr[] = [];
      for (const item of e.items) {
        const previous = items[items.length - 1];
        const unit = name(item);
        if (previous?._tag === "Num" && previous.numericKind === "int" && unit && Object.hasOwn(hoursPerUnit, unit) && previous.loc.end === item.loc.start) {
          items[items.length - 1] = { ...previous, value: previous.value * hoursPerUnit[unit]!, loc: { ...previous.loc, end: item.loc.end } };
        } else items.push(lower(item));
      }
      if (e._tag === "List" && predicates.has(head(e) ?? "")) items.splice(1, 0, contact(e));
      return { ...e, items };
    };
    const arms = clauses.slice(0, -1).flatMap(c => c._tag === "List" ? [lower(c.items[1]!), lower(c.items[2]!)] : []);
    const fallback = lower(clauses[clauses.length - 1]!);
    const body = arms.length ? list(rule, [sym(rule, "cond"), ...arms, sym(rule, ":else"), fallback]) : fallback;
    const laneType = list(lanesForm!, [sym(lanesForm!, "type"), sym(lanesForm!, "EmailLane"),
      list(lanesForm!, [sym(lanesForm!, "Union"), ...lanes.map(([e]) => e)])]);
    const lanePerHour = [
      list(lanesForm!, [sym(lanesForm!, ":"), sym(lanesForm!, "email-lane-per-hour"),
        list(lanesForm!, [sym(lanesForm!, "->"), sym(lanesForm!, "EmailLane"), sym(lanesForm!, "Int")])]),
      list(lanesForm!, [sym(lanesForm!, "define"), sym(lanesForm!, "email-lane-per-hour"),
        { _tag: "Vector", items: [sym(lanesForm!, "lane")], loc: lanesForm!.loc },
        list(lanesForm!, [sym(lanesForm!, "match"), sym(lanesForm!, "lane"),
          ...lanes.flatMap(([e, , rate]) => [e, { _tag: "Num", numericKind: "int", value: rate, loc: e.loc } as SExpr])])]),
    ];
    const decide = [
      list(rule, [sym(rule, ":"), sym(nameNode!, ruleName),
        list(rule, [sym(rule, "->"), sym(rule, "EmailContact"), sym(rule, "EmailDecision")])]),
      list(rule, [sym(rule, "define"), sym(nameNode!, ruleName), { _tag: "Vector", items: [contact(rule)], loc: rule.loc }, body]),
    ];
    // Schemas load first; the rule leads the functions so it reads first in the output.
    const vocabularyTypes = vocabulary.filter(e => head(e) === "type");
    const lowered = [laneType, ...vocabularyTypes, ...decide, ...lanePerHour,
      ...vocabulary.filter(e => !vocabularyTypes.includes(e)), ...authored.filter(e => e !== rule)];

    const normalized = normalizeEffectProgram(lowered);
    for (const { expr, message } of effectProgramStrayForms(normalized)) report(expr, "top-level-form", message);
    if (diagnostics.length) return result();
    const issues = (ds: readonly { code: string; message: string; severity?: "error" | "warning"; span?: { startOffset: number; endOffset: number } }[]) => {
      for (const d of ds) diagnostics.push({ code: d.code, message: d.message
        .replace(`Function ${ruleName} cannot call`, `Rule ${ruleName} cannot call`)
        .replace("functions and constants have no services in scope. Give its define an Effect return signature.", "rules have no services in scope."),
        severity: d.severity ?? "error", phase: "typecheck",
        ...(d.span ? { span: locate({ start: d.span.startOffset, end: d.span.endOffset, line: 1, col: 1 }) } : {}) });
    };
    const mechanics = mechanicsPackageableDeclarations(normalized, sourceId, true);
    if (!mechanics.ok) { issues(mechanics.diagnostics); return result(); }
    const checked = checkMechanicsDeclarations(mechanics.declarations);
    issues(checked.diagnostics);
    check = checked.info;
    declarations = [...mechanics.declarations, ...projected.declarations];
    if (!checked.ok) return result();

    const module = generateMechanicsEffectTypeScriptModule(mechanics.declarations, { check: checked.info }).code;
    const exported = typeName(ruleName);
    const exports = new Set([...module.matchAll(/^export (?:const|class|type) ([\w$]+)/gm)].map(m => m[1]!));
    if (exports.has(exported)) report(nameNode!, "name-collision", `Generated name ${exported} is already in use.`);
    const ruleDeclaration = projected.declarations.find(d => d.span.startOffset === rule.loc.start)!;
    const emitted = emitFormTypeScript(prelude.descriptions.get(ruleDeclaration.formName)!, ruleDeclaration.payload, prelude.descriptions.list());
    return result(`${module.trimEnd()}\n\nexport const ${exported} = ${emitted};\n`);
  } catch (error) {
    const loc = error instanceof Error && "loc" in error ? error.loc as SExpr["loc"] : { start: 0, end: source.length, line: 1, col: 1 };
    report({ _tag: "Sym", name: "", loc }, "syntax", error instanceof Error ? error.message : String(error));
    return result();
  }
}
