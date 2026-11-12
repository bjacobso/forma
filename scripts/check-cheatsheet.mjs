import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { builtinContracts } from "../packages/ts/dist/Builtins.mjs";
import { showScheme } from "../packages/ts/dist/Type.mjs";
import { TsLanguageHost } from "../packages/host/dist/ts-host.mjs";
import { builtinDiagnosticCatalog } from "../packages/ts/dist/Diagnostic.mjs";

const path = new URL("../docs/cheatsheet.md", import.meta.url);
let page = readFileSync(path, "utf8");
const rows = [...builtinContracts].filter(([name, contract]) => contract.runtime && contract.hm && contract.scheme && !name.startsWith("__"))
  .sort(([a], [b]) => a.localeCompare(b)).map(([name, contract]) => {
    const names = new Map([...contract.scheme.tvars, ...contract.scheme.rvars, ...contract.scheme.evars].map((name, index) => [name, `a${index}`]));
    const signature = (contract.checked ?? showScheme(contract.scheme)).replace(/\b(?:__[a-z_]+|[tre]\d+)\b/gu, name => {
      if (!names.has(name)) names.set(name, `a${names.size}`);
      return names.get(name);
    });
    return `| \`${name}\` | \`${signature.replaceAll("|", "\\|")}\` |`;
  });
const table = ["| Name | Signature |", "| --- | --- |", ...rows].join("\n");
assert.ok(page.includes("<!-- builtin-contracts:start -->\n") && page.includes("<!-- builtin-contracts:end -->"), "Missing builtin table markers");
const updated = page.replace(/(?<=<!-- builtin-contracts:start -->\n)[\s\S]*?(?=<!-- builtin-contracts:end -->)/u, `${table}\n`);
if (process.argv.includes("--update")) { writeFileSync(path, updated); page = updated; }
assert.equal(page, updated, "Builtin table is stale: node scripts/check-cheatsheet.mjs --update");
assert.ok(page.split(/\s+/u).filter(Boolean).length <= 2500, "Cheat sheet exceeds 2,500 words");
const codes = new Set(builtinDiagnosticCatalog.map(entry => entry.code));
for (const match of page.slice(page.indexOf("## Ten common")).matchAll(/^\| `([\w/-]+)` \|/gmu)) {
  if (match[1].includes("/")) assert.ok(codes.has(match[1]), `Unknown diagnostic: ${match[1]}`);
}
const host = new TsLanguageHost();
const { sessionId } = await host.openSession();
const snippets = [...page.matchAll(/```lisp([^\n]*)\n([\s\S]*?)```/gu)];
assert.ok(snippets.length > 0, "Missing checked examples");
assert.equal([...page.matchAll(/^```[^\n]*\n/gmu)].length, snippets.length * 2, "Every code fence must be a checked Lisp example");
try {
  const modules = snippets.filter(match => match[1].trim()).map(match => {
    assert.match(match[1], /^ file=[\w-]+\.lisp$/u, "Unknown Lisp fence metadata");
    return { sourceId: match[1].trim().slice(5), source: match[2] };
  });
  const loaded = await host.loadSourceBundle({ sessionId, sources: modules });
  assert.deepEqual(loaded.diagnostics, []);
  for (const [index, match] of snippets.entries()) {
    const sourceId = match[1].trim() ? match[1].trim().slice(5) : `cheatsheet-${index + 1}.lisp`;
    const checked = await host.typecheck({ sessionId, sourceId, source: match[2] });
    assert.ok(!checked.diagnostics.some(d => d.severity === "error"), `${sourceId}: ${JSON.stringify(checked.diagnostics)}`);
  }
} finally { await host.closeSession({ sessionId }); }
console.log(`Cheat sheet passes: ${snippets.length} checked snippets, ${rows.length} builtin signatures, at most 2,500 words.`);
