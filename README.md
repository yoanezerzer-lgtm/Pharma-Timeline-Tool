# Drug Development Timelines

A browsable repository of how medicines actually got approved: every clinical trial
behind a marketing application, traced from the FDA approval package and plotted from
phase 1 through to approval and subsequent label expansions.

Click a drug, read its development timeline as a Gantt chart, click any trial for its
cohort, population, design, and endpoints.

## Why this works

The link between a trial and an approval is already documented — it just lives in PDFs.
The FDA approval package (Medical Review, Summary Review) and section 14 of the approved
label name the trials that supported the indication. Reviews cite sponsor protocol
numbers like `M13-549`, and those same numbers are recorded on the trial's
ClinicalTrials.gov record. That gives a complete join:

```
openFDA Drugs@FDA  ──▶  application + submission dates + document URLs
                            │
                            ▼
        approval package PDFs  ──▶  protocol numbers, NCT IDs, acronyms
                            │
                            ▼
        ClinicalTrials.gov  ──▶  phase, dates, enrollment, design
                                  (this draws the chart)
```

Because ClinicalTrials.gov can confirm whether a token is a real study identifier, the
extractor uses a deliberately loose regex and lets the registry reject the noise. A
false positive costs one cached HTTP request; a missed trial costs a hole in the
timeline. No language model is involved, and nothing is inferred.

## Cost

Zero. openFDA and ClinicalTrials.gov are public and need no API key, PDF parsing runs
locally via `pdfjs-dist`, and GitHub Actions and Pages are free for public repositories.

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the suite. Fully offline — every test uses fixtures. |
| `npm run typecheck` | TypeScript, no emit. |
| `npm run validate` | Checks every committed drug record against the schema. |
| `npm run build` | Production build into `dist/`. |

## Ingesting data

```bash
npm run ingest -- --drug upadacitinib
```

Flags:

| Flag | Purpose |
| --- | --- |
| `--steps fda,docs,codes,ctgov,merge` | Run only some stages. |
| `--refresh` | Ignore the on-disk cache and re-fetch. |
| `--max-lookups 400` | Cap registry lookups on a long review document. |
| `--dry-run` | Report what would change without writing. |

Every response is cached under `data/raw/<slug>/`, so re-runs are cheap and mostly
offline. Re-running when nothing has changed is a true no-op — the record is written
byte-for-byte identically, including the ingest timestamp.

The same script runs in CI via the **Ingest drug data** workflow (`workflow_dispatch`),
which pushes the result to a branch and opens a pull request with the data diff.
Opening a PR from Actions needs the repository setting *Settings → Actions → General →
Workflow permissions → "Allow GitHub Actions to create and approve pull requests"*,
which is off by default. If it is off, the workflow still pushes the data and prints a
link to open the PR by hand rather than failing.

To add a drug, add an entry to `scripts/ingest/registry.ts` — the application number and
the intervention names to match — and run the pipeline.

### The pipeline

| Stage | Does |
| --- | --- |
| `fda` | openFDA Drugs@FDA → application, approved submissions (each becomes a milestone), and approval-package document URLs. |
| `docs` | Downloads review and label PDFs; extracts the text layer locally. |
| `codes` | Regex candidate identifiers, then validates each against ClinicalTrials.gov. |
| `ctgov` | Fetches full registry records, plus every trial registered for the drug, to separate the filing from later work. |
| `merge` | Writes `data/drugs/<slug>.json`, preserving human-verified fields. |

Orchestration lives in `scripts/ingest/run.ts` as `runIngest()`, with every I/O path
injectable; `cli.ts` only parses arguments and prints. That split is what lets
`tests/ingest.e2e.test.ts` run the whole pipeline against a pre-seeded cache with no
network — the stages wired together are where the interesting failures live.

## Trust model

Every field carries provenance: where it came from, how it was extracted, and whether a
person has checked it.

- **Two rules are load-bearing.** A field marked `verified: true` is *never* overwritten
  by a later ingest run — conflicts are reported instead. And a curated trial the
  registry stops returning is kept, not deleted.
- **Roles are rules, not guesses.** A trial named in label section 14 is marked
  `PIVOTAL`, because that is a fact about the document. Everything else is a weaker
  heuristic, marked unverified, for a person to correct.
- **Narrative is human-authored.** `takeaways`, `limitations`, and the drug summary are
  never generated. They stay empty until written, and the UI omits empty sections rather
  than showing a shell.
- **Dates keep their precision.** ClinicalTrials.gov often gives month- or year-only
  dates, so `DateValue` records how precise the source actually was and the chart fades
  those bar edges instead of implying a specific day.

## Tests

`npm test` runs everything offline. Alongside the per-stage unit tests there is an
end-to-end run (`tests/ingest.e2e.test.ts`) that seeds a fake cache and drives the real
pipeline, checking the things unit tests structurally cannot: that document codes join
to registry records, that label section 14 drives the pivotal flag, that re-running is
byte-identical, and that a human-verified field survives a re-run with the disagreement
reported.

## Current status

The committed `upadacitinib` record is **hand-authored placeholder geometry**, marked
`extractedBy: 'seed', verified: false` throughout, so the interface had something to
render before the first pipeline run. The site shows a banner saying so. Running the
ingest replaces it wholesale.

Not yet built:

- **EMA.** The schema defines EU regulatory fields and milestone types
  (`MAA_SUBMISSION`, `CHMP_OPINION`, `EC_DECISION`) so adding it is additive rather than
  a migration, but nothing populates or renders them. The EU lane is simply absent.
- **OCR.** Approval packages older than roughly 2002 are scanned images with no text
  layer. The pipeline warns when it finds one instead of silently producing zero trials.
- **Pre-2005 trials** frequently have no ClinicalTrials.gov record at all, so the join
  misses and dates have to come from the review text by hand. This affects older drugs
  (Gardasil 4, for instance); it does not affect Rinvoq.

## Sources

- [openFDA Drugs@FDA API](https://open.fda.gov/apis/drug/drugsfda/)
- [ClinicalTrials.gov REST API v2](https://clinicaltrials.gov/data-api/api)
- FDA approval packages on [accessdata.fda.gov](https://www.accessdata.fda.gov/scripts/cder/daf/)
