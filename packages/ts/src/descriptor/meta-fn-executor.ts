/**
 * MetaFnExecutor — converts MetaFnDecl into executable ElaborationHooks.
 *
 * Each __form-hook body is a Lisp expression evaluated at compile time using the
 * kernel evaluator with a constrained set of helper builtins.
 *
 * @module meta-fn-executor
 */

import { Effect } from "effect";
import type { MetaFnDecl, MetaFnKind } from "./meta-fn-decl.js";
import {
  ElaborationError,
  type ElaborationHook,
  type HookInput,
  type HookOutput,
  type HookKind,
  type Diagnostic,
} from "./ElaborationHook.js";
import type { KValue, BuiltinFn } from "../evaluator/types.js";
import type { Type } from "../type/types.js";
import { TCon } from "../type/types.js";
import {
  createMetaBuiltins,
  type HostedMetaBuiltinsFactory,
  type MetaBuiltinsContext,
} from "./meta-builtins.js";
import { metaType } from "./meta-types.js";
import { defaultBuiltins } from "../builtins/index.js";
import { Env } from "../Env.js";
import { evaluateExprs } from "../evaluator/eval.js";
import { SimpleNormalizedSlots, type SlotValue } from "./NormalizedSlots.js";

// =============================================================================
// HookInput → KValue conversion
// =============================================================================

/**
 * Convert a HookInput into a KMap that __form-hook bodies can access
 * via meta/* builtins.
 */
export function hookInputToKValue(input: HookInput): KValue {
  const map = new Map<string, KValue>();
  const descriptor = input.descriptor;
  map.set("formName", input.formName);

  // Convert identifiers
  const identifiers = new Map<string, KValue>();
  for (const [k, v] of input.identifiers) {
    identifiers.set(k, v);
  }
  map.set("identifiers", identifiers as unknown as KValue);

  // Convert normalized slots to a map
  const slots = new Map<string, KValue>();
  const slotValues = normalizedSlotValues(input.normalizedSlots);
  if (slotValues) {
    for (const [slotName, slotValue] of slotValues) {
      slots.set(slotName, slotValueToKValue(slotValue));
    }
  } else {
    // Fallback for non-default NormalizedSlots implementations.
    const descriptor = input.descriptor;
    for (const slotSpec of descriptor.slots) {
      const slotName = slotSpec.name;
      if (input.normalizedSlots.has(slotName)) {
        const strVal = input.normalizedSlots.getString(slotName);
        if (strVal !== undefined) {
          slots.set(slotName, strVal);
          continue;
        }
        const symVal = input.normalizedSlots.getSymbol(slotName);
        if (symVal !== undefined) {
          slots.set(slotName, symVal);
          continue;
        }
        const exprVal = input.normalizedSlots.getExpr(slotName);
        if (exprVal !== undefined) {
          slots.set(slotName, exprVal as unknown as KValue);
          continue;
        }
        const listVal = input.normalizedSlots.getStringList(slotName);
        if (listVal.length > 0) {
          slots.set(slotName, listVal as unknown as KValue);
          continue;
        }
        slots.set(slotName, null);
      }
    }
  }
  map.set("slots", slots as unknown as KValue);

  // Loc
  if (input.loc) {
    const locMap = new Map<string, KValue>();
    locMap.set("start", input.loc.start as unknown as KValue);
    locMap.set("end", input.loc.end as unknown as KValue);
    locMap.set("line", input.loc.line as unknown as KValue);
    locMap.set("col", input.loc.col as unknown as KValue);
    map.set("loc", locMap as unknown as KValue);
  } else {
    map.set("loc", null);
  }

  // Expose descriptor as a KMap for meta/descriptor
  const descMap = new Map<string, KValue>();
  descMap.set("name", descriptor.name);
  descMap.set("phase", descriptor.phase);
  if (descriptor.doc) descMap.set("doc", descriptor.doc);
  map.set("descriptor", descMap as unknown as KValue);
  map.set("descriptorRef", descriptor as unknown as KValue);

  // NormalizedForm — stored as a reference so meta/normalized-form can return it
  map.set("normalizedForm", input.normalizedSlots as unknown as KValue);

  // SemanticEnv — stored as a reference so meta/semantic-env can return it
  map.set("semanticEnv", input.semanticEnv as unknown as KValue);
  map.set("rawExpr", input.rawExpr as unknown as KValue);

  return map as unknown as KValue;
}

function normalizedSlotValues(
  normalizedSlots: HookInput["normalizedSlots"],
): ReadonlyMap<string, SlotValue> | undefined {
  if (normalizedSlots instanceof SimpleNormalizedSlots) {
    return normalizedSlots.toReadonlyMap();
  }
  if ("toReadonlyMap" in normalizedSlots && typeof normalizedSlots.toReadonlyMap === "function") {
    return normalizedSlots.toReadonlyMap() as ReadonlyMap<string, SlotValue>;
  }
  return undefined;
}

function slotValueToKValue(slotValue: SlotValue): KValue {
  switch (slotValue.kind) {
    case "string":
    case "symbol":
      return slotValue.value;
    case "string-list":
      return slotValue.value as unknown as KValue;
    case "bool":
      return slotValue.value;
    case "expr":
      return slotValue.value as unknown as KValue;
    case "children":
      return slotValue.value as unknown as KValue;
  }
}

// =============================================================================
// KValue → HookOutput conversion
// =============================================================================

function convertDiag(value: KValue): Diagnostic {
  if (value instanceof Map) {
    const m = value as ReadonlyMap<string, KValue>;
    return {
      severity: (m.get("severity") as Diagnostic["severity"]) ?? "error",
      message: (m.get("message") as string) ?? "Unknown error",
      ...(typeof m.get("code") === "string" ? {code:m.get("code") as string} : {}),
      ...(m.has("slot") ? { slot: m.get("slot") as string } : {}),
    };
  }
  return { severity: "error", message: String(value) };
}

function convertKValueToType(value: KValue): Type {
  return metaType(value) ?? TCon("Unknown");
}

export function kValueToHookOutput(kind: HookKind, value: KValue): HookOutput {
  switch (kind) {
    case "bindings": {
      const entries =
        value instanceof Map ? (value as ReadonlyMap<string, KValue>) : new Map<string, KValue>();
      // Convert KValue types to Type objects
      const typedEntries = new Map<string, Type>();
      for (const [k, v] of entries) {
        typedEntries.set(k, convertKValueToType(v));
      }
      return { kind: "bindings", bindings: { entries: typedEntries } };
    }
    case "validate": {
      const diagnostics = Array.isArray(value) ? value.map(convertDiag) : [];
      return { kind: "validate", diagnostics };
    }
    case "construct":
      return { kind: "construct", ir: value };
    case "result-type":
      return { kind: "result-type", type: convertKValueToType(value) };
  }
}

// =============================================================================
// MetaFnDecl → ElaborationHook
// =============================================================================

/**
 * Create an ElaborationHook from a MetaFnDecl.
 * The hook evaluates the __form-hook's body expression at compile time.
 */
export function createMetaFnHook(
  decl: MetaFnDecl,
  hostedMetaBuiltins?: HostedMetaBuiltinsFactory,
  metaBuiltinsContext: MetaBuiltinsContext = { hostedDsls: new Map() },
): ElaborationHook {
  const kind = executableHookKind(decl.kind);
  return {
    name: decl.name,
    kind,
    ...(decl.doc != null ? { doc: decl.doc } : {}),
    inputType: decl.inputType,
    outputType: decl.outputType,
    pure: true,
    phase: "compile" as const,
    execute: (input: HookInput): Effect.Effect<HookOutput, ElaborationError> =>
      Effect.gen(function* () {
        // Build builtins: start with standard builtins, then layer meta builtins on top
        const hostedBuiltins = hostedMetaBuiltins?.(input.semanticEnv, metaBuiltinsContext);
        const metaBuiltins = createMetaBuiltins(input.semanticEnv, {
          ...(hostedBuiltins ? { hostedBuiltins } : {}),
          hostedDsls: metaBuiltinsContext.hostedDsls,
        });
        const builtins = {
          ...defaultBuiltins,
          ...metaBuiltins,
          // Namespaced aliases for standard builtins used by prelude hooks.
          // Prelude convention: (list/map items fn) — items-first, fn-second.
          // Standard builtins: (map fn coll) — fn-first, coll-second.
          // These wrappers swap argument order for compatibility.
          "list/map": ((args, apply) =>
            defaultBuiltins["map"]!([args[1]!, args[0]!], apply)) as BuiltinFn,
          "list/flat-map": ((args, apply) =>
            defaultBuiltins["flat-map"]!([args[1]!, args[0]!], apply)) as BuiltinFn,
          "list/filter": ((args, apply) =>
            defaultBuiltins["filter"]!([args[1]!, args[0]!], apply)) as BuiltinFn,
          // (list/reduce items init fn) — items-first, init-second, fn-third
          "list/reduce": ((args, apply) =>
            defaultBuiltins["reduce"]!([args[2]!, args[1]!, args[0]!], apply)) as BuiltinFn,
        };

        // Build env with input bound
        const env = Env.empty().bind("input", hookInputToKValue(input));

        // Evaluate the body using the kernel evaluator
        const result = yield* evaluateExprs([...(decl.helpers ?? []),decl.body], {
          builtins,
          stepLimit: 10000,
          env,
        }).pipe(
          Effect.mapError((kernelErr) => {
            const origMsg = kernelErr.message ?? String(kernelErr);
            // Detect unbound variable hints
            const unboundMatch = origMsg.match(/unbound.*?['"]?(\w+\/\w+)['"]?/i);
            const hint = unboundMatch
              ? ` (hint: builtin '${unboundMatch[1]}' may not be registered in meta-builtins)`
              : "";
            return new ElaborationError({
              message: `Meta-fn '${decl.name}' (${kind}) failed: ${origMsg}${hint}`,
              hookName: decl.name,
              phase: kind,
            });
          }),
        );

        // Convert result to HookOutput
        return kValueToHookOutput(kind, result.value);
      }),
  };
}

function executableHookKind(kind: MetaFnKind): HookKind {
  switch (kind) {
    case "bindings":
    case "validate":
    case "construct":
    case "result-type":
      return kind;
    case "infer":
    case "check":
      throw new Error(`Meta-fn kind '${kind}' is not executable through ElaborationHook`);
  }
}
