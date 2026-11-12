#!/usr/bin/env node
declare const __FORMA_DISTRIBUTION_VERSION__: string;

let missing = false;
for (const [name, entry, range] of [
  ["vscode-languageserver", "vscode-languageserver/node.js", "^9.0.1"],
  ["vscode-languageserver-textdocument", "vscode-languageserver-textdocument", "^1.0.12"],
] as const) {
  try {
    import.meta.resolve(entry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw error;
    process.stderr.write(`forma-language-server needs ${name}. Install it: npm install ${name}@${range}\n`);
    missing = true;
    process.exitCode = 1;
  }
}

if (!missing && (process.argv.includes("--help") || process.argv.includes("--version"))) {
  console.log(`forma-language-server ${__FORMA_DISTRIBUTION_VERSION__}\nUsage: forma-language-server --stdio`);
} else if (!missing) {
  await import("@formalang/language-server/server");
}
