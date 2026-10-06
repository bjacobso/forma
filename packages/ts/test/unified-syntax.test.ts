import { describe, expect, test } from "vitest";
import { generateEffectProgram } from "../src/mechanics/elaborate.js";

function generate(source: string) {
  const result = generateEffectProgram(source);
  expect(result.diagnostics).toEqual([]);
  expect(result.ok).toBe(true);
  return result.code!;
}

describe("unified Effect surface", () => {
  test("record types, derived brands, keyword unions, optional fields and noun declarations", () => {
    const code = generate(`
      (type OrderId (Brand String))
      (type Status (Union :pending :paid))
      (type Order {:id OrderId :status Status :coupon (Option String)})
      (error Missing {:id OrderId})
      (error Timeout)
      (class Customer {:name String})
      (: status (-> Order Status))
      (define status [order] order.status)
      (: initial (Effect Status))
      (define initial :pending)
    `);
    expect(code).toContain('Schema.brand("OrderId")');
    expect(code).toContain('Schema.Literals(["pending", "paid"])');
    expect(code).toContain('order.status');
    expect(code).toMatch(/export const initial: Effect.Effect<Status> =/);
  });
  test("service signatures, optional Effect sets, pure bindings and tail lifting", () => {
    const code = generate(`
      (service Clock (: now (Effect Int)))
      (: next (Effect Int [] [Clock.now]))
      (define next (do! [now Clock.now :let [later (+ now 1)]] later))
    `);
    expect(code).toContain('yield* clock.now');
    expect(code).toContain('return later');
  });
  test("module signatures may follow effect definitions", () => {
    expect(generate('(define inc [x] (+ x 1)) (: inc (-> Int (Effect Int)))')).toContain('export const inc');
  });
  test("Option constructors and binder catch-all use one spelling", () => {
    const code = generate(`
      (error Missing)
      (: found (Effect Int [Missing]))
      (define found (match (Some 1) (Some n) n None (fail (Missing {}))))
      (: recovered (Effect Int))
      (define recovered (catch found err 0))
    `);
    expect(code).toContain('Option.some(1)');
  });
});

import { Effect } from "effect";
import { Builtins, Evaluator, Type, Reader } from "../src/index.js";
const builtins = Builtins.defaultBuiltins;
const prelude = Evaluator.makePreludeLayer(builtins);
const evaluate = async (source: string) => (await Effect.runPromise(Effect.provide(Evaluator.evaluate(source, { builtins, stepLimit: 100_000 }), prelude))).value;

describe("unified core surface and runtime semantics", () => {
  test("Tagged constructors are available and matched by their tag", async () => {
    const source = `(type (Maybe a) (Tagged (Some a) None))
      (define unwrap [value] (match value (Some n) n None 0))
      [(unwrap (Some 7)) (unwrap None)]`;
    expect(await evaluate(source)).toEqual([7, 0]);
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('List<Int>');
  });
  test("obsolete type declarations are rejected", async () => {
    await expect(evaluate('(define-type (Maybe a) (Some a) (None))')).rejects.toThrow("define-type");
  });
  test("macro ellipsis, function sugar, dot access, and unless", async () => {
    expect(await evaluate('(macro (twice x) `(+ ~x ~x)) (define read [r] (twice r.count)) (unless false (read {:count 3}))')).toBe(6);
  });
  test("record constructor patterns destructure their payload", async () => {
    expect(await evaluate('(type Shape (Tagged (Circle {:radius Number}) Point)) (match (Circle {:radius 3}) (Circle {:radius r}) r Point 0)')).toBe(3);
  });
  test("quote returns data without evaluating its datum", async () => {
    expect(await evaluate("'unbound")).toMatchObject({ _tag: 'KSymbol', name: 'unbound' });
  });
  test("module signatures can appear after definitions", async () => {
    expect(await Effect.runPromise(Type.inferSourceStr('(define plus [x] (+ x 1)) (: plus (-> Number Number)) (plus 2)'))).toBe('Number');
  });
});

import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { elaborateProgram } from "../src/descriptor/elaborate.js";
import { bootstrapOntologyPreludes } from "../src/Preludes.js";

describe("typed forms and domain surface", () => {
  const source = `
    (type GreetingIR {:kind "Greeting" :name Symbol :message String :doc (Option String)})
    (form (greeting name message {:keys [doc]})
      "A greeting."
      :types {:name (Declares Greeting) :message String :doc (Option String)}
      :ir GreetingIR
      {:kind "Greeting" :name name :message message :doc doc})`;
  const prelude = bootstrapFromSources('', source);
  test("one definition derives syntax, bindings, checking and construction", () => {
    const descriptor = prelude.descriptions.get('greeting')!;
    expect(descriptor.identifiers).toEqual([{ name: 'name', kind: 'Symbol', declaration: true }]);
    expect(descriptor.produces).toBe('GreetingIR');
    const result = elaborateProgram('(greeting hello "Hi" :doc "Welcome")', { prelude });
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations[0]?.payload).toEqual({ kind: 'Greeting', name: 'hello', message: 'Hi', doc: 'Welcome' });
  });
  test("typed holes and unknown options are diagnosed at author spans", () => {
    const result = elaborateProgram('(greeting hello 42) (greeting other "ok" :typo true)', { prelude });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(d => d.message)).toEqual(expect.arrayContaining(['message does not match its declared hole type', 'Unknown option :typo']));
    expect(result.diagnostics.every(d => d.span !== undefined)).toBe(true);
  });
  test("entity records are required by default and support Id references", () => {
    const result = elaborateProgram('(entity Department {:name String}) (entity Employee {:name String :department (Id Department) :active (Option Bool)} :doc "Staff")', { prelude: bootstrapOntologyPreludes() });
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations[1]?.payload).toMatchObject({ kind: 'Entity', name: 'Employee', fields: [{ name: 'employee/name', type: 'String', required: true }, { name: 'employee/department', type: ['Id', 'Department'], required: true }, { name: 'employee/active', type: 'Bool', required: false }] });
  });
  test("braces always read as maps", () => {
    expect(Effect.runSync(Reader.parseToSExpr('{a b}'))._tag).toBe('Map');
    expect(() => Effect.runSync(Reader.parseToSExpr('{a b c}'))).toThrow();
  });
});

import { migrateSource } from '../src/surface/migrate.js';
describe('canonical semantics and structural migration', () => {
  test('keywords, strings and quoted symbols remain distinct', async () => {
    expect(await evaluate('[ (= :x ":x") (= :x :x) (= (quote x) "x") (get {:x 1 ":x" 2} :x) (get {:x 1 ":x" 2} ":x")]')).toEqual([false,true,false,1,2]);
    expect(await Effect.runPromise(Type.inferSourceStr(':x'))).toBe(':x');
  });
  test('tagged values have exactly their declared discriminator and fields', async () => {
    const source='(type Shape (Tagged :tag kind (Circle {:radius Number}) Point)) [(Circle {:radius 3}) Point (match (Circle {:radius 4}) (Circle {:radius r}) r Point 0)]';
    expect(await evaluate(source)).toEqual([new Map<string,string | number>([[":kind","Circle"],[":radius",3]]),new Map([[":kind","Point"]]),4]);
    expect(await Effect.runPromise(Type.inferSourceStr('(type Shape (Tagged (Circle {:radius Number}) Point)) (match (Circle {:radius 4}) (Circle {:radius r}) r Point 0)'))).toBe('Number');
  });
  test('field access follows lexical scope', async () => {
    expect(await evaluate('(define record {:count 7}) (let [other record] other.count)')).toBe(7);
  });
  test('migration is idempotent and preserves comments', () => {
    const source='; module\n(define-schema User (Struct\n  ; name\n  (field name String)\n  (field nickname (Optional String))))\n; function\n(define greet (fn [user] ; body\n (get user :name)))\n';
    const migrated=migrateSource(source);
    expect(migrated.source).toContain('(type User');
    expect(migrated.source).toContain(':nickname (Option String)');
    for (const comment of ['; module','; name','; function','; body']) expect(migrated.source).toContain(comment);
    expect(migrateSource(migrated.source).changed).toBe(false);
    expect(migrated.script.ops.every(op=>op.op==='replace' && op.target.length>0)).toBe(true);
  });
  test('migration preserves complete reader macro bodies', () => {
    const source = '(define-macro not [x] `(if ~x false true))';
    const expression = Effect.runSync(Reader.parseToSExpr(source));
    expect(expression._tag).toBe('List');
    if (expression._tag === 'List') {
      const body = expression.items[3]!;
      expect(source.slice(body.loc.start, body.loc.end)).toBe('`(if ~x false true)');
    }
    const migrated = migrateSource(source);
    expect(migrated.source).toBe('(macro (not x) `(if ~x false true))');
    expect(migrateSource(migrated.source).changed).toBe(false);
  });
  test('Effect tagged constructors support record patterns', () => {
    const code=generate('(type Discount (Tagged :tag kind (Percent {:rate Int}) NoDiscount)) (: apply (-> Discount Int)) (define apply [discount] (match discount (Percent {:rate r}) r NoDiscount 0)) (: discount Discount) (define discount (Percent {:rate 10}))');
    expect(code).toContain('kind === "Percent"');
  });
  test('form output is checked against its IR contract', () => {
    const prelude=bootstrapFromSources('', '(type ItemIR {:kind "Item" :name Symbol :count Int}) (form (item name) :types {:name (Declares Item)} :ir ItemIR {:kind "Item" :name name :count "wrong"})');
    const result=elaborateProgram('(item example)', {prelude});
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain('payload.count must be Int');
  });
});

describe('typed form contracts and shared binding patterns', () => {
  test('keywords can occupy positional holes', () => {
    const prelude=bootstrapFromSources('', '(type ChoiceIR {:kind "Choice" :value Keyword}) (form (choice value) :types {:value Keyword} :ir ChoiceIR {:kind "Choice" :value value})');
    expect(elaborateProgram('(choice :blue)',{prelude}).declarations[0]?.payload).toEqual({kind:'Choice',value:'blue'});
  });
  test('computed result types register the declared binding', () => {
    const prelude=bootstrapFromSources('', '(type ItemIR {:kind "Item" :name Symbol}) (form (item name) :types {:name (Declares Item)} :ir ItemIR :type (fn [holes] (quote String)) {:kind "Item" :name name})');
    const env=new SimpleSemanticEnvironment();
    const result=elaborateProgram('(item example)',{prelude,semanticEnv:env});
    expect(result.diagnostics).toEqual([]);
    expect(env.getBindingType('example')).toEqual({_tag:'TCon',name:'String'});
  });
  test('Expr holes check String and scope bindings', () => {
    const prelude=bootstrapFromSources('', `(type CheckIR {:kind "Check"})
      (form (check expression) :types {:expression (Expr String)} :ir CheckIR
        :scope {:expression (fn [holes] {(quote local) (quote String)})} {:kind "Check"})`);
    expect(elaborateProgram('(check local)',{prelude}).ok).toBe(true);
    expect(elaborateProgram('(check 42)',{prelude}).diagnostics[0]?.message).toContain('expects String');
  });
  test('warning diagnostics do not reject a valid form', () => {
    const prelude=bootstrapFromSources('', '(type NoticeIR {:kind "Notice"}) (form (notice) :types {} :ir NoticeIR :check (fn [holes] [{:severity :warning :message "Consider a name"}]) {:kind "Notice"})');
    const result=elaborateProgram('(notice)',{prelude});
    expect(result.ok).toBe(true);
    expect(result.diagnostics[0]?.severity).toBe('warning');
  });
  test('child IR remains usable by a parent projection', () => {
    const prelude=bootstrapFromSources('', `(type LeafIR {:kind "Leaf" :value Int}) (type TreeIR {:kind "Tree" :total Int})
      (form (leaf value) :types {:value Int} :ir LeafIR {:kind "Leaf" :value value})
      (form (tree child ...) :types {:child (List leaf)} :ir TreeIR {:kind "Tree" :total (reduce (fn [sum leaf] (+ sum leaf.value)) 0 child)})`);
    expect(elaborateProgram('(tree (leaf 2) (leaf 3))',{prelude}).declarations[0]?.payload).toEqual({kind:'Tree',total:5});
    expect(elaborateProgram('(tree (leaf "bad"))',{prelude}).ok).toBe(false);
  });
  test('constructors and nested record patterns work in functions and let', async () => {
    const source='(type Shape (Tagged (Circle {:radius Number}) Point)) (define area [(Circle {:radius r})] (* r r)) (let [(Circle {:radius r}) (Circle {:radius 3})] (+ r (area (Circle {:radius 4}))))';
    expect(await evaluate(source)).toBe(19);
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('Number');
  });
  test('keyword and symbol construction preserve runtime kinds', async () => {
    expect(await evaluate('[(keyword "color") (sym "name")]')).toMatchObject([{_tag:'KKeyword',name:':color'},{_tag:'KSymbol',name:'name'}]);
  });
});
import { SimpleSemanticEnvironment } from '../src/descriptor/SemanticEnvironment.js';

import { elaborateSources, toJsonValue } from '../src/descriptor/elaborate.js';
import { KKeyword, KSymbol, mapKey } from '../src/evaluator/types.js';
describe('typed form module semantics', () => {
  test('forms and IR types defined in the program elaborate across files without changing the prelude', () => {
    const prelude = bootstrapFromSources('', '');
    const result = elaborateSources([
      {sourceId:'use',source:'(greeting hi "Hello")'},
      {sourceId:'library',source:`(type GreetingIR {:kind "Greeting" :name Symbol :message String :doc (Option String)})
        (form (greeting name message {:keys [doc]}) :types {:name (Declares Greeting) :message String :doc (Option String)} :ir GreetingIR
          {:kind "Greeting" :name name :message message :doc doc})`}
    ],{prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations[0]?.payload).toEqual({kind:'Greeting',name:'hi',message:'Hello'});
    expect(prelude.descriptions.has('greeting')).toBe(false);
  });
  test('IR contracts distinguish strings, symbols and keywords', () => {
    const prelude=bootstrapFromSources('',`(type ValueIR {:kind "Value" :value String})
      (form (value input) :types {:input Keyword} :ir ValueIR {:kind "Value" :value input})`);
    const result=elaborateProgram('(value :hello)',{prelude});
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain('payload.value must be String');
  });
  test('IR contracts reject undeclared fields and invalid map key types', () => {
    const prelude=bootstrapFromSources('',`(type ValueIR {:kind "Value" :values (Map String Int)})
      (form (value) :types {} :ir ValueIR {:kind "Value" :values {:wrong 1} :typo true})`);
    const result=elaborateProgram('(value)',{prelude});
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain('payload.values.key must be String');
    expect(result.diagnostics[0]?.message).toContain('is not a declared field');
  });
  test('JSON projection preserves colon-prefixed string keys', () => {
    expect(toJsonValue(new Map([[mapKey(KKeyword(':key'))!,1],[mapKey(':key')!,2],[mapKey(KSymbol('key'))!,3]]))).toEqual({key:3,':key':2});
  });
});


describe('canonical numeric types', () => {
  test('integers, real numbers and Bool have distinct canonical types', async () => {
    for (const [source,type] of [['42','Int'],['1.5','Number'],['true','Bool'],['(+ 1 2)','Int'],['(/ 1 2)','Number'],['(floor 1.5)','Int'],['(if true 1 2.5)','Number']]) {
      expect(await Effect.runPromise(Type.inferSourceStr(source!))).toBe(type);
    }
  });
  test('Int widens to Number but fractional division cannot promise Int', async () => {
    expect(await Effect.runPromise(Type.inferSourceStr('(: inc (-> Int Int)) (define inc [n] (+ n 1)) (inc 2)'))).toBe('Int');
    expect(await Effect.runPromise(Type.inferSourceStr('(: real Number) (define real 1) real'))).toBe('Number');
    await expect(Effect.runPromise(Type.inferSourceStr('(: half (-> Int Int)) (define half [n] (/ n 2))'))).rejects.toThrow('Number');
    await expect(Effect.runPromise(Type.inferSourceStr('(if 1 true false)'))).rejects.toThrow('Bool');
  });
});

describe("literal checking and typed domain scopes", () => {
  test("literal and Union annotations check exact values in definitions and calls", async () => {
    expect(await Effect.runPromise(Type.inferSourceStr('(type Plan (Union :free :pro)) (: select (-> Plan Plan)) (define select [plan] plan) (select :pro)'))).toBe('Union<:free, :pro>');
    expect(await Effect.runPromise(Type.inferSourceStr('(: name "Ada") (define name "Ada") name'))).toBe('"Ada"');
    await expect(Effect.runPromise(Type.inferSourceStr('(: name "Ada") (define name "Grace")'))).rejects.toThrow();
    await expect(Effect.runPromise(Type.inferSourceStr('(type Plan (Union :free :pro)) (: select (-> Plan Plan)) (define select [plan] plan) (select :enterprise)'))).rejects.toThrow();
  });
  test("record literal fields are checked against their literal types", async () => {
    expect(await Effect.runPromise(Type.inferSourceStr('(: person {:name "Ada" :age Int}) (define person {:name "Ada" :age 20}) person'))).toContain('"Ada"');
    await expect(Effect.runPromise(Type.inferSourceStr('(: person {:name "Ada"}) (define person {:name "Grace"})'))).rejects.toThrow();
  });
  test("static string keys preserve identity alongside keyword keys", async () => {
    const source='(let [record {:x 1 ":x" "two"}] [(get record :x) (get record ":x")])';
    expect(await evaluate(source)).toEqual([1,'two']);
    await expect(Effect.runPromise(Type.inferSourceStr('(let [record {:x 1 ":x" "two"}] (: (get record ":x") Int))'))).rejects.toThrow();
  });
  test("query predicates see declared short field names and require Bool", () => {
    const prelude=bootstrapOntologyPreludes();
    const result=elaborateProgram('(entity Person {:name String :active Bool}) (query active-people :from Person :where active :select [name])',{prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations[1]?.payload).toMatchObject({kind:'Query',name:'active-people',from:'Person',select:['person/name']});
    const bad=elaborateProgram('(entity Person {:name String}) (query wrong :from Person :where name)',{prelude});
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.some(d=>d.message.includes('expects Bool'))).toBe(true);
  });
});

describe("standard constructors and contextual records", () => {
  test("Option constructors work without a user declaration", async () => {
    const source='[(match (Some 3) (Some value) value None 0) (match None (Some value) value None 0)]';
    expect(await evaluate(source)).toEqual([3,0]);
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('List<Int>');
  });
  test("optional record fields lift supplied values and fill absent fields", async () => {
    const source='(type Person {:name String :nickname (Option String)}) (: person Person) (define person {:name "Ada"}) (: named Person) (define named {:name "Ada" :nickname "A"}) [(match person.nickname (Some nick) nick None "missing") (match named.nickname (Some nick) nick None "missing")]';
    expect(await evaluate(source)).toEqual(['missing','A']);
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('List<String>');
  });
  test("record lifting applies to function parameters and constructor payloads", async () => {
    const source='(type Person {:name String :nickname (Option String)}) (: read (-> Person String)) (define read [person] (match person.nickname (Some nick) nick None person.name)) (read {:name "Ada"})';
    expect(await evaluate(source)).toBe('Ada');
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('String');
  });
});

describe('constructor scope',()=>{
  test('qualified constructors preserve their wire tag and payload shape',async()=>{
    const source='(type Shape (Tagged :tag kind (Circle {:radius Number}) Point)) (match (Shape.Circle {:radius 2}) (Shape.Circle {:radius radius}) radius Shape.Point 0)';
    expect(await evaluate(source)).toBe(2);
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('Number');
  });
});

describe('nominal brands', () => {
  test('derived brand constructors accept their base and preserve distinct types', async () => {
    const source='(type UserId (Brand String)) (type OrderId (Brand String)) (: read (-> UserId String)) (define read [id] "ok") (read (UserId "user:1"))';
    expect(await evaluate(source)).toBe('ok');
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('String');
    await expect(Effect.runPromise(Type.inferSourceStr(source.replace('(read (UserId "user:1"))','(read (OrderId "order:1"))')))).rejects.toThrow();
    await expect(Effect.runPromise(Type.inferSourceStr(source.replace('(read (UserId "user:1"))','(read "user:1")')))).rejects.toThrow();
  });
});

describe('open records and schema metadata', () => {
  test('open rows accept additional fields and retain required field checking', async () => {
    const source='(: read (-> {:name String & r} String)) (define read [person] person.name) (read {:name "Ada" :age 37})';
    expect(await evaluate(source)).toBe('Ada');
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('String');
    await expect(Effect.runPromise(Type.inferSourceStr(source.replace(':name "Ada"', ':name 42')))).rejects.toThrow();
  });
  test('entity fields retain keyword Union members and reject unknown metadata', () => {
    const prelude=bootstrapOntologyPreludes();
    const result=elaborateProgram('(entity Account {:plan (Union :free :pro) :label (String :doc "Display name")})',{prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations[0]?.payload).toMatchObject({fields:[{name:'account/plan',type:['Union',':free',':pro']},{name:'account/label',description:'Display name'}]});
    const bad=elaborateProgram('(entity Account {:label (String :min 2)})',{prelude});
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.some(d=>d.message.includes('Unknown type metadata :min'))).toBe(true);
  });
});

describe('ambiguous constructor resolution', () => {
  test('expected types choose a scoped nullary constructor', async () => {
    const source='(type Discount (Tagged None (Percent Int))) (type Shipping (Tagged None (Express Int))) (: discount Discount) (define discount None) (: shipping Shipping) (define shipping None) [(match discount Discount.None 1 (Discount.Percent _) 2) (match shipping Shipping.None 3 (Shipping.Express _) 4)]';
    expect(await evaluate(source)).toEqual([1,3]);
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('List<Int>');
  });
  test('an ambiguous bare constructor needs an expected type', async () => {
    const source='(type A (Tagged Empty)) (type B (Tagged Empty)) Empty';
    await expect(evaluate(source)).rejects.toThrow('Ambiguous constructor Empty');
    await expect(Effect.runPromise(Type.inferSourceStr(source))).rejects.toThrow('Ambiguous constructor Empty');
  });
  test('function argument and return signatures resolve constructors', async () => {
    const source='(type A (Tagged Empty)) (type B (Tagged Empty)) (: make (-> Int A)) (define make [n] Empty) (: use (-> B Int)) (define use [b] (match b Empty 7)) (use Empty)';
    expect(await evaluate(source)).toBe(7);
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('Int');
  });
});

 test("nested variable ascriptions evaluate their expression", async () => {
   const source = "(: identity (-> Int Int)) (define identity [x] (: x Int)) (identity 42)";
   expect(await evaluate(source)).toBe(42);
   expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe("Int");
 });

 test("generic structural aliases substitute each application independently", async () => {
   const source = '(type (Box a) {:value a}) (: read-int (-> (Box Int) Int)) (define read-int [box] box.value) (: read-string (-> (Box String) String)) (define read-string [box] box.value) [(read-int {:value 42}) (read-string {:value "ok"})]';
   expect(await evaluate(source)).toEqual([42, "ok"]);
   expect(await Effect.runPromise(Type.inferSourceStr('(type (Box a) {:value a}) (: read (-> (Box Int) Int)) (define read [box] box.value) (read {:value 42})'))).toBe('Int');
   await expect(Effect.runPromise(Type.inferSourceStr('(type (Box a) {:value a}) (: box (Box Int)) (define box {:value "wrong"})'))).rejects.toThrow();
 });

 test("optional record fields preserve values that are already Option", async () => {
   const source = '(type Row {:name (Option String)}) (: make (-> (Option String) Row)) (define make [name] {:name name}) (make (Some "Ada"))';
   expect(await evaluate(source)).toEqual(new Map([[":name", new Map([[":_tag", "Some"], [":value", "Ada"]])]]));
   expect(await Effect.runPromise(Type.inferSourceStr(source))).toContain('Option<String>');
 });
 test("typed IR contracts reject string keys posing as keyword fields", () => {
   const prelude=bootstrapFromSources('', '(type ItemIR {:kind "Item" :name Symbol}) (form (item name) :types {:name (Declares Item)} :ir ItemIR {"kind" "Item" :name name})');
   const result=elaborateProgram('(item value)', {prelude});
   expect(result.ok).toBe(false);
   expect(result.diagnostics[0]?.message).toContain('payload.kind is required');
 });

 test("Map types retain their key constraints", async () => {
   await expect(Effect.runPromise(Type.inferSourceStr('(type Wrong (Map Int String))'))).rejects.toThrow('Map keys');
   await expect(Effect.runPromise(Type.inferSourceStr('(type Wrong {:id (Brand String)})'))).rejects.toThrow('Brand is only');
   expect(await Effect.runPromise(Type.inferSourceStr('(type UserId (Brand String)) (type Index (Map UserId Int)) 1'))).toBe('Int');
 });

 test("dictionary lookups return Option for present and absent keys", async () => {
   const source='(: names (Map String Int)) (define names {"Ada" 1}) [(get names "Ada") (get names "missing")]';
   expect(await evaluate(source)).toEqual([new Map<string, string | number>([[":_tag", "Some"],[":value",1]]), new Map([[":_tag","None"]])]);
   expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('List<Option<Int>>');
 });

 test("seed field values are checked against the referenced entity", () => {
   const prelude=bootstrapOntologyPreludes();
   expect(elaborateProgram('(entity Person {:name String :age (Option Int)}) (seed Person "p:1" {:name "Ada"})',{prelude}).ok).toBe(true);
   for (const fields of ['{:name 42}', '{:name "Ada" :age "old"}', '{:name "Ada" :typo 1}', '{}']) {
     const result=elaborateProgram(`(entity Person {:name String :age (Option Int)}) (seed Person "p:1" ${fields})`,{prelude});
     expect(result.ok).toBe(false);
     expect(result.diagnostics.some(d=>d.severity === 'error' && d.span !== undefined)).toBe(true);
   }
 });

 test("parent scopes are visible in repeated child form expressions", () => {
   const prelude=bootstrapFromSources('', `(type LeafIR {:kind "Leaf" :value Syntax}) (type TreeIR {:kind "Tree" :children (List LeafIR)})
    (form (leaf value) :types {:value (Expr Int)} :ir LeafIR {:kind "Leaf" :value value})
    (form (tree child ...) :types {:child (List leaf)} :scope {:child (fn [holes] {:local (quote Int)})} :ir TreeIR {:kind "Tree" :children child})`);
   const result=elaborateProgram('(tree (leaf (+ local 1)))',{prelude});
   expect(result.diagnostics).toEqual([]);
   expect(result.ok).toBe(true);
   expect(result.declarations[0]?.payload).toMatchObject({kind:'Tree',children:[{kind:'Leaf'}]});
 });

describe('typed dictionary operations', () => {
  test('updates, selection, and lookup preserve dictionary types', async () => {
    const source = `(: scores (Map String Int)) (define scores {"Ada" 4})
      (define changed (assoc scores "Grace" 9))
      (define selected (select-keys changed ["Grace"]))
      {:value (get selected "Grace") :count (count (dissoc changed "Ada"))
       :present (contains? selected "Grace") :keys (keys selected)}`;
    expect(await evaluate(source)).toEqual(new Map<string, unknown>([
      [':value', new Map<string, unknown>([[':_tag', 'Some'], [':value', 9]])],
      [':count', 1], [':present', true], [':keys', ['Grace']],
    ]));
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('{:count Int :keys List<String> :present Bool :value Option<Int>}');
  });
  test('dictionary updates reject undeclared key and value types', async () => {
    for (const operation of ['(assoc scores "Ada" "wrong")', '(dissoc scores :Ada)', '(select-keys scores [:Ada])']) {
      const result = await Effect.runPromise(Type.inferSourceStr(`(: scores (Map String Int)) (define scores {"Ada" 4}) ${operation}`).pipe(Effect.result));
      expect(result._tag).toBe('Failure');
    }
  });
});

describe('named record values', () => {
  test('classes and errors construct values with nominal types', async () => {
    const source = `(class Customer {:name String :nickname (Option String)})
      (error Missing {:id String})
      (define customer (Customer {:name "Ada"}))
      {:name customer.name :error (Missing {:id "42"})}`;
    expect(await evaluate(source)).toEqual(new Map<string, unknown>([
      [':name', 'Ada'], [':error', new Map<string, unknown>([[':id', '42'], [':_tag', 'Missing']])],
    ]));
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('{:error Missing :name String}');
  });
  test('identical class fields do not make two class types interchangeable', async () => {
    const source = '(class A {:name String}) (class B {:name String}) (: consume (-> A String)) (define consume [value] value.name) (consume (B {:name "Ada"}))';
    expect((await Effect.runPromise(Type.inferSourceStr(source).pipe(Effect.result)))._tag).toBe('Failure');
  });
  test('constructor record patterns work for classes and errors', async () => {
    expect(await evaluate('(class Customer {:name String}) (match (Customer {:name "Ada"}) (Customer {:name name}) name)')).toBe('Ada');
    expect(await evaluate('(error Missing {:id String}) (match (Missing {:id "42"}) (Missing {:id id}) id)')).toBe('42');
  });
});

describe('record inference and metadata defaults', () => {
  test('inferred record updates retain fields provided by callers', async () => {
    const source='(define with-active [record] (assoc record :active true)) (get (with-active {:name "Ada"}) :name)';
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('String');
    expect(await evaluate(source)).toBe('Ada');
  });
  test('finite dictionary keys can mix keyword and string literals', async () => {
    const source='(: values (Map (Union :a "b") Int)) (define values {:a 1 "b" 2}) (count (select-keys values [:a "b"]))';
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('Int');
    expect(await evaluate(source)).toBe(2);
  });
  test('seed defaults and fully qualified fields use the declared schema', () => {
    const prelude=bootstrapOntologyPreludes();
    const result=elaborateProgram('(entity Employee {:name (String :default "Ada") :active (Bool :default false) :nickname (Option String)}) (seed Employee "e:1" {:employee/nickname "A"})',{prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations[1]?.payload).toMatchObject({fields:{'employee/name':'Ada','employee/active':false,'employee/nickname':'A'}});
  });
});

describe('form families and prelude helpers', () => {
  test('a child family accepts forms whose IR belongs to its declared union', () => {
    const prelude = bootstrapFromSources('', `
      (type TextIR {:kind "Text" :content String})
      (type CountIR {:kind "Count" :value Int})
      (type component (Union TextIR CountIR))
      (type PanelIR {:kind "Panel" :children (List component)})
      (form (text content) :types {:content String} :ir TextIR {:kind "Text" :content content})
      (form (count value) :types {:value Int} :ir CountIR {:kind "Count" :value value})
      (form (panel child ...) :types {:child (List component)} :ir PanelIR {:kind "Panel" :children child})`);
    const result = elaborateProgram('(panel (text "hello") (count 3))', {prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations[0]?.payload).toMatchObject({kind:'Panel', children:[{kind:'Text',content:'hello'},{kind:'Count',value:3}]});
    expect(elaborateProgram('(panel (panel))', {prelude}).ok).toBe(false);
  });
  test('projection helpers resolve across prelude source files', () => {
    const prelude = bootstrapFromSources('', `(type ItemIR {:kind "Item" :value Int})
      (form (item value) :types {:value Int} :ir ItemIR (make-item value))`,
      '(define make-item [value] {:kind "Item" :value (+ value 1)})');
    const result = elaborateProgram('(item 4)', {prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations[0]?.payload).toMatchObject({kind:'Item',value:5});
  });
});

describe('canonical nested domain forms', () => {
  test('documents project wrapper-free pages and typed fields', () => {
    const result = elaborateProgram(`(entity Employee {:name String})
      (document i9 :description "Employment form"
        (page employee-information :assignee employee
          (content :i9/intro "Welcome")
          (text :i9/name "Name" :required true :bind Employee.name)))`, {prelude:bootstrapOntologyPreludes()});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations[1]?.payload).toMatchObject({kind:'Document',name:'i9',pages:[{sectionId:'employee-information',fields:[{type:'content',content:'Welcome'},{type:'text',required:true,binding:{attribute:'employee/name',entity:'Employee'}}]}]});
  });
  test('processes project a typed trigger and mixed children and reject unknown nodes', () => {
    const prelude = bootstrapOntologyPreludes();
    const source = `(entity Employee {:name String})
      (process onboarding :trigger (on-create Employee)
        (node welcome) (edge start welcome))`;
    const result = elaborateProgram(source, {prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations[1]?.payload).toMatchObject({kind:'Process',trigger:{kind:'Trigger',triggerKind:'on-create',entity:'Employee'},nodes:[{id:'welcome'}],edges:[{from:'start',to:'welcome'}]});
    expect(elaborateProgram(source.replace('edge start welcome','edge start missing'), {prelude}).ok).toBe(false);
    expect(elaborateProgram(source.replace('on-create Employee','on-create Ghost'), {prelude}).ok).toBe(false);
  });
  test('PDF mappings project mixed entries through local child namespaces', () => {
    const result = elaborateProgram(`(pdf-mapping example :template-blob "blob:1"
      (direct :document/name "Name")
      (computed (str "Hello") "Greeting")
      (switch :document/status (case "active" (set "Status" true))))`, {prelude:bootstrapOntologyPreludes()});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations[0]?.payload).toMatchObject({kind:'PdfMapping',mappings:[{kind:'Direct',source:'document/name'},{kind:'Computed',pdfField:'Greeting'},{kind:'Switch',cases:[{when:'active',assignments:[{pdfField:'Status',value:true}]}]}]});
  });
});

describe('entity metadata and optional IR values', () => {
  test('meta entities use a tier option and optional type metadata supplies seed defaults', () => {
    const prelude = bootstrapOntologyPreludes();
    const result = elaborateProgram('(entity Catalog {:label (Option String :default "entry")} :tier :meta) (seed Catalog "catalog:1" {})', {prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations[0]?.payload).toMatchObject({kind:'MetaEntity',fields:[{default:'entry',required:false}]});
    expect(result.declarations[1]?.payload).toMatchObject({fields:{'catalog/label':'entry'}});
    expect(elaborateProgram('(entity Catalog {} :tier :unknown)', {prelude}).ok).toBe(false);
  });
  test('an explicit Some nil keeps a present null field at the IR boundary', () => {
    const prelude = bootstrapFromSources('', '(type NullIR {:kind "Null" :value (Option Unit)}) (form (present) :types {} :ir NullIR {:kind "Null" :value (Some nil)}) (form (absent) :types {} :ir NullIR {:kind "Null" :value None})');
    const result = elaborateProgram('(present) (absent)', {prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations.map(declaration=>declaration.payload)).toEqual([{kind:'Null',value:null},{kind:'Null'}]);
  });
});

describe('canonical ontology operations and remaining domains', () => {
  const prelude = bootstrapOntologyPreludes();
  test('an Action signature projects an ordinary definition and checks its return', () => {
    const result = elaborateProgram(`
      (entity Candidate {:name String})
      (entity Employee {:name String :active Bool})
      (: hire (-> Candidate (Action (Id Employee))))
      (define hire [candidate] (create! Employee {:name candidate.name :active true}))
    `, {prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations.at(-1)?.payload).toMatchObject({kind:'Action',name:'hire',returns:['Id','Employee'],inputs:[{name:'candidate',required:true}]});
  });
  test('actions reject invalid create fields and return types', () => {
    const wrongField = elaborateProgram('(entity Employee {:name String}) (: hire (Action (Id Employee))) (define hire (create! Employee {:name 42}))',{prelude});
    expect(wrongField.ok).toBe(false);
    const wrongReturn = elaborateProgram('(entity Employee {:name String}) (: hire (Action Int)) (define hire (create! Employee {:name "Ada"}))',{prelude});
    expect(wrongReturn.ok).toBe(false);
    const unknown = elaborateProgram('(: hire (Action (Id Missing))) (define hire (create! Missing {}))',{prelude});
    expect(unknown.diagnostics.map(d=>d.message).join(' ')).toContain('Unknown reference Missing');
  });
  test('constraints check predicates and messages within entity scope', () => {
    const result = elaborateProgram('(entity Employee {:name String :active Bool}) (constraint active-employee :entity Employee :severity :warning :when active :message (str "Inactive " name))',{prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations.at(-1)?.payload).toMatchObject({kind:'Constraint',severity:'warning'});
    expect(elaborateProgram('(entity Employee {:name String}) (constraint bad :entity Employee :severity :error :when name :message "Bad")',{prelude}).ok).toBe(false);
  });
  test('query presets use typed references and record defaults', () => {
    const result = elaborateProgram('(entity Employee {:name String}) (query staff :from Employee) (query-preset names staff {:search "Ada"} :merge-policy :preset-overrides)',{prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations.at(-1)?.payload).toMatchObject({kind:'QueryPreset',queryRef:{kind:'Query',name:'staff'},mergePolicy:'preset-overrides'});
  });
  test('views and fragments share a form and typed columns', () => {
    const result = elaborateProgram('(entity Employee {:name String}) (query staff :from Employee) (view staff-table :query staff :fragment true (column :employee/name :label "Name"))',{prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations.at(-1)?.payload).toMatchObject({kind:'View',fragment:true,columns:[{name:'employee/name',label:'Name'}]});
  });
});

describe('alias contracts and metadata recursion', () => {
  test('generic optional fields coerce once and allow omitted fields', async () => {
    const source=`(type (Box a) {:value (Option a)})
      (: full (Box Int)) (define full {:value 7})
      (: empty (Box String)) (define empty {})
      [(match full.value (Some n) n None 0) (match empty.value (Some s) s None "empty")]`;
    expect(await evaluate(source)).toEqual([7,"empty"]);
    expect(await Effect.runPromise(Type.inferSourceStr('(type (Box a) {:value (Option a)}) (: box (Box Int)) (define box {}) box'))).toBe('{:value Option<Int>}');
  });
  test('IR contracts resolve optional aliases and generic applications', () => {
    const prelude=bootstrapFromSources('',`(type OptionalString (Option String))
      (type (Box a) {:value (Option a)})
      (type AliasIR {:kind "Alias" :name Symbol :note OptionalString :box (Box Int)})
      (form (alias name) :types {:name Symbol} :ir AliasIR {:kind "Alias" :name name :note None :box {}})`);
    const result=elaborateProgram('(alias sample)',{prelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations[0]?.payload).toEqual({kind:"Alias",name:"sample",box:{}});
    expect(prelude.descriptions.get('AliasIR')?.extensions?.['protocol/object']).toMatchObject({fields:{note:{required:false}}});
  });
  test('quoted function type syntax survives prelude macros', async () => {
    expect(await evaluate("'(-> String Unit)")).toEqual([expect.objectContaining({name:'->'}),expect.objectContaining({name:'String'}),expect.objectContaining({name:'Unit'})]);
  });
  test('boolean fallback retains false and named functions recurse', async () => {
    expect(await evaluate('(or false false)')).toBe(false);
    expect(await evaluate('(define length [items] (if (empty? items) 0 (+ 1 (length (rest items))))) (length [1 2 3])')).toBe(3);
  });
});

test('nested form warnings retain their severity and author location', () => {
  const prelude=bootstrapFromSources('',`(type ChildIR {:message String}) (type child ChildIR)
    (type ParentIR {:kind "Parent" :children (List ChildIR)})
    (form (child/notice message) :types {:message String} :ir ChildIR
      :check (fn [{:keys [message]}] [{:severity :warning :slot :message :message "Review this notice"}]) {:message message})
    (form (parent children ...) :types {:children (List child)} :ir ParentIR {:kind "Parent" :children children})`);
  const result=elaborateProgram('(parent (notice "Hello"))',{prelude});
  expect(result.ok).toBe(true);
  expect(result.diagnostics).toMatchObject([{severity:"warning",message:"Review this notice",span:{startOffset:16,endOffset:23}}]);
});

import { Formatter } from '../src/index.js';
import { buildProtocolObjectDescriptors } from '../src/descriptor/protocol-descriptor.js';
import { emitProtocolInterface, emitProtocolObjectSchema } from '../src/descriptor/protocol-effect-schema.js';

describe('unified syntax integration boundaries', () => {
  test('computed closed-record lookup returns an Option for present and absent keys', async () => {
    const source='(define lookup [key] (get {:x 1 :y 2} key)) [(lookup :x) (lookup :missing)]';
    expect(await evaluate(source)).toEqual([new Map<string,string|number>([[":_tag","Some"],[":value",1]]),new Map([[":_tag","None"]])]);
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('List<Option<Int>>');
  });
  test('conditional Map construction accepts branches with different keys', async () => {
    const source='(: choose (-> Bool (Map (Union :x :y) Int))) (define choose [yes] (if yes {:x 1} {:y 2})) (get (choose false) :y)';
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe('Option<Int>');
    expect(await evaluate(source)).toEqual(new Map<string,string|number>([[":_tag","Some"],[":value",2]]));
  });
  test('action shorthand derives its entity through sequential effect and pure bindings', () => {
    const result=elaborateProgram(`(entity Todo {:title String :done Bool})
      (: complete (-> (Id Todo) (Action Unit)))
      (define complete [id] (update! id {:done true}))
      (: create-and-complete (Action (Id Todo)))
      (define create-and-complete (do! [id (create! Todo {:title "Write" :done false}) :let [alias id] _ (complete alias)] alias))
      (: remove (-> (Id Todo) (Action Unit))) (define remove [id] (retract! id))`,{prelude:bootstrapOntologyPreludes()});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations.filter(d=>d.summary.kind==='Action')).toHaveLength(3);
    expect(generate(`(entity Todo {:title String}) (: remove (-> (Id Todo) (Action Unit))) (define remove [id] (retract! id))`)).toContain('retractTodo');
  });
  test('shadowing cannot borrow the type of an outer entity id', () => {
    const result=elaborateProgram('(entity Todo {:title String}) (: remove (-> (Id Todo) (Action Unit))) (define remove [id] (let [id "untyped"] (retract! id)))',{prelude:bootstrapOntologyPreludes()});
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(d=>d.message).join(' ')).toContain('known entity type');
  });
  test('HTTP checks distinguish schemas from errors and validate paths and type references', () => {
    const prelude=bootstrapOntologyPreludes();
    const declarations='(type Response {:name String}) (error Missing :status 404) ';
    expect(elaborateProgram(declarations+'(api people :path-params {:id String} (endpoint get :method :get :path "/people/{id}" :success Response :errors [Missing]))',{prelude}).ok).toBe(true);
    for (const source of ['(api people (endpoint get :method :get :path "/{id}" :success Response))','(api people (endpoint get :method :get :path "/" :success Unknown))','(api people (endpoint get :method :get :path "/" :success Response :errors [Response]))']) expect(elaborateProgram(declarations+source,{prelude}).ok).toBe(false);
  });
  test('protocol generation retains nested records and specializes generic aliases', () => {
    const prelude=bootstrapFromSources('', '(type (Box a) {:value a :note (Option String)}) (type Envelope {:data (Box Int) :meta {:enabled Bool}})');
    const descriptor=buildProtocolObjectDescriptors([...prelude.descriptions.list()]).find(d=>d.name==='Envelope')!;
    expect(emitProtocolInterface(descriptor).join("\n")).toContain('readonly data: { readonly value: number; readonly note?: string }');
    expect(emitProtocolObjectSchema(descriptor).join("\n")).toContain('data: Schema.Struct({ value: Schema.Number, note: Schema.optionalKey(Schema.String) })');
    expect(emitProtocolObjectSchema(descriptor).join("\n")).toContain('enabled: Schema.Boolean');
  });
  test('form patterns determine formatter layout without rewriting declaration heads', () => {
    const prelude=bootstrapFromSources('', '(type GreetingIR {:kind "Greeting" :name Symbol :message String :doc (Option String)}) (form (greeting name message {:keys [doc]}) :types {:name Symbol :message String :doc (Option String)} :ir GreetingIR {:kind "Greeting" :name name :message message :doc doc})');
    const source='(greeting welcome "Hello" :doc "A longer description")';
    const options={softWrap:30,descriptors:[...prelude.descriptions.list()]};
    const formatted=Effect.runSync(Formatter.formatLispSource(source,options));
    expect(formatted).toBe('(greeting welcome "Hello"\n  :doc "A longer description")\n');
    expect(Effect.runSync(Formatter.formatLispSource(formatted,options))).toBe(formatted);
  });
});


describe("canonical boundary diagnostics", () => {
  test.each(["(def value 1)","(defn value [x] x)","(lambda [x] x)","(let* [x 1] x)","(: value Num) (define value 1)","(type Values (Array String))","(type Old [(name String)])"])("rejects obsolete grammar: %s", async source => {
    await expect(evaluate(source)).rejects.toThrow();
  });
  test("HTTP migration preserves types, error status, methods and parameters", () => {
    const source = `(define-schema Response (:kind struct) (:fields (field name String)) (:identifier "Response"))
(define-error Missing (:fields (field id String)) (:status 404))
(define-api-group users (:path-params (param id String))
  (endpoint read (:method GET) (:path "/users/{id}") (:success Response) (:errors Missing)) )`;
    const result = migrateSource(source);
    expect(result.source).toContain('(type Response {:name String})');
    expect(result.source).toContain('(error Missing {:id String} :status 404)');
    expect(result.source).toContain(':method :get');
    expect(migrateSource(result.source).changed).toBe(false);
    expect(elaborateProgram(result.source,{prelude:bootstrapOntologyPreludes()}).diagnostics).toEqual([]);
  });
  test("check diagnostics preserve their codes and reject non-records", () => {
    const form = `(type CheckedIR {:kind "Checked"})
(form (checked value) :types {:value String} :ir CheckedIR
  :check (fn [holes] [{:severity :warning :code "checked/warning" :message "Review"}]) {:kind "Checked"})`;
    const result=elaborateProgram('(checked "ok")',{prelude:bootstrapFromSources('',form)});
    expect(result.diagnostics[0]).toMatchObject({code:'checked/warning',severity:'warning'});
    const invalid=elaborateProgram('(checked "ok")',{prelude:bootstrapFromSources('',form.replace('[{:severity :warning :code "checked/warning" :message "Review"}]','[42]'))});
    expect(invalid.ok).toBe(false);
    expect(invalid.diagnostics[0]?.message).toContain('must be a record');
  });
});


test("formatting retains comments beside nested values and quoted data", async () => {
  const {formatLispSource}=await import('../src/Formatter.js');
  const source=`; module
(define values [1 ; first
 2]) ; end
' ; quoted
{:key "; literal" ; last
}
; footer`;
  const formatted=Effect.runSync(formatLispSource(source));
  for(const comment of ['; module','; first','; end','; quoted','; last','; footer']) expect(formatted).toContain(comment);
  expect(Effect.runSync(formatLispSource(formatted))).toBe(formatted);
  expect(await evaluate(formatted)).toEqual(await evaluate(source));
});


test("migration extracts nested brands into canonical named declarations", () => {
  const migrated=migrateSource('(define-schema Request (Struct (field id (Brand RequestId String))))');
  expect(migrated.source).toContain('(type RequestId (Brand String))');
  expect(migrated.source).toContain('(type Request {:id RequestId})');
  expect(migrateSource(migrated.source).changed).toBe(false);
  expect(generateEffectProgram(migrated.source).diagnostics).toEqual([]);
});


test("action providers retain inline keyword unions in entity fields", () => {
  const generated=generateEffectProgram('(entity Todo {:status (Union :open :done)}) (: add (Action (Id Todo))) (define add (create! Todo {:status :open}))');
  expect(generated.diagnostics).toEqual([]);
  expect(generated.code).toContain('Schema.Literals(["open", "done"])');
});


test("keyword literals retain their exact type through binding and branching", async () => {
  expect(Effect.runSync(Type.inferSourceStr('(define state :open) state'))).toBe(':open');
  expect(Effect.runSync(Type.inferSourceStr('(if true :open :done)'))).toBe('Union<:open, :done>');
  expect(Effect.runSync(Type.inferSourceStr('(= :open :done)'))).toBe('Bool');
});


test("conditional records join their keyword field types", () => {
  expect(Effect.runSync(Type.inferSourceStr('(get (if true {:state :open} {:state :done}) :state)'))).toBe('Union<:open, :done>');
});
