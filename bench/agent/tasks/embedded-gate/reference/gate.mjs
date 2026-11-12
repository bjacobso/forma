import { readFile } from "node:fs/promises";
export async function openGate(createLanguage, { notify, steps }) {
 const source = await readFile(new URL("./rules.lisp", import.meta.url), "utf8");
 const language = await createLanguage({
  modules: [{id: "rules.lisp", source}],
  capabilities: {notify: {arity: 1,
   typeScheme: {kind: "function", params: [{kind: "type", name: "String"}], result: {kind: "type", name: "String"}},
   handler: async text => ({ok: true, value: await notify(text)})}}
 });
 return {
  check: source => language.check(source, {sourceId: "agent.lisp"}),
  run: source => language.run(source, {sourceId: "agent.lisp", limits: {steps}}),
  close: () => language.close()
 };
}
