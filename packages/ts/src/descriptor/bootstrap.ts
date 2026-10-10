import { payloadContractsFromSources, type PayloadContracts } from "../artifact/descriptor-contracts.js";
import { typeDefinition } from "../surface/type-alias.js";
/**
 * Bootstrap — load prelude sources and register form descriptors + __form-hook hooks.
 *
 * This is the entry point for bootstrapping the language from prelude files.
 * It parses descriptor preludes, extracts form descriptors and __form-hook
 * declarations, and registers them in the appropriate registries.
 *
 * @module bootstrap
 */

import { parse, toSExprMany } from "../reader/index.js";
import { head, name } from "../surface/effect.js";
import type { SExpr } from "../reader/types.js";
import { reachableHelpers } from "../surface/helpers.js";
import { patternBindings } from "../surface/members.js";
import { unifiedFormHooks } from "../surface/form.js";
import { parsePrelude, type MetaFnDecl, type MetaFnKind } from "./meta-fn-decl.js";
import { FormDescriptorRegistry } from "./FormDescriptorRegistry.js";
import { ElaborationRegistry } from "./ElaborationRegistry.js";
import { createMetaFnHook } from "./meta-fn-executor.js";
import { ElaborationDescriptorRegistry } from "./ElaborationDescriptorRegistry.js";
import { createElaborationDescriptorHook } from "./elaboration-executor.js";
import type { FormDescriptor } from "./FormDescriptor.js";
import type { HookKind } from "./ElaborationHook.js";
import type { HostedMetaBuiltinsFactory, MetaBuiltinsContext } from "./meta-builtins.js";
import type {
  ElaborationDescriptor,
  ElaborationField,
  ElaborationObjectField,
  ElaborationSource,
} from "./ElaborationDescriptor.js";

// =============================================================================
// Types
// =============================================================================

export interface BootstrappedPrelude {
  readonly sources?: readonly string[];
  readonly typingHooks?: ReadonlyMap<string, MetaFnDecl>;
  readonly payloadContracts?: PayloadContracts;
  readonly formBuiltins?: HostedMetaBuiltinsFactory;
  readonly descriptions: FormDescriptorRegistry;
  readonly elaboration: ElaborationRegistry;
  readonly elaborationDescriptors: ElaborationDescriptorRegistry;
  readonly hostedDsls: ReadonlyMap<string, BootstrappedHostedDsl>;
  readonly stats: {
    readonly compilerForms: number;
    readonly domainForms: number;
    readonly hostedDsls: number;
    readonly hostedDslForms: number;
    readonly hostedDslMetaFns: number;
    readonly metaFns: number;
    readonly elaborations: number;
  };
}

export interface HostedDsl {
  readonly name: string;
  readonly sources: readonly string[];
  readonly hostedMetaBuiltins?: HostedMetaBuiltinsFactory;
}

export interface BootstrappedHostedDsl {
  readonly name: string;
  readonly descriptors: readonly FormDescriptor[];
  readonly metaFns: readonly MetaFnDecl[];
  readonly elaborations: readonly ElaborationDescriptor[];
}

export interface BootstrapOptions {
  /** Session loading checks references after evaluation, with located diagnostics. */
  readonly checkReferences?: boolean;
  readonly additionalSources?: readonly string[];
  readonly hostedMetaBuiltins?: HostedMetaBuiltinsFactory;
  readonly hostedDsls?: readonly HostedDsl[];
}

// =============================================================================
// Bootstrap from source strings
// =============================================================================

/**
 * Bootstrap from prelude source strings.
 * Parses all sources, deduplicates meta-fns (last wins), and registers
 * all descriptors and hooks.
 *
 * @param compilerSource - descriptor compiler source (meta forms)
 * @param domainSource - domain form declarations
 * @param additionalSources - additional sources with hooks or extra declarations
 */
export function bootstrapFromSources(
  compilerSource: string,
  domainSource: string,
  ...additionalSourcesAndOptions: readonly (string | BootstrapOptions)[]
): BootstrappedPrelude {
  const { additionalSources, options } = splitBootstrapInputs(additionalSourcesAndOptions);
  const typeDefinitions = new Map<string,SExpr>();
  for (const source of [compilerSource,domainSource,...additionalSources]) for (const e of toSExprMany(parse(source).redTree)) { const definition=typeDefinition(e); if (definition) typeDefinitions.set(...definition); }
  const compiler = parsePrelude(compilerSource,typeDefinitions);
  const domain = parsePrelude(domainSource,typeDefinitions);
  const additional = additionalSources.map((s) => parsePrelude(s,typeDefinitions));
  const hostedDsls = parseHostedDsls(options.hostedDsls ?? []);

  const descriptions = new FormDescriptorRegistry();
  const elaboration = new ElaborationRegistry();
  const elaborationDescriptors = new ElaborationDescriptorRegistry();

  // Register all form descriptors
  for (const desc of compiler.forms) {
    descriptions.register(desc);
  }
  for (const desc of domain.forms) {
    descriptions.register(desc);
  }
  let additionalFormCount = 0;
  for (const a of additional) {
    for (const desc of a.forms) {
      descriptions.register(desc);
      additionalFormCount++;
    }
  }

  const allHelpers = [...compiler.helpers, ...domain.helpers, ...additional.flatMap(prelude => prelude.helpers)];
  for (const descriptor of descriptions.list()) if (descriptor.surface) {
    const spec = descriptor.surface;
    descriptions.register({...descriptor, surface: {...spec, helpers: reachableHelpers([spec.body, ...spec.options.values()], allHelpers, new Set(spec.holes.keys()))}});
  }


  // Register all __form-hook hooks (deduplicated, last wins)
  const helpers = [...compiler.helpers,...domain.helpers,...additional.flatMap(prelude=>prelude.helpers)];
  const derivedHooks: MetaFnDecl[] = [];
  for (const descriptor of descriptions.list()) {
    const strategies = [["bindings",descriptor.bindings], ["validate",descriptor.validation], ["construct",descriptor.elaboration], ["result-type",descriptor.resultType],
      ["infer",descriptor.inferHook ? {kind:"hook",fn:descriptor.inferHook} : {kind:"none"}],
      ["check",descriptor.checkHook ? {kind:"hook",fn:descriptor.checkHook} : {kind:"none"}]] as const;
    for (const [kind,strategy] of strategies) {
      if (strategy.kind !== "hook" && strategy.kind !== "composite") continue;
      const hookName = strategy.fn;
      if (!hookName) continue;
      const definition = helpers.find(expr=>expr._tag === "List" && name(expr.items[1])===hookName);
      if (definition?._tag !== "List") continue;
      const value = definition.items[2];
      const lambda = value?._tag === "List" && head(value) === "fn" ? value : undefined;
      const parameters = value?._tag === "Vector" ? value : lambda?.items[1];
      if (parameters?._tag !== "Vector" || parameters.items.length !== 1) continue;
      const parameter = parameters.items[0];
      const bodies = lambda ? lambda.items.slice(2) : definition.items.slice(3);
      const functionBody = bodies.length === 1 ? bodies[0]! : { _tag:"List" as const,loc:definition.loc,items:[{_tag:"Sym" as const,name:"do",loc:definition.loc},...bodies] };
      const body: SExpr = { _tag:"List",loc:definition.loc,items:[{_tag:"Sym",loc:definition.loc,name:"let"},{_tag:"Vector",loc:definition.loc,items:[parameter!,{_tag:"Sym",loc:definition.loc,name:"input"}]},functionBody] };
      derivedHooks.push({name:hookName,kind,inputType:"NormalizedForm",outputType:kind === "construct" ? descriptor.produces ?? "IR" : ["result-type", "infer", "check"].includes(kind) ? "Type" : kind === "validate" ? "Diagnostics" : "Bindings",capabilities:[],body,helpers:reachableHelpers([functionBody],helpers,new Set(patternBindings(parameter!)))});
    }
  }
  const allMetaFns = [
    ...derivedHooks,
    ...compiler.metaFns,
    ...domain.metaFns,
    ...additional.flatMap((a) => a.metaFns),
    ...[...hostedDsls.values()].flatMap((hostedDsl) => hostedDsl.metaFns),
  ];
  const deduped = new Map(allMetaFns.map((m) => [m.name, {...m, helpers: reachableHelpers([m.body],helpers,new Set(["input"]))}]));
  validateMetaFnDeclarations([...deduped.values()]);
  const hostedMetaBuiltins = mergeHostedMetaBuiltins(
    options.hostedMetaBuiltins,
    options.hostedDsls ?? [],
  );
  const metaBuiltinsContext: MetaBuiltinsContext = { hostedDsls };
  for (const metaFn of deduped.values()) {
    if (!isExecutableHookKind(metaFn.kind)) continue;
    elaboration.registerHook(createMetaFnHook(metaFn, hostedMetaBuiltins, metaBuiltinsContext));
  }

  const allElaborations = [
    ...compiler.elaborations,
    ...domain.elaborations,
    ...additional.flatMap((a) => a.elaborations),
    ...[...hostedDsls.values()].flatMap((hostedDsl) => hostedDsl.elaborations),
  ];
  const dedupedElaborations = new Map(allElaborations.map((item) => [item.name, item]));
  for (const descriptor of dedupedElaborations.values()) {
    elaborationDescriptors.register(descriptor);
    const hasLispFallback = elaboration.hasHook(descriptor.hook);
    if (!nativeElaborationDisabled() || !hasLispFallback) {
      elaboration.registerHook(createElaborationDescriptorHook(descriptor));
    }
  }

  for (const descriptor of descriptions.list()) for (const hook of unifiedFormHooks(descriptor,descriptions,hostedMetaBuiltins,hostedDsls)) elaboration.registerHook(hook);
  if (options.checkReferences !== false) {
    validateDescriptorReferences({ descriptions, elaboration, elaborationDescriptors });
  }

  return {
    sources: [compilerSource, domainSource, ...additionalSources],
    typingHooks: deduped,
    ...(hostedMetaBuiltins ? {formBuiltins: hostedMetaBuiltins} : {}),
    payloadContracts: payloadContractsFromSources([compilerSource, domainSource, ...additionalSources]),
    descriptions,
    elaboration,
    elaborationDescriptors,
    hostedDsls,
    stats: {
      compilerForms: compiler.forms.length,
      domainForms: domain.forms.length + additionalFormCount,
      hostedDsls: hostedDsls.size,
      hostedDslForms: [...hostedDsls.values()].reduce(
        (count, hostedDsl) => count + hostedDsl.descriptors.length,
        0,
      ),
      hostedDslMetaFns: [...hostedDsls.values()].reduce(
        (count, hostedDsl) => count + hostedDsl.metaFns.length,
        0,
      ),
      metaFns: deduped.size,
      elaborations: dedupedElaborations.size,
    },
  };
}

function validateMetaFnDeclarations(metaFns: readonly MetaFnDecl[]): void {
  for (const metaFn of metaFns) {
    if (metaFn.capabilities.length === 0) continue;
    throw new Error(
      `Meta-fn '${metaFn.name}' declares unsupported capabilities: ${metaFn.capabilities.join(", ")}`,
    );
  }
}

function isExecutableHookKind(kind: MetaFnKind): kind is HookKind {
  return (
    kind === "bindings" || kind === "validate" || kind === "construct" || kind === "result-type"
  );
}

function splitBootstrapInputs(values: readonly (string | BootstrapOptions)[]): {
  readonly additionalSources: readonly string[];
  readonly options: BootstrapOptions;
} {
  const last = values.at(-1);
  const hasOptions = typeof last === "object" && last !== null;
  const options = hasOptions ? (last as BootstrapOptions) : {};
  const positionalSources = hasOptions
    ? (values.slice(0, -1) as readonly string[])
    : (values as readonly string[]);
  return {
    additionalSources: [...positionalSources, ...(options.additionalSources ?? [])],
    options,
  };
}

function parseHostedDsls(
  hostedDsls: readonly HostedDsl[],
): ReadonlyMap<string, BootstrappedHostedDsl> {
  const registrations = new Map<string, BootstrappedHostedDsl>();

  for (const hostedDsl of hostedDsls) {
    if (registrations.has(hostedDsl.name)) {
      throw new Error(`Duplicate hosted DSL registration '${hostedDsl.name}'`);
    }

    const typeDefinitions = new Map<string, SExpr>();
    for (const source of hostedDsl.sources) for (const e of toSExprMany(parse(source).redTree)) { const definition=typeDefinition(e); if (definition) typeDefinitions.set(...definition); }
    const parsedSources = hostedDsl.sources.map((source) => parsePrelude(source, typeDefinitions));
    const allHelpers = parsedSources.flatMap(parsed => parsed.helpers);
    const descriptors = parsedSources.flatMap((parsed) => parsed.forms).map(descriptor => descriptor.surface ? {...descriptor, surface: {...descriptor.surface, helpers: reachableHelpers([descriptor.surface.body, ...descriptor.surface.options.values()], allHelpers, new Set(descriptor.surface.holes.keys()))}} : descriptor);
    const metaFns = parsedSources.flatMap((parsed) => parsed.metaFns);
    const elaborations = parsedSources.flatMap((parsed) => parsed.elaborations);
    registrations.set(hostedDsl.name, {
      name: hostedDsl.name,
      descriptors,
      metaFns,
      elaborations,
    });
  }

  return registrations;
}

function nativeElaborationDisabled(): boolean {
  return ["1", "true", "TRUE", "yes", "YES"].includes(
    (typeof process === "undefined" ? undefined : process.env["FORMA_DISABLE_NATIVE_ELABORATION"]) ?? "",
  );
}

function validateElaborationDescriptorReferences(
  descriptors: readonly ElaborationDescriptor[],
  forms: FormDescriptorRegistry,
): void {
  for (const descriptor of descriptors) {
    const form = forms.get(descriptor.form);
    if (!form) {
      throw new Error(
        `Elaboration '${descriptor.name}' references missing form '${descriptor.form}'`,
      );
    }
    if (form.elaboration.kind !== "hook" && form.elaboration.kind !== "composite") {
      throw new Error(
        `Elaboration '${descriptor.name}' references form '${descriptor.form}' without a construct hook`,
      );
    }
    if (form.elaboration.fn !== descriptor.hook) {
      throw new Error(
        `Elaboration '${descriptor.name}' targets hook '${descriptor.hook}' but form '${descriptor.form}' constructs with '${form.elaboration.fn}'`,
      );
    }
  }
}

function validateConstructedByReferences(
  forms: readonly FormDescriptor[],
  elaborations: ElaborationDescriptorRegistry,
): void {
  for (const form of forms) {
    if (!form.constructedBy) continue;

    const descriptor = elaborations.getByName(form.constructedBy.elaboration);
    if (!descriptor) {
      throw new Error(
        `Form '${form.name}' declares :constructed-by '${form.constructedBy.elaboration}', but no such elaboration is registered`,
      );
    }
    const child = form.constructedBy.child ?? form.name;
    if (!elaborationMentionsChild(descriptor, child)) {
      throw new Error(
        `Form '${form.name}' declares :constructed-by '${form.constructedBy.elaboration}', but that elaboration does not project child form '${child}'`,
      );
    }
  }
}

export function elaborationMentionsChild(descriptor: ElaborationDescriptor, childForm: string): boolean {
  return descriptor.fields.some((field) => fieldMentionsChild(field, childForm));
}

function fieldMentionsChild(field: ElaborationField, childForm: string): boolean {
  switch (field.kind) {
    case "source":
      return sourceMentionsChild(field.source, childForm);
    case "children":
      return (
        field.child === childForm ||
        field.fields.some((childField) => objectFieldMentionsChild(childField, childForm))
      );
    case "assignments":
      return field.child === childForm;
  }
}

function objectFieldMentionsChild(field: ElaborationObjectField, childForm: string): boolean {
  return sourceMentionsChild(field.source, childForm);
}

function sourceMentionsChild(source: ElaborationSource, childForm: string): boolean {
  switch (source.kind) {
    case "child":
    case "children":
      return (
        source.child === childForm ||
        source.fields.some((field) => objectFieldMentionsChild(field, childForm))
      );
    case "object":
      return source.fields.some((field) => objectFieldMentionsChild(field, childForm));
    case "format":
      return source.parts.some((part) => sourceMentionsChild(part, childForm));
    case "first":
      return source.sources.some((part) => sourceMentionsChild(part, childForm));
    case "default":
    case "ref":
    case "primitive":
      return sourceMentionsChild(source.source, childForm);
    case "when":
      return (
        sourceMentionsChild(source.condition, childForm) ||
        sourceMentionsChild(source.source, childForm)
      );
    default:
      return false;
  }
}

function mergeHostedMetaBuiltins(
  rootFactory: HostedMetaBuiltinsFactory | undefined,
  hostedDsls: readonly HostedDsl[],
): HostedMetaBuiltinsFactory | undefined {
  const hostedDslFactories = hostedDsls
    .map((hostedDsl) => hostedDsl.hostedMetaBuiltins)
    .filter((factory): factory is HostedMetaBuiltinsFactory => factory !== undefined);
  const factories = [rootFactory, ...hostedDslFactories].filter(
    (factory): factory is HostedMetaBuiltinsFactory => factory !== undefined,
  );

  if (factories.length === 0) return undefined;

  return (semanticEnv, context) =>
    Object.assign({}, ...factories.map((factory) => factory(semanticEnv, context)));
}

/** Preserve bootstrap's cross-registry invariants after deferred session checks. */
export function validateDescriptorReferences(
  prelude: Pick<BootstrappedPrelude, "descriptions" | "elaboration" | "elaborationDescriptors">,
  resolveHook?: (name: string) => boolean,
): void {
  validateDescriptorHookReferences(prelude.descriptions.list(), prelude.elaboration, resolveHook);
  validateElaborationDescriptorReferences(prelude.elaborationDescriptors.list(), prelude.descriptions);
  validateConstructedByReferences(prelude.descriptions.list(), prelude.elaborationDescriptors);
}

function validateDescriptorHookReferences(
  descriptors: readonly FormDescriptor[],
  elaboration: ElaborationRegistry,
  resolveHook?: (name: string) => boolean,
): void {
  for (const descriptor of descriptors) {
    // Meta-phase bootstrap forms still rely on transitional seed behavior.
    if (descriptor.phase !== "domain") continue;

    validateDescriptorStaticReferences(descriptor);
    validateHookReference(descriptor, "bindings", "bindings", descriptor.bindings, elaboration, resolveHook);
    validateHookReference(descriptor, "validation", "validate", descriptor.validation, elaboration, resolveHook);
    validateHookReference(
      descriptor,
      "elaboration",
      "construct",
      descriptor.elaboration,
      elaboration,
      resolveHook,
    );
    validateHookReference(
      descriptor,
      "resultType",
      "result-type",
      descriptor.resultType,
      elaboration,
      resolveHook,
    );
  }
}

function validateDescriptorStaticReferences(descriptor: FormDescriptor): void {
  const slotNames = new Set(descriptor.slots.map((slot) => slot.name));
  const identifierNames = new Set(descriptor.identifiers.map((identifier) => identifier.name));
  const fieldNames = new Set([...slotNames, ...identifierNames]);

  for (const slot of descriptor.slots) {
    if (slot.typeFrom && !slotNames.has(slot.typeFrom)) {
      throw new Error(
        `Form '${descriptor.name}' references missing type-from slot '${slot.typeFrom}'`,
      );
    }
  }

  const bindingRules =
    descriptor.bindings.kind === "static" || descriptor.bindings.kind === "composite"
      ? descriptor.bindings.rules
      : [];
  for (const rule of bindingRules) {
    if (rule.identifier && !identifierNames.has(rule.identifier)) {
      throw new Error(
        `Form '${descriptor.name}' references missing binding identifier '${rule.identifier}'`,
      );
    }
    if (rule.slot && !slotNames.has(rule.slot)) {
      throw new Error(`Form '${descriptor.name}' references missing binding slot '${rule.slot}'`);
    }
  }

  const validationChecks =
    descriptor.validation.kind === "static" || descriptor.validation.kind === "composite"
      ? descriptor.validation.checks
      : [];
  for (const check of validationChecks) {
    if (check.slot && !fieldNames.has(check.slot)) {
      throw new Error(
        `Form '${descriptor.name}' references missing validation field '${check.slot}'`,
      );
    }
    if (check.defaultSlot && !fieldNames.has(check.defaultSlot)) {
      throw new Error(
        `Form '${descriptor.name}' references missing validation field '${check.defaultSlot}'`,
      );
    }
    if (check.listSlot && !fieldNames.has(check.listSlot)) {
      throw new Error(
        `Form '${descriptor.name}' references missing validation field '${check.listSlot}'`,
      );
    }
  }

  if (descriptor.elaboration.kind === "static" || descriptor.elaboration.kind === "composite") {
    for (const opcode of descriptor.elaboration.opcodes) {
      if (opcode.slot && !fieldNames.has(opcode.slot)) {
        throw new Error(
          `Form '${descriptor.name}' references missing elaboration field '${opcode.slot}'`,
        );
      }
    }
  }

  switch (descriptor.resultType.kind) {
    case "slot-type":
    case "declaration-result":
    case "declaration-ref-result":
      if (!slotNames.has(descriptor.resultType.slot)) {
        throw new Error(
          `Form '${descriptor.name}' references missing result-type slot '${descriptor.resultType.slot}'`,
        );
      }
      break;
    default:
      break;
  }
}

function validateHookReference(
  descriptor: FormDescriptor,
  strategyName: string,
  expectedKind: HookKind,
  strategy:
    | FormDescriptor["bindings"]
    | FormDescriptor["validation"]
    | FormDescriptor["elaboration"]
    | FormDescriptor["resultType"],
  elaboration: ElaborationRegistry,
  resolveHook?: (name: string) => boolean,
): void {
  if (strategy.kind !== "hook" && strategy.kind !== "composite") return;

  const hook = elaboration.getHook(strategy.fn);
  if (!hook) {
    if (resolveHook?.(strategy.fn)) return;
    throw new Error(
      `Form '${descriptor.name}' references missing ${strategyName} hook '${strategy.fn}'`,
    );
  }

  if (hook.kind !== expectedKind) {
    throw new Error(
      `Form '${descriptor.name}' expects ${strategyName} hook '${strategy.fn}' to be kind '${expectedKind}', got '${hook.kind}'`,
    );
  }
}
