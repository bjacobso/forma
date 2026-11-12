#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
pnpm exec forma check src/data.lisp
pnpm exec forma check src/main.lisp
result=$(pnpm exec forma run src/main.lisp)
printf '%s\n' "$result"
test "$result" = '"Hello from Forma"'
pnpm exec forma fmt --check src/main.lisp src/rules.lisp src/data.lisp
pnpm exec forma test
