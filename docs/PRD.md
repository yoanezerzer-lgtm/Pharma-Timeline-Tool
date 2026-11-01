# Product requirements: Drug Development Timelines

**Status:** draft for the owner's edits, 1 Nov 2026. Once agreed, every
session follows this document. Change it only with the owner. `CLAUDE.md`
holds the working rules; `docs/HANDOFF.md` holds the current state.

## 1. What it is

A free website that tells the story of how a medicine got approved by the
FDA: what it is for, which clinical trials led to each approval, what they
showed, and how long it took. Every fact comes from FDA documents,
ClinicalTrials.gov or the National Library of Medicine, read by code and
linked to its source.

## 2. Who it is for

- **Students** (pharmacy, medicine, life sciences): want to understand a drug
  and how drugs get approved.
- **Industry and scientists**: want trial evidence, timelines and how
  approvals compare across drugs and diseases.

Both are served by the same pages. The top of each page is plain enough for
a student; detail sits lower down or behind a click.

## 3. The four questions the site must answer

1. **What is this drug for?** (drug page)
2. **How did it get approved?** Which trials, what they showed, when.
   (approval page)
3. **What is approved for this disease?** (disease page)
4. **How long did development take?** (approval and disease pages)

Anything that doesn't help answer one of these is left out or moved down.

## 4. Pages

Each page answers one question. The first screen must answer it on its own.

### Home
- **Answers:** "Where do I start?"
- **Shows:** title, one line on what the site is, one search box, one area
  menu, the list of drugs grouped by therapeutic area (drug, what it's for in
  a few words, year approved).
- **Does not show:** check badges, admin links, application numbers,
  multiple view styles.

### Drug page
- **Answers:** "What is this drug for, and how does it work?"
- **First screen:** name, drug class, company, first approval; "What it's
  for" (the label's patient leaflet, word for word); the approved uses as
  short names, each linking to its approval page.
- **Lower down:** how it works (label section 12.1 open, 12.2–12.3 behind a
  click); further reading links (company press release, drug website: link
  only); sources and checks.

### Approval page (one approved use)
- **Answers:** "Which trials got this approved, what did they show, and how
  long did it take?"
- **First screen:** the use in the FDA's words; approval date; time from the
  main trials' completion to approval; the trial timeline (main trials
  only by default).
- **Then:** for each main trial, what it showed, in the label's own words
  (section 14: the primary result and the comparison), linked to the label.
- **Lower down:** supporting trials, other approvals of the drug, sources.

### Disease page
- **Answers:** "What is approved for this disease, and since when?"
- **First screen:** everyday name; one short plain explanation (first
  paragraph only, link to read more); first and latest approval.
- **Then:** one timeline row per approved use across all drugs; what each
  approval covers in the FDA's words.
- **Lower down:** medical definition (MeSH); downloads (Excel, PowerPoint).

### Compare (nice to have)
- **Answers:** "How do two development programmes compare?"
- Same tiles, type and colours as the rest of the site.

## 5. Look and wording

- **One design for the whole site:** one card or tile style, one heading
  style, one spacing scale, one way to show a source link. A new page reuses
  them; it does not invent its own.
- **Short copy:** page titles of a few words; one-sentence descriptions;
  no jargon in headings ("What it's for", not "Indications and usage").
- **Source wording stays exact:** FDA, label and MedlinePlus text is quoted
  as written. Only spacing the PDF adds may be closed up. Plain-language
  labels for navigation (area names, section headings) are written or
  approved by the owner.
- **Gaps are shown, not filled:** "Not yet matched", never a guess.

## 6. Sources

| Need | Source | Rule |
|---|---|---|
| Approvals, uses, dates | FDA approval letters, labels, Drugs@FDA | Exact wording |
| What it's for | Label patient leaflet ("What is BRAND?") | Word for word |
| How it works | Label section 12 | Word for word |
| What the trials showed | Label section 14 | Word for word |
| Trials, dates, phases | ClinicalTrials.gov | As registered |
| Disease explanation | MedlinePlus, MedlinePlus Genetics, NCI dictionary | Matched by title only |
| Disease definition, categories | MeSH | As written; capitals and citations tidied |
| Company material | Press releases, drug websites | Link only, never copy |

Not usable: FDA Drug Trials Snapshots (fda.gov blocks automated reading).
StatPearls: link only.

## 7. Out of scope

- Medical advice for patients (dosing, "is this right for me").
- Non-US approvals (EU, Japan).
- Prices, sales and market data.

## 8. First version (what "done" means)

All 52 drugs, with the four core pages (home, drug, approval, disease)
finished to this document. No new drugs are added until then.

**Done when:** someone new to a drug can open its page and, within two
minutes and without outside help, say what it treats, which trials got it
approved and what those trials showed.

**Checked by:** a walk-through of three journeys in a browser, on a laptop
and a phone, before each release:
1. Home → search a drug → drug page → an approved use → its trials.
2. Home → an area → a disease → compare its approvals.
3. A disease page → a drug → back.

## 9. Plan (in order)

1. Agree this document.
2. One design: shared tile, heading and source-link styles; apply to every
   page, including Compare.
3. Short copy pass on every title, heading and description.
4. Approval page: "what the trials showed" from label section 14; main
   trials first.
5. Short names for approved uses (from the FDA's wording; owner approves any
   rewording).
6. "Rare diseases" area from FDA orphan status.
7. Further reading links on drug pages.
8. Walk-through of the three journeys; fix what fails.
9. Then: more drugs; mechanism-of-action diagrams (one per drug class, built
   from label section 12.1, reviewed by the owner).

## 10. Open questions for the owner

- **Accounts:** stay free and open with no sign-up (the 29 Oct direction),
  or keep the door open for accounts later?
- **Short names for uses:** may short names be cut from the FDA's own
  wording automatically ("Breast cancer, HR-positive, HER2-negative,
  advanced"), or should each be approved by you?
- **Genetic diseases area:** keep atopic dermatitis there because MeSH
  files it as inherited, or exclude it?
