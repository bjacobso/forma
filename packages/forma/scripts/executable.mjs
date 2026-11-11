import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

for (const bin of ["cli", "forma-language-server"]) chmodSync(`dist/${bin}.mjs`, 0o755);
// Imported implementation declarations retain their old documentation comments.
// Remove those comments using the TypeScript printer, preserving declaration types.
const printer = ts.createPrinter({ removeComments: true });
for (const file of readdirSync("dist", { recursive: true })) {
  if (!file.endsWith(".d.mts")) continue;
  const path = `dist/${file}`;
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  writeFileSync(path, printer.printFile(source));
}

// Ordinary Forma libraries ship as source for explicit file-module imports.
mkdirSync("dist/preludes", { recursive: true });
copyFileSync("../../preludes/modules/test.lisp", "dist/preludes/test.lisp");
