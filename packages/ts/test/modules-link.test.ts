import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveModuleGraph,
  sourceModuleResolver,
  linkEffectModules,
  generatedBindingName,
  moduleOutputName,
} from "../src/Modules.js";
const files = [
  {
    id: "ids.forma",
    source:
      "(export CustomerId Customer make-customer) (type CustomerId (Brand String)) (class Customer {:id CustomerId :name String}) (: make-customer (-> CustomerId String Customer)) (define make-customer [id name] (Customer {:id id :name name}))",
  },
  {
    id: "log.forma",
    source:
      '(import "./ids.forma" [Customer]) (export Console log) (service Console (: print (-> String (Effect Unit)))) (: log (-> Customer (Effect String [] [Console.print]))) (define log [customer] (do! [_ (Console.print customer.name)] (succeed customer.name)))',
  },
  {
    id: "identity.forma",
    source: "(export identity) (define identity [value] value)",
  },
  {
    id: "main.forma",
    source:
      '(import "./identity.forma" [identity]) (import "./ids.forma" :as ids) (import "./log.forma" [log]) (export main) (: main (Effect String [] [Console.print])) (define main (log (ids/make-customer (ids/CustomerId (identity "1")) (identity "Ada"))))',
  },
];
test("linked Effect modules compile and execute; importing prepares effects without running them", () => {
  // Requirement members must themselves be imported explicitly.
  const main = {
    ...files[3]!,
    source: files[3]!.source.replace("[log]", "[log Console]"),
  };
  const state = {
    id: "state.forma",
    source:
      '(export Status label) (type Status (Tagged (Ready {:message String}) Empty)) (: label (-> Status String)) (define label [status] (match status (Status.Ready {:message message}) message Status.Empty ""))',
  };
  const entry = {
    ...main,
    source:
      '(import "./state.forma" :as state) ' +
      main.source.replace(
        '(identity "Ada")',
        '(state/label (state/Status.Ready {:message (identity "Ada")}))',
      ),
  };
  const graph = resolveModuleGraph(
    entry,
    sourceModuleResolver([...files, state]),
  );
  const linked = linkEffectModules(graph);
  expect(linked.diagnostics).toEqual([]);
  expect(linked.modules).toHaveLength(5);
  expect(
    linked.modules.find((m) => m.moduleId === "main.forma")?.code,
  ).toContain("import {");
  expect(
    linked.modules.filter((m) => m.code.includes("extends Context.Service")),
  ).toHaveLength(1);
  expect(
    linked.modules.filter((m) => m.code.includes("Schema.brand(")),
  ).toHaveLength(2);
  expect(
    linked.modules.filter(
      (m) =>
        m.code.includes("export const Status") &&
        m.code.includes("Constructors = {"),
    ),
  ).toHaveLength(1);
  const root = resolve(import.meta.dirname, "../../.."),
    context = resolve(root, ".context");
  mkdirSync(context, { recursive: true });
  const dir = mkdtempSync(resolve(context, "module-link-test-"));
  try {
    writeFileSync(resolve(dir, "package.json"), '{"type":"module"}');
    for (const module of linked.modules)
      writeFileSync(resolve(dir, module.fileName), module.code);
    const mainName = generatedBindingName(
      graph.modules.at(-1)!.interface.exports.find((b) => b.name === "main")!,
    );
    const consoleBinding = graph.modules
      .find((m) => m.id === "log.forma")!
      .interface.exports.find((b) => b.name === "Console")!;
    writeFileSync(
      resolve(dir, "run.ts"),
      `import { Effect } from "effect";\nimport { ${mainName} as main } from "./${linked.entry.replace(/\.ts$/, ".js")}";\nimport { ${generatedBindingName(consoleBinding)} as Console } from "./${moduleOutputName("log.forma").replace(/\.ts$/, ".js")}";\nlet calls=0;\nif (calls !== 0) throw new Error("effect ran at import");\nconst value=await Effect.runPromise(Effect.provideService(main,Console,{print:()=>Effect.sync(()=>{calls++;})}));\nconsole.log(JSON.stringify({value,calls}));\n`,
    );
    writeFileSync(
      resolve(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: true,
          outDir: "out",
        },
        include: ["*.ts"],
      }),
    );
    try {
      execFileSync(
        process.execPath,
        [
          resolve(root, "node_modules/typescript/bin/tsc"),
          "-p",
          resolve(dir, "tsconfig.json"),
        ],
        { encoding: "utf8" },
      );
    } catch (error) {
      throw new Error(String((error as { stdout: unknown }).stdout));
    }
    const output = execFileSync(
      process.execPath,
      [resolve(dir, "out/run.js")],
      { encoding: "utf8" },
    );
    expect(JSON.parse(output)).toEqual({ value: "Ada", calls: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);

test("generated nominal declarations stay distinct, and barrels re-export owning constructors", () => {
  const schema =
    "(export Id Item Status) (type Id (Brand String)) (class Item {:name String}) (type Status (Tagged (Ready {:message String}) Empty))";
  const a = { id: "a.forma", source: schema },
    b = { id: "b.forma", source: schema },
    barrel = {
      id: "barrel.forma",
      source: '(export-from "./a.forma" [Id Item Status])',
    };
  const entry = {
    id: "main.forma",
    source:
      '(import "./barrel.forma" :as a) (import "./b.forma" :as b) (export main) (: main (Effect String)) (define main (succeed "ok"))',
  };
  const graph = resolveModuleGraph(entry, sourceModuleResolver([a, b, barrel]));
  const linked = linkEffectModules(graph);
  expect(linked.diagnostics).toEqual([]);
  expect(linked.modules.find((m) => m.moduleId === barrel.id)?.code).toContain(
    "Constructors } from",
  );
  const root = resolve(import.meta.dirname, "../../..");
  mkdirSync(resolve(root, ".context"), { recursive: true });
  const dir = mkdtempSync(resolve(root, ".context/nominal-link-test-"));
  try {
    writeFileSync(resolve(dir, "package.json"), '{"type":"module"}');
    for (const m of linked.modules)
      writeFileSync(resolve(dir, m.fileName), m.code);
    const names = (id: string) =>
      Object.fromEntries(
        graph.modules
          .find((m) => m.id === id)!
          .interface.exports.map((b) => [b.name, generatedBindingName(b)]),
      );
    const first = names("a.forma"),
      second = names("b.forma");
    writeFileSync(
      resolve(dir, "check.ts"),
      `import { ${first["Id"]} as AId, ${first["Item"]} as AItem, ${first["Status"]} as AStatus } from './${moduleOutputName(barrel.id).replace(/\.ts$/, ".js")}';
import { ${second["Id"]} as BId, ${second["Item"]} as BItem, ${second["Status"]}Constructors as BStatusConstructors } from './${moduleOutputName(b.id).replace(/\.ts$/, ".js")}';
declare const bId: typeof BId.Type;
// @ts-expect-error brands have different owners
const wrongBrand: typeof AId.Type = bId;
// @ts-expect-error classes have different owners
const wrongClass: AItem = new BItem({name:'B'});
// @ts-expect-error tagged types have different owners
const wrongTagged: typeof AStatus.Type = BStatusConstructors.Ready({message:'B'});
`,
    );
    writeFileSync(
      resolve(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["*.ts"],
      }),
    );
    try {
      execFileSync(
        process.execPath,
        [
          resolve(root, "node_modules/typescript/bin/tsc"),
          "-p",
          resolve(dir, "tsconfig.json"),
        ],
        { encoding: "utf8" },
      );
    } catch (error) {
      throw Error(String((error as { stdout: unknown }).stdout));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);

test("local macro expansion retains owning schemas, and top-level applications are diagnosed", () => {
  const entry = {
    id: "main.forma",
    source:
      '(export Name greet) (type Name (Brand String)) (: helper (-> String String)) (define helper [x] (str "hello " x)) (macro (greeting x) `(helper ~x)) (: greet (-> Name String)) (define greet [name] (greeting "Ada"))',
  };
  expect(
    linkEffectModules(resolveModuleGraph(entry, () => undefined)).diagnostics,
  ).toEqual([]);
  const application = resolveModuleGraph(
    { id: "main.forma", source: "(export value) (define value 42) value" },
    () => undefined,
  );
  expect(linkEffectModules(application).diagnostics[0]).toMatchObject({
    code: "module/target-expression",
    span: { sourceId: "main.forma" },
  });
});

test("unused file imports still initialize their owning modules", () => {
  const library = {
    id: "unused.forma",
    source: "(export value) (define value 42)",
  };
  const graph = resolveModuleGraph(
    {
      id: "main.forma",
      source:
        '(import "./unused.forma" [value]) (export main) (: main (Effect String)) (define main (succeed "ok"))',
    },
    sourceModuleResolver([library]),
  );
  const linked = linkEffectModules(graph);
  expect(linked.diagnostics).toEqual([]);
  expect(
    linked.modules.find((m) => m.moduleId === graph.entry)?.code,
  ).toContain(
    `import "./${moduleOutputName(library.id).replace(/\.ts$/, ".js")}";`,
  );
});

test("target name normalization preserves distinct declaration identities", () => {
  const graph = resolveModuleGraph(
    {
      id: "names.forma",
      source: "(export foo-bar fooBar) (define foo-bar 1) (define fooBar 2)",
    },
    () => undefined,
  );
  const linked = linkEffectModules(graph);
  expect(linked.diagnostics).toEqual([]);
  const names = graph.modules[0]!.interface.exports.map(generatedBindingName);
  expect(new Set(names).size).toBe(2);
  for (const name of names)
    expect(linked.modules[0]!.code).toContain(`export const ${name}`);
});

test("an imported macro links its private runtime helper in generated modules", () => {
  const library = {
    id: "macros.forma",
    source:
      "(export increment) (define helper [x] (+ x 1)) (macro (increment x) `(helper ~x))",
  };
  const entry = {
    id: "main.forma",
    source:
      '(import "./macros.forma" [increment]) (export answer) (define answer (increment 41))',
  };
  const graph = resolveModuleGraph(entry, sourceModuleResolver([library]));
  const linked = linkEffectModules(graph);
  expect(linked.diagnostics).toEqual([]);
  expect(graph.modules[0]!.interface.exports.map((b) => b.name)).toEqual([
    "increment",
  ]);
  const root = resolve(import.meta.dirname, "../../..");
  const dir = mkdtempSync(resolve(root, ".context/macro-link-test-"));
  try {
    writeFileSync(resolve(dir, "package.json"), '{"type":"module"}');
    for (const module of linked.modules)
      writeFileSync(resolve(dir, module.fileName), module.code);
    const answer = generatedBindingName(
      graph.modules.at(-1)!.interface.exports[0]!,
    );
    writeFileSync(
      resolve(dir, "run.ts"),
      `import { ${answer} as answer } from "./${linked.entry.replace(/\.ts$/, ".js")}";\nconsole.log(answer);\n`,
    );
    writeFileSync(
      resolve(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: true,
          outDir: "out",
        },
        include: ["*.ts"],
      }),
    );
    execFileSync(
      process.execPath,
      [
        resolve(root, "node_modules/typescript/bin/tsc"),
        "-p",
        resolve(dir, "tsconfig.json"),
      ],
      { encoding: "utf8" },
    );
    expect(
      execFileSync(process.execPath, [resolve(dir, "out/run.js")], {
        encoding: "utf8",
      }).trim(),
    ).toBe("42");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
