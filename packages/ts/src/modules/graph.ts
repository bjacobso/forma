import { parse } from "../reader/parser.js";
import { toSExprMany } from "../reader/to-sexpr.js";
import { headSym as head, type SExpr } from "../reader/types.js";
const headSym = (e?: SExpr): string | undefined => (e ? head(e) : undefined);
import type { Diagnostic } from "../engine/operations.js";
import { defaultBuiltins } from "../Builtins.js";

/** A resolver is supplied by the host. IDs identify file instances, not contents. */
export interface ModuleSource {
  readonly id: string;
  readonly source: string;
}
export type ModuleResolver = (
  specifier: string,
  importer: string,
) => ModuleSource | undefined;
export interface BindingIdentity {
  readonly moduleId: string;
  readonly declaration: string;
}
export type ModuleDeclarationKind =
  | "value"
  | "type"
  | "class"
  | "error"
  | "service"
  | "layer"
  | "macro"
  | "form"
  | "typeclass"
  | "compile-time";
export interface ModuleBinding {
  readonly name: string;
  readonly identity: BindingIdentity;
  readonly symbol: string;
  readonly kind: ModuleDeclarationKind;
  readonly constructors: readonly string[];
  readonly scheme?: ModuleTypeScheme;
}
export type ModuleTypeSyntax =
  | string
  | number
  | boolean
  | null
  | readonly ModuleTypeSyntax[]
  | {
      readonly fields: readonly (readonly [
        ModuleTypeSyntax,
        ModuleTypeSyntax,
      ])[];
    };
export interface ModuleTypeScheme {
  readonly parameters: readonly string[];
  readonly type: ModuleTypeSyntax;
}
export interface ModuleInterface {
  readonly moduleId: string;
  readonly exports: readonly ModuleBinding[];
}
export interface ResolvedModule {
  readonly id: string;
  readonly source: string;
  readonly expressions: readonly SExpr[];
  readonly dependencies: readonly string[];
  readonly bindings: ReadonlyMap<string, ModuleBinding>;
  readonly imports: ReadonlyMap<string, ModuleBinding>;
  readonly namespaceImports: readonly ModuleBinding[];
  readonly interface: ModuleInterface;
}
export interface ModuleGraph {
  readonly entry: string;
  /** Dependency order, independent of the host's loading order. */
  readonly modules: readonly ResolvedModule[];
}
export class ModuleError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}
export function normalizeModuleId(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.at(-1) !== ".." && parts.length) parts.pop();
    else if (part !== ".." || !absolute) parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}
export function relativeModuleId(specifier: string, importer: string): string {
  return normalizeModuleId(
    `${importer.slice(0, importer.lastIndexOf("/") + 1)}${specifier}`,
  );
}
/** An in-memory host adapter. No filesystem or package resolution in the compiler. */
export function sourceModuleResolver(
  sources: readonly ModuleSource[],
): ModuleResolver {
  const files = new Map(sources.map((s) => [normalizeModuleId(s.id), s]));
  return (specifier, importer) => {
    if (!specifier.startsWith("./") && !specifier.startsWith("../"))
      return undefined;
    const id = relativeModuleId(specifier, importer),
      file = files.get(id);
    return file ? { ...file, id } : undefined;
  };
}
/** Injective stable encoding, preserving the capitalization used by type/pattern syntax. */
export function bindingSymbol(identity: BindingIdentity): string {
  const hex = (value: string): string =>
    [...new TextEncoder().encode(value)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  // Encode both components: target naming normalizes foo-bar and fooBar alike.
  return `${identity.declaration}__forma_${hex(identity.moduleId)}_d${hex(identity.declaration)}`;
}
const scalar = (e?: SExpr): string | undefined =>
  e?._tag === "Sym" ? e.name : undefined;
const declarationKinds = new Map<string, ModuleDeclarationKind>([
  ["define", "value"],
  ["type", "type"],
  ["class", "class"],
  ["error", "error"],
  ["service", "service"],
  ["layer", "layer"],
  ["macro", "macro"],
  ["form", "form"],
  ["typeclass", "typeclass"],
  ...["entity", "query", "command", "view", "rule", "protocol"].map(
    (h) => [h, "value"] as const,
  ),
]);
const laterKinds = new Set(["macro", "form", "typeclass", "compile-time"]);
const directives = new Set(["import", "export", "export-from"]);
export const coreTypeNames = new Set([
  "String",
  "Int",
  "Number",
  "Bool",
  "Unit",
  "Json",
  "Any",
  "Unknown",
  "Never",
  "Symbol",
  "Keyword",
  "Type",
  "Syntax",
  "RuntimeExpr",
  "Bytes",
  "DateTime",
  "Duration",
  "List",
  "Option",
  "Map",
  "Record",
  "Union",
  "Tagged",
  "Id",
  "Brand",
  "Result",
  "->",
  "Effect",
  "Stream",
  "Layer",
  "Fiber",
  "Ref",
  "RefCell",
  "Scope",
  "OntologyRuntime",
  "Action",
  "Declares",
  "FormDescriptor",
]);

export interface ModuleCoreOptions {
  readonly bindings?: ReadonlySet<string>;
  readonly types?: ReadonlySet<string>;
  readonly isCoreBinding?: (name: string) => boolean;
}
export function resolveModuleGraph(
  entry: ModuleSource,
  resolver: ModuleResolver,
  core: ModuleCoreOptions = {},
): ModuleGraph {
  const completed = new Map<string, ResolvedModule>(),
    active: string[] = [];
  const fail = (id: string, e: SExpr, code: string, message: string): never => {
    throw new ModuleError({
      code,
      message,
      severity: "error",
      phase: "typecheck",
      span: {
        sourceId: id,
        startOffset: e.loc.start,
        endOffset: e.loc.end,
        startLine: e.loc.line,
        startColumn: e.loc.col,
      },
    });
  };
  const visit = (input: ModuleSource): ResolvedModule => {
    const id = normalizeModuleId(input.id),
      cached = completed.get(id);
    if (cached) return cached;
    active.push(id);
    const parsed = parse(input.source);
    if (parsed.errors.length)
      throw new ModuleError({
        code: "read/syntax",
        message: parsed.errors[0]!.message,
        severity: "error",
        phase: "parse",
        span: {
          sourceId: id,
          startOffset: parsed.errors[0]!.loc?.start ?? 0,
          endOffset: parsed.errors[0]!.loc?.end ?? 0,
        },
      });
    const located = (e: SExpr): SExpr => {
      const loc = { ...e.loc, sourceId: id };
      if (e._tag === "Map")
        return {
          ...e,
          loc,
          pairs: e.pairs.map(([k, v]) => [located(k), located(v)] as const),
        };
      if (e._tag === "List" || e._tag === "Vector" || e._tag === "Set")
        return { ...e, loc, items: e.items.map(located) };
      return { ...e, loc };
    };
    const authored = toSExprMany(parsed.redTree).map(located);
    const bindings = new Map<string, ModuleBinding>(),
      declarationNodes = new Map<string, SExpr>();
    const constructors = new Map<string, ModuleBinding[]>();
    for (const e of authored) {
      const h = headSym(e),
        kind = declarationKinds.get(h ?? "");
      if (e._tag !== "List" || !kind) continue;
      const header = e.items[1],
        name =
          scalar(header) ??
          (header?._tag === "List" ? scalar(header.items[0]) : undefined);
      if (!name) continue; // Existing surface diagnostics handle malformed declarations.
      if (name.includes("/") || name.includes(".") || name.includes("__forma_"))
        fail(
          id,
          header!,
          "module/declaration-name",
          `Module declaration ${name} must be an unqualified name without the reserved __forma_ marker.`,
        );
      if (bindings.has(name))
        fail(
          id,
          header!,
          "module/duplicate-declaration",
          `Duplicate declaration ${name} in ${id}.`,
        );
      const tagged = e.items[2],
        arms =
          kind === "type" &&
          headSym(tagged!) === "Tagged" &&
          tagged?._tag === "List"
            ? tagged.items.slice(scalar(tagged.items[1]) === ":tag" ? 3 : 1)
            : [];
      const names = arms
        .map((a) => scalar(a) ?? headSym(a))
        .filter((n): n is string => !!n);
      const binding: ModuleBinding = {
        name,
        identity: { moduleId: id, declaration: name },
        symbol: bindingSymbol({ moduleId: id, declaration: name }),
        kind,
        constructors: names,
      };
      bindings.set(name, binding);
      declarationNodes.set(name, e);
      for (const n of names)
        constructors.set(n, [...(constructors.get(n) ?? []), binding]);
    }
    const imports = new Map<string, ModuleBinding>(),
      namespaces = new Map<string, ResolvedModule>(),
      exports = new Map<string, ModuleBinding>(),
      dependencies: string[] = [];
    const dependency = (e: SExpr): ResolvedModule => {
      if (e._tag !== "List" || e.items[1]?._tag !== "Str")
        return fail(
          id,
          e,
          "module/directive",
          "An import or export-from requires a string file specifier.",
        );
      const specifier = e.items[1].value;
      if (!specifier.startsWith("./") && !specifier.startsWith("../"))
        fail(
          id,
          e.items[1],
          "module/package-stage",
          `Package import ${specifier} requires RFC 0002 stage 3; use a relative file import.`,
        );
      const resolved = resolver(specifier, id);
      if (!resolved)
        return fail(
          id,
          e.items[1],
          "module/not-found",
          `Cannot resolve ${specifier} from ${id}.`,
        );
      const target = normalizeModuleId(resolved.id);
      if (active.includes(target))
        fail(
          id,
          e.items[1],
          "module/cycle",
          `Module cycle: ${[...active, target].join(" -> ")}. Remove an import to break the cycle.`,
        );
      const module = visit({ ...resolved, id: target });
      if (!dependencies.includes(target)) dependencies.push(target);
      return module;
    };
    const publicBinding = (
      module: ResolvedModule,
      name: SExpr,
    ): ModuleBinding => {
      const n = scalar(name);
      if (!n)
        return fail(
          id,
          name,
          "module/directive",
          "Imported and exported names must be symbols.",
        );
      const b = module.interface.exports.find((b) => b.name === n);
      if (!b)
        return fail(
          id,
          name,
          "module/private-export",
          `${module.id} does not export ${n}; declare (export ${n}) in its owning file.`,
        );
      if (laterKinds.has(b.kind))
        fail(
          id,
          name,
          "module/compile-time-stage",
          `Importing ${b.kind} ${n} requires RFC 0002 stage 2 (compile-time libraries).`,
        );
      return b;
    };
    const addExport = (e: SExpr, b: ModuleBinding) => {
      if (exports.has(b.name))
        fail(
          id,
          e,
          "module/duplicate-export",
          `Duplicate export ${b.name} in ${id}.`,
        );
      if (laterKinds.has(b.kind))
        fail(
          id,
          e,
          "module/compile-time-stage",
          `Exporting ${b.kind} ${b.name} requires RFC 0002 stage 2 (compile-time libraries).`,
        );
      exports.set(b.name, b);
    };
    // Imports/re-exports are prepared before exports, regardless of directive order.
    for (const e of authored) {
      if (e._tag !== "List") continue;
      const h = headSym(e);
      if (h !== "import" && h !== "export-from") continue;
      const module = dependency(e);
      if (
        h === "import" &&
        e.items.length === 4 &&
        scalar(e.items[2]) === ":as" &&
        scalar(e.items[3])
      ) {
        const alias = scalar(e.items[3])!;
        if (
          bindings.has(alias) ||
          imports.has(alias) ||
          namespaces.has(alias) ||
          alias.includes("/") ||
          alias.includes(".")
        )
          fail(
            id,
            e.items[3]!,
            "module/duplicate-import",
            `Namespace ${alias} conflicts with a local binding or import.`,
          );
        namespaces.set(alias, module);
      } else if (e.items.length === 3 && e.items[2]?._tag === "Vector") {
        for (const n of e.items[2].items) {
          const b = publicBinding(module, n);
          if (h === "export-from") addExport(n, b);
          else {
            if (
              bindings.has(b.name) ||
              imports.has(b.name) ||
              namespaces.has(b.name)
            )
              fail(
                id,
                n,
                "module/duplicate-import",
                `Import ${b.name} conflicts with a local binding or import.`,
              );
            imports.set(b.name, b);
          }
        }
      } else
        fail(
          id,
          e,
          "module/directive",
          `Use (${h} "./file.forma" [names])${h === "import" ? ' or (import "./file.forma" :as alias)' : ""}.`,
        );
    }
    for (const e of authored)
      if (headSym(e) === "export" && e._tag === "List") {
        if (e.items.length < 2)
          fail(id, e, "module/directive", "export requires one or more names.");
        for (const n of e.items.slice(1)) {
          const b =
            bindings.get(scalar(n) ?? "") ?? imports.get(scalar(n) ?? "");
          if (!b)
            fail(
              id,
              n,
              "module/missing-export",
              `Cannot export ${scalar(n) ?? "expression"}: no local declaration or named import.`,
            );
          addExport(n, b!);
        }
      }
    const visible = new Map([...bindings, ...imports]);
    const resolve = (
      e: SExpr,
      locals: ReadonlySet<string>,
      type = false,
    ): SExpr => {
      if (e._tag !== "Sym" || e.name.startsWith(":")) return e;
      const n = e.name,
        root = n.split(".")[0]!;
      if (locals.has(n) || locals.has(root)) return e;
      if (
        !visible.has(root) &&
        !namespaces.has(n.split("/")[0]!) &&
        (Object.hasOwn(defaultBuiltins, n) ||
          core.bindings?.has(n) ||
          core.isCoreBinding?.(n))
      )
        return e;
      let binding = visible.get(n),
        suffix = "";
      const slash = n.indexOf("/");
      if (slash > 0) {
        const alias = n.slice(0, slash),
          qualified = n.slice(slash + 1),
          memberRoot = qualified.split(".")[0]!;
        const module = namespaces.get(alias);
        if (!module)
          fail(id, e, "module/namespace", `Unknown module namespace ${alias}.`);
        binding = module!.interface.exports.find((b) => b.name === memberRoot);
        suffix = qualified.slice(memberRoot.length);
        if (!binding)
          fail(
            id,
            e,
            "module/private-export",
            `${module!.id} does not export ${memberRoot}.`,
          );
        if (laterKinds.has(binding!.kind))
          fail(
            id,
            e,
            "module/compile-time-stage",
            `Importing ${binding!.kind} ${memberRoot} requires RFC 0002 stage 2.`,
          );
      } else if (!binding && n.includes(".")) {
        binding = visible.get(root);
        suffix = n.slice(root.length);
      }
      if (binding) {
        if (
          suffix &&
          ["macro", "form", "typeclass", "layer"].includes(binding.kind)
        )
          fail(
            id,
            e,
            "module/namespace",
            `${binding.name} has no constructor or service members.`,
          );
        if (
          suffix &&
          binding.kind === "type" &&
          !binding.constructors.includes(suffix.slice(1))
        )
          fail(
            id,
            e,
            "module/constructor",
            `${binding.name} has no constructor ${suffix.slice(1)}.`,
          );
        return { ...e, name: binding.symbol + suffix };
      }
      if (namespaces.has(n))
        fail(
          id,
          e,
          "module/namespace",
          `Namespace ${n} is a compile-time alias; use ${n}/export-name.`,
        );
      const owners = constructors.get(n);
      if (owners?.length === 1)
        return { ...e, name: `${owners[0]!.symbol}.${n}` };
      if (owners && owners.length > 1)
        fail(
          id,
          e,
          "surface/ambiguous-constructor",
          `Ambiguous constructor ${n}; use Type.${n}.`,
        );
      if (n.includes("__forma_"))
        fail(
          id,
          e,
          "module/private-name",
          `Resolved declaration identities cannot be written in source: ${n}.`,
        );
      if (
        type &&
        /^[A-Z]/.test(root) &&
        !coreTypeNames.has(root) &&
        !core.types?.has(root)
      )
        fail(
          id,
          e,
          "module/private-name",
          `Unknown or private type ${n}; import it explicitly.`,
        );
      return e;
    };
    const boundNames = (e: SExpr): string[] => {
      if (e._tag === "Sym")
        return /^[a-z_$]/.test(e.name) &&
          !["nil", "true", "false", "&"].includes(e.name)
          ? [e.name]
          : [];
      if (e._tag === "Map")
        return e.pairs.flatMap(([k, v]) =>
          scalar(k) === ":keys" && v._tag === "Vector"
            ? v.items.flatMap((p) => (scalar(p) ? [scalar(p)!] : []))
            : boundNames(v),
        );
      if (e._tag === "List" || e._tag === "Vector")
        return e.items.flatMap(boundNames);
      return [];
    };
    let resolvingTemplate = false;
    const walk = (
      e: SExpr,
      locals: ReadonlySet<string> = new Set(),
      type = false,
    ): SExpr => {
      if (e._tag === "Sym") return resolve(e, locals, type);
      if (e._tag === "Map")
        return {
          ...e,
          pairs: e.pairs.map(([k, v]) => [k, walk(v, locals, type)] as const),
        };
      if (e._tag === "Vector" || e._tag === "Set")
        return { ...e, items: e.items.map((v) => walk(v, locals, type)) };
      if (e._tag !== "List") return e;
      const h = headSym(e),
        items = e.items;
      if (directives.has(h ?? ""))
        fail(
          id,
          e,
          "module/top-level",
          "Module directives must appear at file top level.",
        );
      if (h === "quote") return e;
      if (h === "quasiquote") {
        // Only unquotes resolve executable references.
        const quoted = (q: SExpr): SExpr =>
          headSym(q) === "unquote" || headSym(q) === "unquote-splicing"
            ? walk(q, locals)
            : q._tag === "List" || q._tag === "Vector"
              ? { ...q, items: q.items.map(quoted) }
              : q._tag === "Map"
                ? {
                    ...q,
                    pairs: q.pairs.map(
                      ([k, v]) => [quoted(k), quoted(v)] as const,
                    ),
                  }
                : q._tag === "Sym" && resolvingTemplate
                  ? resolve(q, locals)
                  : q;
        return { ...e, items: [items[0]!, ...items.slice(1).map(quoted)] };
      }
      const scoped = (binders: SExpr) =>
        new Set([...locals, ...boundNames(binders)]);
      if (
        (h === "fn" || h === "define") &&
        (h === "fn" ? items[1] : items[2])?._tag === "Vector"
      ) {
        const index = h === "fn" ? 1 : 2,
          params = items[index]!,
          local = scoped(params);
        return {
          ...e,
          items: [
            items[0]!,
            ...(h === "define" ? [resolve(items[1]!, locals)] : []),
            params,
            ...items.slice(index + 1).map((v) => walk(v, local)),
          ],
        };
      }
      if ((h === "let" || h === "do!") && items[1]?._tag === "Vector") {
        let local = new Set(locals);
        const pairs: SExpr[] = [];
        for (let i = 0; i < items[1].items.length; i += 2) {
          const binder = items[1].items[i]!,
            value = items[1].items[i + 1];
          if (!value) break;
          if (scalar(binder) === ":let" && value._tag === "Vector") {
            const pure: SExpr[] = [];
            for (let j = 0; j + 1 < value.items.length; j += 2) {
              const p = value.items[j]!;
              pure.push(
                walkPattern(p, local),
                walk(value.items[j + 1]!, local),
              );
              local = new Set([...local, ...boundNames(p)]);
            }
            pairs.push(binder, { ...value, items: pure });
          } else {
            pairs.push(walkPattern(binder, local), walk(value, local));
            local = new Set([...local, ...boundNames(binder)]);
          }
        }
        return {
          ...e,
          items: [
            items[0]!,
            { ...items[1], items: pairs },
            ...items.slice(2).map((v) => walk(v, local)),
          ],
        };
      }
      if ((h === "match" || h === "catch") && items[1]) {
        const resolved = [items[0]!, walk(items[1], locals)];
        for (let i = 2; i < items.length; i += 2) {
          const p = items[i]!;
          resolved.push(walkPattern(p, locals));
          if (items[i + 1]) resolved.push(walk(items[i + 1]!, scoped(p)));
        }
        return { ...e, items: resolved };
      }
      if (h === "type" || h === "class" || h === "error") {
        const header = items[1]!,
          local =
            header._tag === "List"
              ? new Set([
                  ...locals,
                  ...header.items.slice(1).flatMap(boundNames),
                ])
              : locals;
        const resolvedHeader =
          header._tag === "List"
            ? {
                ...header,
                items: [
                  resolve(header.items[0]!, locals),
                  ...header.items.slice(1),
                ],
              }
            : resolve(header, locals);
        const body = items[2];
        const resolvedBody =
          headSym(body!) === "Tagged" && body?._tag === "List"
            ? {
                ...body,
                items: body.items.map((arm, i) =>
                  i === 0 ||
                  scalar(arm) === ":tag" ||
                  scalar(body.items[i - 1]) === ":tag"
                    ? arm
                    : arm._tag === "List"
                      ? {
                          ...arm,
                          items: [
                            arm.items[0]!,
                            ...arm.items
                              .slice(1)
                              .map((v) => walk(v, local, true)),
                          ],
                        }
                      : arm,
                ),
              }
            : body
              ? walk(body, local, true)
              : undefined;
        return {
          ...e,
          items: [
            items[0]!,
            resolvedHeader,
            ...(resolvedBody ? [resolvedBody] : []),
            ...items.slice(3),
          ],
        };
      }
      if (h === ":" && items.length === 3)
        return {
          ...e,
          items: [
            items[0]!,
            resolve(items[1]!, locals),
            walk(items[2]!, locals, true),
          ],
        };
      if (h === "layer") {
        let local = new Set([
          ...locals,
          ...items
            .slice(2)
            .flatMap((v) =>
              headSym(v) === "define" && v._tag === "List" && scalar(v.items[1])
                ? [scalar(v.items[1])!]
                : [],
            ),
        ]);
        const args: SExpr[] = [];
        for (let i = 2; i < items.length; i++) {
          const v = items[i]!;
          if (scalar(v) === ":setup" && items[i + 1]?._tag === "Vector") {
            const setup = items[++i] as Extract<SExpr, { _tag: "Vector" }>,
              pairs: SExpr[] = [];
            for (let j = 0; j + 1 < setup.items.length; j += 2) {
              const p = setup.items[j]!;
              pairs.push(p, walk(setup.items[j + 1]!, local));
              local = new Set([...local, ...boundNames(p)]);
            }
            args.push(v, { ...setup, items: pairs });
          } else args.push(walk(v, local));
        }
        return {
          ...e,
          items: [items[0]!, resolve(items[1]!, locals), ...args],
        };
      }
      if (h === "service")
        return {
          ...e,
          items: [
            items[0]!,
            resolve(items[1]!, locals),
            ...items.slice(2).map((method) =>
              method._tag === "List" && headSym(method) === ":"
                ? {
                    ...method,
                    items: [
                      method.items[0]!,
                      method.items[1]!,
                      ...method.items
                        .slice(2)
                        .map((v) => walk(v, locals, true)),
                    ],
                  }
                : walk(method, locals),
            ),
          ],
        };
      if ((h === "macro" || h === "form") && items[1]?._tag === "List") {
        const pattern = items[1],
          local = new Set([
            ...locals,
            ...pattern.items.slice(1).flatMap(boundNames),
          ]);
        const previous = resolvingTemplate;
        resolvingTemplate = true;
        const body = items.slice(2).map((v) => walk(v, local));
        resolvingTemplate = previous;
        return {
          ...e,
          items: [
            items[0]!,
            {
              ...pattern,
              items: [
                resolve(pattern.items[0]!, locals),
                ...pattern.items.slice(1),
              ],
            },
            ...body,
          ],
        };
      }
      return { ...e, items: items.map((v) => walk(v, locals, type)) };
    };
    const walkPattern = (e: SExpr, locals: ReadonlySet<string>): SExpr => {
      if (e._tag === "Sym")
        return /^[A-Z]/.test(e.name) ||
          e.name.includes("/") ||
          e.name.includes(".")
          ? resolve(e, locals)
          : e;
      if (e._tag === "List" || e._tag === "Vector")
        return { ...e, items: e.items.map((v) => walkPattern(v, locals)) };
      if (e._tag === "Map")
        return {
          ...e,
          pairs: e.pairs.map(([k, v]) => [k, walkPattern(v, locals)] as const),
        };
      return e;
    };
    const expressions = authored
      .filter((e) => !directives.has(headSym(e) ?? ""))
      .map((e) => walk(e));
    const module: ResolvedModule = {
      id,
      source: input.source,
      expressions,
      dependencies,
      bindings,
      imports,
      namespaceImports: [...namespaces.values()].flatMap((m) =>
        m.interface.exports.filter((b) => !laterKinds.has(b.kind)),
      ),
      interface: {
        moduleId: id,
        exports: [...exports.values()].sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        ),
      },
    };
    completed.set(id, module);
    active.pop();
    return module;
  };
  const root = visit(entry);
  return { entry: root.id, modules: [...completed.values()] };
}
