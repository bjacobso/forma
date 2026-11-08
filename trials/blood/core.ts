/** Experimental explicit core. No parser, inference, elaborator hooks, or native backend. */
export type Type =
  | { tag: "Int" | "Bool" | "Unit" }
  | { tag: "var"; name: string }
  | { tag: "handle"; region: string }
  | { tag: "pair" | "sum"; left: Type; right: Type }
  | { tag: "fn"; param: Type; result: Type; effects: string[] }
  | { tag: "forall"; types: string[]; rows: string[]; body: Type };

export type Term =
  | { tag: "int"; value: number }
  | { tag: "bool"; value: boolean }
  | { tag: "unit" }
  | { tag: "var"; name: string }
  | { tag: "let"; name: string; value: Term; body: Term }
  | { tag: "pair"; left: Term; right: Term }
  | { tag: "split"; value: Term; left: string; right: string; body: Term }
  | { tag: "inject"; side: "left" | "right"; value: Term; other: Type }
  | { tag: "case"; value: Term; leftName: string; left: Term; rightName: string; right: Term }
  | { tag: "lambda"; name: string; param: Type; result: Type; effects: string[]; body: Term }
  | { tag: "call"; fn: Term; arg: Term }
  | { tag: "poly"; types: string[]; rows: string[]; body: Term }
  | { tag: "instantiate"; value: Term; types: Type[]; rows: string[][] }
  | { tag: "if"; condition: Term; yes: Term; no: Term }
  | { tag: "op"; name: string; arg: Term }
  | { tag: "using"; name: string; region: string; body: Term }
  | { tag: "read" | "close"; name: string }
  | { tag: "fail"; error: string; result: Type }
  | { tag: "catch"; error: string; body: Term; handler: Term };

export interface Signature { param: Type; result: Type }
export interface Contract { type: Type; effects: string[] }
export const Int: Type = { tag: "Int" };
export const Bool: Type = { tag: "Bool" };
export const Unit: Type = { tag: "Unit" };
const unique = (xs: string[]) => [...new Set(xs)].sort();
const union = (...xs: string[][]) => unique(xs.flat());
function same(a: Type, b: Type): boolean {
  // Binder spelling and object property insertion order are not type semantics.
  const key = (t: Type, types: string[] = [], rows: string[] = []): unknown => {
    switch (t.tag) {
      case "Int": case "Bool": case "Unit": return [t.tag];
      case "var": return [t.tag, types.includes(t.name) ? types.indexOf(t.name) : t.name];
      case "handle": return [t.tag, t.region];
      case "pair": case "sum": return [t.tag, key(t.left, types, rows), key(t.right, types, rows)];
      case "fn": return [t.tag, key(t.param, types, rows), key(t.result, types, rows),
        unique(t.effects.map(e => e.startsWith("$") && rows.includes(e.slice(1)) ? `$${rows.indexOf(e.slice(1))}` : e))];
      case "forall": return [t.tag, t.types.length, t.rows.length, key(t.body, [...types, ...t.types], [...rows, ...t.rows])];
    }
  };
  return JSON.stringify(key(a)) === JSON.stringify(key(b));
}
const require = (ok: boolean, message: string): void => { if (!ok) throw new Error(message); };
const affine = (t: Type): boolean => t.tag === "handle" || ((t.tag === "pair" || t.tag === "sum") && (affine(t.left) || affine(t.right)));
const containsRegion = (t: Type, r: string): boolean => {
  switch (t.tag) {
    case "handle": return t.region === r;
    case "pair": case "sum": return containsRegion(t.left, r) || containsRegion(t.right, r);
    case "fn": return containsRegion(t.param, r) || containsRegion(t.result, r);
    case "forall": return containsRegion(t.body, r);
    default: return false;
  }
};

interface Scope { types: Set<string>; rows: Set<string>; regions: Set<string> }
function bind(scope: Scope, types: string[], rows: string[]): Scope {
  const names = [...types, ...rows];
  require(new Set(names).size === names.length, "duplicate type/row binder");
  for (const name of names) {
    require(/^[a-z][a-z0-9]*$/.test(name), "invalid type/row binder");
    require(!scope.types.has(name) && !scope.rows.has(name), "shadowed type/row binder");
  }
  return { ...scope, types: new Set([...scope.types, ...types]), rows: new Set([...scope.rows, ...rows]) };
}

function checkRows(rows: string[], scope: Scope, ops: ReadonlyMap<string, Signature>): string[] {
  for (const row of rows) {
    if (row.startsWith("$")) require(scope.rows.has(row.slice(1)), `unbound effect row ${row}`);
    else require(ops.has(row) || /^error:[A-Za-z][A-Za-z0-9]*$/.test(row) ||
      ["Resource.open", "Resource.read", "Resource.close"].includes(row), `unknown effect ${row}`);
  }
  return unique(rows);
}

function checkType(t: Type, scope: Scope, ops: ReadonlyMap<string, Signature>): Type {
  switch (t.tag) {
    case "Int": case "Bool": case "Unit": return { tag: t.tag };
    case "var": require(scope.types.has(t.name), `unbound type ${t.name}`); return t;
    case "handle": require(scope.regions.has(t.region), `unbound region ${t.region}`); return t;
    case "pair": case "sum": return { tag: t.tag, left: checkType(t.left, scope, ops), right: checkType(t.right, scope, ops) };
    case "fn": return { tag: "fn", param: checkType(t.param, scope, ops), result: checkType(t.result, scope, ops), effects: checkRows(t.effects, scope, ops) };
    case "forall": return { tag: "forall", types: t.types, rows: t.rows, body: checkType(t.body, bind(scope, t.types, t.rows), ops) };
    default: throw new Error("unknown type constructor");
  }
}

function substitute(t: Type, types: Map<string, Type>, rows: Map<string, string[]>): Type {
  switch (t.tag) {
    case "var": return types.get(t.name) ?? t;
    case "pair": case "sum": return { ...t, left: substitute(t.left, types, rows), right: substitute(t.right, types, rows) };
    case "fn": return { ...t, param: substitute(t.param, types, rows), result: substitute(t.result, types, rows),
      effects: union(...t.effects.map(e => e.startsWith("$") ? rows.get(e.slice(1)) ?? [e] : [e])) };
    case "forall": {
      const ts = new Map(types), rs = new Map(rows);
      t.types.forEach(n => ts.delete(n)); t.rows.forEach(n => rs.delete(n));
      return { ...t, body: substitute(t.body, ts, rs) };
    }
    default: return t;
  }
}

/** Public contracts are first-order data: host code cannot receive closures or handles. */
function dataType(t: Type): boolean {
  return ["Int", "Bool", "Unit"].includes(t.tag) || ((t.tag === "pair" || t.tag === "sum") && dataType(t.left) && dataType(t.right));
}

/** Independently checks explicit terms. No extension-supplied type is trusted. */
export function check(term: Term, signatures: ReadonlyMap<string, Signature> = new Map()): Contract {
  const root: Scope = { types: new Set(), rows: new Set(), regions: new Set() };
  const ops = new Map<string, Signature>();
  for (const [name, sig] of signatures) {
    require(/^[A-Z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/.test(name) && !name.startsWith("Resource."), "invalid or reserved capability name");
    require(dataType(sig.param) && dataType(sig.result), "capability boundary requires first-order data");
    ops.set(name, { param: checkType(sig.param, root, signatures), result: checkType(sig.result, root, signatures) });
  }
  function infer(t: Term, env: Map<string, Type>, scope: Scope): Contract {
    const result = (type: Type, ...effects: string[][]): Contract => ({ type, effects: union(...effects) });
    const local = (names: [string, Type][], body: Term): Contract => {
      const next = new Map(env);
      for (const [name, type] of names) {
        require(!next.has(name), `shadowed binding ${name}`);
        next.set(name, type);
      }
      const checked = infer(body, next, scope);
      for (const name of env.keys()) if (!next.has(name)) env.delete(name);
      return checked;
    };
    switch (t.tag) {
      case "int": require(Number.isSafeInteger(t.value), "Int outside safe integer range"); return result(Int);
      case "bool": return result(Bool);
      case "unit": return result(Unit);
      case "var": {
        const type = env.get(t.name);
        require(type !== undefined, `unbound or moved binding ${t.name}`);
        if (affine(type!)) env.delete(t.name);
        return result(type!);
      }
      case "let": {
        const value = infer(t.value, env, scope);
        const body = local([[t.name, value.type]], t.body);
        return result(body.type, value.effects, body.effects);
      }
      case "pair": {
        const left = infer(t.left, env, scope), right = infer(t.right, env, scope);
        return result({ tag: "pair", left: left.type, right: right.type }, left.effects, right.effects);
      }
      case "split": {
        const value = infer(t.value, env, scope);
        if (value.type.tag !== "pair") throw new Error("split expects pair");
        const body = local([[t.left, value.type.left], [t.right, value.type.right]], t.body);
        return result(body.type, value.effects, body.effects);
      }
      case "inject": {
        const value = infer(t.value, env, scope), other = checkType(t.other, scope, ops);
        return result({ tag: "sum", left: t.side === "left" ? value.type : other,
          right: t.side === "right" ? value.type : other }, value.effects);
      }
      case "case": {
        const value = infer(t.value, env, scope);
        if (value.type.tag !== "sum") throw new Error("case expects sum");
        require(!env.has(t.leftName) && !env.has(t.rightName), "shadowed case binder");
        const leftEnv = new Map(env), rightEnv = new Map(env);
        leftEnv.set(t.leftName, value.type.left); rightEnv.set(t.rightName, value.type.right);
        const left = infer(t.left, leftEnv, scope), right = infer(t.right, rightEnv, scope);
        require(same(left.type, right.type), "case result type mismatch");
        for (const name of env.keys()) if (!leftEnv.has(name) || !rightEnv.has(name)) env.delete(name);
        return result(left.type, value.effects, left.effects, right.effects);
      }
      case "lambda": {
        const param = checkType(t.param, scope, ops), expected = checkType(t.result, scope, ops);
        const allowed = checkRows(t.effects, scope, ops);
        // Closures are unrestricted in this core; they cannot capture affine values.
        const next = new Map([...env].filter(([, type]) => !affine(type)));
        require(!env.has(t.name), `shadowed binding ${t.name}`);
        next.set(t.name, param);
        const body = infer(t.body, next, scope);
        require(same(body.type, expected), "lambda result type mismatch");
        require(body.effects.every(e => allowed.includes(e)), "lambda hides effects");
        return result({ tag: "fn", param, result: expected, effects: allowed });
      }
      case "call": {
        const fn = infer(t.fn, env, scope), arg = infer(t.arg, env, scope);
        if (fn.type.tag !== "fn") throw new Error("call expects function");
        require(same(fn.type.param, arg.type), "argument type mismatch");
        return result(fn.type.result, fn.effects, arg.effects, fn.type.effects);
      }
      case "poly": {
        require(["lambda", "poly", "int", "bool", "unit"].includes(t.body.tag), "polymorphism requires a syntactic value");
        const body = infer(t.body, new Map([...env].filter(([, type]) => !affine(type))), bind(scope, t.types, t.rows));
        require(body.effects.length === 0, "effectful polymorphic value");
        return result({ tag: "forall", types: t.types, rows: t.rows, body: body.type });
      }
      case "instantiate": {
        const value = infer(t.value, env, scope);
        if (value.type.tag !== "forall") throw new Error("instantiate expects forall");
        require(t.types.length === value.type.types.length && t.rows.length === value.type.rows.length, "instantiation arity mismatch");
        const types = t.types.map(type => checkType(type, scope, ops));
        // No impredicative instantiation or affine type arguments in this first core.
        const mono = (type: Type): boolean => type.tag !== "forall" &&
          ((type.tag !== "pair" && type.tag !== "sum") || (mono(type.left) && mono(type.right))) &&
          (type.tag !== "fn" || (mono(type.param) && mono(type.result)));
        require(types.every(type => mono(type) && !affine(type)), "type argument must be unrestricted and monomorphic");
        const type = substitute(value.type.body, new Map(value.type.types.map((n, i) => [n, types[i]!])),
          new Map(value.type.rows.map((n, i) => [n, checkRows(t.rows[i]!, scope, ops)])));
        // Rechecking also rejects binder capture introduced by substitution.
        return result(checkType(type, scope, ops), value.effects);
      }
      case "if": {
        const condition = infer(t.condition, env, scope);
        require(same(condition.type, Bool), "condition must be Bool");
        const yesEnv = new Map(env), noEnv = new Map(env);
        const yes = infer(t.yes, yesEnv, scope), no = infer(t.no, noEnv, scope);
        require(same(yes.type, no.type), "branch type mismatch");
        for (const name of env.keys()) if (!yesEnv.has(name) || !noEnv.has(name)) env.delete(name);
        return result(yes.type, condition.effects, yes.effects, no.effects);
      }
      case "op": {
        const sig = ops.get(t.name);
        require(sig !== undefined, `unknown capability ${t.name}`);
        const arg = infer(t.arg, env, scope);
        require(same(sig!.param, arg.type), "capability argument type mismatch");
        return result(sig!.result, arg.effects, [t.name]);
      }
      case "using": {
        require(!scope.regions.has(t.region), "shadowed region");
        require(!env.has(t.name), `shadowed binding ${t.name}`);
        const next = new Map(env); next.set(t.name, { tag: "handle", region: t.region });
        const body = infer(t.body, next, { ...scope, regions: new Set([...scope.regions, t.region]) });
        require(!containsRegion(body.type, t.region), "resource escapes its region");
        for (const name of env.keys()) if (!next.has(name)) env.delete(name);
        return result(body.type, body.effects, ["Resource.open", "Resource.close"]);
      }
      case "read": case "close": {
        require(env.get(t.name)?.tag === "handle", `unbound or moved resource ${t.name}`);
        if (t.tag === "close") env.delete(t.name);
        return result(t.tag === "read" ? Int : Unit, [t.tag === "read" ? "Resource.read" : "Resource.close"]);
      }
      case "fail": {
        checkRows([`error:${t.error}`], scope, ops);
        return result(checkType(t.result, scope, ops), [`error:${t.error}`]);
      }
      case "catch": {
        checkRows([`error:${t.error}`], scope, ops);
        // A body may move a resource before failing. Never restore ownership on catch.
        const body = infer(t.body, env, scope), handler = infer(t.handler, env, scope);
        require(same(body.type, handler.type), "handler type mismatch");
        return result(body.type, body.effects.filter(e => e !== `error:${t.error}`), handler.effects);
      }
      default: throw new Error("unknown core term");
    }
  }
  return infer(term, new Map(), root);
}

export type Data = number | boolean | null | { left: Data; right: Data } | { side: "left" | "right"; value: Data };
type Value = number | boolean | null | { left: Value; right: Value } | { side: "left" | "right"; value: Value }
  | { kind: "closure"; name: string; body: Term; env: Map<string, Value> }
  | { kind: "poly"; body: Term; env: Map<string, Value> }
  | { kind: "handle"; id: number; closed: boolean };
export interface Capability extends Signature { invoke: (arg: Data) => Data }
export type RunResult = { status: "completed"; value: Data; trace: string[]; contract: Contract }
  | { status: "rejected" | "failed"; message: string; trace: string[] };
class Failure extends Error {
  readonly label: string;
  constructor(label: string) { super(label); this.label = label; }
}

function validData(value: unknown, type: Type): value is Data {
  switch (type.tag) {
    case "Int": return Number.isSafeInteger(value);
    case "Bool": return typeof value === "boolean";
    case "Unit": return value === null;
    case "pair": return typeof value === "object" && value !== null &&
      "left" in value && "right" in value && validData(value.left, type.left) && validData(value.right, type.right);
    case "sum": return typeof value === "object" && value !== null && "side" in value && "value" in value &&
      (value.side === "left" ? validData(value.value, type.left) : value.side === "right" && validData(value.value, type.right));
    default: return false;
  }
}

/** Check, validate grants, then execute. Resource handles here are simulated, not OS files. */
export function run(term: Term, capabilities: ReadonlyMap<string, Capability> = new Map(), grants: string[] = [], steps = 10000): RunResult {
  const trace: string[] = [];
  let contract: Contract;
  try {
    contract = check(term, capabilities);
    require(dataType(contract.type), "run result must be first-order data");
    require(contract.effects.every(e => e.startsWith("error:") || grants.includes(e)), "ungranted capability");
    require(Number.isSafeInteger(steps) && steps > 0, "invalid step budget");
  } catch (error) { return { status: "rejected", message: String(error), trace }; }
  let nextId = 0;
  const close = (h: { id: number; closed: boolean }) => {
    if (!h.closed) { h.closed = true; trace.push(`close:${h.id}`); }
  };
  const evaluate = (t: Term, env: Map<string, Value>): Value => {
    if (--steps < 0) throw new Error("step limit exceeded");
    const bindValue = (name: string, value: Value, body: Term, base = env): Value => {
      const next = new Map(base); next.set(name, value); return evaluate(body, next);
    };
    switch (t.tag) {
      case "int": case "bool": return t.value;
      case "unit": return null;
      case "var": return env.get(t.name)!;
      case "let": return bindValue(t.name, evaluate(t.value, env), t.body);
      case "pair": return { left: evaluate(t.left, env), right: evaluate(t.right, env) };
      case "split": {
        const value = evaluate(t.value, env) as { left: Value; right: Value };
        const next = new Map(env); next.set(t.left, value.left); next.set(t.right, value.right);
        return evaluate(t.body, next);
      }
      case "inject": return { side: t.side, value: evaluate(t.value, env) };
      case "case": {
        const value = evaluate(t.value, env) as { side: "left" | "right"; value: Value };
        return bindValue(value.side === "left" ? t.leftName : t.rightName, value.value,
          value.side === "left" ? t.left : t.right);
      }
      case "lambda": return { kind: "closure", name: t.name, body: t.body, env: new Map(env) };
      case "poly": return { kind: "poly", body: t.body, env: new Map(env) };
      case "instantiate": {
        const p = evaluate(t.value, env) as { body: Term; env: Map<string, Value> };
        return evaluate(p.body, p.env);
      }
      case "call": {
        const fn = evaluate(t.fn, env) as { name: string; body: Term; env: Map<string, Value> };
        const arg = evaluate(t.arg, env);
        return bindValue(fn.name, arg, fn.body, fn.env);
      }
      case "if": return evaluate(evaluate(t.condition, env) ? t.yes : t.no, env);
      case "op": {
        const arg = evaluate(t.arg, env) as Data, capability = capabilities.get(t.name)!;
        require(validData(arg, capability.param), "invalid host argument");
        trace.push(`call:${t.name}`);
        const value = capability.invoke(arg);
        require(validData(value, capability.result), "invalid host result");
        return value;
      }
      case "using": {
        const h = { kind: "handle" as const, id: nextId++, closed: false };
        trace.push(`open:${h.id}`);
        try { return bindValue(t.name, h, t.body); } finally { close(h); }
      }
      case "read": case "close": {
        const h = env.get(t.name) as { id: number; closed: boolean };
        require(!h.closed, "resource already closed");
        if (t.tag === "close") { close(h); return null; }
        trace.push(`read:${h.id}`); return h.id;
      }
      case "fail": throw new Failure(t.error);
      case "catch": {
        try { return evaluate(t.body, env); }
        catch (error) { if (error instanceof Failure && error.label === t.error) return evaluate(t.handler, env); throw error; }
      }
    }
  };
  try { return { status: "completed", value: evaluate(term, new Map()) as Data, trace, contract }; }
  catch (error) { return { status: "failed", message: String(error), trace }; }
}
