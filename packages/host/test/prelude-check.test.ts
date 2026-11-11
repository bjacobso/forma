import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

test("an external prelude uses only the CLI to check and generate its reference", () => {
  const fixture = resolve(import.meta.dirname,"../../../conformance/consumer-prelude");
  const dir = mkdtempSync(join(tmpdir(),"forma-prelude-"));
  try {
    const out = join(dir,"reference.md");
    const run = (...options: string[]) => spawnSync(process.execPath,[resolve(import.meta.dirname,"../dist/cli.mjs"),"prelude","check",join(fixture,"greeting.forma"),...options],{cwd:dir,encoding:"utf8"});
    const checked = run("--catalog",join(fixture,"diagnostics.json"),"--out",out);
    expect(checked.status, checked.stdout + checked.stderr).toBe(0);
    expect(JSON.parse(checked.stdout)).toMatchObject({ok:true,value:{forms:1,examples:1}});
    expect(readFileSync(out,"utf8")).toContain("(greet world)");
    const missing = run();
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).diagnostics).toContainEqual(expect.objectContaining({code:"prelude/diagnostic-coverage"}));
    expect(run("--unknown").status).toBe(1);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
