import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OcamlDaemon } from "../../../scripts/parity/ocaml-daemon.mjs";
import { packageDir, repoRoot, readExampleSources, readPreludes } from "./corpus.mjs";

// Examples are independent modules: names such as Employee can differ across examples.
const groups = new Map();
for (const source of readExampleSources({canonicalOnly:true,dropOntologyManifest:true})) {
  if (source.sourceId.includes("compiler-debug/invalid-query")) continue;
  const name = source.sourceId.split("/")[1];
  groups.set(name, [...(groups.get(name) ?? []), source]);
}
if (groups.size === 0) throw new Error("No canonical example modules found");
const preludes = readPreludes().map(source => ({kind:"prelude",...source}));
const system = {kind:"source",sourceId:"preludes/system.lisp",source:readFileSync(resolve(repoRoot,"preludes/system.lisp"),"utf8")};
const daemon = new OcamlDaemon(resolve(packageDir,"dist/native/forma_cli.exe"),repoRoot);
let loaded=0, elaborated=0;
const failures=[];
try {
  for (const [name,sources] of groups) {
    const opened=await daemon.request({op:"openSession"});
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const sessionId=opened.value.sessionId;
    try {
      const bundle=await daemon.request({op:"loadSourceBundle",sessionId,sources:[...preludes,system,...sources.map(source=>({kind:"source",...source}))]});
      if (!bundle.ok) throw new Error(JSON.stringify(bundle));
      const results=bundle.value.results;
      for (const result of results) {
        if (!result.ok) failures.push({module:name,sourceId:result.sourceId,phase:"load",diagnostics:result.diagnostics});
        else if (sources.some(source=>source.sourceId===result.sourceId)) loaded++;
      }
      if (results.some(result=>!result.ok)) continue;
      const result=await daemon.request({op:"elaborateMany",sessionId,sourceIds:sources.map(source=>source.sourceId)});
      if (!result.ok) throw new Error(JSON.stringify(result));
      for (const source of result.value.results) {
        if (!source.ok) failures.push({module:name,sourceId:source.sourceId,phase:"elaborate",diagnostics:source.diagnostics});
        else elaborated++;
      }
    } finally {
      await daemon.request({op:"closeSession",sessionId});
    }
  }
} finally {
  await daemon.close();
}
const count=[...groups.values()].reduce((count,sources)=>count+sources.length,0);
console.log(`forma-ocaml corpus: ${groups.size} modules, loaded ${loaded}/${count}, elaborated ${elaborated}/${count}`);
for (const failure of failures) console.error(JSON.stringify(failure));
if (failures.length) process.exitCode=1;
