#!/usr/bin/env bash
# Puts each drug's saved FDA text (data/raw/<slug>/docs) from its
# diag/raw-text-<slug> branch into data/raw, for npm run compare-rules.
# Only drugs with a committed record; a shallow fetch of each branch.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

slugs=()
for f in data/drugs/*.json; do slugs+=("$(basename "$f" .json)"); done

# The text only matches the record of the run that saved it: a newer label
# brings approvals the published record may not have yet. That record is
# saved beside the text (data/raw/<slug>/record.json); on branches from
# before that, it is the ingest/<slug> branch the same run pushed.

# Missing branches make a batch fetch fail, so ask the remote which exist first.
existing=$(git ls-remote --heads origin 'diag/raw-text-*' 'ingest/*' | sed 's#.*refs/heads/##')
wanted=()
for s in "${slugs[@]}"; do
  for b in "diag/raw-text-$s" "ingest/$s"; do
    if grep -qx "$b" <<<"$existing"; then wanted+=("+refs/heads/$b:refs/remotes/origin/$b"); fi
  done
done
git fetch --quiet --no-tags --depth=1 origin "${wanted[@]}"

for s in "${slugs[@]}"; do
  ref="refs/remotes/origin/diag/raw-text-$s"
  git rev-parse --verify --quiet "$ref" >/dev/null || continue
  rm -rf "data/raw/$s/docs" "data/raw/$s/record.json"
  git archive "$ref" "data/raw/$s/docs" 2>/dev/null | tar -x || true
  if git cat-file -e "$ref:data/raw/$s/record.json" 2>/dev/null; then
    git show "$ref:data/raw/$s/record.json" > "data/raw/$s/record.json"
    continue
  fi
  ingest="refs/remotes/origin/ingest/$s"
  git rev-parse --verify --quiet "$ingest" >/dev/null || continue
  gap=$(( $(git log -1 --format=%ct "$ingest") - $(git log -1 --format=%ct "$ref") ))
  # Pushed by the same run: within the hour after the text.
  if [ "$gap" -ge 0 ] && [ "$gap" -le 3600 ] && git cat-file -e "$ingest:data/drugs/$s.json" 2>/dev/null; then
    git show "$ingest:data/drugs/$s.json" > "data/raw/$s/record.json"
  fi
done
echo "saved text for $(ls -d data/raw/*/docs 2>/dev/null | wc -l | tr -d ' ') drugs, with the run's own record for $(ls data/raw/*/record.json 2>/dev/null | wc -l | tr -d ' ')"
