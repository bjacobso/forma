// Run after building the engine and host, on Node 24. Alternating fresh
// processes compare warm disk snapshots with caching disabled, not a warm VM.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname,"..");
const dir = mkdtempSync(join(tmpdir(),"forma-startup-"));
const samples = 15;
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];
try {
  writeFileSync(join(dir,"kernel.forma"),readFileSync(join(root,"preludes/kernel.forma"),"utf8"));
  writeFileSync(join(dir,"main.forma"),'(import "./kernel.forma" [unless]) (define answer (unless false (+ 20 3))) answer');
  const url = name => JSON.stringify(pathToFileURL(join(root,`packages/ts/dist/${name}.mjs`)).href);
  const cases = {
    file: [join(root,"packages/host/dist/cli.mjs"),"file","typecheck",join(dir,"main.forma")],
    descriptors: ["--input-type=module","-e",`import {enablePreludeCache} from ${url("Node")}; import {bootstrapOntologyPreludes} from ${url("Preludes")}; enablePreludeCache(); console.log(JSON.stringify(bootstrapOntologyPreludes().stats));`],
  };
  const results = {};
  for (const [name,args] of Object.entries(cases)) {
    const baselinePath = process.argv[process.argv.indexOf("--baseline-cli") + 1];
    const baselineArgs = name === "file" && process.argv.includes("--baseline-cli") ? [resolve(baselinePath),...args.slice(1)] : args;
    const run = disabled => {
      const start = performance.now();
      const result = spawnSync(process.execPath,disabled ? baselineArgs : args,{encoding:"utf8",timeout:20_000,env:{...process.env,FORMA_CACHE_DIR:join(dir,"cache"),FORMA_NO_CACHE:disabled ? "1" : "0"}});
      assert.equal(result.status,0,result.stdout + result.stderr);
      return {ms:performance.now()-start,output:result.stdout};
    };
    const baseline = run(true);
    const first = run(false);
    const uncached = [], cached = [];
    for (let i=0;i<samples;i++) {
      for (const disabled of i % 2 ? [false,true] : [true,false]) {
        const result = run(disabled);
        assert.equal(result.output,baseline.output,"Caching changed observable results");
        (disabled ? uncached : cached).push(result.ms);
      }
    }
    const before = median(uncached), after = median(cached);
    results[name] = {samples,firstMissMs:first.ms,uncachedMedianMs:before,cachedMedianMs:after,reductionPercent:100*(1-after/before),uncachedMs:uncached,cachedMs:cached};
    // End-to-end startup includes process/import noise. Guard regressions, while
    // the descriptor workload must show a real improvement even on noisy CI.
    if (process.argv.includes("--check")) assert.ok(after < before * (name === "file" ? 1.1 : 0.9),`${name} startup regression: ${after.toFixed(1)}ms vs ${before.toFixed(1)}ms`);
  }
  console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,results},null,2));
} finally { rmSync(dir,{recursive:true,force:true}); }
