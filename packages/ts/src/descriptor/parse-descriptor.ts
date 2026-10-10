/**
 * Parse (__form-descriptor ...) S-expression syntax into FormDescriptor objects.
 *
 * Converts the declarative ONTOLOGY.lisp form definitions into the
 * FormDescriptor type used by the elaboration pipeline.
 *
 * @module parse-descriptor
 */

import { parseUnifiedForm } from "../surface/form.js";
import { Effect } from "effect";
import { parseManyToSExpr } from "../reader/index.js";
import type { SExpr } from "../reader/types.js";
import { ParseError } from "../reader/types.js";
import { headSym, tail, trySym } from "../reader/types.js";
import { formatSExpr } from "../Formatter.js";
import type {
  FormDescriptor,
  ChildFormShape,
  IdentifierSpec,
  SlotSpec,
  SlotMode,
  BindingStrategy,
  BindingRule,
  ValidationStrategy,
  ValidationCheck,
  ElaborationStrategy,
  ElaborationOpcode,
  ResultTypeStrategy,
  DeclarationTypeStrategy,
  ParentConstructSpec,
  ConstructSpec,
  ConstructField,
  DescriptorExtensions,
  DescriptorExtensionValue,
} from "./FormDescriptor.js";

export class FormDescriptorSyntaxError extends Error {
  constructor(
    readonly formName: string,
    readonly section: string,
    message: string,
  ) {
    super(message);
    this.name = "FormDescriptorSyntaxError";
  }
}

function validateDomainHookReference(
  formName: string,
  section: string,
  hookName: string,
  phase: "meta" | "domain",
): void {
  if (phase !== "domain") return;
  if (hookName.includes("/")) return;
  throw new FormDescriptorSyntaxError(
    formName,
    section,
    `Domain form '${formName}' must use slash hook names in '${section}', got '${hookName}'`,
  );
}

function parseParentConstructSpec(
  elaboration: string,
  options: readonly SExpr[],
): ParentConstructSpec {
  let child: string | undefined;
  for (let index = 0; index < options.length; index += 2) {
    const key = options[index] ? trySym(options[index]!) : undefined;
    const value = options[index + 1] ? trySym(options[index + 1]!) : undefined;
    if (key === ":child" && value) child = value;
  }
  return { elaboration, ...(child != null ? { child } : {}) };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a source string containing one or more (__form-descriptor ...) declarations
 * into FormDescriptor objects.
 */
export function parseFormDescriptors(
  source: string,
): Effect.Effect<FormDescriptor[], ParseError | FormDescriptorSyntaxError | Error> {
  return Effect.gen(function* () {
    const exprs = yield* parseManyToSExpr(source);
    return yield* Effect.try({
      try: () => {
        const descriptors: FormDescriptor[] = [];
        for (const expr of exprs) {
          descriptors.push(...parseFormDescriptorForms(expr));
        }
        return descriptors;
      },
      catch: (cause) =>
        cause instanceof Error ? cause : new Error("Failed to parse form descriptors"),
    });
  });
}

/**
 * Parse a single (__form-descriptor ...) S-expression into a FormDescriptor.
 * Returns undefined if the expression is not a form declaration.
 */
export function parseFormDescriptor(expr: SExpr): FormDescriptor | undefined {
  if (headSym(expr) === "form") return parseUnifiedForm(expr);
  if (headSym(expr) !== "__form-descriptor") return undefined;

  const args = tail(expr);
  if (args.length < 1) return undefined;

  const nameExpr = args[0]!;
  const name = trySym(nameExpr);
  if (!name) return undefined;

  // Defaults
  let phase: "meta" | "domain" = "domain";
  let doc: string | undefined;
  const examples: string[] = [];
  const identifiers: IdentifierSpec[] = [];
  const slots: SlotSpec[] = [];
  let bindings: BindingStrategy = { kind: "none" };
  let validation: ValidationStrategy = { kind: "none" };
  let elaboration: ElaborationStrategy = { kind: "none" };
  let resultType: ResultTypeStrategy = { kind: "none" };
  let declarationType: DeclarationTypeStrategy | undefined;
  let construct: ConstructSpec | undefined;
  let produces: string | undefined;
  let commonErrors: string[] | undefined;
  let completionShape: string | undefined;
  let formatStyle: string | undefined;
  let extensions: DescriptorExtensions | undefined;

  // Track hook overrides
  let bindingsHook: string | undefined;
  let validateHook: string | undefined;
  let constructHook: string | undefined;
  let resultTypeHook: string | undefined;
  let inferHook: string | undefined;
  let checkHook: string | undefined;
  let constructedBy: ParentConstructSpec | undefined;
  let sawStaticResultType = false;

  // Iterate keyword-headed children
  for (let i = 1; i < args.length; i++) {
    const child = args[i]!;
    const kw = headSym(child);
    if (!kw || !kw.startsWith(":")) continue;

    const childTail = tail(child);

    switch (kw) {
      case ":phase": {
        const val = childTail[0] && trySym(childTail[0]);
        if (val === "meta" || val === "domain") phase = val;
        break;
      }

      case ":doc": {
        if (childTail[0]?._tag === "Str") doc = childTail[0].value;
        break;
      }

      case ":examples": {
        for (const ex of childTail) {
          if (ex._tag === "Str") examples.push(ex.value);
        }
        break;
      }

      case ":identifier": {
        const name = childTail[0] && trySym(childTail[0]);
        if (name) identifiers.push({ name, kind: "Symbol", declaration: true });
        break;
      }

      case ":identifiers": {
        for (const idExpr of childTail) {
          const id = parseIdentifier(idExpr);
          if (id) identifiers.push(id);
        }
        break;
      }

      case ":slots": {
        for (const slotExpr of childTail) {
          const slot = parseSlot(slotExpr);
          if (slot) slots.push(slot);
        }
        break;
      }

      case ":bindings": {
        const rules = parseStaticBindings(childTail);
        if (rules.length > 0) {
          bindings = { kind: "static", rules };
        }
        break;
      }

      case ":validation": {
        const checks = parseStaticValidation(childTail);
        if (checks.length > 0) {
          validation = { kind: "static", checks };
        }
        break;
      }

      case ":bindings-fn": {
        const fn = childTail[0] && trySym(childTail[0]);
        if (fn) bindingsHook = fn;
        break;
      }

      case ":validate-fn": {
        const fn = childTail[0] && trySym(childTail[0]);
        if (fn) validateHook = fn;
        break;
      }

      case ":construct-fn": {
        const fn = childTail[0] && trySym(childTail[0]);
        if (fn) constructHook = fn;
        break;
      }

      case ":constructed-by": {
        const name = childTail[0] && trySym(childTail[0]);
        if (name) constructedBy = parseParentConstructSpec(name, childTail.slice(1));
        break;
      }

      case ":result-type-fn": {
        const fn = childTail[0] && trySym(childTail[0]);
        if (fn) resultTypeHook = fn;
        break;
      }

      case ":infer-fn": {
        const fn = childTail[0] && trySym(childTail[0]);
        if (fn) inferHook = fn;
        break;
      }

      case ":check-fn": {
        const fn = childTail[0] && trySym(childTail[0]);
        if (fn) checkHook = fn;
        break;
      }

      case ":result-type": {
        const first = childTail[0];
        const parsed = first ? parseStaticResultType(first) : undefined;
        sawStaticResultType = true;
        if (parsed) resultType = parsed;
        break;
      }

      case ":declaration-type": {
        const first = childTail[0];
        const parsed = first ? parseStaticDeclarationType(first) : undefined;
        if (parsed) declarationType = parsed;
        break;
      }

      case ":elaborates": {
        const opcodes = parseStaticElaboration(childTail);
        const checks = parseStaticValidation(childTail);
        if (opcodes.length > 0) {
          elaboration = { kind: "static", opcodes };
        }
        if (checks.length > 0) {
          validation = { kind: "static", checks };
        }
        break;
      }

      case ":construct": {
        const fields = parseConstructFields(childTail);
        if (fields.length > 0) {
          construct = { fields };
        }
        break;
      }

      case ":produces": {
        const val = childTail[0] && trySym(childTail[0]);
        if (val) produces = val;
        break;
      }

      case ":common-errors": {
        const errors = childTail
          .filter((item): item is Extract<SExpr, { _tag: "Str" }> => item._tag === "Str")
          .map((item) => item.value);
        if (errors.length > 0) commonErrors = errors;
        break;
      }

      case ":completion-shape": {
        const val = childTail[0] && trySym(childTail[0]);
        if (val) completionShape = val;
        break;
      }

      case ":format-style": {
        const val = childTail[0] && trySym(childTail[0]);
        if (val) formatStyle = val;
        break;
      }

      case ":extensions": {
        const parsed = parseExtensions(childTail);
        if (parsed) extensions = parsed;
        break;
      }

      default:
        throw new FormDescriptorSyntaxError(
          name,
          kw,
          `Unknown __form-descriptor section '${kw}' in form '${name}'`,
        );
    }
  }

  if (bindingsHook) validateDomainHookReference(name, ":bindings-fn", bindingsHook, phase);
  if (validateHook) validateDomainHookReference(name, ":validate-fn", validateHook, phase);
  if (constructHook) validateDomainHookReference(name, ":construct-fn", constructHook, phase);
  if (resultTypeHook) {
    validateDomainHookReference(name, ":result-type-fn", resultTypeHook, phase);
  }
  if (inferHook) validateDomainHookReference(name, ":infer-fn", inferHook, phase);
  if (checkHook) validateDomainHookReference(name, ":check-fn", checkHook, phase);
  // NOTE: `:elaborates` and `:construct-fn` can coexist — the opcodes run
  // during the binding/elaboration phase while the hook constructs IR.
  if (phase === "domain" && resultTypeHook && sawStaticResultType) {
    throw new FormDescriptorSyntaxError(
      name,
      ":result-type",
      `Domain form '${name}' cannot declare both ':result-type' and ':result-type-fn'`,
    );
  }

  // Hook overrides static for bindings/result type; validation can compose static checks with a hook.
  if (bindingsHook) {
    bindings =
      bindings.kind === "static"
        ? { kind: "composite", rules: bindings.rules, fn: bindingsHook }
        : { kind: "hook", fn: bindingsHook };
  }
  if (validateHook) {
    validation =
      validation.kind === "static"
        ? { kind: "composite", checks: validation.checks, fn: validateHook }
        : { kind: "hook", fn: validateHook };
  }
  if (constructHook) {
    elaboration =
      elaboration.kind === "static"
        ? { kind: "composite", opcodes: elaboration.opcodes, fn: constructHook }
        : { kind: "hook", fn: constructHook };
  }
  if (resultTypeHook) {
    resultType = { kind: "hook", fn: resultTypeHook };
  }

  const descriptor: FormDescriptor = {
    name,
    phase,
    ...(doc != null ? { doc } : {}),
    ...(examples.length > 0 ? { examples } : {}),
    identifiers,
    slots,
    bindings,
    validation,
    elaboration,
    resultType,
    ...(declarationType != null ? { declarationType } : {}),
    ...(inferHook != null ? { inferHook } : {}),
    ...(checkHook != null ? { checkHook } : {}),
    ...(constructedBy != null ? { constructedBy } : {}),
    ...(construct != null ? { construct } : {}),
    ...(produces != null ? { produces } : {}),
    ...(commonErrors != null ? { commonErrors } : {}),
    ...(completionShape != null ? { completionShape } : {}),
    ...(formatStyle != null ? { formatStyle } : {}),
    ...(extensions != null ? { extensions } : {}),
  };

  return descriptor;
}

/**
 * Parse one top-level descriptor expression. `__form-descriptor` returns one
 * descriptor; `__protocol-descriptor` lowers into synthetic protocol descriptors.
 */
export function parseFormDescriptorForms(expr: SExpr): FormDescriptor[] {
  const form = parseFormDescriptor(expr);
  if (form) return [form];
  return parseProtocolDescriptorForms(expr);
}

function parseProtocolDescriptorForms(expr: SExpr): FormDescriptor[] {
  if (headSym(expr) !== "__protocol-descriptor") return [];

  const args = tail(expr);
  const protocolName = args[0] ? trySym(args[0]) : undefined;
  if (!protocolName) return [];

  const descriptors: FormDescriptor[] = [];
  const typeNames = new Set<string>();
  const enumNames = new Set<string>();
  const objectNames = new Set<string>();
  const unionNames = new Set<string>();
  const catalogs: FormDescriptor[] = [];
  let imports: DescriptorExtensionValue = [];
  let literalSchemas: DescriptorExtensionValue = [];

  for (let i = 1; i < args.length; i++) {
    const child = args[i]!;
    const head = headSym(child);
    if (!head) continue;

    if (head.startsWith(":")) {
      switch (head) {
        case ":types":
        case ":aliases":
          for (const name of stringArrayExtension(parseExtensionArgs(tail(child)))) {
            typeNames.add(name);
          }
          break;
        case ":enums":
          for (const name of stringArrayExtension(parseExtensionArgs(tail(child)))) {
            enumNames.add(name);
          }
          break;
        case ":objects":
          for (const name of stringArrayExtension(parseExtensionArgs(tail(child)))) {
            objectNames.add(name);
          }
          break;
        case ":unions":
        case ":sums":
          for (const name of stringArrayExtension(parseExtensionArgs(tail(child)))) {
            unionNames.add(name);
          }
          break;
        case ":imports":
          imports = parseExtensionArgs(tail(child));
          break;
        case ":literals":
        case ":literal-schemas":
          literalSchemas = parseExtensionArgs(tail(child));
          break;
      }
      continue;
    }

    switch (head) {
      case "record":
      case "object": {
        const descriptor = parseProtocolObjectClause(protocolName, child);
        if (descriptor) {
          descriptors.push(descriptor);
          const raw = descriptor.extensions?.["protocol/object"];
          const name = isExtensionRecord(raw) ? stringExtension(raw["name"]) : undefined;
          if (name) objectNames.add(name);
        }
        break;
      }
      case "sum":
      case "union": {
        const descriptor = parseProtocolUnionClause(protocolName, child);
        if (descriptor) {
          descriptors.push(descriptor);
          const raw = descriptor.extensions?.["protocol/union"];
          const name = isExtensionRecord(raw) ? stringExtension(raw["name"]) : undefined;
          if (name) unionNames.add(name);
        }
        break;
      }
      case "type": {
        const descriptor = parseProtocolTypeClause(protocolName, child);
        if (descriptor) {
          descriptors.push(descriptor);
          const raw = descriptor.extensions?.["protocol/type"];
          const name = isExtensionRecord(raw) ? stringExtension(raw["name"]) : undefined;
          if (name) typeNames.add(name);
        }
        break;
      }
      case "enum": {
        const descriptor = parseProtocolEnumClause(protocolName, child);
        if (descriptor) {
          descriptors.push(descriptor);
          const raw = descriptor.extensions?.["protocol/enum"];
          const name = isExtensionRecord(raw) ? stringExtension(raw["name"]) : undefined;
          if (name) enumNames.add(name);
        }
        break;
      }
      case "catalog": {
        const descriptor = parseProtocolCatalogClause(protocolName, child);
        if (descriptor) catalogs.push(descriptor);
        break;
      }
    }
  }

  descriptors.push(
    syntheticProtocolDescriptor(`${toKebabCase(protocolName)}-protocol-module`, "protocol/module", {
      name: protocolName,
      types: [...typeNames],
      enums: [...enumNames],
      objects: [...objectNames],
      unions: [...unionNames],
      imports,
      literals: literalSchemas,
    }),
  );

  return [...descriptors, ...catalogs];
}

function parseExtensions(exprs: readonly SExpr[]): DescriptorExtensions | undefined {
  const extensions: Record<string, DescriptorExtensionValue> = {};

  for (const expr of exprs) {
    const key = normalizeExtensionKey(headSym(expr));
    if (!key) continue;
    extensions[key] = mergeExtensionValue(extensions[key], parseExtensionArgs(tail(expr)));
  }

  return Object.keys(extensions).length > 0 ? extensions : undefined;
}

function parseProtocolObjectClause(protocolName: string, expr: SExpr): FormDescriptor | undefined {
  const args = tail(expr);
  const name = args[0] ? trySym(args[0]) : undefined;
  if (!name) return undefined;
  const options = parseProtocolClauseOptions(args.slice(1));
  return syntheticProtocolDescriptor(
    `${toKebabCase(protocolName)}-${toKebabCase(name)}`,
    "protocol/object",
    {
      name,
      ...options,
    },
  );
}

function parseProtocolUnionClause(protocolName: string, expr: SExpr): FormDescriptor | undefined {
  const args = tail(expr);
  const name = args[0] ? trySym(args[0]) : undefined;
  if (!name) return undefined;
  const options = parseProtocolClauseOptions(args.slice(1));
  return syntheticProtocolDescriptor(
    `${toKebabCase(protocolName)}-${toKebabCase(name)}`,
    "protocol/union",
    {
      name,
      ...options,
    },
  );
}

function parseProtocolTypeClause(protocolName: string, expr: SExpr): FormDescriptor | undefined {
  const args = tail(expr);
  const name = args[0] ? trySym(args[0]) : undefined;
  if (!name) return undefined;
  const rest = args.slice(1);
  const options = parseProtocolClauseOptions(rest);
  if (options["type"] === undefined) {
    const inlineType = rest.find((item) => {
      const head = headSym(item);
      return !head?.startsWith(":");
    });
    if (inlineType) options["type"] = parseExtensionValue(inlineType);
  }
  return syntheticProtocolDescriptor(
    `${toKebabCase(protocolName)}-${toKebabCase(name)}`,
    "protocol/type",
    {
      name,
      ...options,
    },
  );
}

function parseProtocolEnumClause(protocolName: string, expr: SExpr): FormDescriptor | undefined {
  const args = tail(expr);
  const name = args[0] ? trySym(args[0]) : undefined;
  if (!name) return undefined;
  const rest = args.slice(1);
  const options = parseProtocolClauseOptions(rest);
  if (options["values"] === undefined && options["value"] === undefined) {
    const values = rest.flatMap((item) => {
      const head = headSym(item);
      if (head?.startsWith(":")) return [];
      const value = parseExtensionValue(item);
      return Array.isArray(value) ? value : [value];
    });
    if (values.length > 0) options["values"] = values;
  }
  return syntheticProtocolDescriptor(
    `${toKebabCase(protocolName)}-${toKebabCase(name)}`,
    "protocol/enum",
    {
      name,
      ...options,
    },
  );
}

function parseProtocolCatalogClause(protocolName: string, expr: SExpr): FormDescriptor | undefined {
  const args = tail(expr);
  const name = args[0] ? trySym(args[0]) : undefined;
  if (!name) return undefined;
  const options = parseProtocolClauseOptions(args.slice(1));
  return syntheticProtocolDescriptor(
    `${toKebabCase(protocolName)}-${toKebabCase(name)}`,
    "protocol/catalog",
    {
      name,
      ...options,
    },
  );
}

function parseProtocolClauseOptions(
  exprs: readonly SExpr[],
): Record<string, DescriptorExtensionValue> {
  const options: Record<string, DescriptorExtensionValue> = {};
  for (const expr of exprs) {
    const key = normalizeExtensionKey(headSym(expr));
    if (!key) continue;
    options[key] = mergeExtensionValue(options[key], parseExtensionArgs(tail(expr)));
  }
  return options;
}

function syntheticProtocolDescriptor(
  name: string,
  extensionKey: string,
  extensionValue: DescriptorExtensionValue,
): FormDescriptor {
  return {
    name,
    phase: "meta",
    identifiers: [],
    slots: [],
    bindings: { kind: "none" },
    validation: { kind: "none" },
    elaboration: { kind: "none" },
    resultType: { kind: "none" },
    extensions: {
      [extensionKey]: extensionValue,
    },
  };
}

function isExtensionRecord(
  value: DescriptorExtensionValue | undefined,
): value is Readonly<Record<string, DescriptorExtensionValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringExtension(value: DescriptorExtensionValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayExtension(value: DescriptorExtensionValue): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function parseExtensionArgs(args: readonly SExpr[]): DescriptorExtensionValue {
  if (args.length === 0) return null;
  if (
    args.every((arg) => {
      const head = headSym(arg);
      return head !== undefined && head.startsWith(":");
    })
  ) {
    const object: Record<string, DescriptorExtensionValue> = {};
    for (const arg of args) {
      const key = normalizeExtensionKey(headSym(arg));
      if (!key) continue;
      object[key] = mergeExtensionValue(object[key], parseExtensionArgs(tail(arg)));
    }
    return object;
  }
  if (args.length === 1) return parseExtensionValue(args[0]!);
  return args.map((arg) => parseExtensionValue(arg));
}

function parseExtensionValue(expr: SExpr): DescriptorExtensionValue {
  switch (expr._tag) {
    case "Str":
      return expr.value;
    case "Num":
      return expr.value;
    case "Bool":
      return expr.value;
    case "Sym":
      return expr.name.replace(/^:/, "");
    case "Vector":
      return expr.items.map((item) => parseExtensionValue(item));
    case "Map": {
      const object: Record<string, DescriptorExtensionValue> = {};
      for (const [key, value] of expr.pairs) {
        const normalizedKey = key._tag === "Sym" ? key.name.replace(/^:/, "") : formatSExpr(key);
        object[normalizedKey] = parseExtensionValue(value);
      }
      return object;
    }
    case "List": {
      const head = headSym(expr);
      if (head && head.startsWith(":")) {
        const object: Record<string, DescriptorExtensionValue> = {};
        const key = normalizeExtensionKey(head);
        if (key) object[key] = parseExtensionArgs(tail(expr));
        return object;
      }
      return expr.items.map((item) => parseExtensionValue(item));
    }
  }

  return null;
}

function normalizeExtensionKey(key: string | undefined): string | undefined {
  return key?.replace(/^:/, "");
}

function mergeExtensionValue(
  current: DescriptorExtensionValue | undefined,
  next: DescriptorExtensionValue,
): DescriptorExtensionValue {
  if (
    current &&
    next &&
    typeof current === "object" &&
    typeof next === "object" &&
    !Array.isArray(current) &&
    !Array.isArray(next)
  ) {
    const merged: Record<string, DescriptorExtensionValue> = {
      ...(current as Record<string, DescriptorExtensionValue>),
    };
    for (const [key, value] of Object.entries(next as Record<string, DescriptorExtensionValue>)) {
      merged[key] = mergeExtensionValue(merged[key], value);
    }
    return merged;
  }

  return next;
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Parse (identifier name Symbol (:declaration true)) into IdentifierSpec
 */
function parseIdentifier(expr: SExpr): IdentifierSpec | undefined {
  if (headSym(expr) !== "identifier") return undefined;
  const args = tail(expr);
  if (args.length < 2) return undefined;

  const name = trySym(args[0]!);
  const kindStr = trySym(args[1]!);
  if (!name || !kindStr) return undefined;

  const kind = kindStr as IdentifierSpec["kind"];
  if (kind !== "Symbol" && kind !== "String" && kind !== "Value") return undefined;

  let declaration: boolean | undefined;
  let idDoc: string | undefined;

  for (let i = 2; i < args.length; i++) {
    const child = args[i]!;
    const kw = headSym(child);
    if (!kw) continue;
    const childArgs = tail(child);

    if (kw === ":declaration" && childArgs[0]?._tag === "Bool") {
      declaration = childArgs[0].value || undefined;
    } else if (kw === ":declaration" && childArgs[0] && trySym(childArgs[0]) === "true") {
      declaration = true;
    } else if (kw === ":doc" && childArgs[0]?._tag === "Str") {
      idDoc = childArgs[0].value;
    }
  }

  return {
    name,
    kind,
    ...(declaration ? { declaration } : {}),
    ...(idDoc != null ? { doc: idDoc } : {}),
  };
}

/**
 * Parse (slot from value (:required true)) into SlotSpec
 */
function parseSlot(expr: SExpr): SlotSpec | undefined {
  if (headSym(expr) !== "slot") return undefined;
  const args = tail(expr);
  if (args.length < 2) return undefined;

  const name = trySym(args[0]!);
  const modeStr = trySym(args[1]!);
  if (!name || !modeStr) return undefined;

  const mode = modeStr as SlotMode;
  if (mode !== "value" && mode !== "expr" && mode !== "form") return undefined;

  let required: boolean | undefined;
  let many: boolean | undefined;
  let type: string | undefined;
  let typeFrom: string | undefined;
  let slotDoc: string | undefined;
  const aliases: string[] = [];
  let childFormName: string | undefined;
  const childIdentifiers: IdentifierSpec[] = [];
  const childSlots: SlotSpec[] = [];
  const positionalSlots: string[] = [];

  for (let i = 2; i < args.length; i++) {
    const child = args[i]!;
    const kw = headSym(child);
    if (!kw) continue;
    const childArgs = tail(child);

    switch (kw) {
      case ":required":
        if (childArgs[0]?._tag === "Bool") required = childArgs[0].value || undefined;
        else if (childArgs[0] && trySym(childArgs[0]) === "true") required = true;
        break;
      case ":many":
        if (childArgs[0]?._tag === "Bool") many = childArgs[0].value || undefined;
        else if (childArgs[0] && trySym(childArgs[0]) === "true") many = true;
        break;
      case ":type": {
        const t = childArgs[0] && trySym(childArgs[0]);
        if (t) type = t;
        else if (childArgs[0]?._tag === "Str") type = childArgs[0].value;
        break;
      }
      case ":type-from":
        typeFrom = childArgs[0] && trySym(childArgs[0]);
        break;
      case ":doc":
        if (childArgs[0]?._tag === "Str") slotDoc = childArgs[0].value;
        break;
      case ":alias": {
        const alias = childArgs[0] && trySym(childArgs[0]);
        if (alias) aliases.push(alias);
        break;
      }
      case ":child-form": {
        const childForm = childArgs[0] && trySym(childArgs[0]);
        if (childForm) childFormName = childForm;
        break;
      }
      case ":child-identifier": {
        const childIdentifier = parseInlineChildIdentifier(child);
        if (childIdentifier) childIdentifiers.push(childIdentifier);
        break;
      }
      case ":child-slot": {
        const childSlot = parseInlineChildSlot(child);
        if (childSlot) {
          childSlots.push(childSlot.slot);
          if (childSlot.positional) positionalSlots.push(childSlot.slot.name);
        }
        break;
      }
    }
  }

  let childShape: ChildFormShape | undefined;
  if (childFormName) {
    childShape = {
      formName: childFormName,
      identifiers: childIdentifiers,
      slots: childSlots,
      ...(positionalSlots.length > 0 ? { positionalSlots } : {}),
    };
  }

  return {
    name,
    mode,
    ...(required ? { required } : {}),
    ...(many ? { many } : {}),
    ...(type != null ? { type } : {}),
    ...(typeFrom != null ? { typeFrom } : {}),
    ...(childShape != null ? { childShape } : {}),
    ...(slotDoc != null ? { doc: slotDoc } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
  };
}

function parseInlineChildIdentifier(expr: SExpr): IdentifierSpec | undefined {
  if (headSym(expr) !== ":child-identifier") return undefined;
  const args = tail(expr);
  if (args.length < 2) return undefined;

  const name = trySym(args[0]!);
  const kindStr = trySym(args[1]!);
  if (!name || !kindStr) return undefined;

  const kind = kindStr as IdentifierSpec["kind"];
  if (kind !== "Symbol" && kind !== "String" && kind !== "Value") return undefined;

  return { name, kind };
}

function parseInlineChildSlot(
  expr: SExpr,
): { readonly slot: SlotSpec; readonly positional: boolean } | undefined {
  if (headSym(expr) !== ":child-slot") return undefined;
  const args = tail(expr);
  if (args.length < 2) return undefined;

  const name = trySym(args[0]!);
  const modeStr = trySym(args[1]!);
  if (!name || !modeStr) return undefined;

  const mode = modeStr as SlotMode;
  if (mode !== "value" && mode !== "expr" && mode !== "form") return undefined;

  let positional = false;
  let required: boolean | undefined;
  let many: boolean | undefined;
  let type: string | undefined;
  const aliases: string[] = [];

  for (let i = 2; i < args.length; i++) {
    const child = args[i]!;
    const kw = headSym(child);
    if (!kw) continue;
    const childArgs = tail(child);

    switch (kw) {
      case ":positional":
        if (childArgs[0]?._tag === "Bool") positional = childArgs[0].value;
        else if (childArgs[0] && trySym(childArgs[0]) === "true") positional = true;
        break;
      case ":required":
        if (childArgs[0]?._tag === "Bool") required = childArgs[0].value || undefined;
        else if (childArgs[0] && trySym(childArgs[0]) === "true") required = true;
        break;
      case ":many":
        if (childArgs[0]?._tag === "Bool") many = childArgs[0].value || undefined;
        else if (childArgs[0] && trySym(childArgs[0]) === "true") many = true;
        break;
      case ":type": {
        const t = childArgs[0] && trySym(childArgs[0]);
        if (t) type = t;
        else if (childArgs[0]?._tag === "Str") type = childArgs[0].value;
        break;
      }
      case ":alias": {
        const alias = childArgs[0] && trySym(childArgs[0]);
        if (alias) aliases.push(alias);
        break;
      }
    }
  }

  return {
    positional,
    slot: {
      name,
      mode,
      ...(required ? { required } : {}),
      ...(many ? { many } : {}),
      ...(type != null ? { type } : {}),
      ...(aliases.length > 0 ? { aliases } : {}),
    },
  };
}

/**
 * Parse static binding rules from (bind ...) expressions.
 *
 * Format: (bind bind-declaration-name (:identifier name) (:type EntityType))
 */
function parseStaticBindings(exprs: readonly SExpr[]): BindingRule[] {
  const rules: BindingRule[] = [];

  for (const expr of exprs) {
    if (headSym(expr) !== "bind") continue;
    const args = tail(expr);
    if (args.length < 1) continue;

    const kindStr = trySym(args[0]!);
    if (!kindStr) continue;

    // Parse the binding kind from the hyphenated name
    const kind = parseBindingKind(kindStr);
    if (!kind) continue;

    let identifier: string | undefined;
    let slot: string | undefined;
    let as: string | undefined;
    let type: string | undefined;

    for (let i = 1; i < args.length; i++) {
      const child = args[i]!;
      const kw = headSym(child);
      if (!kw) continue;
      const childArgs = tail(child);

      switch (kw) {
        case ":identifier":
          identifier = childArgs[0] && trySym(childArgs[0]);
          break;
        case ":slot":
          slot = childArgs[0] && trySym(childArgs[0]);
          break;
        case ":as":
          as = childArgs[0] && trySym(childArgs[0]);
          break;
        case ":type":
          type = childArgs[0] && trySym(childArgs[0]);
          break;
      }
    }

    rules.push({
      kind,
      ...(identifier != null ? { identifier } : {}),
      ...(slot != null ? { slot } : {}),
      ...(as != null ? { as } : {}),
      ...(type != null ? { type } : {}),
    });
  }

  return rules;
}

/**
 * Map binding kind names to BindingRule.kind values.
 */
function parseBindingKind(name: string): BindingRule["kind"] | undefined {
  const mapping: Record<string, BindingRule["kind"]> = {
    "bind-declaration-name": "declaration",
    declaration: "declaration",
    "bind-slot-declaration": "slot-declaration",
    "slot-declaration": "slot-declaration",
    "bind-slot-declaration-result": "slot-declaration-result",
    "slot-declaration-result": "slot-declaration-result",
  };
  return mapping[name];
}

function parseStaticValidation(exprs: readonly SExpr[]): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  for (const expr of exprs) {
    if (headSym(expr) !== "validate") continue;
    const args = tail(expr);
    const rawKind = args[0] && trySym(args[0]!);
    const kind = rawKind ? parseValidationKind(rawKind) : undefined;
    if (!kind) continue;

    let slot: string | undefined;
    let values: string[] | undefined;
    let collection: string | undefined;
    let defaultSlot: string | undefined;
    let listSlot: string | undefined;

    for (let i = 1; i < args.length; i++) {
      const child = args[i]!;
      const kw = headSym(child);
      if (!kw) continue;
      const childArgs = tail(child);

      switch (kw) {
        case ":slot":
          slot = childArgs[0] && trySym(childArgs[0]);
          break;
        case ":values":
          if (childArgs[0]?._tag === "Vector") {
            values = childArgs[0].items
              .map((item) => trySym(item) ?? (item._tag === "Str" ? item.value : undefined))
              .filter((item): item is string => item !== undefined);
          }
          break;
        case ":collection":
          collection =
            (childArgs[0] && trySym(childArgs[0])) ??
            (childArgs[0] ? formatSExpr(childArgs[0]) : undefined);
          break;
        case ":default-slot":
          defaultSlot = childArgs[0] && trySym(childArgs[0]);
          break;
        case ":list-slot":
          listSlot = childArgs[0] && trySym(childArgs[0]);
          break;
      }
    }

    checks.push({
      kind,
      ...(slot != null ? { slot } : {}),
      ...(values != null ? { values } : {}),
      ...(collection != null ? { collection } : {}),
      ...(defaultSlot != null ? { defaultSlot } : {}),
      ...(listSlot != null ? { listSlot } : {}),
    });
  }

  return checks;
}

function parseValidationKind(name: string): ValidationCheck["kind"] | undefined {
  const mapping: Record<string, ValidationCheck["kind"]> = {
    "validate-one-of": "one-of",
    "validate-membership": "membership",
    "validate-list-membership": "membership",
    "validate-default-in-list": "default-in-list",
    "validate-required": "required",
  };
  return mapping[name];
}

function parseStaticElaboration(exprs: readonly SExpr[]): ElaborationOpcode[] {
  const opcodes: ElaborationOpcode[] = [];

  for (const expr of exprs) {
    if (headSym(expr) !== "elaborate") continue;
    const args = tail(expr);
    const rawKind = args[0] && trySym(args[0]!);
    const kind = rawKind ? parseElaborationKind(rawKind) : undefined;
    if (!kind) continue;

    let slot: string | undefined;
    let form: string | undefined;
    let target: string | undefined;
    let declarationKind: string | undefined;
    let bindingName: string | undefined;

    for (let i = 1; i < args.length; i++) {
      const child = args[i]!;
      const kw = headSym(child);
      if (!kw) continue;
      const childArgs = tail(child);

      switch (kw) {
        case ":slot":
          slot = childArgs[0] && trySym(childArgs[0]);
          break;
        case ":form":
          form = childArgs[0] && trySym(childArgs[0]);
          break;
        case ":target":
          target = childArgs[0] && trySym(childArgs[0]);
          break;
        case ":declaration-kind":
          declarationKind = childArgs[0] && trySym(childArgs[0]);
          break;
        case ":binding-name":
          bindingName = childArgs[0] && trySym(childArgs[0]);
          break;
      }
    }

    opcodes.push({
      kind,
      ...(slot != null ? { slot } : {}),
      ...(form != null ? { form } : {}),
      ...(target != null ? { target } : {}),
      ...(declarationKind != null ? { declarationKind } : {}),
      ...(bindingName != null ? { bindingName } : {}),
    });
  }

  return opcodes;
}

function parseElaborationKind(name: string): ElaborationOpcode["kind"] | undefined {
  const mapping: Record<string, ElaborationOpcode["kind"]> = {
    "literal-string": "literal-string",
    "literal-bool": "literal-bool",
    "literal-string-list": "literal-string-list",
    "resolve-value-ref": "resolve-value-ref",
    "resolve-slot-declaration-result": "resolve-slot-declaration-result",
    children: "children",
    collect: "collect",
  };
  return mapping[name];
}

function parseStaticResultType(expr: SExpr): ResultTypeStrategy | undefined {
  const kind = headSym(expr);
  if (!kind) return undefined;

  switch (kind) {
    case "constant": {
      const typeName = tail(expr)[0] && trySym(tail(expr)[0]!);
      return typeName ? { kind: "constant", type: typeName } : undefined;
    }
    case "slot-type": {
      const slot = tail(expr)[0] && trySym(tail(expr)[0]!);
      return slot ? { kind: "slot-type", slot } : undefined;
    }
    case "declaration-result": {
      const slot = tail(expr)[0] && trySym(tail(expr)[0]!);
      return slot ? { kind: "declaration-result", slot } : undefined;
    }
    case "declaration-ref-result": {
      const slot = tail(expr)[0] && trySym(tail(expr)[0]!);
      return slot ? { kind: "declaration-ref-result", slot } : undefined;
    }
    default:
      return undefined;
  }
}

function parseStaticDeclarationType(expr: SExpr): DeclarationTypeStrategy | undefined {
  const kind = headSym(expr);
  if (!kind) return undefined;

  switch (kind) {
    case "constant": {
      const typeName = tail(expr)[0] && trySym(tail(expr)[0]!);
      return typeName ? { kind: "constant", type: typeName } : undefined;
    }
    case "row":
      return { kind: "row" };
    default:
      return undefined;
  }
}

function parseConstructFields(exprs: readonly SExpr[]): ConstructField[] {
  const fields: ConstructField[] = [];

  for (const expr of exprs) {
    if (expr._tag !== "Vector" || expr.items.length < 2) continue;

    const fieldName = trySym(expr.items[0]!);
    if (!fieldName) continue;

    let optional = false;
    if (expr.items[2]?._tag === "Map") {
      for (const [key, value] of expr.items[2].pairs) {
        if (trySym(key) === ":optional") {
          optional = value._tag === "Bool" ? value.value : trySym(value) === "true";
        }
      }
    }

    fields.push({
      name: fieldName,
      expr: formatSExpr(expr.items[1]!),
      ...(optional ? { optional } : {}),
    });
  }

  return fields;
}
