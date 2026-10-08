import type { KValue } from "../evaluator/types.js";
import { camelIdentifier, typeName } from "../mechanics/naming.js";
import { datum } from "../surface/datum.js";
import { head, name, sym } from "../surface/effect.js";
import type { SExpr } from "../reader/types.js";
import type { FormDescriptor } from "./FormDescriptor.js";
import {
  builderIRCode,
  emitFormExpression,
  projectBuilderIR,
  renderTypeScript,
  targetCode,
} from "./form-emitter.js";

export interface GenerateFormBuildersOptions {
  readonly descriptors: readonly FormDescriptor[];
  readonly forms: readonly string[];
  readonly imports: readonly string[];
  /** Target-specific refinements, e.g. GET payloads use schema field records. */
  readonly typeOverrides?: Readonly<Record<string, string>>;
  readonly inputTypeOverrides?: Readonly<Record<string, string>>;
  readonly typeArguments?: Readonly<Record<string, readonly string[]>>;
  readonly childValueTypes?: Readonly<Record<string, string>>;
  readonly parentValueTypes?: Readonly<Record<string, string>>;
}

/** Derive builders from typed holes, direct record projections and emit hooks.
 * Unsupported executable checks/scopes are rejected; they are never silently lost.
 */
export function generateFormBuilders(options: GenerateFormBuildersOptions): {
  readonly code: string;
} {
  const descriptors = options.forms.map((n) => {
    const descriptor = options.descriptors.find((d) => d.name === n);
    if (!descriptor?.surface?.options.has(":emit"))
      throw new Error(`Builder form ${n} needs a projection and :emit hook`);
    if (
      [":check", ":scope"].some((k) => descriptor.surface!.options.has(k)) ||
      head(descriptor.surface.options.get(":type")) === "fn"
    )
      throw new Error(
        `Builder form ${n} has executable checks, scopes, or a computed type; supply a declarative form instead`,
      );
    return descriptor;
  });
  const lines = [...options.imports, ""];
  for (const descriptor of descriptors) {
    const spec = descriptor.surface!;
    const repeated = spec.pattern.findIndex((p) => name(p) === "...");
    const className = typeName(descriptor.name);
    const irBindings = new Map<string, KValue>();
    for (const [n, t] of spec.holes) {
      const optional = head(t) === "Option";
      const u = optional && t._tag === "List" ? t.items[1]! : t;
      const type =
        head(u) === "Declares" || head(u) === "Refers" || name(u) === "String"
          ? "string"
          : name(u) === "Type"
            ? "Schema.Top"
            : head(u) === "Union" && u._tag === "List"
              ? u.items
                  .slice(1)
                  .map((v) => JSON.stringify(name(v)?.replace(/^:/, "")))
                  .join(" | ")
              : head(u) === "List" && u._tag === "List"
                ? `readonly ${name(u.items[1]) === "Type" ? "Schema.Top" : `${typeName(name(u.items[1])!)}IR`}[]`
                : head(u) === "Record"
                  ? "Schema.Struct.Fields"
                  : undefined;
      if (!type)
        throw new Error(`Unsupported builder hole ${descriptor.name}.${n}`);
      irBindings.set(n, targetCode(`${type}${optional ? " | undefined" : ""}`));
    }
    lines.push(
      `export type ${className}IR = ${builderIRCode(projectBuilderIR(descriptor, irBindings)).replace(/\} as const/g, "}")};`,
      "",
    );
    if (repeated >= 0) {
      const childHole = name(spec.pattern[repeated - 1])!;
      const childType = spec.holes.get(childHole)!;
      const childName =
        childType._tag === "List" ? name(childType.items[1]) : undefined;
      const child = descriptors.find((d) => d.name === childName);
      const id = name(spec.pattern[0]);
      if (
        !child ||
        !id ||
        spec.pattern.length !== 3 ||
        head(spec.holes.get(id)) !== "Declares"
      )
        throw new Error(
          `Repeated builder ${descriptor.name} supports (form name child ...) with a generated child form`,
        );
      const childClass = typeName(child.name);
      const declaredType = spec.holes.get(id)!;
      const declaration =
        declaredType._tag === "List" ? name(declaredType.items[1])! : "";
      const childValueType = options.childValueTypes?.[descriptor.name];
      const parentValueType = options.parentValueTypes?.[descriptor.name];
      if (!childValueType || !parentValueType)
        throw new Error(
          `Repeated builder ${descriptor.name} needs target value type refinements`,
        );
      const constraint = `{ readonly ir: ${childClass}IR; readonly value: ${childValueType} }`;
      const bindings = new Map<string, KValue>([
        [id, targetCode("this.name")],
        [childHole, targetCode("this.children")],
      ]);
      const ir = projectBuilderIR(descriptor, bindings);
      const firstBindings = new Map<string, KValue>([
        [id, targetCode("name")],
        [childHole, [targetCode("child.value")]],
      ]);
      const first = emitFormExpression(
        descriptor,
        projectBuilderIR(descriptor, firstBindings),
        options.descriptors,
      );
      if (head(first) !== "ts/method" || first._tag !== "List")
        throw new Error(
          `Repeated builder ${descriptor.name} must emit a target method call`,
        );
      const append = {
        ...first,
        items: [
          first.items[0]!,
          sym(first, "this.value"),
          ...first.items.slice(2),
        ],
      };
      const firstValue = renderTypeScript(first),
        appendValue = renderTypeScript(append);
      lines.push(
        `export class ${className}Builder<const Name extends string, const Children extends readonly ${constraint}[]> {`,
        `  constructor(readonly name: Name, readonly children: Children, readonly value: ${parentValueType}) {}`,
        `  get reference() { return { kind: ${JSON.stringify(declaration)}, name: this.name } as const; }`,
        `  get ir() { return ${builderIRCode(ir, new Set(["this.children"])).replace(".map(child => child.ir)", ".map((child: Children[number]) => child.ir)")}; }`,
        `  add<const Child extends ${constraint}>(child: Child) {`,
        `    return new ${className}Builder<Name, readonly [...Children, Child]>(this.name, [...this.children, child] as const, ${appendValue});`,
        "  }",
        "}",
        `export const ${className} = {`,
        `  make: <const Name extends string>(name: Name) => ({`,
        `    reference: { kind: ${JSON.stringify(declaration)}, name } as const,`,
        `    ir: ${builderIRCode(
          projectBuilderIR(
            descriptor,
            new Map([
              [id, targetCode("name")],
              [childHole, []],
            ]),
          ),
        )},`,
        `    add: <const Child extends ${constraint}>(child: Child) => new ${className}Builder(name, [child] as const, ${firstValue}),`,
        "  }),",
        "};",
        "",
      );
      continue;
    }
    const enums = [...spec.holes].filter(([, t]) => head(t) === "Union");
    if (enums.length > 1)
      throw new Error(
        `Builder ${descriptor.name} supports one literal union hole`,
      );
    const enumHole = enums[0];
    const variants =
      enumHole && enumHole[1]._tag === "List"
        ? enumHole[1].items.slice(1)
        : [undefined];
    lines.push(`export const ${className} = {`);
    for (const variant of variants) {
      const variantName = variant ? name(variant)?.replace(/^:/, "") : "make";
      if (!variantName)
        throw new Error(
          `Builder ${descriptor.name} only supports keyword unions`,
        );
      const bindings = new Map<string, KValue>();
      if (variant && enumHole) bindings.set(enumHole[0], datum(variant));
      const generics: string[] = [],
        params: string[] = [],
        fields: string[] = [];
      const argument = (
        hole: string,
        t: SExpr,
        optional: boolean,
        inOptions: boolean,
      ): void => {
        const local = camelIdentifier(hole),
          generic = typeName(hole);
        let constraint: string;
        if (head(t) === "Declares") constraint = "string";
        else if (head(t) === "Refers" && t._tag === "List")
          constraint = "string";
        else if (name(t) === "String") constraint = "string";
        else if (name(t) === "Type") constraint = "Schema.Top";
        else if (
          head(t) === "Record" &&
          t._tag === "List" &&
          name(t.items[1]) === "Type"
        )
          constraint = "Schema.Struct.Fields";
        else if (
          head(t) === "List" &&
          t._tag === "List" &&
          name(t.items[1]) === "Type"
        )
          constraint = "readonly Schema.Top[]";
        else
          throw new Error(
            `Unsupported builder hole ${descriptor.name}.${hole}`,
          );
        constraint =
          options.typeOverrides?.[
            `${descriptor.name}.${variantName}.${hole}`
          ] ?? constraint;
        generics.push(
          `const ${generic} extends ${constraint}${optional ? " = never" : ""}`,
        );
        const inputType =
          options.inputTypeOverrides?.[
            `${descriptor.name}.${variantName}.${hole}`
          ] ?? (head(t) === "Refers" && t._tag === "List" ? `{ readonly kind: ${JSON.stringify(name(t.items[1]))}; readonly name: ${generic} }` : generic);
        if (inOptions)
          fields.push(
            `readonly ${JSON.stringify(hole)}${optional ? "?" : ""}: (${inputType})${optional ? " | undefined" : ""}`,
          );
        else params.push(`${local}: ${inputType}`);
        const code = inOptions ? `options[${JSON.stringify(hole)}]` : local;
        bindings.set(
          hole,
          targetCode(
            head(t) === "Refers" ? `${code}${optional ? "?." : "."}name` : code,
          ),
        );
      };
      // Required type parameters must precede defaulted optional parameters.
      const holes = [...spec.holes]
        .filter(([n]) => n !== enumHole?.[0])
        .sort(
          (a, b) =>
            Number(head(a[1]) === "Option") - Number(head(b[1]) === "Option"),
        );
      for (const [hole, t] of holes) {
        const inOptions = spec.pattern.some(
          (p) =>
            p._tag === "Map" &&
            p.pairs[0]?.[1]._tag === "Vector" &&
            p.pairs[0][1].items.some((k) => name(k) === hole),
        );
        const optional = head(t) === "Option";
        argument(
          hole,
          optional && t._tag === "List" ? t.items[1]! : t,
          optional,
          inOptions,
        );
      }
      if (fields.length) params.push(`options: { ${fields.join("; ")} }`);
      const ir = projectBuilderIR(descriptor, bindings);
      let expression = emitFormExpression(descriptor, ir, options.descriptors);
      const typeArguments =
        options.typeArguments?.[`${descriptor.name}.${variantName}`];
      if (typeArguments && expression._tag === "List" && expression.items[0]) {
        const target = targetCode(
          `${renderTypeScript(expression.items[0])}<${typeArguments.join(", ")}>`,
        );
        if (
          target !== null &&
          typeof target === "object" &&
          "_tag" in target &&
          target._tag === "KSExpr"
        )
          expression = {
            ...expression,
            items: [target.expr, ...expression.items.slice(1)],
          };
      }
      const value = renderTypeScript(expression);
      const declarationHole = [...spec.holes].find(
        ([, t]) => head(t) === "Declares",
      );
      const declaredType = declarationHole?.[1];
      const declaration =
        declaredType?._tag === "List" ? name(declaredType.items[1]) : undefined;
      lines.push(
        `  ${camelIdentifier(variantName)}: ${generics.length ? `<${generics.join(", ")}>` : ""}(${params.join(", ")}) => ({`,
        ...(declaration && declarationHole
          ? [
              `    reference: { kind: ${JSON.stringify(declaration)}, name: ${camelIdentifier(declarationHole[0])} } as const,`,
            ]
          : []),
        `    ir: ${builderIRCode(ir)},`,
        `    value: ${value},`,
        "  }),",
      );
    }
    lines.push("};", "");
  }
  return { code: lines.join("\n") };
}
