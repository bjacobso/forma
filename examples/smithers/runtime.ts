import { Action, Flow, FlowRuntime, HumanTask, Interpreter, Poll, RetryPolicy, Sleep, WaitFor } from "@smthrs/flow";
import { FlowEngine } from "@smthrs/engine";
import { Node } from "@smthrs/plan";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { ActionIR, Codec, Json, Program, WorkflowIR } from "./compile.ts";

// The schemas come from checked Forma declarations rather than TS generics.
// Keep their dynamic types at this adapter boundary; never eval author code.
type DynamicSchema = Schema.Codec<any, any>;
type DynamicNode = Node.Node<any, any, any>;
type DynamicAction = Action.Declared<any, any, DynamicSchema, DynamicSchema, any>;
type DynamicFlow = Flow.Flow<any, any, DynamicSchema, DynamicSchema, any>;
export type Handler = (payload: Record<string, Json>) => Effect.Effect<Json, Json>;
export interface NativeBinding { flow: Flow.AnyWithProps; layer?: Layer.Layer<any, never, any> }
const adapterVersion = "forma-smithers/v2";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function schema(codec: Codec): DynamicSchema {
  switch (codec.tag) {
    case "String": return Schema.String;
    case "Int": return Schema.Int;
    case "Float": return Schema.Number;
    case "Bool": return Schema.Boolean;
    case "Json": return Schema.Json;
    case "Unit": return Schema.Null;
    case "Never": return Schema.Never;
    case "literal": return codec.value === null ? Schema.Null : Schema.Literal(codec.value as string | number | boolean);
    case "record": return Schema.Struct(Object.fromEntries(Object.entries(codec.fields!).map(([k, v]) => [k, schema(v)])));
    case "list": return Schema.Array(schema(codec.item!));
    case "option": return Schema.Union([schema(codec.item!), Schema.Null]);
    case "union": return Schema.Union(codec.members!.map(schema));
    default: throw new Error(`Unsupported workflow schema: ${codec.tag}`);
  }
}

function fields(codec: Codec): Schema.Struct.Fields {
  if (codec.tag !== "record") throw new Error("Action and flow payloads must be records.");
  return Object.fromEntries(Object.entries(codec.fields!).map(([k, v]) => [k, schema(v)]));
}

function object(value: Json | undefined): Record<string, Json> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an expression record.");
  return value;
}

/** A deliberately small total expression language, shared with the prelude. */
export function evaluate(expression: Json, values: Record<string, any>): any {
  if (Array.isArray(expression)) return expression.map(item => evaluate(item, values));
  if (expression === null || typeof expression !== "object") return expression;
  if (expression.get != null) {
    const path = expression.get as string[];
    return path.slice(1).reduce((value, field) => value[field], values[path[0]]);
  }
  if (expression.op != null) {
    const args = (expression.args as Json[]).map(arg => evaluate(arg, values));
    switch (expression.op) {
      case "eq": return canonical(args[0]) === canonical(args[1]);
      case "and": return args.every(Boolean);
      case "concat": return args.join("");
      case "add": {
        const result = args.reduce((a, b) => a + b, 0);
        if (!Number.isSafeInteger(result)) throw new RangeError("Workflow Int addition exceeds the safe integer range.");
        return result;
      }
      default: throw new Error(`Unknown expression operator: ${expression.op}`);
    }
  }
  return Object.fromEntries(Object.entries(expression).map(([k, v]) => [k, evaluate(v, values)]));
}

function references(expression: Json): string[] {
  if (Array.isArray(expression)) return expression.flatMap(references);
  if (expression === null || typeof expression !== "object") return [];
  if (expression.get != null) return [(expression.get as string[])[0]];
  return Object.values(expression).flatMap(references);
}

function effects(declaration: ActionIR | WorkflowIR) {
  return { reads: declaration.reads, writes: declaration.writes, tier: declaration.tier, mode: "expected" as const, onConflict: "serialize" as const };
}

/** Lower the checked, portable IR to native Smithers declarations and nodes. */
export function link(program: Program, handlers: Record<string, Handler>, nativeFlows: Record<string, NativeBinding> = {}) {
  const actions = new Map<string, DynamicAction>();
  const flows = new Map<string, DynamicFlow>();
  const generated = new Map<string, DynamicFlow>();
  const implementations: Layer.Layer<any, never, any>[] = [];
  const nativeDeclarations: DynamicFlow[] = [];
  for (const external of program.nativeFlows) {
    const binding = nativeFlows[external.name];
    if (!binding) throw new Error(`Missing native flow: ${external.name}`);
    const native = binding.flow as unknown as DynamicFlow;
    for (const [name, expected, actual] of [
      ["payload", schema(external.schemas.payload), native.payloadSchema],
      ["success", schema(external.schemas.success), native.successSchema],
    ] as const) {
      if (canonical(Node.schemaIdentity(expected)) !== canonical(Node.schemaIdentity(actual))) {
        throw new Error(`Native flow ${external.name} ${name} schema does not match its declaration.`);
      }
    }
    nativeDeclarations.push(native);
    if (binding.layer) implementations.push(binding.layer);
    flows.set(external.name, Flow.make(`forma/native/${external.name}`, {
      payload: fields(external.schemas.payload), success: schema(external.schemas.success), error: schema(external.schemas.error),
      capabilities: external.capabilities, body: payload => native.child(payload as never),
    }));
  }
  for (const action of program.actions) {
    const declaration = Action.make(`forma/action/${action.name}`, {
      payload: fields(action.schemas.payload), success: schema(action.schemas.success), error: schema(action.schemas.error),
      tier: action.tier, capabilities: action.capabilities, effects: effects(action),
      implementationVersion: action.version, attemptTimeoutMs: action["timeout-ms"],
      retryPolicy: RetryPolicy.make({ initialMs: 1, factor: 1, maxMs: 1, maxAttempts: action.attempts }),
      // Include payload so two revisions cannot share one external-effect key.
      idempotencyKey: action.key || action.tier === "sealed"
        ? payload => ({ namespace: action.key ?? action.name, payload: payload as Json }) : undefined,
    });
    const handler = handlers[action.name];
    if (!handler) throw new Error(`Missing handler: ${action.name}`);
    implementations.push(declaration.toLayer(payload => handler(payload as Record<string, Json>), { implementationVersion: action.version }));
    actions.set(action.name, declaration);
  }

  // Poll declarations are registered eagerly, outside graph rebuilding.
  for (const flow of program.workflows) for (const node of flow.nodes) {
    if (node.kind !== "poll") continue;
    const d = node.data;
    const target = actions.get(d.target as string)!;
    const actionIR = program.actions.find(a => a.name === d.target)!;
    const capture = { adapterVersion, flow: flow.name, node, action: actionIR };
    const poll = Poll.make(`forma/poll/${flow.name}/${node.name}`, {
      input: { args: schema(actionIR.schemas.payload) },
      result: schema(actionIR.schemas.success.fields!.value),
      intervalMs: d["every-ms"] as number, maxAttempts: d["max-attempts"] as number,
      check: Node.capture(capture, input => Node.map(target.call(input.args),
        Node.capture(capture, checked => ({ satisfied: checked.done, output: checked.value }))) as Node.Node<any, never, any>),
    });
    generated.set(`forma/poll/${flow.name}/${node.name}`, poll as unknown as DynamicFlow);
  }

  function body(flow: WorkflowIR, payload: Record<string, Json>): DynamicNode {
    const definitions = new Map(flow.nodes.map(n => [n.name, n]));
    type Values = Map<string, any>;
    type Continue = (value: any, values: Values) => DynamicNode;
    const done: Continue = value => Node.succeed(value);
    const captures = { adapterVersion, declaration: flow, payload };
    const captured = <A extends unknown[], B>(site: string, fn: (...args: A) => B) =>
      Node.capture({ ...captures, site }, fn);
    function bind(node: DynamicNode, name: string, values: Values, next: Continue, site: string): DynamicNode {
      return Node.bindPlanned(node, captured(site, value => next(value, new Map([...values, [name, value]]))));
    }
    function dependencies(name: string): string[] {
      const n = definitions.get(name);
      if (!n) return [];
      const d = n.data;
      const ordinary = [...references(d.args ?? null), ...references(d.expression ?? null)];
      if (n.kind === "branch") return [d.condition as string, d.yes as string, d.no as string];
      if (n.kind === "recover") return [d.attempt as string, d.fallback as string];
      return [...ordinary, ...(d.members as string[] ?? [])];
    }
    function ancestors(name: string, values: Values, found = new Set<string>()): Set<string> {
      if (values.has(name)) return found;
      for (const dependency of dependencies(name)) {
        if (!found.has(dependency)) {
          found.add(dependency);
          ancestors(dependency, values, found);
        }
      }
      return found;
    }
    function withShared(names: string[], values: Values, next: (values: Values) => DynamicNode, site: string): DynamicNode {
      const counts = new Map<string, number>();
      for (const name of new Set(names)) for (const dependency of new Set([name, ...ancestors(name, values)])) {
        counts.set(dependency, (counts.get(dependency) ?? 0) + 1);
      }
      const shared = flow.nodes.find(n => !values.has(n.name) && (counts.get(n.name) ?? 0) > 1);
      if (!shared) return next(values);
      const name = shared.name;
      // Bind a lazy settlement, not an eager success barrier: unrelated race
      // members can win, and each consumer retains its own recovery boundary.
      const outcome = Node.catch(Node.map(lower(name, values, done, site + "/producer/" + name),
        captured(site + "/success/" + name, value => ({ ok: true, value }))), {
        onFailure: captured(site + "/failure/" + name, error => Node.succeed({ ok: false, error })),
      });
      return Node.bindPlanned(outcome, captured(site + "/shared/" + name, result => {
        const demand = Node.branch(Node.succeed(result), {
          if: captured(site + "/ok/" + name, (settled: any) => settled.ok === true),
          then: captured(site + "/value/" + name, (settled: any) => Node.succeed(settled.value)),
          else: captured(site + "/error/" + name, (settled: any) => Node.fail(settled.error)),
        });
        return withShared(names, new Map([...values, [name, demand]]), next, site + "/bound/" + name);
      }));
    }
    function withDependencies(names: string[], values: Values, next: (values: Values) => DynamicNode, site: string): DynamicNode {
      const missing = [...new Set(names)].filter(name => !values.has(name) || Node.isNode(values.get(name)));
      if (!missing.length) return next(values);
      if (missing.length === 1) return lower(missing[0], values, (_, updated) => next(updated), site + "/dependency");
      return withShared(missing, values, ready => {
        const joined = Node.all(Object.fromEntries(missing.map(name =>
          [name, lower(name, ready, done, site + "/member/" + name)])));
        return Node.bindPlanned(joined, captured(site + "/join", result => {
          const updated = new Map(ready);
          for (const name of missing) updated.set(name, result[name]);
          return next(updated);
        }));
      }, site);
    }
    function expression(value: Json, values: Values, next: Continue, site: string): DynamicNode {
      return withDependencies(references(value), values, ready => {
        // Substituting a reference into an argument is plan-time wiring.
        // Only operators need a deferred computation on the actual values.
        function hasOperator(value: Json): boolean {
          return Array.isArray(value) ? value.some(hasOperator)
            : value !== null && typeof value === "object" && (value.op != null || Object.values(value).some(hasOperator));
        }
        if (!hasOperator(value)) return next(evaluate(value, Object.fromEntries(ready)), ready);
        const inputs = Object.fromEntries([...new Set(references(value))].map(name => [name, ready.get(name)]));
        const mapped = Node.map(Node.succeed(inputs),
          Node.capture({ expression: value, adapterVersion }, function(resolved) {
            return evaluate(this.expression, resolved);
          }));
        return Node.bindPlanned(mapped, captured(site + "/expression", value => next(value, ready)));
      }, site + "/inputs");
    }
    function lower(name: string, values: Values, next: Continue, parentSite: string): DynamicNode {
      if (values.has(name)) {
        const value = values.get(name);
        return Node.isNode(value) ? bind(value, name, values, next, parentSite + "/demand/" + name) : next(value, values);
      }
      const node = definitions.get(name);
      if (!node) throw new Error(`Unknown node: ${flow.name}/${name}`);
      const d = node.data;
      const site = parentSite + "/" + name;
      const settle = (result: DynamicNode, ready = values) => next === done ? result : bind(result, name, ready, next, site + "/result");
      switch (node.kind) {
        case "value": return expression(d.expression, values, (value, ready) => settle(Node.succeed(value), ready), site);
        case "fail": return expression(d.expression, values, (error, ready) => settle(Node.fail(error), ready), site);
        case "step": return expression(d.args, values, (args, ready) => settle(actions.get(d.target as string)!.call(args), ready), site);
        case "child": case "handoff": return expression(d.args, values, (args, ready) => {
          const target = flows.get(d.target as string);
          if (!target) throw new Error(`Unknown flow: ${d.target}`);
          return settle(node.kind === "child" ? target.child(args) : target.to(args), ready);
        }, site);
        case "sequence": {
          const members = d.members as string[];
          function sequence(index: number, ready: Values): DynamicNode {
            return lower(members[index], ready, (value, updated) => index === members.length - 1
              ? settle(Node.succeed(value), updated)
              : Node.andThen(Node.succeed(value), sequence(index + 1, updated)), site + "/sequence/" + index);
          }
          return sequence(0, values);
        }
        case "all": {
          const members = d.members as string[];
          return withDependencies(members, values, ready =>
            settle(Node.succeed(Object.fromEntries(members.map(member => [member, ready.get(member)]))), ready), site);
        }
        case "race": case "any": case "quorum": {
          return withShared(d.members as string[], values, ready => {
            const members = Object.fromEntries((d.members as string[]).map(member =>
              [member, lower(member, ready, done, site + "/member/" + member)]));
            return settle(node.kind === "race" ? Node.race(members)
              : node.kind === "any" ? Node.any(members) : Node.quorum(d.count as number, members), ready);
          }, site);
        }
        case "branch": return lower(d.condition as string, values, (condition, ready) =>
          settle(Node.branch(Node.succeed({ condition, values: Object.fromEntries([...ready].filter(([, value]) => !Node.isNode(value))) } as unknown), {
            if: captured(site + "/predicate", (subject: any) => subject.condition === true),
            then: captured(site + "/then", (subject: any) => lower(d.yes as string,
              new Map([...ready].map(([key, value]) => [key, Node.isNode(value) ? value : subject.values[key]])), done, site + "/then")),
            else: captured(site + "/else", (subject: any) => lower(d.no as string,
              new Map([...ready].map(([key, value]) => [key, Node.isNode(value) ? value : subject.values[key]])), done, site + "/else")),
          }), ready), site + "/condition");
        case "recover": return settle(Node.catch(
          lower(d.attempt as string, values, done, site + "/attempt"), {
            onFailure: captured(site + "/recover", () => lower(d.fallback as string, values, done, site + "/fallback")),
          }));
        case "sleep": return settle(Node.map(Sleep.action.call({ millis: d.millis as number }), captured(site, () => null)));
        case "wait": return settle(Node.map(WaitFor.action.call({ name }),
          captured(site, value => Schema.decodeUnknownSync(schema(d.codec as unknown as Codec))(value))));
        case "ask": {
          const codec = d.codec as unknown as Codec;
          const options = codec.tag === "union" && codec.members!.every(member => member.tag === "literal" && typeof member.value === "string")
            ? codec.members!.map(member => member.value as string) : undefined;
          const kind = options ? "select" : codec.tag === "Bool" ? "confirm" : codec.tag === "String" ? "ask" : "json";
          return settle(HumanTask.action.call({
            name, kind, prompt: d.prompt as string, timeoutMs: d["timeout-ms"] as number,
            ...(options ? { options } : {}),
            ...(kind === "json" ? { schema: humanSchema(codec) } : {}),
          }));
        }
        case "poll": {
          const key = `forma/poll/${flow.name}/${name}`;
          const target = generated.get(key)!;
          return expression(d.args, values, (args, ready) => settle(target.child({ args } as never), ready), site);
        }
        default: throw new Error(`Unsupported node: ${node.kind}`);
      }
    }
    return lower(flow.return, new Map([["input", payload]]), done, "root");
  }
  for (const flow of program.workflows) {
    flows.set(flow.name, Flow.make(`forma/flow/${flow.name}`, {
      payload: fields(flow.schemas.payload), success: schema(flow.schemas.success), error: schema(flow.schemas.error),
      capabilities: flow.capabilities, effects: effects(flow),
      deadline: flow["deadline-ms"], maxRounds: flow["max-rounds"], body: payload => body(flow, payload as Record<string, Json>),
    }));
  }
  return {
    flows, actions,
    registrations() {
      const registrations = [...flows.values(), ...generated.values(), ...nativeDeclarations].map(flow => Interpreter.layer(flow));
      return Layer.mergeAll(Poll.layer, ...implementations, ...registrations)
        .pipe(Layer.provideMerge(Action.layerImplementations));
    },
    layer<Error = never, Services = never>(engine: Layer.Layer<FlowRuntime.FlowRuntime, Error, Services> = FlowEngine.layerMemory as Layer.Layer<FlowRuntime.FlowRuntime, Error, Services>) {
      return this.registrations().pipe(Layer.provideMerge(engine));
    },
  };
}

function humanSchema(codec: Codec): Schema.Json {
  switch (codec.tag) {
    case "String": return { type: "string" };
    case "Int": return { type: "integer" };
    case "Float": return { type: "number" };
    case "Bool": return { type: "boolean" };
    case "Json": return {};
    case "Unit": return { type: "null" };
    case "literal": return { enum: [codec.value!] };
    case "record": return { type: "object", properties: Object.fromEntries(Object.entries(codec.fields!).map(([k, v]) => [k, humanSchema(v)])), required: Object.keys(codec.fields!) };
    case "list": return { type: "array", items: humanSchema(codec.item!) };
    case "option": return { ...humanSchema(codec.item!) as object, nullable: true };
    case "union": return { enum: codec.members!.map(member => member.value!) };
    default: throw new Error(`HumanTask does not support this schema: ${codec.tag}`);
  }
}
