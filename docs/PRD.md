# Product requirements: Drug Development Timelines

**Status:** agreed with the owner, 4 Nov 2026; revised the same day after
an outside review: professionals first, one disease area at a time
(owner). Every session and every
Treadle agent reads this before planning. Change it only with the owner.
`CLAUDE.md` holds the working rules; `docs/HANDOFF.md` holds the current
state.

## 1. Mission

> For one disease area at a time, show every FDA approval in it: what it
> covers, the trials behind it, and how long it took, with every fact
> traceable to the FDA's own documents. Free, for people who research drug
> approvals for work, and for anyone learning about them.

What sets it apart: it's free (the industry databases cost a lot), it's
sourced word for word, so any fact can go in a client slide with its
footnote, and within an area it's complete: a precedent list with a drug
missing is wrong, so an area isn't shown as complete until it is.

## 2. Who it is for

**Professionals come first** (owner, 4 Nov, after an outside review): the
consultants, business-development and regulatory analysts who build
"what's the precedent?" tables by hand from FDA documents or pay for an
industry database. When a choice has to be made, pick what helps them.
Not first: investment-fund associates tracking upcoming FDA decisions
(drugs not yet approved are out of scope).

| User | Arrives with | Leaves with |
|---|---|---|
| Consultant or analyst (first) | "What's the precedent in Y? Which trials, what results, how long?" | Every approval in Y in one table, a source per fact, Excel and a slide |
| Student (second) | "I have to present drug X." | What it treats, the pivotal trials, what they showed, sources to cite |
| Scientist, teacher, journalist | "What's been approved for disease Y, and when?" | One timeline across drugs |

The same pages serve all of them: the top of each page is plain enough for a
newcomer; detail sits lower down or behind a click.

Why the change: the site's drugs are mostly recent approvals, which is
what professionals ask about and not what most students study; and the
owner does this work, so can judge the site from the inside.

## 3. The questions the site must answer

1. **What is approved for this disease, and since when?** All of it, for
   a complete area. (disease page)
2. **How did each get approved?** Which trials, what they showed, which
   regulatory path. (disease and approval pages)
3. **How long did it take?** From the main trials' completion to approval.
   (disease and approval pages)
4. **Where does each fact come from?** A source on every fact, kept in the
   downloads. (every page)
5. **What is this drug for?** (drug page)
6. **How do drugs get approved at all?** (explainer, later)

Anything that doesn't help answer one of these is left out or moved down.

## 4. Pages

Each page answers one question. The first screen must answer it on its own.

### Home
- **Answers:** "Where do I start?"
- **Shows:** title, one line on what the site is, the complete area(s)
  first, each with what it covers in one line, then one search box, one area
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

### Disease page (the main page)
- **Answers:** "What is approved for this disease, and since when?"
- **First screen:** everyday name; first and latest approval; **what the
  list covers**: "every FDA approval for [scope], checked on [date]" for a
  complete area, "drugs on this site" otherwise, so it never reads as
  complete when it isn't; one timeline row per approved use.
- **Then:** the precedent table, one row per approval: drug, the use in the
  FDA's words, approval date, main trials, what they showed (label section
  14), time from trial completion to approval, regulatory path; a source on
  every fact.
- **Lower down:** short plain explanation and medical definition (MeSH);
  downloads (Excel, PowerPoint) that keep the sources.

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
- Drugs not yet approved (pipeline, upcoming FDA decision dates).
- Accounts and sign-up for now; nothing built may rule them out later
  (owner, 3 Nov).

## 8. Risks we plan around

1. **Looks complete when it isn't.** For a professional, a precedent list
   missing a drug is wrong. An area is called complete only when checked
   against the FDA's own records; every other list states its coverage
   (goals 2 and 4).
2. **No idea who uses it.** A free, cookie-free visitor counter, page
   counts only, comes first (goal 1; owner agreed 4 Nov).
3. **Can't be found.** People start from Google, which barely indexes
   `#/…` page addresses (goals 1 and 7).
4. **A wrong fact.** Every fact is checked, and readers can report a
   mistake (goal 4).
5. **Paid databases do more.** We don't compete on breadth. We win on free,
   a source on every fact, and complete within our areas.
6. **Going stale.** The weekly refresh keeps labels current; the weekly
   status issue shows if it stops. A complete area must also pick up new
   approvals in it.
7. **Breadth costs checking.** One area at a time; the next area only once
   the current one is complete and checked (goal 8).
8. **One person.** The owner's job is approving, from one short list a week.

## 9. Goals, in order

These are the goals on the Treadle board. Each is an outcome for a user, not
a piece of work. Goals 1, 2 and 3 are active, with the standing goal below;
the rest wait.

1. **We can see whether anyone comes.** Real page addresses, a title and
   description per page, a site map, the free visitor counter. *Done when*
   the counter shows which pages people open.
2. **One area is complete.** Every FDA approval in one area, older drugs
   included, each checked, with the area's scope written in one line.
   Proposed first area: atopic dermatitis, moderate to severe (about six
   medicines, all approved since 2017, with trials on ClinicalTrials.gov;
   owner to confirm). *Done when* the list matches the FDA's own records for
   that scope and a professional in the field finds nothing missing.
3. **A professional builds a precedent table in ten minutes.** The disease
   page's precedent table and downloads (Excel, PowerPoint) with a source on
   every fact. *Done when* the ten-minute test (below) passes for three
   people who do this work and haven't seen the site.
4. **Every fact can be trusted, and nothing looks more complete than it
   is.** Checking catch-up finished, stuck facts settled, a "report a
   mistake" link, a "not medical advice" line; outside complete areas, every
   list says what it covers; uses linked to diseases (MeSH's own synonyms);
   areas right (atopic dermatitis under immunology, Rare diseases, "Being
   sorted" empty). *Done when* every drug shows "Checked", a reported mistake
   reaches the owner's list, and no page reads as "all the approved drugs"
   unless it's true.
5. **The regulatory path of every approval.** Accelerated approval,
   priority review, breakthrough therapy, orphan status and later label
   changes, from FDA documents the pipeline can read; gaps shown, not
   guessed.
6. **A newcomer understands an approval in two minutes.** For students
   and new analysts: one design, short copy, short names for uses. *Done
   when* the two-minute test (below) passes on a phone and a laptop for
   three people who haven't seen the site.
7. **It is found from Google.** *Done when* disease and drug pages show up
   in Google for their names.
8. **The next area.** Picked by the owner once goal 2's area is complete;
   one area at a time, each checked. Atopic dermatitis's neighbours
   (psoriasis, then inflammatory bowel disease) share drugs already on the
   site.

Standing goal, all along: **the owner only approves.** Auto-merge on,
finished Treadle branches shipped by one message, one short owner list a
week.

Later: a short explainer on how drugs get approved (phases, pivotal
trials, accelerated approval, in FDA wording, approved by the owner);
mechanism diagrams per drug class; Compare.

## 10. The tests

### The ten-minute test (goal 3)

Someone who does precedent research for work, and hasn't seen the site,
opens the complete area and within ten minutes, without outside help,
produces a table of every approval in it: the use in the FDA's words, the
approval date, the main trials and what they showed, the time to approval,
and a source for each. Then they say whether anything is missing and
whether they would use it at work instead of what they use now. Their
answers go on the owner's list.

### The two-minute test (goal 6)

Someone new to a drug opens its page and, within two minutes and without
outside help, says what it treats, which trials got it approved and what
those trials showed.

Checked by walking three journeys in a browser, on a laptop and a phone,
before each release:
1. Home → search a drug → drug page → an approved use → its trials.
2. Home → an area → a disease → its approvals.
3. A disease page → a drug → back.
