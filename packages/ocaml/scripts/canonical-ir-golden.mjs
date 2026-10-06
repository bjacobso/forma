import assert from "node:assert/strict";
import {readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {OcamlDaemon} from "../../../scripts/parity/ocaml-daemon.mjs";
import {requireNativeCli} from "./require-build.mjs";
const directory = resolve(import.meta.dirname, "../../../conformance/fixtures/canonical-ir");
const daemon = new OcamlDaemon(requireNativeCli(), resolve(import.meta.dirname, ".."));
const ok = response => {assert.equal(response.ok, true, JSON.stringify(response)); return response.value;};
try {
  const {sessionId} = ok(await daemon.request({op:"openSession"}));
  for (const filename of ["kernel", "compiler", "ontology"]) ok(await daemon.request({op:"loadPrelude",sessionId,sourceId:`preludes/${filename}.lisp`,source:readFileSync(resolve(directory, `../../../preludes/${filename}.lisp`), "utf8")}));
  for (const [name,file] of [["emit/canonical-schema","schema.lisp"],["emit/canonical-data","data.lisp"]]) ok(await daemon.request({op:"loadSource",sessionId,sourceId:name,source:readFileSync(resolve(directory,file),"utf8")}));
  const emitted = ok(await daemon.request({op:"emit",sessionId,sourceIds:["emit/canonical-schema","emit/canonical-data"],backend:"canonical-ir"}));
  const normalized = {backend:emitted.backend, artifacts:emitted.artifacts.map(({name,mediaType,content})=>({name,mediaType,content}))};
  const actual = {normalized,success:true};
  assert.equal(actual.normalized.artifacts[0].content.declarationCount, 5);
  assert.equal(actual.normalized.artifacts[0].content.modules.flatMap(m=>m.declarations).filter(d=>d.kind==="Record").length, 2);
  const path = resolve(directory,"expected.json");
  if (process.env.FORMA_UPDATE_GOLDEN === "1") writeFileSync(path, JSON.stringify(actual,null,2)+"\n");
  assert.deepEqual(actual, JSON.parse(readFileSync(path,"utf8")), "Canonical IR fixture is stale");
  ok(await daemon.request({op:"closeSession",sessionId}));
  console.log("forma-ocaml canonical IR golden ok (including module record identities)");
} finally {await daemon.close();}
