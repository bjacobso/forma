import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OcamlDaemon } from "../../../scripts/parity/ocaml-daemon.mjs";
import { packageDir,repoRoot,readPreludes,readExampleSources } from "./corpus.mjs";

export const exampleModules = () => {
  const modules=new Map();
  for (const source of readExampleSources({canonicalOnly:true,dropOntologyManifest:true})) {
    if (source.sourceId.includes("compiler-debug/invalid-query")) continue;
    const name=source.sourceId.split("/")[1];
    modules.set(name,[...(modules.get(name) ?? []),{kind:"source",...source}]);
  }
  return modules;
};

/** Compile each independent example with its complete dependency bundle. */
export async function emitExampleModules() {
  const daemon=new OcamlDaemon(resolve(packageDir,"dist/native/forma_cli.exe"),repoRoot);
  const preludes=readPreludes({kind:"prelude"});
  const system={kind:"source",sourceId:"preludes/system.lisp",source:readFileSync(resolve(repoRoot,"preludes/system.lisp"),"utf8")};
  const results=[];
  try {
    for (const [name,sources] of exampleModules()) {
      const opened=await daemon.request({op:"openSession"});
      if (!opened.ok) throw new Error(JSON.stringify(opened));
      const sessionId=opened.value.sessionId;
      try {
        const loaded=await daemon.request({op:"loadSourceBundle",sessionId,sources:[...preludes,system,...sources]});
        if (!loaded.ok || loaded.value.results.some(result=>!result.ok)) throw new Error(`${name}: ${JSON.stringify(loaded)}`);
        const emitted=await daemon.request({op:"emitMany",sessionId,sourceIds:sources.map(source=>source.sourceId)});
        if (!emitted.ok || emitted.value.results.some(result=>!result.ok)) throw new Error(`${name}: ${JSON.stringify(emitted.ok ? emitted.value.results.filter(result=>!result.ok) : emitted)}`);
        results.push(...emitted.value.results);
      } finally {
        await daemon.request({op:"closeSession",sessionId});
      }
    }
  } finally {
    await daemon.close();
  }
  return results;
}
