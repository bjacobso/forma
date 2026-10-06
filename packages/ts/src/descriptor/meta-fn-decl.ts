import { typeDefinition } from "../surface/type-alias.js";
import { metadataDescriptor } from "../surface/metadata.js";
import { protocolModuleDescriptor } from "../surface/protocol-module.js";
/**
 * MetaFnDecl — parse (__form-hook ...) declarations from prelude sources.
 *
 * Meta-fn declarations define compile-time hooks as Lisp expressions:
 *   (__form-hook name
 *     (:kind bindings)
 *     (:input FormMetaInput)
 *     (:output BindingMap)
 *     (:doc "Computes bindings for ...")
 *     (:body (let [...] ...)))
 *
 * @module meta-fn-decl
 */

import type { SExpr } from "../reader/types.js";
import { headSym, tail, trySym } from "../reader/types.js";
import { parse, toSExprMany } from "../reader/index.js";
import type { HookKind } from "./ElaborationHook.js";
import type { FormDescriptor } from "./FormDescriptor.js";
import { typeDescriptor } from "../surface/contract.js";
import { parseUnifiedForm } from "../surface/form.js";
import { head, name } from "../surface/effect.js";
import { parseFormDescriptorForms } from "./parse-descriptor.js";
import { parseElaborationDescriptor, type ElaborationDescriptor } from "./ElaborationDescriptor.js";

// =============================================================================
// Types
// =============================================================================

export type MetaFnKind = HookKind | "infer" | "check";

export interface MetaFnDecl {
  readonly name: string;
  readonly kind: MetaFnKind;
  readonly inputType: string;
  readonly outputType: string;
  readonly capabilities: readonly string[];
  readonly doc?: string;
  readonly body: SExpr;
  readonly helpers?: readonly SExpr[];
}

export class MetaFnSyntaxError extends Error {
  constructor(
    readonly metaFnName: string,
    readonly section: string,
    message: string,
  ) {
    super(message);
    this.name = "MetaFnSyntaxError";
  }
}

// =============================================================================
// Parsing
// =============================================================================

const HOOK_KIND_MAP: Record<string, MetaFnKind> = {
  bindings: "bindings",
  validate: "validate",
  construct: "construct",
  "result-type": "result-type",
  infer: "infer",
  check: "check",
};

/**
 * Parse a single (__form-hook ...) S-expression into a MetaFnDecl.
 * Returns undefined if the expression is not a __form-hook declaration.
 */
export function parseMetaFnDecl(expr: SExpr): MetaFnDecl | undefined {
  if (headSym(expr) !== "__form-hook") return undefined;

  const args = tail(expr);
  if (args.length < 1) {
    throw new MetaFnSyntaxError("<anonymous>", ":name", "__form-hook is missing its name");
  }

  const nameExpr = args[0]!;
  const name = trySym(nameExpr);
  if (!name) {
    throw new MetaFnSyntaxError("<anonymous>", ":name", "__form-hook name must be a symbol identifier");
  }

  let kind: MetaFnKind | undefined;
  let inputType: string | undefined;
  let outputType: string | undefined;
  const capabilities: string[] = [];
  let doc: string | undefined;
  let body: SExpr | undefined;

  for (let i = 1; i < args.length; i++) {
    const child = args[i]!;
    const kw = headSym(child);
    if (!kw || !kw.startsWith(":")) continue;

    const childTail = tail(child);

    switch (kw) {
      case ":kind": {
        const val = childTail[0] && trySym(childTail[0]);
        if (val && val in HOOK_KIND_MAP) {
          kind = HOOK_KIND_MAP[val];
        } else {
          throw new MetaFnSyntaxError(
            name,
            ":kind",
            `__form-hook '${name}' has invalid hook kind '${String(val ?? "")}'`,
          );
        }
        break;
      }
      case ":input": {
        const val = childTail[0] && trySym(childTail[0]);
        if (val) inputType = val;
        break;
      }
      case ":output": {
        const val = childTail[0] && trySym(childTail[0]);
        if (val) outputType = val;
        break;
      }
      case ":capabilities": {
        for (const item of childTail) {
          const sym = trySym(item);
          if (sym) {
            capabilities.push(sym);
          }
        }
        break;
      }
      case ":doc": {
        if (childTail[0]?._tag === "Str") doc = childTail[0].value;
        break;
      }
      case ":body": {
        if (childTail[0]) body = childTail[0];
        break;
      }

      default:
        throw new MetaFnSyntaxError(
          name,
          kw,
          `Unknown __form-hook section '${kw}' in __form-hook '${name}'`,
        );
    }
  }

  if (!kind) {
    throw new MetaFnSyntaxError(
      name,
      ":kind",
      `__form-hook '${name}' is missing required section ':kind'`,
    );
  }
  if (!inputType) {
    throw new MetaFnSyntaxError(
      name,
      ":input",
      `__form-hook '${name}' is missing required section ':input'`,
    );
  }
  if (!outputType) {
    throw new MetaFnSyntaxError(
      name,
      ":output",
      `__form-hook '${name}' is missing required section ':output'`,
    );
  }
  if (!body) {
    throw new MetaFnSyntaxError(
      name,
      ":body",
      `__form-hook '${name}' is missing required section ':body'`,
    );
  }

  return {
    name,
    kind,
    inputType,
    outputType,
    capabilities,
    ...(doc != null ? { doc } : {}),
    body,
  };
}

// =============================================================================
// Prelude parsing
// =============================================================================

/**
 * Parse a prelude source string, returning both form descriptors and meta-fns.
 * Uses error-tolerant parsing since preludes may contain comments/syntax issues.
 * For duplicate __form-hook names, keeps the LAST occurrence (which has the full body).
 */
export function parsePrelude(source: string, sharedTypes?: ReadonlyMap<string,SExpr>, sharedHelpers: readonly SExpr[] = []): {
  forms: FormDescriptor[];
  metaFns: MetaFnDecl[];
  elaborations: ElaborationDescriptor[];
  helpers: readonly SExpr[];
} {
  const { redTree } = parse(source);
  const exprs = toSExprMany(redTree);

  const forms: FormDescriptor[] = [];
  const metaFnMap = new Map<string, MetaFnDecl>();
  const elaborationMap = new Map<string, ElaborationDescriptor>();

  const types = new Map(exprs.flatMap(e => {const definition=typeDefinition(e);return definition ? [definition] : [];}));
  if (sharedTypes) for (const [n,t] of sharedTypes) if (!types.has(n)) types.set(n,t);
  const helpers = [...sharedHelpers,...exprs.filter(e => head(e) === "define" || head(e) === "macro")];
  for (const expr of exprs) {
    if (head(expr) === "type" && expr._tag === "List" && name(expr.items[1]) && expr.items[2]) {
      forms.push(typeDescriptor(name(expr.items[1])!,expr.items[2]!, types)); continue;
    }
    if (head(expr) === "form") {
      const form = parseUnifiedForm(expr, types, helpers);
      if (form) forms.push(form);
      continue;
    }
    const metadata = metadataDescriptor(expr);
    if (metadata) { forms.push(metadata); continue; }
    const formDesc = parseFormDescriptorForms(expr);
    if (formDesc.length > 0) {
      forms.push(...formDesc);
      continue;
    }

    const metaFn = parseMetaFnDecl(expr);
    if (metaFn) {
      // Last wins — later declarations override earlier ones
      metaFnMap.set(metaFn.name, metaFn);
      continue;
    }

    const elaboration = parseElaborationDescriptor(expr);
    if (elaboration) {
      elaborationMap.set(elaboration.name, elaboration);
    }
  }

  const merged = new Map<string, FormDescriptor>();
  for (const descriptor of forms) {
    const previous = merged.get(descriptor.name);
    const primary = descriptor.surface ? descriptor : previous?.surface ? previous : descriptor;
    merged.set(descriptor.name, {...primary, extensions: {...previous?.extensions, ...descriptor.extensions}});
  }
  forms.splice(0, forms.length, ...merged.values());
  const module = protocolModuleDescriptor(exprs, forms);
  if (module) forms.push(module);
  return {
    forms,
    helpers,
    metaFns: [...metaFnMap.values()],
    elaborations: [...elaborationMap.values()],
  };
}
