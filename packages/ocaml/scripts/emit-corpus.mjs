import { emitExampleModules } from "./corpus-emission.mjs";
const results=await emitExampleModules();
const declarations=results.reduce((count,result)=>count+result.artifact.content.declarationCount,0);
console.log(`forma-ocaml corpus emit ok (${results.length} sources, ${declarations} declarations)`);
