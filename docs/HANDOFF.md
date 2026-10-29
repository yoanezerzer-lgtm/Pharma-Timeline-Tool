# Handoff: where things stand (29 Oct 2026)

Read `CLAUDE.md` first: it holds the owner's standing rules. This note is
the current state and the agreed next steps. Update it when they change.

## Where things stand
- **52 drugs** on the site (https://yoanezerzer-lgtm.github.io/Pharma-Timeline-Tool/).
  The 6 original ones (Rinvoq, Skyrizi, Keytruda, Lexapro, Foundayo,
  rusfertide) plus 46 added from FDA's own list of new-medicine approvals.
- **46 of the 52 are unverified.** The overnight checker
  (`docs/agents/nightly-verify.md`, Sonnet, ~00:36 ET) hasn't caught up.
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
1. **Verification catch-up.** Make the nightly checker take unverified drugs
   first. Show a clear "not yet checked" state until a drug is verified.
   Don't add more drugs until this is moving.
2. **Home screen.** Too busy at 52 drugs. Make a compact, searchable list the
   default: brand, generic, one short disease name, approval year. Group by
   disease area and keep the full FDA wording on the drug page. Short names
   come from the label's own headings ("1.1 Rheumatoid Arthritis") where
   they exist. Never AI-written.
3. **Company names.** Merge duplicates: ABBVIE / AbbVie Inc., MSD / Merck
   Sharp & Dohme. `sameCompany()` in `scripts/ingest/roles.ts` already
   decides when two names are the same company. Display the name printed on
   the label ("Manufactured for: …").
4. **Drug pages** with an "About this drug" section: the label's sections
   12.1–12.3 verbatim, plus FDA's Established Pharmacologic Class.
5. **Disease pages:** every approval for one disease across drugs, on one
   timeline, with Excel/PowerPoint export later. For a short description,
   quote MedlinePlus or MeSH (public domain) with the source. Only *link* to
   StatPearls: its CC BY-NC-ND licence bars commercial reuse.

## How to work (to save the owner's usage)
- Batch: run a whole batch, collect every problem in one report, fix them
  together. Don't fix one drug at a time.
- Don't subscribe to every PR. Use auto-merge where the repo allows it, and
  check CI once.
- Use Sonnet for routine data runs and small fixes; keep design work for
  the stronger model.
- When a conversation gets long, update this note and start a new session.

## Open questions for the owner (product direction)
- Who is the first paying user, and when does this move from a GitHub site
  to a real app with accounts?
- The ~110 old branches on GitHub: optional cleanup. This session can't
  delete them, and the owner can do it on the branches page.
