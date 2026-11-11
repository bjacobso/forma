import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { typecheck } from "../src/Engine.js";

function sources(directory: string): {sourceId:string;source:string}[] {
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry => {
    const path = resolve(directory,entry.name);
    if (entry.isDirectory()) return sources(path);
    if (/\.(lisp|forma)$/.test(entry.name)) return [{sourceId:path,source:readFileSync(path,"utf8")}];
    if (entry.name === "fixture.json") {
      const fixture = JSON.parse(readFileSync(path,"utf8"));
      if (typeof fixture.source?.inline === "string") return [{sourceId:path,source:fixture.source.inline}];
    }
    if (entry.name === "known-divergences.json") return JSON.parse(readFileSync(path,"utf8"))
      .filter((entry: {program?:string}) => typeof entry.program === "string")
      .map((entry: {id:string;program:string}) => ({sourceId:`${path}:${entry.id}`,source:entry.program}));
    return [];
  });
}

test("corpus, check-run seeds and type fixtures never expose solver variables", () => {
  const corpus = [
    ...sources(resolve(import.meta.dirname,"../../../conformance")),
    ...sources(resolve(import.meta.dirname,"fixtures")),
  ];
  expect(corpus.length).toBeGreaterThan(100);
  for (const input of corpus) for (const diagnostic of typecheck(input).diagnostics) {
    if (diagnostic.code === "typecheck/type-mismatch") {
      expect(diagnostic.details?.expected,input.sourceId).toEqual(expect.any(String));
      expect(diagnostic.details?.got,input.sourceId).toEqual(expect.any(String));
    }
    // File paths may contain names such as "t4-…"; only the rest of the message must be free of solver variables.
    const words = diagnostic.message.replace(/\S*[\\/]\S*/g, "");
    expect(words,input.sourceId).not.toMatch(/\bt\d+\b|__forma_[0-9a-f]+/);
  }
},60_000);
