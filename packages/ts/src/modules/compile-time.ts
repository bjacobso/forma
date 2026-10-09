import { Effect } from "effect";
import { Env } from "../Env.js";
import { defaultBuiltins } from "../Builtins.js";
import { evaluateCompileTimeExprs } from "../evaluator/eval.js";
import { expandKernelExprsSync } from "../evaluator/frontend.js";
import {
  isKFn,
  isKMacro,
  isKSymbol,
  isKKeyword,
  mapKeyValue,
  KSymbol,
  type KValue,
} from "../evaluator/types.js";
import { normalizeCoreProgram } from "../surface/core.js";
import { datum } from "../surface/datum.js";
import { head, name } from "../surface/effect.js";
import {
  matchFormSyntax,
  normalizeUnifiedForm,
  parseUnifiedForm,
  unifiedFormHooks,
} from "../surface/form.js";
import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import { SimpleSemanticEnvironment } from "../descriptor/SemanticEnvironment.js";
import { FormDescriptorRegistry } from "../descriptor/FormDescriptorRegistry.js";
import type { Span } from "../diagnostic/diagnostic.js";
import type { SExpr } from "../reader/types.js";
import type { DSLTypeProvider } from "../type/dsl-provider.js";
import { mono, TCon } from "../type/types.js";
import {
  ModuleError,
  type BindingIdentity,
  type ModuleBinding,
  type ModuleTypeSyntax,
  type ModuleTypeScheme,
  type ResolvedModule,
} from "./graph.js";

export type ModuleDataValue =
  | null
  | boolean
  | number
  | string
  | readonly ModuleDataValue[]
  | { readonly symbol: string }
  | { readonly keyword: string }
  | {
      readonly record: readonly (readonly [ModuleDataValue, ModuleDataValue])[];
    };
export interface ModuleDataOrigin {
  readonly path: string;
  readonly identity: BindingIdentity;
  readonly span: Span;
}
export interface ModuleData {
  readonly value: ModuleDataValue;
  readonly provenance: readonly ModuleDataOrigin[];
  readonly scheme?: ModuleTypeScheme;
  readonly contract?: ModuleTypeSyntax;
}
export interface ModuleFormMetadata {
  readonly pattern: ModuleTypeSyntax;
  readonly holes: ModuleTypeSyntax;
  readonly options: ModuleTypeSyntax;
  readonly projection: ModuleTypeSyntax;
  readonly dependencies: readonly string[];
  readonly doc?: string;
  readonly completionShape?: string;
}
export interface LinkedModuleForm {
  readonly identity: BindingIdentity;
  readonly descriptor: FormDescriptor;
  readonly owner: ModuleCompileTime;
}
export interface ModuleCompileTime {
  readonly forms: ReadonlyMap<string, LinkedModuleForm>;
  readonly types: ReadonlyMap<string, SExpr>;
  readonly semantic: SimpleSemanticEnvironment;
  readonly origins: ReadonlyMap<string, readonly ModuleDataOrigin[]>;
  readonly environment: () => Env;
  readonly read: (symbol: string) => KValue;
  readonly run: (
    expression: SExpr,
    environment?: Env,
    builtins?: Record<string, import("../evaluator/types.js").BuiltinFn>,
  ) => KValue;
  readonly expand: (expressions: readonly SExpr[]) => readonly SExpr[];
}
const spanOf = (e: SExpr): Span => ({
  sourceId: e.loc.sourceId ?? "",
  startOffset: e.loc.start,
  endOffset: e.loc.end,
});
export function moduleTypeSyntax(e: SExpr): ModuleTypeSyntax {
  if (e._tag === "Sym") return e.name === "nil" ? null : e.name;
  if (e._tag === "Str" || e._tag === "Num" || e._tag === "Bool") return e.value;
  if (e._tag === "Map")
    return {
      fields: e.pairs.map(
        ([k, v]) => [moduleTypeSyntax(k), moduleTypeSyntax(v)] as const,
      ),
    };
  if (e._tag === "Error") return e.message;
  return e.items.map(moduleTypeSyntax);
}
export function moduleDataValue(value: KValue): ModuleDataValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (isKSymbol(value)) return { symbol: value.name };
  if (isKKeyword(value)) return { keyword: value.name };
  if (Array.isArray(value)) return value.map(moduleDataValue);
  if (value instanceof Map)
    return {
      record: [...value].map(
        ([key, v]) =>
          [moduleDataValue(mapKeyValue(key)), moduleDataValue(v)] as const,
      ),
    };
  throw new Error("Value is not inspectable pure data.");
}
const unwrap = (e: SExpr): SExpr =>
  head(e) === "Option" && e._tag === "List" ? e.items[1]! : e;
export function isSyntaxHole(type: SExpr): boolean {
  type = unwrap(type);
  return (
    ["Declares", "Refers", "Expr"].includes(head(type) ?? "") ||
    ["Symbol", "Type", "Syntax", "RuntimeExpr"].includes(name(type) ?? "") ||
    (head(type) === "List" &&
      type._tag === "List" &&
      isSyntaxHole(type.items[1]!))
  );
}
function localForms(expressions: readonly SExpr[]): readonly FormDescriptor[] {
  const types = new Map(
    expressions.flatMap((e) =>
      head(e) === "type" && e._tag === "List" && name(e.items[1]) && e.items[2]
        ? [[name(e.items[1])!, e.items[2]] as const]
        : [],
    ),
  );
  return expressions.flatMap((e) =>
    head(e) === "form" ? [parseUnifiedForm(e, types)!] : [],
  );
}
export function discoverFormDeclarations(
  expressions: readonly SExpr[],
  bindings: ReadonlyMap<string, ModuleBinding>,
  imports: ReadonlyMap<string, ModuleBinding>,
  namespaces: ReadonlyMap<string, ResolvedModule>,
  ownerOf: (identity: BindingIdentity) => ResolvedModule | undefined,
) {
  const forms = new Map(
    localForms(expressions).map((d) => [
      d.name,
      { descriptor: d, identity: bindings.get(d.name)!.identity },
    ]),
  );
  for (const binding of imports.values()) {
    if (binding.kind === "macro") {
      const owner = ownerOf(binding.identity);
      for (const [symbol, form] of owner?.compileTime?.forms ?? [])
        forms.set(symbol, {
          descriptor: form.descriptor,
          identity: form.identity,
        });
    }
    if (binding.kind !== "form") continue;
    const owner = ownerOf(binding.identity);
    const descriptor = owner?.compileTime?.forms.get(
      binding.symbol,
    )?.descriptor;
    if (descriptor)
      forms.set(binding.name, { descriptor, identity: binding.identity });
  }
  for (const [alias, module] of namespaces)
    for (const binding of module.interface.exports) {
      const descriptor = module.compileTime?.forms.get(
        binding.symbol,
      )?.descriptor;
      if (descriptor)
        forms.set(`${alias}/${binding.name}`, {
          descriptor,
          identity: binding.identity,
        });
    }
  return expressions.flatMap((e) => {
    const form = forms.get(head(e) ?? "");
    if (!form?.descriptor.surface) return [];
    const holes = matchFormSyntax(form.descriptor.surface, e);
    return [...form.descriptor.surface.holes].flatMap(([hole, type]) => {
      type = unwrap(type);
      const node = holes.get(hole);
      return head(type) === "Declares" &&
        type._tag === "List" &&
        node?._tag === "Sym"
        ? [
            {
              name: node.name,
              node,
              classification: name(type.items[1])!,
              form: form.identity,
            },
          ]
        : [];
    });
  });
}

/** Per-module lexical closures and demand-driven pure data; no ambient artifact index. */
export function prepareCompileTimeModule(
  module: ResolvedModule,
  ownerOf: (identity: BindingIdentity) => ResolvedModule | undefined,
): ResolvedModule {
  const forms = new Map<string, LinkedModuleForm>(),
    types = new Map<string, SExpr>(),
    origins = new Map<string, readonly ModuleDataOrigin[]>();
  const semantic = new SimpleSemanticEnvironment();
  const visible = [
    ...module.bindings.values(),
    ...module.imports.values(),
    ...module.namespaceImports,
  ];
  const imported = visible.filter((b) => b.identity.moduleId !== module.id);
  let env = Env.empty();
  const definitions = new Map(
    module.expressions.flatMap((e) =>
      head(e) === "define" && e._tag === "List" && name(e.items[1])
        ? [[name(e.items[1])!, e] as const]
        : [],
    ),
  );
  const applications = new Map<string, SExpr>();
  const setters = new Map<string, (value: KValue) => void>(),
    ready = new Set<string>(),
    demanding: string[] = [];
  const fail = (e: SExpr, code: string, message: string): never => {
    throw new ModuleError({
      code,
      message,
      severity: "error",
      phase: "elaborate",
      span: spanOf(e),
    });
  };
  for (const binding of visible) {
    const declaration = binding.declaration;
    if (declaration)
      semantic.declare(binding.symbol, bindingSymbolOf(declaration.form), {
        _tag: "TCon",
        name: declaration.classification,
      });
    const owner = ownerOf(binding.identity)?.compileTime;
    if (binding.identity.moduleId !== module.id && owner) {
      const form = owner.forms.get(binding.symbol);
      if (form) forms.set(binding.symbol, form);
      if (binding.kind === "macro" || binding.kind === "form")
        for (const [symbol, form] of owner.forms) forms.set(symbol, form);
      const type = owner.types.get(binding.symbol);
      if (type) types.set(binding.symbol, type);
      const sourceOrigins = owner.origins.get(binding.symbol);
      if (sourceOrigins) origins.set(binding.symbol, sourceOrigins);
    }
  }
  for (const expression of module.expressions)
    if (
      head(expression) === "type" &&
      expression._tag === "List" &&
      name(expression.items[1]) &&
      expression.items[2]
    )
      types.set(name(expression.items[1])!, expression.items[2]);
  for (const [symbol, type] of types) {
    semantic.setFact("type-kind", symbol, "type");
    if (type._tag === "Map")
      semantic.setFact(
        "declaration-field-syntax",
        symbol,
        new Map(
          type.pairs.map(([key, type]) => [
            (name(key) ?? "").replace(/^:/, ""),
            type,
          ]),
        ),
      );
  }
  const collect = (expression: SExpr): readonly string[] =>
    expression._tag === "Sym"
      ? [expression.name]
      : expression._tag === "Map"
        ? expression.pairs.flatMap(([k, v]) => [...collect(k), ...collect(v)])
        : expression._tag === "List" &&
            ["quote", "quasiquote"].includes(head(expression) ?? "")
          ? []
          : expression._tag === "List" ||
              expression._tag === "Vector" ||
              expression._tag === "Set"
            ? expression.items.flatMap(collect)
            : [];
  const materialize = (expression: SExpr) => {
    const seen = new Set<string>();
    const visit = (symbol: string): void => {
      if (seen.has(symbol)) return;
      seen.add(symbol);
      if (
        definitions.has(symbol) ||
        applications.has(symbol) ||
        imported.some((b) => b.symbol === symbol)
      ) {
        if (!ready.has(symbol)) read(symbol);
        if (isKFn(env.lookup(symbol)!)) {
          const definition = definitions.get(symbol);
          if (definition)
            collect(definition)
              .filter((n) => n !== symbol)
              .forEach(visit);
        }
      }
    };
    collect(expression).forEach(visit);
  };
  const run = (
    expression: SExpr,
    environment?: Env,
    builtins = defaultBuiltins,
  ): KValue => {
    const expanded = expandKernelExprsSync([expression], {
      env,
      includePrelude: false,
    }).expanded;
    for (const e of expanded) {
      for (const symbol of collect(e))
        if (symbol.includes("__forma_") && !env.has(symbol)) {
          for (const binding of imported.filter((b) => b.kind === "macro")) {
            const owner = ownerOf(binding.identity)?.compileTime;
            if (owner?.environment().has(symbol)) {
              env = env.bind(symbol, owner.read(symbol));
              ready.add(symbol);
              break;
            }
          }
        }
      materialize(e);
    }
    try {
      return Effect.runSync(
        evaluateCompileTimeExprs(normalizeCoreProgram(expanded), {
          env: environment ?? env,
          builtins,
          stepLimit: 100_000,
        }),
      ).value;
    } catch (error) {
      if (error instanceof ModuleError) throw error;
      return fail(
        expression,
        "module/compile-time-data",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  const state: ModuleCompileTime = {
    forms,
    types,
    semantic,
    origins,
    environment: () => env,
    read,
    run,
    expand: (expressions) =>
      expressions.flatMap((e) =>
        head(e) === "macro"
          ? []
          : [
                "type",
                "form",
                "service",
                "layer",
                ":",
                "class",
                "error",
              ].includes(head(e) ?? "")
            ? [e]
            : expandKernelExprsSync([e], {
                env,
                includePrelude: false,
                keepMacroDefs: false,
              }).expanded,
      ),
  };
  for (const expression of module.expressions)
    if (head(expression) === "form") {
      const descriptor = parseUnifiedForm(expression, types)!;
      forms.set(descriptor.name, {
        descriptor,
        owner: state,
        identity: visible.find((b) => b.symbol === descriptor.name)!.identity,
      });
    }
  for (const expression of module.expressions) {
    const form = forms.get(head(expression) ?? "");
    if (!form?.descriptor.surface) continue;
    const holes = matchFormSyntax(form.descriptor.surface, expression);
    for (const [hole, type] of form.descriptor.surface.holes)
      if (head(unwrap(type)) === "Declares") {
        const node = holes.get(hole);
        if (node?._tag === "Sym") applications.set(node.name, expression);
      }
  }
  for (const symbol of [
    ...definitions.keys(),
    ...applications.keys(),
    ...imported.map((b) => b.symbol),
  ]) {
    const slot = env.bindMutable(symbol, null);
    env = slot.env;
    setters.set(symbol, slot.set);
  }
  // Functions close over slots once; constants and imported data are demanded later.
  for (const [symbol, expression] of definitions)
    if (
      expression._tag === "List" &&
      ((expression.items[2]?._tag === "Vector" &&
        expression.items.length > 3) ||
        head(expression.items[2]) === "fn")
    ) {
      setters.get(symbol)!(
        Effect.runSync(
          evaluateCompileTimeExprs(normalizeCoreProgram([expression]), {
            env,
            builtins: defaultBuiltins,
            stepLimit: 100_000,
          }),
        ).value,
      );
      ready.add(symbol);
    }
  for (const binding of imported)
    if (binding.kind === "macro") {
      const value = ownerOf(binding.identity)?.compileTime?.read(
        binding.symbol,
      );
      if (value !== undefined) {
        setters.get(binding.symbol)!(value);
        ready.add(binding.symbol);
      }
    }
  const macroExpressions = module.expressions.filter(
    (e) => head(e) === "macro",
  );
  if (macroExpressions.length) {
    env = Effect.runSync(
      evaluateCompileTimeExprs(normalizeCoreProgram(macroExpressions), {
        env,
        builtins: defaultBuiltins,
        stepLimit: 100_000,
      }),
    ).env;
    for (const expression of macroExpressions)
      if (expression._tag === "List" && expression.items[1]?._tag === "List")
        ready.add(name(expression.items[1].items[0])!);
  }
  function read(symbol: string): KValue {
    if (ready.has(symbol)) {
      const definition = definitions.get(symbol);
      const binding = visible.find((b) => b.symbol === symbol);
      if (definition && binding && isKFn(env.lookup(symbol)!)) {
        materialize(definition);
        const inputs = collect(definition)
          .filter((n) => n !== symbol)
          .flatMap((n) => origins.get(n) ?? []);
        origins.set(symbol, [
          { path: "", identity: binding.identity, span: spanOf(definition) },
          ...inputs,
        ]);
      }
      return env.lookup(symbol)!;
    }
    const binding = visible.find((b) => b.symbol === symbol);
    const expression = definitions.get(symbol) ?? applications.get(symbol);
    if (demanding.includes(symbol))
      return fail(
        expression!,
        "module/data-cycle",
        `Compile-time data cycle: ${[...demanding, symbol].join(" -> ")}.`,
      );
    demanding.push(symbol);
    try {
      let value: KValue;
      if (binding && binding.identity.moduleId !== module.id) {
        const owner = ownerOf(binding.identity)?.compileTime;
        if (!owner)
          return fail(
            module.expressions[0]!,
            "module/compile-time-data",
            `No compile-time data for ${binding.name}.`,
          );
        value = owner.read(symbol);
        origins.set(symbol, owner.origins.get(symbol) ?? []);
      } else if (expression && applications.has(symbol)) {
        const form = forms.get(head(expression)!)!;
        const descriptor = form.descriptor;
        // Prepare helpers in their definition scope before binding caller holes.
        for (const dependency of collect(descriptor.surface!.body))
          if (!descriptor.surface!.holes.has(dependency)) {
            try {
              form.owner.read(dependency);
            } catch (error) {
              if (error instanceof ModuleError) throw error;
            }
          }
        const normalized = normalizeUnifiedForm(descriptor, expression);
        const input = {
          formName: descriptor.name,
          descriptor,
          normalizedSlots: normalized.slots,
          identifiers: normalized.identifiers,
          semanticEnv: semantic,
          loc: expression.loc,
          rawExpr: expression,
        };
        const registry = new FormDescriptorRegistry();
        for (const f of forms.values()) registry.register(f.descriptor);
        const hooks = unifiedFormHooks(
          descriptor,
          registry,
          undefined,
          undefined,
          {
            environment: form.owner.environment,
            evaluateHole: (hole, type) =>
              isSyntaxHole(type) ? datum(hole) : run(hole),
            run: (body, scope, builtins) =>
              form.owner.run(body, scope, builtins),
          },
        );
        const checked = Effect.runSync(
          hooks.find((h) => h.kind === "validate")!.execute(input),
        );
        if (checked.kind === "validate")
          for (const problem of checked.diagnostics)
            if (problem.severity === "error")
              fail(
                { ...expression, loc: problem.loc ?? expression.loc },
                problem.code ?? "elaborate/form-check",
                problem.message,
              );
        const result = Effect.runSync(
          hooks.find((h) => h.kind === "construct")!.execute(input),
        );
        if (result.kind !== "construct")
          throw new Error("Expected form projection.");
        const payload = result.ir as KValue;
        value = binding
          ? new Map<string, KValue>([
              [
                ":identity",
                new Map([
                  [":moduleId", binding!.identity.moduleId],
                  [":declaration", binding!.identity.declaration],
                ]),
              ],
              [
                ":classification",
                KSymbol(binding!.declaration!.classification),
              ],
              [":data", payload],
            ])
          : payload;
      } else if (expression?._tag === "List") value = run(expression.items[2]!);
      else if (env.has(symbol)) return env.lookup(symbol)!;
      else throw new Error(`Unknown compile-time binding ${symbol}.`);
      setters.get(symbol)?.(value);
      ready.add(symbol);
      if (binding && binding.identity.moduleId === module.id && expression) {
        const own = {
          path: "",
          identity: binding.identity,
          span: spanOf(expression),
        };
        const inputOrigins = collect(expression)
          .filter((n) => n !== symbol)
          .flatMap((n) => origins.get(n) ?? []);
        const form = applications.has(symbol)
          ? forms.get(head(expression)!)
          : undefined;
        if (form?.descriptor.surface)
          for (const dependency of collect(form.descriptor.surface.body))
            inputOrigins.push(...(form.owner.origins.get(dependency) ?? []));
        origins.set(symbol, memberOrigins(value, [own, ...inputOrigins]));
      }
      return value;
    } finally {
      demanding.pop();
    }
  }
  module.expressions.forEach((expression, index) => {
    if (
      forms.has(head(expression) ?? "") &&
      ![...applications.values()].includes(expression)
    ) {
      const symbol = `@application_${index}`;
      applications.set(symbol, expression);
      read(symbol);
    }
  });
  const enrich = (binding: ModuleBinding): ModuleBinding => {
    if (binding.identity.moduleId !== module.id) return binding;
    const descriptor = forms.get(binding.symbol)?.descriptor;
    const schema = types.get(binding.symbol);
    let data: ModuleData | undefined;
    if (binding.declaration) {
      try {
        const descriptor = forms.get(
          bindingSymbolOf(binding.declaration.form),
        )?.descriptor;
        const ir = descriptor?.surface?.options.get(":ir");
        const payload =
          ir?._tag === "Sym"
            ? (descriptor?.surface?.types.get(ir.name) ?? ir)
            : ir;
        const contract = payload ? moduleTypeSyntax(payload) : "Any";
        data = {
          value: moduleDataValue(read(binding.symbol)),
          provenance: origins.get(binding.symbol) ?? [],
          contract,
          scheme: {
            parameters: [],
            type: {
              fields: [
                [
                  ":identity",
                  {
                    fields: [
                      [":moduleId", "String"],
                      [":declaration", "String"],
                    ],
                  },
                ],
                [":classification", "Symbol"],
                [":data", contract],
              ],
            },
          },
        };
      } catch (error) {
        if (error instanceof ModuleError) throw error;
        return fail(
          applications.get(binding.symbol)!,
          "module/compile-time-data",
          error instanceof Error ? error.message : String(error),
        );
      }
    } else if (binding.kind === "value") {
      try {
        const value = read(binding.symbol);
        if (!isKFn(value) && !isKMacro(value))
          data = {
            value: moduleDataValue(value),
            provenance: origins.get(binding.symbol) ?? [],
          };
      } catch {
        /* Runtime-only definitions have no data facet. Demands report their failures. */
      }
    }
    return {
      ...binding,
      ...(schema ? { schema: moduleTypeSyntax(schema) } : {}),
      ...(data ? { data } : {}),
      ...(descriptor?.surface
        ? {
            form: {
              pattern: descriptor.surface.pattern.map(moduleTypeSyntax),
              holes: {
                fields: [...descriptor.surface.holes].map(
                  ([hole, type]) =>
                    [`:${hole}`, moduleTypeSyntax(type)] as const,
                ),
              },
              options: {
                fields: [...descriptor.surface.options].map(
                  ([key, value]) => [key, moduleTypeSyntax(value)] as const,
                ),
              },
              projection: moduleTypeSyntax(descriptor.surface.body),
              dependencies: module.dependencies,
              ...(descriptor.doc ? { doc: descriptor.doc } : {}),
              ...(descriptor.completionShape
                ? { completionShape: descriptor.completionShape }
                : {}),
            },
          }
        : {}),
    };
  };
  for (const binding of module.bindings.values())
    if (binding.declaration) read(binding.symbol);
  return {
    ...module,
    compileTime: state,
    interface: {
      ...module.interface,
      exports: module.interface.exports.map(enrich),
    },
  };
}

/** Paths address the elaborated value. Inputs are conservative across arbitrary
 * pure helpers: every result member retains all contributing declaration origins. */
function memberOrigins(
  value: KValue,
  sources: readonly ModuleDataOrigin[],
): readonly ModuleDataOrigin[] {
  const roots = sources.filter((source) => source.path === "");
  const unique = roots.filter(
    (source, index) =>
      roots.findIndex(
        (other) =>
          other.identity.moduleId === source.identity.moduleId &&
          other.identity.declaration === source.identity.declaration &&
          other.span.startOffset === source.span.startOffset,
      ) === index,
  );
  const escape = (key: string) =>
    key.replaceAll("~", "~0").replaceAll("/", "~1");
  const walk = (value: KValue, path: string): ModuleDataOrigin[] => {
    const own = unique.map((source) => ({ ...source, path }));
    if (Array.isArray(value))
      return [...own, ...value.flatMap((v, i) => walk(v, `${path}/${i}`))];
    if (value instanceof Map)
      return [
        ...own,
        ...[...value].flatMap(([key, v]) =>
          walk(v, `${path}/${escape(key.replace(/^:/, ""))}`),
        ),
      ];
    return own;
  };
  return walk(value, "");
}

function bindingSymbolOf(identity: BindingIdentity): string {
  const hex = (s: string) =>
    [...new TextEncoder().encode(s)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  return `${identity.declaration}__forma_${hex(identity.moduleId)}_d${hex(identity.declaration)}`;
}

export function moduleFormProvider(state: ModuleCompileTime): DSLTypeProvider {
  return {
    isKnownForm: (name) => state.forms.has(name),
    getSlots: () => [],
    getResultType: (name) =>
      state.forms.has(name) ? TCon("Declaration") : undefined,
    getTypeBindings(name, expression) {
      const descriptor = state.forms.get(name)?.descriptor;
      if (!descriptor?.surface) return new Map();
      const holes = matchFormSyntax(descriptor.surface, expression);
      return new Map(
        descriptor.identifiers
          .filter((identifier) => identifier.declaration)
          .flatMap((identifier) => {
            const hole = holes.get(identifier.name);
            return hole?._tag === "Sym"
              ? [[hole.name, mono(TCon("Declaration"))] as const]
              : [];
          }),
      );
    },
    extractTypedSlots: () => [],
  };
}
