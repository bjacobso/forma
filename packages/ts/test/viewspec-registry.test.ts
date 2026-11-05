import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { Env } from "../src/Env.js";
import { defaultBuiltins } from "../src/Builtins.js";
import { evaluateExprs } from "../src/Evaluator.js";
import type { BuiltinFn, KValue } from "../src/evaluator/types.js";
import { parseManyToSExpr, parseToSExpr, type SExpr } from "../src/Reader.js";
import { preludeSource } from "../src/Preludes.js";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { createMetaBuiltins } from "../src/descriptor/meta-builtins.js";
import { SimpleSemanticEnvironment } from "../src/descriptor/SemanticEnvironment.js";
import { compileDescriptorTree } from "../src/descriptor/descriptor-tree-compile.js";
import { findDescriptorTreeProtocolRegistry } from "../src/descriptor/descriptor-tree-metadata.js";
import type { FormDescriptor } from "../src/descriptor/FormDescriptor.js";
import { datum, syntaxForDatum } from "../src/surface/datum.js";

const descriptors = [...bootstrapFromSources(
  preludeSource("compiler.lisp"), preludeSource("ui.lisp"),
  preludeSource("viewspec.lisp"), preludeSource("viewspec-protocol.lisp"),
).descriptions.list()];
const literal = (e: SExpr): KValue => e._tag === "Str" || e._tag === "Num" || e._tag === "Bool" ? e.value : e._tag === "Sym" ? e.name : null;
const plain = (value: KValue): unknown => value instanceof Map
  ? Object.fromEntries([...value].map(([key, value]) => [key, plain(value)]))
  : Array.isArray(value) ? value.map(plain) : value;

function hosted(forms: readonly FormDescriptor[]) {
  const registry = findDescriptorTreeProtocolRegistry(forms)!;
  const calls: KValue[][] = [];
  const compile: BuiltinFn = args => Effect.sync(() => {
    calls.push([...args.slice(0, 2)]);
    return compileDescriptorTree({
      layout: syntaxForDatum(args[2]!)!, descriptors: forms, extensionKey: String(args[1]),
      compileExpr: e => new Map<string, KValue>([["kind", "literal"], ["value", literal(e)]]),
      compileActionOrArray: () => [], compileJsonValue: literal, normalizeLiteralValue: literal,
    }) as KValue;
  });
  const builtins = { ...defaultBuiltins, ...createMetaBuiltins(new SimpleSemanticEnvironment(), {
    hostedDsls: new Map([["viewspec", { name: "viewspec", descriptors: forms }]]),
    hostedBuiltins: { [registry.compileLayoutTreeOp]: compile },
  }) };
  const run = (op: string, source: string) => plain(Effect.runSync(evaluateExprs(
    Effect.runSync(parseManyToSExpr(`(${op} "viewspec" input)`)),
    { builtins, env: Env.empty().bind("input", datum(Effect.runSync(parseToSExpr(source)))), stepLimit: 10_000 },
  )).value);
  return { calls, compile: (source: string) => run("meta/compile-descriptor-tree", source), validate: (source: string) => run("meta/validate-descriptor-tree", source) };
}

function withRegistry(values: Record<string, string | boolean>): FormDescriptor[] {
  return descriptors.map(form => form.name === "view-protocol-registry" ? {
    ...form, extensions: { ...form.extensions, "protocol/registry": { ...(form.extensions?.["protocol/registry"] as Record<string, string | boolean>), ...values } },
  } : form);
}

describe("ViewSpec protocol registry", () => {
  test("keeps adapter selection and call conventions", () => {
    expect(findDescriptorTreeProtocolRegistry(descriptors)).toEqual({
      compileLayoutTreeOp: "view/compile-layout-tree", hostedDslName: "viewspec",
      componentExtension: "view/component", layoutAliasExtension: "view/layout-alias",
      layoutAliasDefaultTo: "custom", allowDefaultComponentLayoutArgs: true,
      allowHostedDslNameLayoutArgs: true,
    });
  });

  test("hosted compilation and validation use the consumer's existing field conventions", () => {
    const source = '(rows (text "Hello"))';
    const expected = { type: "rows", children: [{ type: "text", content: { kind: "literal", value: "Hello" } }] };
    const minimal = hosted(descriptors);
    expect(minimal.validate(source)).toEqual([]);
    expect(minimal.compile(source)).toEqual(expected);
    expect(minimal.calls).toEqual([["viewspec", "view/component"]]);
    const legacyHints = hosted(withRegistry({
      "component-protocol-type-field-field": "unused-custom-name",
      "component-children-policy-field": "unused-children",
      "expr-literal-kind": "unused-kind",
    }));
    expect(legacyHints.compile(source)).toEqual(expected);
    expect(legacyHints.validate('(tabs (text "Wrong child"))')).toEqual(minimal.validate('(tabs (text "Wrong child"))'));
    expect(minimal.validate('(tabs (text "Wrong child"))')).not.toEqual([]);
  });

  test("explicit adapter overrides still dispatch to the selected host operation", () => {
    const custom = withRegistry({ "compile-layout-tree-op": "host/custom-layout", "allow-default-component-layout-args": false });
    expect(findDescriptorTreeProtocolRegistry(custom)?.allowDefaultComponentLayoutArgs).toBe(false);
    const adapter = hosted(custom);
    expect(adapter.compile('(text "Hello")')).toEqual({ type: "text", content: { kind: "literal", value: "Hello" } });
    expect(adapter.calls).toEqual([["viewspec", "view/component"]]);
  });
});
