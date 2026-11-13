/** Prelude-defined Effect Cluster entities targeting native Effect 4.
 * The prelude owns the vocabulary, delivery rules, and target templates. This
 * linker lowers each message's pure transition to an ordinary Effect function,
 * so the existing mechanics checker types it against the declared state,
 * payload, success, and errors. It adds no Cluster cases to mechanics and no
 * runtime helper: the output is Entity.make, Rpc.make, and Entity.toLayer.
 */
import type { PackageableDeclaration } from "./artifact/artifact.js";
import type { Diagnostic } from "./diagnostic/diagnostic.js";
import { bootstrapPreludes } from "./Preludes.js";
import { elaborateProgram, sourceLocator, type DeclarationSyntax, type ElaboratedDeclaration } from "./descriptor/elaborate.js";
import { emissionDatum, emitFormExpression, renderTypeScript } from "./descriptor/form-emitter.js";
import { mechanicsPackageableDeclarations } from "./mechanics/artifact.js";
import { checkMechanicsDeclarations } from "./mechanics/check.js";
import { effectProgramStrayForms } from "./mechanics/elaborate.js";
import { generateMechanicsEffectTypeScriptModule } from "./mechanics/effect-typescript.js";
import { typeName } from "./mechanics/naming.js";
import { arrayItems, isRecord } from "./mechanics/types.js";
import { parse, toSExprMany } from "./reader/index.js";
import type { SExpr } from "./reader/types.js";
import { head, list, name, normalizeEffectProgram, sym, vector } from "./surface/effect.js";

export const bootstrapClusterPreludes = () => bootstrapPreludes(["compiler.lisp", "cluster.lisp"]);

export interface ClusterProgramResult {
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
  readonly code?: string;
}

/** Names the transition binds; payload fields may not shadow them. */
const reservedFields = new Set(["state", "state-ref", "payload"]);
/** Imports the emitted wiring needs alongside the mechanics module's own. */
const targetImports = ["Effect", "Ref", "Schema", "Entity", "ClusterSchema", "Rpc"];

/** Generate a module of schemas, checked transition functions, entities, and
 * their handler layers. Process wiring (runners, storage) stays native.
 */
export function generateClusterProgram(source: string, options: { readonly sourceId?: string } = {}): ClusterProgramResult {
  const sourceId = options.sourceId ?? "cluster.lisp";
  const diagnostics: Diagnostic[] = [];
  let declarations: readonly PackageableDeclaration[] = [];
  const failed = () => diagnostics.some(d => d.severity === "error");
  const result = (code?: string): ClusterProgramResult => ({
    ok: !failed(), declarations, diagnostics, ...(code !== undefined && !failed() ? { code } : {}),
  });
  const span = sourceLocator(source, sourceId);
  const locate = (loc: SExpr["loc"]) => {
    const prefix = source.slice(0, loc.start);
    return span({ ...loc, line: prefix.split("\n").length, col: loc.start - prefix.lastIndexOf("\n") });
  };
  const report = (at: SExpr, code: string, message: string) =>
    diagnostics.push({ code: `cluster/${code}`, message, severity: "error", phase: "typecheck", span: locate(at.loc) });
  try {
    const parsed = parse(source);
    for (const error of parsed.errors) diagnostics.push({
      code: "cluster/parse", severity: "error", phase: "parse", message: error.message,
      ...(error.loc ? { span: span(error.loc) } : {}),
    });
    if (failed()) return result();
    const authored = toSExprMany(parsed.redTree);
    const prelude = bootstrapClusterPreludes();
    const projected = elaborateProgram(source, { prelude, sourceId });
    diagnostics.push(...projected.diagnostics);
    if (failed()) return result();
    for (const e of authored) if (["command", "query"].includes(head(e) ?? ""))
      report(e, "top-level", "Declare commands and queries inside an entity.");
    const entities = projected.declarations.filter(d => d.formName === "entity");
    const entityStarts = new Set(entities.map(d => d.span.startOffset));

    // Named payload records resolve through the author's own type forms.
    const types = new Map(authored.flatMap(e => head(e) === "type" && e._tag === "List" && name(e.items[1])
      ? [[name(e.items[1])!, e.items[2]!] as const] : []));
    const recordFields = (t: SExpr | undefined): readonly (readonly [string, SExpr])[] | undefined =>
      t?._tag === "Map" ? t.pairs.map(([k, v]) => [name(k)!.replace(/^:/, ""), v] as const)
      : t?._tag === "Sym" && types.has(t.name) ? recordFields(types.get(t.name)) : undefined;
    // A primary key must be a stable scalar: String or Int, possibly refined or branded.
    const keyType = (t: SExpr | undefined, seen = new Set<string>()): boolean => {
      const n = name(t) ?? head(t);
      if (n === "String" || n === "Int") return true;
      if (n === "Brand" && t?._tag === "List") return keyType(t.items[1], seen);
      return n !== undefined && types.has(n) && !seen.has(n) && keyType(types.get(n), new Set([...seen, n]));
    };

    const lowered: SExpr[] = [];
    for (const entity of entities) lowered.push(...lowerEntity(entity, { report, recordFields, keyType }));
    if (failed()) return result();

    const program = [...authored.filter(e => !entityStarts.has(e.loc.start)), ...lowered];
    const normalized = normalizeEffectProgram(program);
    for (const { expr, message } of effectProgramStrayForms(normalized)) report(expr, "top-level-form", message);
    if (failed()) return result();
    const issues = (ds: readonly { code: string; message: string; severity?: "error" | "warning"; span?: { startOffset: number; endOffset: number } }[]) => {
      for (const d of ds) diagnostics.push({
        code: d.code, message: d.message, severity: d.severity ?? "error", phase: "typecheck",
        ...(d.span ? { span: locate({ start: d.span.startOffset, end: d.span.endOffset, line: 1, col: 1 }) } : {}),
      });
    };
    const mechanics = mechanicsPackageableDeclarations(normalized, sourceId, true);
    if (!mechanics.ok) { issues(mechanics.diagnostics); return result(); }
    const checked = checkMechanicsDeclarations(mechanics.declarations);
    issues(checked.diagnostics);
    declarations = [...mechanics.declarations, ...projected.declarations];
    if (failed()) return result();

    const module = generateMechanicsEffectTypeScriptModule(mechanics.declarations, { check: checked.info }).code;
    const names = new Set([...module.matchAll(/^export (?:const|class|type) ([\w$]+)/gm)].map(m => m[1]!));
    const chunks: string[] = [];
    for (const entity of entities) {
      const exported = typeName(String((entity.payload as Record<string, unknown>)["name"]));
      const nameNode = entity.syntax.holes["name"]?.[0]?.expression ?? entity.authored;
      for (const n of [exported, `${exported}Live`]) {
        if (names.has(n) || targetImports.includes(n)) report(nameNode, "name-collision", `Generated name ${n} is already in use.`);
        names.add(n);
      }
      const emitted = emitFormExpression(prelude.descriptions.get("entity")!, emissionDatum(entity.payload), prelude.descriptions.list());
      const part = (key: string) => {
        const pair = emitted._tag === "Map" ? emitted.pairs.find(([k]) => name(k) === key) : undefined;
        if (!pair) throw new Error(`The entity emitter returned no ${key}`);
        return renderTypeScript(pair[1]);
      };
      chunks.push(`export const ${exported} = ${part(":entity")};\n\nexport const ${exported}Live = ${part(":layer")};`);
    }
    if (failed()) return result();
    const target = chunks.join("\n\n");
    // Merge the names the wiring uses into the mechanics module's effect import.
    const effectImport = /^import \{ ([^}]*) \} from "effect";$/m;
    const present = module.match(effectImport)?.[1]?.split(", ") ?? [];
    const needed = ["Effect", "Ref", "Schema"].filter(n => present.includes(n) || target.includes(`${n}.`));
    const merged = `import { ${[...new Set([...present, ...needed])].sort().join(", ")} } from "effect";`;
    const cluster = ["ClusterSchema", "Entity"].filter(n => target.includes(`${n}.`));
    const header = [merged, `import { ${cluster.join(", ")} } from "effect/cluster";`, 'import { Rpc } from "effect/rpc";'].join("\n");
    const body = effectImport.test(module) ? module.replace(effectImport, header) : `${header}\n${module}`;
    return result(`${body.trimEnd()}\n\n${target}\n`);
  } catch (error) {
    diagnostics.push({ code: "cluster/emit", severity: "error", phase: "typecheck", message: String(error) });
    return result();
  }
}

interface LowerContext {
  readonly report: (at: SExpr, code: string, message: string) => void;
  readonly recordFields: (t: SExpr | undefined) => readonly (readonly [string, SExpr])[] | undefined;
  readonly keyType: (t: SExpr | undefined) => boolean;
}

/** Lower one entity to mechanics forms located at the authored syntax:
 * its state schema, its initial constant, and one function per message.
 */
function lowerEntity(entity: ElaboratedDeclaration, { report, recordFields, keyType }: LowerContext): SExpr[] {
  const ir = entity.payload as Record<string, unknown>;
  const hole = (syntax: DeclarationSyntax, key: string) => syntax.holes[key]?.[0]?.expression;
  const at = entity.authored;
  const stateType = sym(hole(entity.syntax, "state") ?? at, String(ir["state-type"]));
  const initialName = String(ir["initial-name"]);
  const forms: SExpr[] = [
    list(at, [sym(at, "type"), stateType, hole(entity.syntax, "state")!]),
    list(at, [sym(at, ":"), sym(at, initialName), stateType]),
    list(at, [sym(at, "define"), sym(at, initialName), hole(entity.syntax, "initial")!]),
  ];
  const messages = arrayItems(ir["messages"] as never).filter(isRecord);
  (entity.syntax.holes["message"] ?? []).forEach((syntax, index) => {
    const m = messages[index]!;
    const e = syntax.expression;
    const payload = hole(syntax, "payload");
    const fields = payload ? recordFields(payload) : [];
    if (payload && !fields) {
      report(payload, "payload-record", "A message payload must be a record, written inline or as the name of a record type.");
      return;
    }
    for (const [field] of fields ?? []) if (reservedFields.has(field))
      report(payload!, "reserved-field", `A payload field cannot be named ${field}; transitions bind state, state-ref, and payload.`);
    const dedupe = hole(syntax, "dedupe-by");
    if (dedupe) {
      const key = name(dedupe)?.replace(/^:/, "");
      const field = fields?.find(([f]) => f === key);
      if (!field) report(dedupe, "dedupe-field", `The payload has no field ${key} to deduplicate by.`);
      else if (!/^[A-Za-z_$][\w$]*$/.test(key!)) report(dedupe, "dedupe-field", `Deduplicate by a field whose name is a plain identifier; ${key} is not.`);
      else if (!keyType(field[1])) report(dedupe, "dedupe-field", `Deduplicate by a String or Int field; ${key} is not one.`);
    }
    const error = hole(syntax, "error");
    const errors = !error ? [] : error._tag === "Sym" ? [error]
      : head(error) === "Union" && error._tag === "List" && error.items.slice(1).every(i => i._tag === "Sym") ? error.items.slice(1) : undefined;
    if (!errors) { report(error!, "error-type", "Name a declared error, or a (Union ...) of declared errors."); return; }

    const handler = sym(e, String(m["handler"]));
    const stateRef = sym(e, "state-ref");
    const state = sym(e, "state");
    const effect = list(e, [sym(e, "Effect"), hole(syntax, "success")!, ...(errors.length ? [vector(e, errors)] : [])]);
    const reply = hole(syntax, "reply")!;
    const update = hole(syntax, "update");
    const guard = hole(syntax, "guard");
    // Constructing through the state type checks the update's fields exactly.
    let body = update
      ? list(e, [sym(e, "let"), vector(e, [state, list(update, [stateType, update])]),
          list(e, [sym(e, "do!"), vector(e, [sym(e, "_"), list(e, [sym(e, "ref-set"), stateRef, state])]), reply])])
      : reply;
    if (guard) body = list(e, [sym(e, "if"), guard, body, list(e, [sym(e, "fail"), hole(syntax, "reject")!])]);
    if (fields?.length) body = list(e, [sym(e, "let"),
      vector(e, fields.flatMap(([f]) => [sym(e, f), list(e, [sym(e, "get"), sym(e, "payload"), sym(e, `:${f}`)])])), body]);
    body = list(e, [sym(e, "do!"), vector(e, [state, list(e, [sym(e, "ref-get"), stateRef])]), body]);
    const params = payload ? [stateRef, sym(e, "payload")] : [stateRef];
    const signature = list(e, [sym(e, "->"), list(e, [sym(e, "Ref"), stateType]), ...(payload ? [payload] : []), effect]);
    forms.push(list(e, [sym(e, ":"), handler, signature]), list(e, [sym(e, "define"), handler, vector(e, params), body]));
  });
  return forms;
}
