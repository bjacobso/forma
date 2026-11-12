#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
pnpm --dir "$root" exec turbo run build --filter=@forma-language/forma
node "$root/examples/http-rpc/generate.mjs" --check
pnpm --dir "$root" exec tsc -p "$root/examples/http-rpc/tsconfig.json"
node --test "$root/examples/http-rpc/generate.test.mjs" "$root/examples/http-rpc/demo.test.ts"
