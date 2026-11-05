// Run after the engine build, as pnpm check does. Protocol preludes are exempt.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { loadPreludes, renderPrelude } from "../docs/.vitepress/preludes.ts";
import { parseManyToSExpr } from "../packages/ts/dist/Reader.mjs";
import { bootstrapOntologyPreludes, preludeSource } from "../packages/ts/dist/Preludes.mjs";
import { elaborateProgram } from "../packages/ts/dist/Descriptor.mjs";
import { bootstrapElmPreludes, generateElmProgram } from "../packages/ts/dist/Elm.mjs";
import { bootstrapEmailPreludes, generateEmailProgram } from "../packages/ts/dist/Email.mjs";
import { bootstrapHttpApiPreludes, generateHttpApiProgram } from "../packages/ts/dist/HttpApi.mjs";

const ontology = bootstrapOntologyPreludes();
const stacks = {
  ontology, ui: ontology, viewspec: ontology,
  elm: bootstrapElmPreludes(), email: bootstrapEmailPreludes(),
  "http-api": bootstrapHttpApiPreludes(),
};
const linkers = { elm: generateElmProgram, email: generateEmailProgram, "http-api": generateHttpApiProgram };
const parse = source => Effect.runSync(parseManyToSExpr(source));
const syntax = source => JSON.parse(JSON.stringify(parse(source), (key, value) => key === "loc" ? undefined : value));
let forms = 0, examples = 0;
for (const prelude of loadPreludes().filter(prelude => prelude.group === "domain")) {
  const source = readFileSync(new URL(`../preludes/${prelude.file}`, import.meta.url), "utf8");
  assert.equal(preludeSource(prelude.file), source, `${prelude.file}: regenerate embedded prelude sources`);
  const authoredForms = parse(source).filter(form => form._tag === "List" && form.items[0]?.name === "form");
  if (!authoredForms.length) continue;
  const stack = stacks[prelude.slug];
  assert.ok(stack, `${prelude.file}: add its example bootstrap stack to check-prelude-docs.mjs`);
  const page = renderPrelude(prelude);
  for (const form of authoredForms) {
    const name = form.items[1]?.items?.[0]?.name;
    const label = `${prelude.file}: ${name}`;
    assert.ok(form.items[2]?._tag === "Str" && form.items[2].value.trim(), `${label}: missing form docstring`);
    const descriptor = stack.descriptions.get(name);
    const entry = prelude.entries.find(entry => entry.kind === "form" && entry.name === name);
    assert.ok(descriptor?.doc?.trim() && entry?.doc?.trim(), `${label}: documentation was not extracted`);
    assert.ok(descriptor.examples?.length, `${label}: missing per-form examples`);
    assert.equal(entry.examples?.length, descriptor.examples.length, `${label}: reference dropped examples`);
    for (const [index, example] of descriptor.examples.entries()) {
      const exampleLabel = `${label}, example ${index + 1}`;
      assert.deepEqual(syntax(entry.examples[index]), syntax(example), `${exampleLabel}: reference changed example syntax`);
      assert.ok(page.includes(entry.examples[index]), `${exampleLabel}: reference did not render the source`);
      const options = { sourceId: `${prelude.file}#${name}-example-${index + 1}` };
      const result = linkers[prelude.slug]
        ? linkers[prelude.slug](example, options)
        : elaborateProgram(example, { ...options, prelude: stack });
      assert.ok(result.ok, `${exampleLabel}:\n${JSON.stringify(result.diagnostics, null, 2)}`);
      if (linkers[prelude.slug]) assert.ok(result.code, `${exampleLabel}: linker did not emit TypeScript`);
      examples++;
    }
    forms++;
  }
}
console.log(`Prelude docs pass: ${forms} form docstrings, ${examples} checked examples; protocol preludes exempt.`);
