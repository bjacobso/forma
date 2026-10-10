import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonAbi } from "../src/json-abi.js";
import { TsLanguageHost } from "../src/ts-host.js";

const cli = resolve(import.meta.dirname, "../dist/cli.mjs");
const request = (abi: JsonAbi, input: unknown) => abi.handleJson(JSON.stringify(input));
describe("JSON process ABI", () => {
  const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname,"../../../conformance/fixtures/host-plumbing.json"),"utf8"));
  for (const fixture of fixtures.cases) {
    it(`shared native host fixture: ${fixture.id}`, async () => {
      expect(await request(new JsonAbi(),fixture.request)).toMatchObject(fixture.typescript?.expected ?? fixture.expected);
    });
  }
  const nativeCli = resolve(import.meta.dirname,"../../ocaml/dist/native/forma_cli.exe");
  it.skipIf(!existsSync(nativeCli))("checks the stored host assertions against the OCaml oracle", () => {
    for (const fixture of fixtures.cases) {
      const response = spawnSync(nativeCli,["request",JSON.stringify(fixture.request)],{encoding:"utf8"});
      expect(response.status,response.stderr).toBe(0);
      expect(JSON.parse(response.stdout)).toMatchObject(fixture.expected);
    }
  });
  it("ports the native per-form reuse fixture", async () => {
    const abi = new JsonAbi();
    const forms = async (source:string) => ((await request(abi,{op:"incrementalSummary",source})).value as {forms:{digest:string}[]}).forms;
    const before = await forms(fixtures.incremental.before), after = await forms(fixtures.incremental.after);
    expect(before.map((f,i)=>f.digest !== after[i]?.digest ? i : -1).filter(i=>i>=0)).toEqual(fixtures.incremental.changedForms);
  });

  it("separates author errors from defects and rejects malformed boundaries", async () => {
    const abi = new JsonAbi();
    expect(await abi.handleJson("{" )).toMatchObject({ok:false,diagnostics:[{code:"abi/invalid-json"}]});
    expect(await request(abi,{op:"parse",source:9})).toMatchObject({ok:false,diagnostics:[{code:"abi/invalid-request"}]});
    expect(await request(abi,{op:"nope"})).toMatchObject({ok:false,diagnostics:[{code:"abi/unsupported-op"}]});
    expect(await request(abi,{op:"typecheck",source:'(+ 1 "x")'})).toMatchObject({ok:false,diagnostics:[{code:"typecheck/type-mismatch"}]});
    const host = new TsLanguageHost();
    host.version = async () => { throw new Error("injected failure"); };
    expect(await request(new JsonAbi(host),{op:"version"})).toMatchObject({ok:false,diagnostics:[{code:"internal/error"}]});
    expect(await request(abi,{op:"sessionInfo",sessionId:"missing"})).toMatchObject({ok:false,diagnostics:[{code:"abi/unknown-session"}]});
  });
  it("returns located configuration diagnostics through the boundary and editor host", async () => {
    const input = {sourceId:"author.forma",source:"external",hostBuiltins:[{name:"external",typeScheme:{kind:"type",name:"Typo"}}]};
    expect(await request(new JsonAbi(),{op:"typecheck",...input})).toMatchObject({ok:false,diagnostics:[{code:"typecheck/host-builtin",span:{sourceId:"author.forma",startOffset:0,endOffset:8}}]});
    expect(await new TsLanguageHost().analyzeEditor(input as never)).toMatchObject({success:false,diagnostics:[{code:"typecheck/host-builtin",span:{startOffset:0,endOffset:8}}]});
  });
  it("retains sessions across requests and reports only executed load phases", async () => {
    const abi = new JsonAbi();
    const opened = await request(abi,{op:"openSession"});
    const sessionId = (opened.value as {sessionId:string}).sessionId;
    const loaded = await request(abi,{op:"loadSource",sessionId,sourceId:"main.forma",source:"42",timings:true});
    expect(loaded).toMatchObject({ok:true,value:{formCount:1,timings:{parseMs:expect.any(Number),storeMs:expect.any(Number)}}});
    expect((loaded.value as {timings:unknown}).timings).not.toHaveProperty("typecheckMs");
    expect(await request(abi,{op:"typecheck",sessionId,sourceId:"main.forma"})).toMatchObject({ok:true});
    expect(await request(abi,{op:"typecheckCoreTyped",sessionId,sourceId:"main.forma"})).toMatchObject({ok:true,typedCore:expect.any(Array)});
    const prelude = await request(abi,{op:"loadSource",sessionId,sourceId:"helpers.forma",kind:"prelude",source:"(define answer 42)",timings:true});
    expect(prelude).toMatchObject({ok:true,value:{timings:{parseMs:expect.any(Number),typecheckMs:expect.any(Number),evalMs:expect.any(Number),metacheckMs:expect.any(Number),storeMs:expect.any(Number)}}});
    const beforeRejectedLoad = await request(abi,{op:"typecheck",sessionId,source:"answer"});
    const rejected = await request(abi,{op:"loadSource",sessionId,sourceId:"helpers.forma",kind:"prelude",source:'(define answer (+ 1 "bad"))',timings:true});
    expect(rejected).toMatchObject({ok:false,value:{timings:{parseMs:expect.any(Number),typecheckMs:expect.any(Number)}}});
    expect((rejected.value as {timings:unknown}).timings).not.toHaveProperty("storeMs");
    expect(await request(abi,{op:"typecheck",sessionId,source:"answer"})).toMatchObject({ok:true,type:beforeRejectedLoad.type});
    await request(abi,{op:"closeSession",sessionId});
  });
  it("hashes form structure independently of layout and source identity", async () => {
    const abi = new JsonAbi();
    const snapshot = async (source:string) => (await request(abi,{op:"incrementalSummary",source})).value as {forms:{digest:string}[]};
    const a = await snapshot("(define x 1)\nx");
    const b = await snapshot("; comment\n ( define x 1 ) \n x");
    const c = await snapshot("(define x 2) x");
    expect(a.forms.map(f=>f.digest)).toEqual(b.forms.map(f=>f.digest));
    expect(a.forms[0]?.digest).not.toBe(c.forms[0]?.digest);
    expect(a.forms[1]?.digest).toBe(c.forms[1]?.digest);
    expect(a.forms[0]?.digest).toMatch(/^[a-f0-9]{16}$/);
  });
  it("keeps a daemon alive after boundary, parse, typecheck, and session errors", () => {
    const lines = ['{', JSON.stringify({op:"parse",source:"("}), JSON.stringify({op:"typecheck",source:'(+ 1 "x")'}), JSON.stringify({op:"sessionInfo",sessionId:"missing"}), JSON.stringify({op:"version"})];
    const result = spawnSync(process.execPath,[cli,"daemon"],{input:lines.join("\n")+"\n",encoding:"utf8"});
    expect(result.status,result.stderr).toBe(0);
    const responses = result.stdout.trim().split("\n").map(line=>JSON.parse(line));
    expect(responses).toHaveLength(5);
    expect(responses.map(r=>r.ok)).toEqual([false,false,false,false,true]);
  });
  it("accepts requests on stdin and resolves file modules with author diagnostics", () => {
    const result = spawnSync(process.execPath,[cli,"request"],{input:JSON.stringify({op:"parseSummary",source:"1 2"}),encoding:"utf8"});
    expect(JSON.parse(result.stdout)).toMatchObject({ok:true,value:{formCount:2}});
    const dir = mkdtempSync(join(tmpdir(),"forma-cli-"));
    try {
      writeFileSync(join(dir,"lib.forma"),'(export identity) (define identity [x] x)');
      writeFileSync(join(dir,"main.forma"),'(import "./lib.forma" [identity]) (identity 42)');
      for (const operation of ["typecheck","evaluate","interface","declarations"]) {
        const result = spawnSync(process.execPath,[cli,"file",operation,join(dir,"main.forma")],{encoding:"utf8"});
        expect(result.status,result.stderr).toBe(0);
        expect(JSON.parse(result.stdout),result.stdout).toMatchObject({ok:true});
      }
      writeFileSync(join(dir,"main.forma"),'(import "./missing.forma" [nope])');
      const failed = spawnSync(process.execPath,[cli,"file","typecheck",join(dir,"main.forma")],{encoding:"utf8"});
      expect(JSON.parse(failed.stdout)).toMatchObject({ok:false,diagnostics:[{span:{sourceId:join(dir,"main.forma")}}]});
    } finally { rmSync(dir,{recursive:true,force:true}); }
  }, 30_000);
});
