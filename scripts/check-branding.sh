#!/usr/bin/env bash
set -euo pipefail

patterns=(
  "meta""crdt"
  "open[ -]?""ontology"
  "open[_-]""ontology"
  "on""lang"
  "oo[_-]""lang"
)

failed=0
for pattern in "${patterns[@]}"; do
  if git grep -nI -i -E "$pattern" -- . ':(exclude)scripts/check-branding.sh'; then
    failed=1
  fi
done

if (( failed != 0 )); then
  echo "Legacy project branding remains in tracked files." >&2
  exit 1
fi

echo "Branding check passed."
