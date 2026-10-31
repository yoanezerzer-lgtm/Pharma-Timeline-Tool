# Handoff: where things stand (31 Oct 2026)

Read `CLAUDE.md` first: it holds the owner's standing rules. This note is
the current state and the next steps. Update it when they change, and start
a new session when a conversation gets long.

## Product direction (owner, 29 Oct 2026)
- **A free resource for scientists and students to learn from.** No
  accounts, no paywall. Favour clear explanations, sources a reader can
  follow, and pages that teach (how a drug works, which trials led to which
  approval) over business features.
- Only quote public-domain sources (FDA, ClinicalTrials.gov, MeSH,
  MedlinePlus). Only *link* to StatPearls: its licence bars derivatives.

## The site (https://yoanezerzer-lgtm.github.io/Pharma-Timeline-Tool/)
- **52 drugs.** The 6 originals (Rinvoq, Skyrizi, Keytruda, Lexapro,
  Foundayo, Mimrylo) plus 46 from FDA's list of new-medicine approvals.
- **Home** (`src/pages/DrugIndex.tsx`): compact list, grouped and filtered by
  therapeutic area. A drug appears under each area its uses fall in. Also
  filters by company and year; cards and table views remain.
- **Drug page** (`#/drug/<slug>`, `src/pages/DrugPage.tsx`): approved uses
  (each linked to its disease) and "About this drug": FDA drug class, label
  sections 12.1–12.3 as the PDF text reads (`scripts/ingest/pharmacology.ts`).
- **Approved-use page** (`#/drug/<slug>/indication/<slug>`): trials timeline.
- **Diseases** (`#/diseases`, `#/disease/<MeSH id>`, `src/pages/DiseasePage.tsx`):
  every approval for one disease across drugs on one timeline; MedlinePlus
  plain-language summary; MeSH definition; Excel and PowerPoint downloads
  made in the browser (`src/lib/export.ts`).
- **Check status** on every drug: "Not yet checked", "Partly checked · N of
  M" or "Checked", counted from `data/reference/` at build time.

## Where facts come from (all read by code, never written by an AI)
- **Company:** the name printed on the label ("Manufactured for: …") when
  it is the FDA applicant; duplicates merged with `sameCompany()`
  (`src/lib/company.ts`, `scripts/ingest/labelFacts.ts`).
- **FDA review office:** signature of the newest approval letter (shown on
  the drug page only).
- **Disease of an approved use:** a MeSH term on one of its pivotal trials'
  ClinicalTrials.gov records that the FDA wording names; most specific
  wins; non-disease terms dropped (`scripts/ingest/diseases.ts`).
  **Therapeutic areas** are MeSH's top-level disease categories.
- **MedlinePlus summary:** only when the topic's *title* is the same disease
  (`scripts/ingest/medlineplus.ts`). Its alternative names and MeSH
  headings include narrower diseases, so they don't count. Raw answers are
  kept on the `diag/raw-text-<slug>` branches.

## Known gaps (shown as blanks, not guessed)
- 59 of 90 approved uses have a disease. The others: recent trials not yet
  MeSH-tagged on ClinicalTrials.gov (Icotyde, Orzeyful), uses with no
  pivotal trial (Bysanti, Lexapro, imaging agents), or FDA wording that
  differs from MeSH (8 Keytruda uses, e.g. "Classical Hodgkin Lymphoma").
- 19 of 51 diseases have a MedlinePlus summary.
- Drug class missing for Awiqli and Xocova; Awiqli's label text is redacted.
- No review office for Mimrylo, Tauklarify, Veppanu; no label company for 5.
- Held back (no label in openFDA yet): zilurgisertib, iberdomide,
  daraxonrasib, pivekimab-sunirine.
- `npm run -s status` lists all of these, plus facts stuck in checking.

## Agents and automatic jobs
- **Nightly fact checker** (scheduled task "Nightly data verification",
  00:36 New York): starts a Sonnet session that follows
  `docs/agents/nightly-verify.md`. It takes unchecked drugs first; a fact
  unconfirmed 3 nights is "stuck" and waits for the owner.
- **Weekly refresh** (`.github/workflows/refresh-all.yml`, Saturdays 21:13
  New York, no AI): re-reads every drug. Routine changes publish themselves
  after the full checks. Others (approved uses, trial roles, new trials)
  wait on `data/refresh-<date>`: open a PR from it, check, merge. Run it by
  hand after a pipeline change, with `only` to try a few drugs first.
- **Site check** (`scripts/sitecheck.ts`, no AI): every page in a browser,
  on each pull request and after each deploy.
- **Weekly digest** (scheduled task, Sonnet, Mondays 07:13 Toronto): one
  email to the owner. **Needs the Gmail connector added to the task in
  claude.ai** (it couldn't be attached from a session).

## How to work (to save the owner's usage)
- Decide, don't ask; batch; check CI once, then merge. Auto-merge is off
  in the repo (Settings → General → Pull Requests can turn it on).
- New pipeline facts: write the extractor, test it on the real text on
  the `diag/raw-text-<slug>` branches, then trial-run `Refresh all drugs`
  on a few drugs from the branch (`publish: false`) and inspect before
  running all 52. Services this container can't reach (openFDA,
  ClinicalTrials.gov, MeSH, MedlinePlus) are reached from GitHub Actions.
- Use Sonnet for routine data runs and small fixes.

## Ideas not yet started
- More drugs once most are "Checked" (the `Add new drugs` workflow).
- Fill disease gaps: an FDA-wording-to-MeSH synonym step from MeSH's own
  entry terms (e.g. "Hodgkin Lymphoma" is an entry term of "Hodgkin Disease").
- Optional cleanup: ~110 old branches on GitHub (owner, branches page).
