import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "./generate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = name => readFileSync(join(here, name), "utf8");
const cases = JSON.parse(read("cases.json"));
const scratch = mkdtempSync(join(tmpdir(), "forma-portable-record-"));
const start = performance.now();
let checks = 0;
let comparisons = 0;
const ok = message => { checks++; console.log(`ok ${checks} - ${message}`); };
const exec = (command, args, cwd = scratch, input) => {
  const result = spawnSync(command, args, { cwd, input, encoding: "utf8", timeout: 120_000 });
  if (result.error) throw result.error;
  return { ...result, text: `${result.stdout}${result.stderr}` };
};
const success = result => { assert.equal(result.status, 0, result.text); return result.stdout; };
const tsc = args => exec(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), ...args]);
const go = (args, cwd, input) => exec("go", args, cwd, input);

// Both commands exercise the built public CLI, not a fabricated IR fixture.
function forma(source, mode = "declarations") {
  const path = join(scratch, "schema.forma");
  writeFileSync(path, `${read("forms.forma")}\n${source}`);
  const result = exec(process.execPath, [join(root, "packages/host/dist/cli.mjs"), "file", mode, path], root);
  const response = JSON.parse(result.stdout);
  assert.equal(result.status, response.ok ? 0 : 1, result.text);
  return response;
}
function elaborate(source) {
  const typed = forma(source, "typecheck");
  assert.equal(typed.ok, true, JSON.stringify(typed));
  const result = forma(source);
  assert.equal(result.ok, true, JSON.stringify(result));
  const records = result.value.filter(declaration => declaration.payload?.kind === "WrapRecord");
  assert.equal(records.length, 1);
  return records[0].payload;
}

// The adapters are shared by generated and direct implementations. They do not
// compute expected answers. The wire fixture domain is valid closed string
// records; these adapters deliberately do not claim to validate arbitrary JSON.
function compile(label, source, target, fixtures) {
  const dir = join(scratch, label);
  mkdirSync(dir);
  const fields = Object.keys(fixtures[0].expected);
  if (target === "ts") {
    writeFileSync(join(dir, "program.ts"), source);
    writeFileSync(join(dir, "package.json"), '{"type":"module"}');
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", noEmitOnError: true, types: [] },
      include: ["*.ts"],
    }));
    writeFileSync(join(dir, "consumer.ts"), [
      'import { wrap, type Query } from "./program.js";',
      'export function consume(q: Query): string[] { const result = wrap(q);',
      `return [${fields.map(name => `result.${name}.raw`).join(", ")}]; }`,
    ].join("\n"));
    const result = tsc(["-p", join(dir, "tsconfig.json")]);
    writeFileSync(join(dir, "main.mjs"), [
      'import { readFileSync } from "node:fs";',
      'import { wrap } from "./program.js";',
      'console.log(JSON.stringify(JSON.parse(readFileSync(0, "utf8")).map(wrap)));',
    ].join("\n"));
    return { result, run: () => JSON.parse(success(exec(process.execPath, [join(dir, "main.mjs")], dir, JSON.stringify(fixtures.map(c => c.input))))) };
  }
  writeFileSync(join(dir, "program.go"), source);
  writeFileSync(join(dir, "go.mod"), "module portable-record\n\ngo 1.24\n");
  writeFileSync(join(dir, "consumer.go"), [
    "package main",
    "func consume(q Query) []string { result := Wrap(q)",
    `return []string{${fields.map(name => `result.F_${name}.Raw`).join(", ")}} }`,
  ].join("\n"));
  writeFileSync(join(dir, "main.go"), `package main
import ("encoding/json"; "os")
func main() {
  var inputs []Query
  if err := json.NewDecoder(os.Stdin).Decode(&inputs); err != nil { panic(err) }
  outputs := make([]UserFields, 0, len(inputs))
  for _, input := range inputs { outputs = append(outputs, Wrap(input)) }
  if err := json.NewEncoder(os.Stdout).Encode(outputs); err != nil { panic(err) }
}
`);
  const result = go(["build", "-o", join(dir, "wrap"), "."], dir);
  return { result, run: () => JSON.parse(success(exec(join(dir, "wrap"), [], dir, JSON.stringify(fixtures.map(c => c.input))))) };
}

try {
  console.log(`Node ${process.version}; ${success(tsc(["--version"])).trim()}; ${success(go(["version"])).trim()}`);
  const programs = {};
  for (const version of ["base", "changed"]) {
    const schema = elaborate(read(`${version}.forma`));
    programs[version] = generate(schema);
    assert.deepEqual(generate(schema), programs[version]);
    ok(`${version}: public Forma typecheck/elaboration and deterministic emission`);
    console.log(`${version} emitted TypeScript:\n${programs[version].ts}`);
    console.log(`${version} emitted Go:\n${programs[version].go}`);
    for (const target of ["ts", "go"]) {
      for (const kind of ["generated", "direct"]) {
        const source = kind === "generated" ? programs[version][target] : read(`baseline/${version}.${target}`);
        const built = compile(`${version}-${target}-${kind}`, source, target, cases[version]);
        success(built.result);
        const actual = built.run();
        for (const [index, fixture] of cases[version].entries()) {
          assert.deepEqual(actual[index], fixture.expected, `${version}/${target}/${kind}/${fixture.name}`);
          comparisons++;
        }
        assert.equal(actual.length, cases[version].length);
        ok(`${version}/${target}/${kind}: native compilation + ${cases[version].length} independent expected results`);
      }
    }
  }

  for (const target of ["ts", "go"]) {
    // Neither approach can use stale output against the changed contract.
    for (const kind of ["generated", "direct"]) {
      const source = kind === "generated" ? programs.base[target] : read(`baseline/base.${target}`);
      const stale = compile(`stale-${target}-${kind}`, source, target, cases.changed);
      assert.notEqual(stale.result.status, 0);
      assert.match(stale.result.text, /account_id|label/);
      ok(`${target}: stale ${kind} source fails changed consumer contract`);
    }

    // Type errors and well-typed semantic errors are deliberately distinct.
    const original = programs.base[target];
    const from = target === "ts" ? "raw: q.id" : "Raw: q.F_id";
    assert.equal(original.split(from).length, 2);
    const illTyped = original.replace(from, target === "ts" ? "raw: 7" : "Raw: 7");
    const rejected = compile(`ill-typed-${target}`, illTyped, target, cases.base);
    assert.notEqual(rejected.result.status, 0);
    assert.match(rejected.result.text, /number.*string|7.*string/);
    ok(`${target}: target compiler rejects number in string result`);
    const swapped = original.replace(from, target === "ts" ? "raw: q.cursor" : "Raw: q.F_cursor");
    const wrong = compile(`wrong-field-${target}`, swapped, target, cases.base);
    success(wrong.result);
    assert.notDeepEqual(wrong.run()[0], cases.base[0].expected);
    ok(`${target}: compiler accepts wrong-field mutant; independent asymmetric oracle detects it`);
  }

  for (const [label, source, code] of [
    ["number", '(wrap-record Query [{:name "id" :type "number"}])', "elaborate/form-check"],
    ["optional", '(wrap-record Query [{:name "id" :type "string" :optional true}])', "elaborate/form-check"],
    ["open-generic", '(wrap-record Query [{:name "id" :type T}])', "module/compile-time-data"],
  ]) {
    const result = forma(source);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.ok(result.diagnostics.some(d => d.code === code && d.span?.startLine > 0 && d.span?.startColumn > 0), JSON.stringify(result));
    ok(`Forma rejects ${label} at authored source: ${result.diagnostics.map(d => d.code).join(", ")}`);
  }
  for (const [label, source, error] of [
    ["duplicate", '(wrap-record Query [{:name "id" :type "string"} {:name "id" :type "string"}])', /portable-record\/duplicate/],
    ["nonportable-name", '(wrap-record Query [{:name "雪" :type "string"}])', /portable-record\/name/],
    ["injection", '(wrap-record Query [{:name "id;panic()" :type "string"}])', /portable-record\/name/],
    ["empty", '(wrap-record Query [])', /portable-record\/schema/],
  ]) {
    const schema = elaborate(source);
    assert.throws(() => generate(schema), error);
    ok(`generator rejects ${label} after valid Forma elaboration, before emission`);
  }

  const lines = source => source.split("\n").filter(line => line.trim() && !line.trim().startsWith("//") && !line.trim().startsWith(";;")).length;
  const files = ["forms.forma", "generate.mjs", "run.mjs", "base.forma", "changed.forma", "baseline/base.ts", "baseline/base.go", "baseline/changed.ts", "baseline/changed.go"];
  console.log("Cost inventory (nonblank/non-comment lines; not measured author time):");
  for (const file of files) console.log(`  ${file}: ${lines(read(file))}`);
  for (const [label, before, after] of [
    ["schema", "base.forma", "changed.forma"],
    ["direct TS", "baseline/base.ts", "baseline/changed.ts"],
    ["direct Go", "baseline/base.go", "baseline/changed.go"],
  ]) {
    const paths = [before, after].map((file, index) => {
      const path = join(scratch, `cost-${index}`);
      writeFileSync(path, read(file).split("\n").filter(line => line.trim() && !/^\s*(\/\/|;;)/.test(line)).join("\n") + "\n");
      return path;
    });
    const diff = exec("git", ["diff", "--no-index", "--numstat", ...paths]);
    assert.equal(diff.status, 1, diff.text);
    const [added, removed] = diff.stdout.trim().split("\t");
    console.log(`  ${label} maintenance: +${added}/-${removed} lines`);
  }
  console.log("  Shared generator edits for schema change: 0");
  console.log(`PASS ${checks} checks; ${comparisons} expected-result comparisons; ${(performance.now() - start).toFixed(0)}ms elapsed (includes native compilation, cache-dependent)`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
