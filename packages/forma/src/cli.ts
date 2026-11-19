#!/usr/bin/env node
if (process.argv[2] === "lsp") {
  // `forma lsp` is the language server; editors pass a transport, and stdio is the default.
  process.argv.splice(2, 1);
  if (!process.argv.slice(2).some((arg) => /^--(stdio|node-ipc|socket|pipe)\b/.test(arg))) process.argv.push("--stdio");
  await import("./forma-language-server.js");
} else {
  await import("@formalang/host/cli");
}
