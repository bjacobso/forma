import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const cwd = new URL("..", import.meta.url);
const nativeCli = new URL("dist/native/forma_cli.exe", cwd).pathname;
const jsEntry = new URL("dist/js/jsoo_entry.cjs", cwd).pathname;
const wasmEntry = new URL("dist/wasm/wasm_entry.cjs", cwd).pathname;
const buildTargetsPath = new URL("dist/build-targets.json", cwd);

const buildTargets = existsSync(buildTargetsPath)
  ? JSON.parse(readFileSync(buildTargetsPath, "utf8"))
  : { native: true, js: existsSync(jsEntry), wasm: existsSync(wasmEntry) };

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });

  if (result.error?.code === "ENOENT") {
    console.error(`Missing required command: ${command}`);
    process.exit(127);
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.stdout.write(result.stdout ?? "");
    process.exit(result.status ?? 1);
  }

  return result.stdout;
};

const targets = [
  {
    name: "native",
    available: buildTargets.native === true && existsSync(nativeCli),
    request: (payload) => run(nativeCli, ["request", JSON.stringify(payload)]),
  },
  {
    name: "js",
    available: buildTargets.js === true && existsSync(jsEntry),
    request: (payload) => run("node", [jsEntry, JSON.stringify(payload)]),
  },
  {
    name: "wasm",
    available: buildTargets.wasm === true && existsSync(wasmEntry),
    request: (payload) => run("node", [wasmEntry, JSON.stringify(payload)]),
  },
].filter((target) => target.available);

if (targets.length === 0) {
  throw new Error("No forma-ocaml targets are available under dist/.");
}

const expectPath = (object, path, expected) => {
  const actual = path.reduce((value, key) => value?.[key], object);
  if (actual !== expected) {
    throw new Error(
      `Expected ${path.join(".")} to be ${JSON.stringify(expected)}, received ${JSON.stringify(
        actual,
      )}`,
    );
  }
};

const cases = [
  {
    name: "version",
    request: { op: "version" },
    expect: [
      [["ok"], true],
      [["value", "engine"], "forma-ocaml"],
    ],
  },
  {
    name: "parse summary",
    request: {
      op: "parseSummary",
      sourceId: "parity/parse",
      source: '\'alpha `(list ~x ~@xs) {:name "Ada"}',
    },
    expect: [
      [["ok"], true],
      [["value", "formCount"], 3],
    ],
  },
  {
    name: "arithmetic evaluate",
    request: {
      op: "evaluate",
      sourceId: "parity/eval-arithmetic",
      source: "(+ 1 2)",
    },
    expect: [
      [["ok"], true],
      [["value", "kind"], "int"],
      [["value", "value"], 3],
    ],
  },
  {
    name: "closure evaluate",
    request: {
      op: "evaluate",
      sourceId: "parity/eval-closure",
      source: "(let [base 10 add-base (fn [x] (+ base x))] (add-base 5))",
    },
    expect: [
      [["ok"], true],
      [["value", "kind"], "int"],
      [["value", "value"], 15],
    ],
  },
  {
    name: "match evaluate",
    request: {
      op: "evaluate",
      sourceId: "parity/eval-match",
      source: "(match [1 2] [x y] (+ x y) :else 0)",
    },
    expect: [
      [["ok"], true],
      [["value", "kind"], "int"],
      [["value", "value"], 3],
    ],
  },
  {
    name: "macro evaluate",
    request: {
      op: "evaluate",
      sourceId: "parity/eval-macro",
      source: "(macro (unless test body) `(if ~test nil ~body)) (unless false 7)",
    },
    expect: [
      [["ok"], true],
      [["value", "kind"], "int"],
      [["value", "value"], 7],
    ],
  },
  {
    name: "macro expand",
    request: {
      op: "expand",
      sourceId: "parity/expand-macro",
      source: "(macro (unless test body) `(if ~test nil ~body)) (unless false 7)",
    },
    expect: [
      [["ok"], true],
      [["value", 1, "items", 0, "value"], "if"],
    ],
  },
  {
    name: "map evaluate",
    request: {
      op: "evaluate",
      sourceId: "parity/eval-map",
      source: "(map (fn [x] (+ x 1)) (list 1 2))",
    },
    expect: [
      [["ok"], true],
      [["value", "kind"], "list"],
      [["value", "items", 0, "value"], 2],
      [["value", "items", 1, "value"], 3],
    ],
  },
  {
    name: "map get evaluate",
    request: {
      op: "evaluate",
      sourceId: "parity/eval-map-get",
      source: "(get (assoc {:a 1} :b 2) :b)",
    },
    expect: [
      [["ok"], true],
      [["value", "kind"], "int"],
      [["value", "value"], 2],
    ],
  },
  {
    name: "reduce evaluate",
    request: {
      op: "evaluate",
      sourceId: "parity/eval-reduce",
      source: "(reduce (fn [acc x] (+ acc x)) 0 [1 2 3])",
    },
    expect: [
      [["ok"], true],
      [["value", "kind"], "int"],
      [["value", "value"], 6],
    ],
  },
  {
    name: "concat evaluate",
    request: {
      op: "evaluate",
      sourceId: "parity/eval-concat",
      source: "(concat [1 2] (list 3 4))",
    },
    expect: [
      [["ok"], true],
      [["value", "kind"], "list"],
      [["value", "items", 0, "value"], 1],
      [["value", "items", 3, "value"], 4],
    ],
  },
  {
    name: "into evaluate",
    request: {
      op: "evaluate",
      sourceId: "parity/eval-into",
      source: '(into [["name" "Ada"] [:score 3]])',
    },
    expect: [
      [["ok"], true],
      [["value", "kind"], "map"],
      [["value", "entries", 1, "value", "value"], 3],
    ],
  },
  {
    name: "path evaluate",
    request: {
      op: "evaluate",
      sourceId: "parity/eval-path",
      source: '(path {:employee {:status "active"}} "employee" "status" "length")',
    },
    expect: [
      [["ok"], true],
      [["value", "kind"], "int"],
      [["value", "value"], 6],
    ],
  },
  {
    name: "format evaluate",
    request: {
      op: "evaluate",
      sourceId: "parity/eval-format",
      source: '(format "Hello {}, {}" "Ada" nil)',
    },
    expect: [
      [["ok"], true],
      [["value", "kind"], "string"],
      [["value", "value"], "Hello Ada, "],
    ],
  },
  {
    name: "string equality evaluate",
    request: {
      op: "evaluate",
      sourceId: "parity/eval-string-equality",
      source: '(= (get {:status "active"} :status) "active")',
    },
    expect: [
      [["ok"], true],
      [["value", "kind"], "bool"],
      [["value", "value"], true],
    ],
  },
  {
    name: "int typecheck",
    request: {
      op: "typecheck",
      sourceId: "parity/type-int",
      source: "(+ 1 2)",
    },
    expect: [
      [["ok"], true],
      [["type"], "Int"],
    ],
  },
  {
    name: "typed core typecheck",
    request: {
      op: "typecheckCoreTyped",
      sourceId: "parity/type-core-typed",
      source: "(: inc (-> Int Int)) (define (inc x) (+ x 1)) (inc 2)",
    },
    expect: [
      [["ok"], true],
      [["type"], "Int"],
      [["typedCore", "resultType"], "Int"],
      [["typedCore", "resultTypeExpr", "name"], "Int"],
      [["typedCore", "annotations", 0, "expr", "kind"], "definition"],
      [["typedCore", "annotations", 0, "typeExpr", "kind"], "function"],
      [["typedCore", "annotations", 1, "expr", "kind"], "lambda"],
      [["typedCore", "annotations", 2, "expr", "kind"], "application"],
      [["typedCore", "annotations", 2, "typeExpr", "name"], "Int"],
      [["typedCore", "annotations", 4, "expr", "name"], "x"],
      [["typedCore", "annotations", 4, "typeExpr", "name"], "Int"],
    ],
  },
  {
    name: "float typecheck",
    request: {
      op: "typecheck",
      sourceId: "parity/type-float",
      source: "(/ 4 2)",
    },
    expect: [
      [["ok"], true],
      [["type"], "Number"],
    ],
  },
  {
    name: "map typecheck",
    request: {
      op: "typecheck",
      sourceId: "parity/type-map",
      source: "(map (fn [x] (+ x 1)) (list 1 2))",
    },
    expect: [
      [["ok"], true],
      [["type"], "List<Int>"],
    ],
  },
  {
    name: "get typecheck",
    request: {
      op: "typecheck",
      sourceId: "parity/type-get",
      source: "(get {:a 1} :a)",
    },
    expect: [
      [["ok"], true],
      [["type"], "Int"],
    ],
  },
  {
    name: "equality typecheck",
    request: {
      op: "typecheck",
      sourceId: "parity/type-equality",
      source: '(= (get {:status "active"} :status) "active")',
    },
    expect: [
      [["ok"], true],
      [["type"], "Bool"],
    ],
  },
];

const failures = [];

for (const target of targets) {
  for (const testCase of cases) {
    let response;
    try {
      response = JSON.parse(target.request(testCase.request));
      for (const [path, expected] of testCase.expect) {
        expectPath(response, path, expected);
      }
    } catch (error) {
      failures.push({
        target: target.name,
        case: testCase.name,
        error: String(error),
        response,
      });
    }
  }
}

if (failures.length > 0) {
  console.error(`forma-ocaml target parity failures: ${failures.length}`);
  for (const failure of failures) {
    console.error(JSON.stringify(failure));
  }
  process.exit(1);
}

console.log(`forma-ocaml target parity ok (${cases.length} cases x ${targets.length} targets)`);
