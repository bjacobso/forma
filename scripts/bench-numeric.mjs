// Compile once, then measure the VM hot path. An optional workspace root allows
// the same workloads to run against a separately built baseline checkout.
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";

const root = resolve(process.argv[2] ?? new URL("..", import.meta.url).pathname);
const load = name => import(pathToFileURL(resolve(root, `packages/ts/dist/${name}.mjs`)).href);
const { parse, toSExprMany } = await load("Reader");
const { compileProgram, runChunk } = await load("VM");
const { defaultBuiltins } = await load("Builtins");
const size = 20_000;
const vector = `[${Array.from({length: size}, (_, index) => index).join(" ")}]`;
const sources = {
  "int-arithmetic": `(define sum [i acc] (if (< i ${size}) (sum (+ i 1) (+ acc (* i 3))) acc)) (sum 0 0)`,
  "float-arithmetic": `(define sum [i acc] (if (< i ${size}) (sum (+ i 1) (+ acc (* i 3.0))) acc)) (sum 0 0.0)`,
  "map-reduce": `(reduce (fn [acc x] (+ acc x)) 0 (map (fn [x] (* x 3)) ${vector})`,
};
for (const [name, source] of Object.entries(sources)) {
  const compiled = compileProgram(toSExprMany(parse(source).redTree), {builtins: defaultBuiltins});
  const options = {
    globals: Array.from({length: compiled.globals.count}, (_, index) => {
      const name = compiled.globals.nameAt(index);
      return defaultBuiltins[name] ? {_tag: "KBuiltin", name} : null;
    }),
    builtins: compiled.builtinRegistry.toArray(defaultBuiltins),
    builtinLookup: compiled.builtinRegistry.toMap(defaultBuiltins),
    stepLimit: 10_000_000,
  };
  const run = () => Effect.runSync(runChunk(compiled.chunk, {...options, globals: [...options.globals]}));
  for (let index = 0; index < 5; index++) run();
  const samples = [];
  for (let index = 0; index < 15; index++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({name, medianMs: samples[7], minMs: samples[0], maxMs: samples[14]}));
}
