/** Prelude-defined unary RPC contracts targeting native Effect 4. */
import type { PackageableDeclaration } from "./artifact/artifact.js";
import type { Diagnostic } from "./diagnostic/diagnostic.js";
import { bootstrapPreludes } from "./Preludes.js";
import { emissionDatum, emissionSchema, emitFormTypeScript } from "./descriptor/form-emitter.js";
import { linkEffectSystem, type EffectExtension } from "./effect-system/link.js";
import { checkMechanicsDeclarations } from "./mechanics/check.js";
import { typeName } from "./mechanics/naming.js";
import { arrayItems, isRecord } from "./mechanics/types.js";

export const bootstrapRpcPreludes = () => bootstrapPreludes(["compiler.lisp", "rpc.lisp"]);

export interface RpcProgramOptions {
  readonly sourceId?: string;
}

export interface RpcProgramResult {
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
  readonly code?: string;
}

const operations = (payload: unknown) => arrayItems(isRecord(payload) ? payload["operations"] : undefined).filter(isRecord);
const fields = ["payload", "success", "error"] as const;

/** RPC groups emit native RpcGroup.make; handlers and transports stay native. */
export const rpcExtension: EffectExtension = {
  namespace: "rpc",
  prelude: "rpc.lisp",
  forms: ["rpc-group", "rpc"],
  imports: { "effect/rpc": ["Rpc", "RpcGroup"] },
  prepare: ({ declarations, report }) => {
    for (const d of declarations) if (d.formName !== "rpc-group") report(d.span, "top-level", "Place RPC operations inside an rpc-group.");
    return [];
  },
  check: ({ declarations, mechanics, exports, diagnose }) => {
    // Validate schema holes with the same checker as ordinary type forms.
    // These temporary declarations are checked, never emitted or returned.
    const schemaNames = new Set(exports);
    const schemas: PackageableDeclaration[] = [];
    for (const d of declarations) for (const operation of operations(d.payload)) for (const field of fields) {
      const value = operation[field];
      if (value == null) continue;
      let index = schemas.length;
      let name = `RpcContract${index}`;
      while (schemaNames.has(typeName(name))) name = `RpcContract${++index}`;
      schemaNames.add(typeName(name));
      const schema = emissionSchema(emissionDatum(value));
      schemas.push({ ...d, summary: { kind: "SchemaDef", name, resultType: "SchemaDef" }, payload: { kind: "SchemaDef", name, schema } });
    }
    if (!schemas.length) return;
    diagnose(checkMechanicsDeclarations([...mechanics, ...schemas]).diagnostics.map(d => ({ ...d, phase: "typecheck" as const })));
  },
  emit: (d, { prelude }) => {
    if (d.formName !== "rpc-group" || !isRecord(d.payload)) return [];
    return [{
      name: typeName(String(d.payload["name"])),
      code: emitFormTypeScript(prelude.descriptions.get(d.formName)!, d.payload, prelude.descriptions.list()),
    }];
  },
  graph: (d, _context, add) => {
    if (d.formName !== "rpc-group" || !isRecord(d.payload)) return;
    const group = String(d.payload["name"]);
    const id = add.node("rpc-group", group, d.span);
    for (const operation of operations(d.payload)) {
      const rpc = add.node("rpc", `${group}/${String(operation["name"])}`);
      add.edge(id, rpc, "contains");
      add.uses(rpc, operation["payload"]);
      add.uses(rpc, operation["success"]);
      add.uses(rpc, operation["error"], "raises");
    }
  },
};

/** Assemble a module using the prelude's emit hooks and existing mechanics checks.
 * This adds no RPC cases to mechanics and generates no handler execution kernel.
 */
export function generateRpcProgram(source: string, options: RpcProgramOptions = {}): RpcProgramResult {
  const { system: _, ...result } = linkEffectSystem(source, [rpcExtension], {
    sourceId: options.sourceId ?? "rpc.lisp", namespace: "rpc",
  });
  return result;
}
