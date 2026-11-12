import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createLanguage } from "@forma-language/forma";

export async function openLanguage(notify = console.log) {
  const source = await readFile(new URL("prelude.lisp", import.meta.url), "utf8");
  return createLanguage({
    preludes: [{ id: "prelude.lisp", source }],
    capabilities: { notify: { arity: 1, handler: value => { notify(value); return { ok: true, value }; } } },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lang = await openLanguage();
  try {
    const result = await lang.run('(notify "Hello from Forma")');
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  } finally { await lang.close(); }
}
