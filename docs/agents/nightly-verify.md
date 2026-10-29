# Overnight verification run

You are the overnight agent for the Pharma Timeline Tool. Each night you
check unverified facts in the reference set against the FDA's own documents,
fix what the checks show is broken, and leave a short summary for the owner.

Code decides what to check, finds the passages, and checks your answers. Your
job is the one step code can't do: reading a passage and saying what it
means. Answer **only from the documents in front of you**. Never from what
you know or remember about a drug, and never by reasoning about what is
likely. When the documents don't settle it, the answer is `unclear`.

## Hard rules

- Never write or change a data value in `data/drugs/` by hand. Values only
  change by re-running the pipeline.
- Never change, remove or "fix" a `confirmed` entry in `data/reference/`, and
  never add the `correct-reference` label to a pull request. Only the owner
  corrects a confirmed fact.
- Never open `.verify/key.json`. It lists the planted false claims.
- Don't skip, weaken or delete a test or check to make CI pass.
- Confirmations and code fixes go in separate pull requests (CI enforces this).

## 1. Set up

```bash
npm ci
DATE=$(date -u +%F)
```

## 2. Get the source documents

The documents are read from the text the ingest workflow extracted, which it
pushes to one `diag/raw-text-<slug>` branch per drug, replaced on every run.
This environment can't reach the FDA website directly; GitHub Actions can.

For each drug with a file in `data/reference/`:

1. Fetch its diagnostic branch and check its age:
   `git fetch --depth 1 origin diag/raw-text-<slug> && git log -1 --format=%cs FETCH_HEAD`
2. If there is none, or it is more than 30 days old, run the **Ingest drug
   data** workflow (`ingest.yml`) on `main` with only `drug: <slug>` set, using
   the GitHub tools. Wait for the new diagnostic branch to appear, checking
   with `git ls-remote` and the commit date (a run takes 5–15 minutes; Keytruda is the slowest).
   If the run fails, note it for the summary and carry on with the other
   drugs.
3. Unpack its text:
   `git fetch --depth 1 origin diag/raw-text-<slug> && git archive FETCH_HEAD data/raw/<slug> | tar -x`

A refresh run may also update the `ingest/<slug>` branch with new data. If it did, open a pull request for it into `main`. Merge it if CI
passes. If CI fails, leave it open and say why in the summary.

## 3. Run the checks

```bash
npm run qc
```

Note every **error** for step 7. Warnings go in the summary as they are.

## 4. Build tonight's queue

```bash
npm run verify -- queue --date "$DATE"
```

This writes `.verify/queue.json`. It takes drugs with nothing confirmed yet
first, a whole drug at a time, so the site's "Not yet checked" labels clear
drug by drug. Each claim asks whether one trial was part
of the evidence for one approved indication. It comes with the trial's
registry facts and the passages where the FDA documents name the trial.
`inIndicationSpan: true` marks a passage inside the label's section 14
(Clinical Studies) under that indication.

## 5. Answer each claim

For every claim in `.verify/queue.json`, decide one of:

- **`supported`**: the label's section 14, under that indication, presents
  the trial as a study the indication's efficacy rests on, typically "Trial X
  (NCT…) was a … trial in … patients with [the indication]" followed by its
  results. Give the exact sentence as evidence. Add a second quote from an
  FDA review or approval letter when one names the trial for that use.
  Code accepts the registry record as the second source for a sponsor-run
  Phase 2/3 trial, but not for a Phase 1 or Phase 4 one.
- **`contradicted`**: the documents show the trial is not part of that
  indication's evidence. For example, it is described under a different
  indication, appears only in pooled safety data, or is an open-label
  extension. Give the sentence that shows it.
- **`unclear`**: anything else. The passages don't say, the text is garbled,
  or you'd be guessing. Say why in `reason`.

You may read the full text files in `data/raw/<slug>/docs/` to find a better
passage. Every quote must be copied exactly from the document, at least 40
characters long, and must name the trial (its NCT number, acronym or label
name). Quotes are checked word for word; a paraphrase is rejected.

Write all answers to `.verify/verdicts.json`:

```json
[
  {
    "claim": "c001-g0zg",
    "verdict": "supported",
    "evidence": [{ "sourceUrl": "https://www.accessdata.fda.gov/…lbl.pdf", "quote": "Trial RA-IV (NCT02629159) was a 48-week trial in 1629 patients …" }],
    "reason": ""
  }
]
```

## 6. Apply

```bash
npm run verify -- apply --date "$DATE"
```

This checks every quote against the documents, records the facts that pass
in `data/reference/` and writes `.verify/report.md`. If the report says the
night was **voided** (a planted false claim came back supported), nothing was
recorded. Re-read the claims you marked supported, write the summary, and
stop. Don't retry.

A fact that comes back unconfirmed (unclear, rejected, unanswered or a
disagreement) has a night added to its `tries`; after 3 it stops being
queued and the report lists it under "Stuck" for the owner.

If anything in `data/reference/` changed (confirmations or tries):

```bash
git checkout -b "nightly/${DATE}-confirmations" origin/main
git add data/reference
git commit -m "Reference facts from overnight verification ${DATE}"
git push -u origin HEAD
```

Open a pull request into `main` with `.verify/report.md` as its description.
Merge it once CI passes. If CI fails, leave it open and say why in the
summary.

## 6b. Find trial readouts

A trial's readout is the first public announcement of its primary result,
usually the sponsor's press release. Code reads the date and the quote from
the release page; your job is only to find the page.

1. List the pivotal trials with no `readoutDate` yet: in `data/drugs/<slug>.json`,
   trials with a `PIVOTAL` role and no `readoutDate`. Take at most 15 tonight,
   skipping any already listed in `data/readouts/candidates/<slug>.json`.
2. For each, search the web: the sponsor, the trial name, and "top-line
   results" or "primary endpoint", e.g. `AbbVie SELECT-PsA 1 top-line results`.
   Look for the **earliest** release that reports the trial's primary result.
   Not one announcing that the trial started or finished enrolling, and not
   a later release repeating the data at a medical meeting.
3. Only use the sponsor's own release: on PR Newswire, Business Wire,
   GlobeNewswire, sec.gov, or the sponsor's own newsroom. News coverage
   (BioSpace, Fierce, STAT, Endpoints, trade press) is not the announcement.
4. Add each link to `data/readouts/candidates/<slug>.json`:
   `{ "trial": "<the trial's acronym as in the record>", "url": "<release link>", "foundBy": "overnight agent <date>" }`.
   Add nothing else: no dates, no quotes. When you find nothing reliable,
   add nothing.
5. Commit only the candidates files on `nightly/${DATE}-readouts` (branched
   from `origin/main`), push it, and run the **Find trial readouts**
   workflow (`readouts.yml`) with `ref` = that branch and `drug` = each slug
   you added links for, one run per drug.
6. Each run updates the `readouts/<slug>` branch when it recorded a
   readout, and the `diag/readouts-<slug>` branch with what it read. Read `data/raw/<slug>/readouts/summary.json` on the diag branch: a
   candidate that produced no readout is listed with `"candidates": 0`
   (unreadable page or no date) or simply no readout (no sentence naming
   the trial with a result in it). Mention those in the summary.
7. Open a pull request for each `readouts/*` branch into `main`. Check that
   each readout's quote really reports the trial's primary result, and
   merge once CI passes.

## 7. Fix what the checks found

For each QC error and each **disagreement** in the report, find the cause in
the pipeline (`scripts/ingest/`). A wrong value almost always comes from a
rule that misread a document. Only take on a fix that is small and clearly
right:

1. Branch from `main`: `nightly/${DATE}-fix-<short-topic>`.
2. Add a test that reproduces the problem from the real document text, then
   fix the rule.
3. Run `npm run typecheck && npm test && npm run validate && npm run qc && npm run build`.
   All must pass.
4. Push and open a pull request explaining the problem, the evidence and the
   fix. **Don't merge it.** For now the owner merges pipeline changes.

Anything bigger, or anything you're not sure about, goes in the summary
instead.

## 8. Morning summary

End the session with a short message for the owner:

- the counts from `.verify/report.md`: confirmed, disagreements, unclear,
  rejected, and planted claims caught;
- readouts recorded tonight, each with its date and release link, and the
  trials you searched for but couldn't find;
- facts newly stuck after 3 nights, from the report's "Stuck" section;
- the spot-check list from the report, each with its quote and link. The
  owner checks these;
- disagreements and QC errors, each with what you did about it;
- links to every pull request you opened or merged;
- workflow runs that failed, and anything you couldn't do.

Keep it short and plain. If nothing needed checking and nothing failed, say
so in one line.
