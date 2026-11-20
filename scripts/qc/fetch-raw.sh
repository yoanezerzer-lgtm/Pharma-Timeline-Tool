#!/usr/bin/env bash
# Unpacks the FDA documents' text the ingest saved for every drug
# (diag/raw-text-<slug>) into data/raw/<slug>/docs, so `npm run qc` can check
# each dated use against its approval's label. Drugs with no such branch are
# skipped; qc then skips their labels too.
set -uo pipefail
for f in data/drugs/*.json; do
  slug=$(basename "$f" .json)
  if git fetch -q --depth 1 origin "diag/raw-text-$slug" 2>/dev/null; then
    git archive FETCH_HEAD "data/raw/$slug/docs" 2>/dev/null | tar -x || echo "no saved documents for $slug"
  else
    echo "no diag/raw-text-$slug"
  fi
done
