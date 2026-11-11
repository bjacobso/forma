import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { JsonAbi } from "../src/json-abi.js";

test("CLI prelude snapshots survive fresh processes and corrupt entries fall back", () => {
  const dir = mkdtempSync(join(tmpdir(),"forma-cache-"));
  try {
    const file = join(dir,"main.forma"), cache = join(dir,"cache");
    writeFileSync(join(dir,"kernel.forma"),readFileSync(resolve(import.meta.dirname,"../../../preludes/kernel.forma"),"utf8"));
    writeFileSync(file,'(import "./kernel.forma" [unless]) (export result) (define result (unless false (+ 20 3))) result');
    const run = (operation: string, disabled = false) => spawnSync(process.execPath,[resolve(import.meta.dirname,"../dist/cli.mjs"),"file",operation,file],{
      encoding:"utf8",env:{...process.env,FORMA_CACHE_DIR:cache,...disabled ? {FORMA_NO_CACHE:"1"} : {}},
    });
    for (const operation of ["typecheck","evaluate","declarations"]) {
      const uncached = run(operation,true), cold = run(operation), warm = run(operation);
      expect(uncached.status,uncached.stdout).toBe(0);
      expect(cold.stdout).toBe(uncached.stdout);
      expect(warm.stdout).toBe(uncached.stdout);
    }
    const files = readdirSync(cache);
    expect(files.length).toBeGreaterThan(0);
    const timestamps = files.map(name => statSync(join(cache,name)).mtimeMs);
    run("evaluate");
    expect(files.map(name => statSync(join(cache,name)).mtimeMs)).toEqual(timestamps);
    const kernel = join(dir,"kernel.forma");
    writeFileSync(kernel,readFileSync(kernel,"utf8").replace('`(if ~test nil (do ~@body))','`(if ~test nil 99)'));
    const edited = run("evaluate");
    expect(edited.stdout).toBe(run("evaluate",true).stdout);
    expect(JSON.parse(edited.stdout).value.result.printed).toBe("99");
    for (const name of files) writeFileSync(join(cache,name),"broken snapshot");
    // Restore the original source so the corrupted key is demanded again.
    writeFileSync(kernel,readFileSync(resolve(import.meta.dirname,"../../../preludes/kernel.forma"),"utf8"));
    expect(run("evaluate").stdout).toBe(run("evaluate",true).stdout);
    expect(files.some(name => readFileSync(join(cache,name),"utf8") !== "broken snapshot")).toBe(true);
  } finally { rmSync(dir,{recursive:true,force:true}); }
},20_000);

test("persisted descriptors reconstruct executable hooks and fresh mutable registries", () => {
  const dir = mkdtempSync(join(tmpdir(),"forma-descriptors-"));
  const node = resolve(import.meta.dirname,"../../ts/dist/Node.mjs");
  const preludes = resolve(import.meta.dirname,"../../ts/dist/Preludes.mjs");
  const descriptor = resolve(import.meta.dirname,"../../ts/dist/Descriptor.mjs");
  const script = `import {enablePreludeCache} from ${JSON.stringify(node)};
    import {bootstrapOntologyPreludes} from ${JSON.stringify(preludes)};
    import {elaborateProgram} from ${JSON.stringify(descriptor)};
    enablePreludeCache();
    const first=bootstrapOntologyPreludes();
    const result=elaborateProgram('(entity Person {:name String})',{prelude:first});
    first.descriptions.alias('leak','entity');
    const second=bootstrapOntologyPreludes();
    if(second.descriptions.has('leak')) throw new Error('Registry leaked');
    console.log(JSON.stringify(result));`;
  try {
    const run = (disabled = false) => spawnSync(process.execPath,["--input-type=module","-e",script],{encoding:"utf8",env:{...process.env,FORMA_CACHE_DIR:dir,...disabled ? {FORMA_NO_CACHE:"1"} : {}}});
    const baseline = run(true), cold = run(), warm = run();
    expect(baseline.status,baseline.stderr).toBe(0);
    expect(JSON.parse(baseline.stdout).ok,baseline.stdout).toBe(true);
    expect(cold.stdout).toBe(baseline.stdout);
    expect(warm.stdout).toBe(baseline.stdout);
    expect(readdirSync(dir).length).toBeGreaterThan(0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
},20_000);

test("direct file checking preserves the session ABI for imported values and type errors", async () => {
  const dir = mkdtempSync(join(tmpdir(),"forma-cli-check-"));
  try {
    const library = {sourceId:join(dir,"lib.forma"),source:'(export identity) (define identity [x] x)'};
    writeFileSync(library.sourceId,library.source);
    for (const expression of ['(identity 42)','(= :high (identity "high"))']) {
      const entry = {sourceId:join(dir,"main.forma"),source:`(import "./lib.forma" [identity])\n${expression}`};
      writeFileSync(entry.sourceId,entry.source);
      const abi = new JsonAbi();
      const {sessionId} = (await abi.handleJson('{"op":"openSession"}')).value as {sessionId:string};
      try {
        const loaded = await abi.host.loadSourceBundle({sessionId,sources:[library,entry]});
        expect(loaded.diagnostics).toEqual([]);
        const expected = await abi.handleJson(JSON.stringify({op:"typecheck",sessionId,sourceId:entry.sourceId}));
        const actual = spawnSync(process.execPath,[resolve(import.meta.dirname,"../dist/cli.mjs"),"file","typecheck",entry.sourceId],{encoding:"utf8"});
        expect(actual.status,actual.stderr).toBe(expected.ok ? 0 : 1);
        expect(JSON.parse(actual.stdout)).toEqual(expected);
      } finally { await abi.handleJson(JSON.stringify({op:"closeSession",sessionId})); }
    }
  } finally { rmSync(dir,{recursive:true,force:true}); }
},20_000);
