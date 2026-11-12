#!/usr/bin/env node
declare const __FORMA_DISTRIBUTION_VERSION__: string;

if (process.argv.includes("--help") || process.argv.includes("--version")) {
  console.log(`forma-language-server ${__FORMA_DISTRIBUTION_VERSION__}\nUsage: forma-language-server --stdio`);
} else {
  await import("@formalang/language-server/server");
}
