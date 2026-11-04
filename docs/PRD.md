# Product requirements: Drug Development Timelines

**Status:** agreed with the owner, 4 Nov 2026. Every session and every
Treadle agent reads this before planning. Change it only with the owner.
`CLAUDE.md` holds the working rules; `docs/HANDOFF.md` holds the current
state.

## 1. Mission

> For any FDA-approved medicine, show what it treats and the evidence that
> got it approved, with every fact traceable to the FDA's own documents.
> Free, for anyone learning about drugs.

What sets it apart: it's free (the industry databases cost a lot), it's
sourced word for word (most drug-info sites aren't), and it tells the story
of an *approval*, not dosing.

## 2. Who it is for

**Students come first** (owner, 4 Nov). When a choice has to be made, pick
what helps a pharmacy, medical or life-sciences student.

| User | Arrives with | Leaves with |
|---|---|---|
| Student (first) | "What is X and why was it approved?" | What it treats, how it works, the key trial |
| Scientist, teacher, journalist | "What's been approved for disease Y, and when?" | One timeline across drugs |
| Analyst or consultant (later) | "What's the precedent in Y? How long did it take?" | Trials, timelines, a slide |

The same pages serve all of them: the top of each page is plain enough for a
student; detail sits lower down or behind a click.

## 3. The questions the site must answer

1. **What is this drug for?** (drug page)
2. **How did it get approved?** Which trials, what they showed, when.
   (approval page)
3. **What is approved for this disease?** (disease page)
4. **How long did development take?** (approval and disease pages)
5. **How do drugs get approved at all?** (explainer, goal 5)

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
  paragraph only, link to read more); first and latest approval; **what the
  list covers** ("drugs on this site"), so it never reads as every approved
  drug.
- **Then:** one timeline row per approved use across all drugs; what each
  approval covers in the FDA's words.
- **Lower down:** medical definition (MeSH); downloads (Excel, PowerPoint).

### Compare (later)
- **Answers:** "How do two development programmes compare?"
- Same tiles, type and colours as the rest of the site.

### On every page
- A "report a mistake" link.
- A plain line: this is not medical advice.

## 5. Look and wording

- **One design for the whole site:** one card or tile style, one heading
  style, one spacing scale, one way to show a source link. A new page reuses
  them; it does not invent its own.
- **Short copy:** page titles of a few words; one-sentence descriptions;
  no jargon in headings ("What it's for", not "Indications and usage").
- **Source wording stays exact:** FDA, label and MedlinePlus text is quoted
  as written. Only spacing the PDF adds may be closed up. Short names for
  approved uses may be cut automatically from the FDA's own wording (owner,
  3 Nov). Other plain-language labels are written or approved by the owner.
- **Gaps are shown, not filled:** "Not yet matched", never a guess.
- **Coverage is stated, not implied:** any list says what it covers.

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
- Accounts and sign-up for now; nothing built may rule them out later
  (owner, 3 Nov).

## 8. Risks we plan around

1. **Looks complete when it isn't.** A disease page with two drugs reads as
   "only two drugs are approved". Every list states its coverage (goal 3).
2. **Can't be found.** Students start from Google, which barely indexes
   `#/…` page addresses (goal 4).
3. **No idea who uses it.** A free, cookie-free visitor counter, page
   counts only (goal 4; owner agreed 4 Nov).
4. **A wrong fact.** Every fact is checked, and readers can report a
   mistake (goal 2).
5. **Going stale.** The weekly refresh keeps labels current; the weekly
   status issue shows if it stops.
6. **Breadth costs checking.** No new drugs until goals 1–3 are done; then
   batches, each checked (goal 6).
7. **One person.** The owner's job is approving, from one short list a week
   (goal 7).

## 9. Goals, in order

These are the goals on the Treadle board. Each is an outcome for a user, not
a piece of work. Goals 1, 2, 3 and 7 are active; the rest wait.

1. **A student understands a drug's approval in two minutes.** One design,
   short copy, "what the trials showed" from section 14, short names for
   uses. *Done when* the two-minute test (below) passes on a phone and a
   laptop for three drugs nobody on the project picked.
2. **A student can trust every fact.** Checking catch-up finished, stuck
   facts settled, a "report a mistake" link, a "not medical advice" line.
   *Done when* all 52 drugs show "Checked" and a reported mistake reaches the
   owner's list.
3. **Nothing looks more complete than it is.** Every list says what it
   covers; more uses linked to diseases (MeSH's own synonyms); areas right
   (atopic dermatitis under immunology, Rare diseases, "Being sorted"
   empty). *Done when* no page can be read as "these are all the approved
   drugs" unless it's true.
4. **A student finds it from Google.** Real page addresses, a title and
   description per page, a site map, the visitor counter. *Done when* drug
   pages show up in Google and the counter shows which journeys people take.
5. **It teaches how drugs get approved.** A short explainer (phases,
   pivotal trials, accelerated approval) in FDA wording where it exists,
   approved by the owner; mechanism diagrams per drug class; further reading
   links.
6. **Covers enough drugs to be a student's go-to.** After goals 1–3: a
   scope the owner picks, added in batches, each batch checked.
7. **The owner only approves.** All along: auto-merge on, finished Treadle
   branches shipped by one message, one short owner list a week.
8. **Later: professionals can use it for precedent.** Regulatory milestones
   from FDA letters, Compare, better downloads.

## 10. The two-minute test

Someone new to a drug opens its page and, within two minutes and without
outside help, says what it treats, which trials got it approved and what
those trials showed.

Checked by walking three journeys in a browser, on a laptop and a phone,
before each release:
1. Home → search a drug → drug page → an approved use → its trials.
2. Home → an area → a disease → its approvals.
3. A disease page → a drug → back.
