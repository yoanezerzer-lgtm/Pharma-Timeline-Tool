# Handoff: where things stand (29 Oct 2026)

Read `CLAUDE.md` first: it holds the owner's standing rules. This note is
the current state and the agreed next steps. Update it when they change.

## Where things stand
- **52 drugs** on the site (https://yoanezerzer-lgtm.github.io/Pharma-Timeline-Tool/).
  The 6 original ones (Rinvoq, Skyrizi, Keytruda, Lexapro, Foundayo,
  rusfertide) plus 46 added from FDA's own list of new-medicine approvals.
- **46 of the 52 are unverified.** The overnight checker
  (`docs/agents/nightly-verify.md`, Sonnet, ~00:36 ET) now takes drugs with
  nothing confirmed first, a whole drug at a time. The site labels each drug
  "Not yet checked", "Partly checked · N of M" or "Checked", counted from
  `data/reference/` at build time.
- **Home screen** is a compact list grouped by FDA review office (from the
  newest approval letter's signature), one name per company (label's
  "Manufactured for: …" name, merged with `sameCompany()` in
  `src/lib/company.ts`). Both facts are read by `scripts/ingest/labelFacts.ts`.
  The `Refresh all drugs` workflow re-runs ingestion for every drug.
- **Adding drugs:** the `Add new drugs` workflow (`.github/workflows/add-drugs.yml`,
  `scripts/ingest/novel.ts`) asks openFDA for first approvals of new medicines
  since a date: NDAs classed Type 1, and BLAs that aren't biosimilars. It
  skips drugs already on the site, then runs `ingest.yml` per drug onto
  `ingest/<slug>`. Copy `data/drugs/<slug>.json` and `data/reference/<slug>.json`
  from those branches into one data PR.
- **Held back** (no label in openFDA yet): zilurgisertib, iberdomide,
  daraxonrasib, pivekimab-sunirine. Re-run them once FDA publishes their labels.
- **Known gaps, shown as blanks, not guessed:**
  - FDA drug class is missing for new drugs (openFDA adds it weeks later).
  - Hibsago's trials aren't matched to its approval.
  - Cypsedo, Ambelvist, Bysanti and Yartemlea have no pivotal trial matched.
  - Tauklarify has no registry trials.
  - Keytruda has 10 of 48 pivotal trials matched to a specific approval:
    FDA hasn't published reviews for most of its supplements.
- **Trial-to-approval matching** (`scripts/ingest/approvals.ts`) works in
  three ways: the letter names the trial; the FDA review is plainly about
  it; or the indication has a single approval.

## Agreed next steps, in order
1. **Verification catch-up** (done in code; let the nightly runs work
   through it). Don't add more drugs until most are checked.
2. **Gaps from the home-screen work:** no review office for Mimrylo
   (letter signed above office level), Veppanu and Tauklarify (no signature
   text); no label company for 7 drugs (label names only a manufacturer or
   partner, or a name without "Inc"/"LLC"). Shown as such, not guessed.
3. **Drug pages** (done): `#/drug/<slug>` lists every approved use and
   "About this drug": FDA drug class (openFDA, else the label's Highlights
   statement) and label sections 12.1–12.3 as the PDF text reads
   (`scripts/ingest/pharmacology.ts`). Gap: Awiqli's label text is redacted.
4. **Disease pages** (done): `#/diseases` and `#/disease/<MeSH id>`. An
   approved use's disease is a MeSH term on one of its pivotal trials'
   ClinicalTrials.gov records that the FDA wording names
   (`scripts/ingest/diseases.ts`); definition and therapeutic areas (MeSH's
   top-level disease categories) come from NLM's MeSH service. The home
   screen groups and filters by therapeutic area. Next: Excel/PowerPoint
   export of a disease timeline; plain-language summaries from MedlinePlus.

## Agents and automatic jobs
- **Nightly fact checker** (scheduled task, Sonnet, 00:36 ET): unchecked
  drugs first; a fact unconfirmed 3 nights is "stuck" for the owner.
- **Weekly refresh** (`refresh-all.yml`, Saturdays 21:13 ET, no AI):
  routine changes publish themselves after the full checks; others wait on
  `data/refresh-<date>`.
- **Site check** (`scripts/sitecheck.ts`, no AI): every page in a browser,
  on each pull request and after each deploy.
- **Weekly digest** (scheduled task, Sonnet, Mondays 07:13 Toronto): one
  email to the owner. Needs the Gmail connector added to the task in
  claude.ai (it couldn't be attached from a session).

## How to work (to save the owner's usage)
- Batch: run a whole batch, collect every problem in one report, fix them
  together. Don't fix one drug at a time.
- Don't subscribe to every PR. Use auto-merge where the repo allows it, and
  check CI once.
- Use Sonnet for routine data runs and small fixes; keep design work for
  the stronger model.
- When a conversation gets long, update this note and start a new session.

## Product direction (owner, 29 Oct 2026)
- **A free resource for scientists and students to learn from.** Not a paid
  product for now: no accounts, no paywall. Favour clear explanations,
  sources a reader can follow, and pages that teach (how a drug works, which
  trials led to which approval) over sales or business features.
- Licences still matter for what we copy in: quote public-domain sources
  (FDA, MedlinePlus, MeSH) and only *link* to StatPearls (its licence bars
  derivatives).

## Open questions for the owner
- The ~110 old branches on GitHub: optional cleanup. This session can't
  delete them, and the owner can do it on the branches page.
