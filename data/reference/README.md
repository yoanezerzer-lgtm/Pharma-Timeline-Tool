# Reference set

Facts checked against the FDA's own documents, used to score the pipeline's
output (`npm run qc`). One file per drug, named like the drug record.

- `confirmed`: checked against the source; `checkedBy` says by whom or what.
  A mismatch fails CI.
- `baseline`: the pipeline's answer when recorded, not yet checked. A
  mismatch is reported as a change, not counted as wrong.

`npm run qc -- --snapshot <slug>` records the current record as baseline
entries and never touches a confirmed one. To confirm an entry, check it
against the cited source, set `status` to `confirmed` and fill `checkedBy`.
Never confirm a value from memory or by reasoning about it; only from the
source document.
