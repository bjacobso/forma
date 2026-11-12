#!/usr/bin/env bash
set -euo pipefail

patterns=(
  "meta""crdt"
  "open[ -]?""ontology"
  "open[_-]""ontology"
  # Match the legacy name as a token, allowing citations to loonlang.com.
  "(^|[^[:alnum:]_])on""lang([^[:alnum:]_]|$)"
  "oo[_-]""lang"
)

# The family manifest uses the sibling project’s current public name and site.
failed=0
for pattern in "${patterns[@]}"; do
  if git grep -nI -i -E "$pattern" -- . ':(exclude)scripts/check-branding.sh' ':(exclude)docs/.vitepress/family.json'; then
    failed=1
  fi
done

if (( failed != 0 )); then
  echo "Legacy project branding remains in tracked files." >&2
  exit 1
fi

echo "Branding check passed."
