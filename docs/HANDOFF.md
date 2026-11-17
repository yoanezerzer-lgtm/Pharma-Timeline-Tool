# Handoff: where things stand (17 Nov 2026)

Read `CLAUDE.md` first: it holds the owner's standing rules. `docs/PRD.md`
holds the mission, the users and the goals (4 Nov). This note is the
current state and the next steps. Update it when they change, and start a
new session when a conversation gets long.

## This week (17 Nov): less text on every page
Owner, 17 Nov: the biggest problem now, after adding drugs, is that the
pages are **too dense**. Most of the information has to stay, but it should
not all be on screen at once. This week is design and shorter copy.
- Rule for these chats: keep the facts, cut the words. Show the answer
  first and put the detail one click away (show more, (i) icons, tabs,
  the side panel). Fewer headings, shorter labels, no sentence that
  repeats a table. The FDA's own wording stays word for word where it is
  shown; only the site's own copy gets shorter (`src/lib/copy.ts`).
- One page per chat, in order of traffic: home, drug, approved use,
  disease, trial, Compare. Check each at desktop width and at 375px.
- Domain and Cloudflare: the owner decides by the end of this week.

### State on 17 Nov
- Pull requests: none open. #164 (Dupixent SINUS-24/52 readout dates) was
  merged by mistake and undone the same day; #161 (Cibinqo JADE TEEN,
  MONO-2) closed. Both quotes failed the readout rule (the quote must
  state the primary result: #164 only described the endpoints, #161 was
  the page title). The links stay in `data/readouts/candidates/`.
  #102 and #107 closed as stale (their links are already on main).
- **Readout reader**: it saves quotes that do not state a result, so the
  nightly agent keeps holding them. Fix in a data chat: make the reader
  pick a sentence with a result in it, or record no readout.
- **Nightly fact checker**: runs every night, but no
  `nightly/<date>-confirmations` branch since 11 Nov, only readouts.
  Find out why in a data chat (read the latest overnight summary first).
- **Weekly refresh of 15 Nov** waits on `data/refresh-2026-11-15`
  (22 drugs, includes the 8 Nov dating rules). Review it before Saturday's.
- **FDA review time and approval markers** (`claude/precedent-markers-citations`,
  10 Nov) still have no pull request. Bring up to date with main and merge
  once the design chats have made room for them.

## Product direction
- Professionals first (consultants, business-development and regulatory
  analysts building precedent tables), students second. One disease area
  made complete before any other; first area: **atopic dermatitis,
  moderate to severe** (owner, 4 Nov; `docs/PRD.md` §2, §9).
- **Paid site, published on Google** (owner, 7 Nov). Agreed default: home,
  drug pages and "What it's for" stay free so Google can read them;
  downloads, Compare and full trial detail go behind the paywall. Payments
  need accounts and a host other than GitHub Pages: Cloudflare Pages
  recommended. Don't build anything that rules accounts out.
- Only quote public-domain sources (FDA, ClinicalTrials.gov, MeSH,
  MedlinePlus, NCI). Only *link* to StatPearls and company news.
- **Desktop first**; phones must work (no sideways scroll). Light theme by
  default (dark values kept for later). Look: "Ledger" (IBM Plex, deep
  teal, square corners, striped tables; mock-up
  https://claude.ai/artifact/6p1ctoK8mBFTXsWQSDoWVm). Name "Drug
  Development Timelines" stays for now.

## The site (https://yoanezerzer-lgtm.github.io/Pharma-Timeline-Tool/)
- **58 drugs**: the 6 originals, 46 from FDA's new-medicine list, and 6
  atopic dermatitis drugs (Dupixent, Adbry, Cibinqo, Ebglyss, Nemluvio,
  Protopic). Check status: 33 checked, 8 partly, 17 not yet (`npm run -s
  status`).
- **Layout** (#130, 8 Nov): on wide screens a side panel with search,
  sections, and therapeutic areas with counts; the open page's area lists
  its drugs or diseases. Narrower screens keep the top bar. Footer links to
  **About the data** (`/about/`).
- **Home** (#137, 9 Nov): what the site answers, search, atopic
  dermatitis featured (timeline and its latest first approvals), one
  example of each page type (disease, drug, approved use, trial), recent
  FDA approvals, where facts come from. A disabled "Log in" sits top
  right ("Accounts open soon") as the place for accounts.
- **Drugs page** (`/drugs/`): the old home list (search, area menu, list
  by area). Old `/?area=` and `/?q=` links move there. Areas are the
  owner's (`data/areas/areas.json`): change only with the owner.
- **Trial view**: a trial clicked on a chart opens in the side panel; a
  trial address opened any other way (shared, table, Google) shows a full
  page at the same address. Pivotal trials' pages are in the sitemap.
- **Drug page** (#168, 17 Nov): name (generic) and application number;
  "Approved for" (disease tags; the patient leaflet is no longer shown, owner's
  call) beside key facts (company, class, first approval, approvals);
  "Approvals" as a timeline (hover a marker for disease, area, date, pivotal
  trials) and a list with pivotal-trial counts; "How it works" (label
  12.1–12.3, shown by title only); Company news; Sources. Company logos
  not added (owner considering; see #168).
- **Approved-use page**: trials timeline with a Today line. The trial
  panel has a **source trail** (#130): approval letter → document naming
  the trial → ClinicalTrials.gov record, each linked.
- **Disease page**: approvals over time, now with each use's pivotal
  trials as bars on a shared scale so drugs line up as **lanes** (#130);
  then plain summary, what each approval covers, MeSH definition; Excel
  and PowerPoint downloads.
- Every page has its own address, title and description; the build writes
  `sitemap.xml`, `robots.txt`, `404.html`. Set `SITE_ORIGIN` when the site
  moves to its own domain.

## Where facts come from (read by code, never written by an AI)
- Company: label's "Manufactured for" when it is the applicant
  (`src/lib/company.ts`). Review office: newest approval letter.
- Disease of a use: a MeSH term on a pivotal trial's ClinicalTrials.gov
  record that the FDA wording names (`scripts/ingest/diseases.ts`). Failing
  that (#139), one of MeSH's own names for a disease (heading or entry term,
  e.g. "Hodgkin Lymphoma" → Hodgkin Disease) found in the FDA wording, kept
  only if the pivotal trials carry that term too, or carry no terms at all
  (Protopic). Looked up with one MeSH SPARQL query per use.
- Full wording of a use (#139): the newest label's section 1 sentence for
  it, when the name is only a heading; one sentence per subsection only
  (Keytruda's multi-use subsections keep their heading). A first approval
  whose letter doesn't restate the use takes the wording of the label
  approved with it (Dupixent 2017).
- Sibling applications (#139): a second BLA/NDA for the same brand that the
  letters name (Nemluvio's BLA 761391) dates a use its own first label
  lists and the main application's first label lacks.
  Therapeutic areas are MeSH top-level categories.
- Plain summary: MedlinePlus, MedlinePlus Genetics, or NCI, matched only
  by page *title* (`plainSources.ts`).
- Approval dating (#129, 8 Nov): a use the original label lacks is no
  longer dated to the original approval; the letter that first lists a use
  reads "Approved", not "Widened"; "provides for the treatment of" counts
  as widened only when it names a wider group; old one-sentence labels
  give their indication.
- Company news: links only (headline, date, publisher), allowed sites only
  (PR Newswire, Business Wire, GlobeNewswire, Fierce, company site);
  `npm run validate` enforces it. Rules in `src/lib/news.ts`, job in
  `scripts/news/`, raw reads on `diag/news`.
- Raw source text for any drug: `diag/raw-text-<slug>` branches.

## Known gaps (shown as blanks, not guessed)
`npm run -s status` lists them all. Main ones:
- 14 drugs have an approved use with no disease matched (was 22 before
  the MeSH-names step, #139): uses with no pivotal trial and no disease
  name MeSH knows (imaging agents, "reduce drug-resistant bacteria"), or
  trials whose MeSH terms disagree with the wording (4 Keytruda uses).
- 18 facts **stuck** (unconfirmed 3 nights; need a person), listed by
  status. Includes Adquey's 3 trials (mild-to-moderate atopic dermatitis).
- Missing label company for 8, drug class for 4, review office for 3.
- Held back (no label in openFDA yet): zilurgisertib, iberdomide,
  daraxonrasib, pivekimab-sunirine.
- News: companies whose web name differs (GSK, Janssen) get no
  company-site links.

### Atopic dermatitis area (plan step 4): open gaps
Data step done 9 Nov (#139): Nemluvio's use dated 13 Dec 2024 (BLA
761391), Protopic on the disease page, full FDA wording for Dupixent and
Nemluvio. Still open:
- **Protopic**: no company, class or 12.1–12.3 (old label); no pivotal
  trials (pre-registry).
- **Dupixent** prurigo nodularis has no disease (its trials are filed
  under "Neurodermatitis", which the wording doesn't name).
- Keytruda: 4 of 8 uses now matched (mesothelioma, Hodgkin, gastric,
  cervical); PMBCL, urothelial, biliary tract and TMB-H stay blank because
  their trials' MeSH terms don't agree with the wording.
- Dupixent's checks (8–9 Nov): AD trials confirmed; 12 other-use trials
  (asthma, COPD, CRSwNP, CSU, prurigo, AFRS) were rejected for want of a
  second source and are retrying; SINUS-52 and DRI12544 confirmed 9 Nov.
- Left out on purpose as mild-to-moderate or not specific: Opzelura,
  Eucrisa, Zoryve, Elidel, Zonalon, corticosteroids.
- Nightly checks #131 and #132 reported **no disagreements**. (The
  SELECT-PsA 1 "contradicted" flag mentioned in the 9 Nov brief is not in
  either report or in `data/reference/`; Rinvoq's PsA-I trial is confirmed.)

## Agents and automatic jobs
- **Nightly fact checker** (scheduled task, 00:36 New York, Sonnet,
  `docs/agents/nightly-verify.md`): unchecked drugs first; opens and
  merges a `nightly/<date>-confirmations` PR. Move to weekly once fewer
  than 5 drugs are unchecked (17 now).
- **Weekly refresh** (`refresh-all.yml`, Saturdays, no AI): re-reads every
  drug; routine changes publish themselves, others wait on
  `data/refresh-<date>`. The next one re-reads all drugs with the 8 Nov
  dating rules (some "Widened" become "Approved", e.g. Keytruda): review it.
- **News links** (`news.yml`, Sundays, no AI, 40-minute budget).
- **Site check** (`scripts/sitecheck.ts`): every page in a browser on each
  PR and deploy. **Weekly status** issue every Monday (GitHub emails owner).

## How to work: token and process rules (audit, 3 Nov 2026)
Every message re-reads the whole chat, so long chats get expensive; so does
waiting on CI in a chat and re-running all drugs to test a guess.
1. **One chat per piece of work**; a fresh chat past ~30 turns. End each
   chat by updating this note. The next chat reads `CLAUDE.md` and this note.
2. **Don't wait inside a chat.** Push, open the PR, turn on auto-merge. No
   sleeps or polling.
3. **Batch.** One PR per step (code, tests, docs together).
4. **Look before parsing.** Capture a real response on
   `diag/raw-text-<slug>` before writing a parser for an outside service.
5. **Try a few, then all.** `Refresh all drugs` with `only` = 2–5 drugs and
   `publish: false` first.
6. **Cheap model for routine work** (nightly checker, data runs, small
   fixes); the stronger one for design.
7. **Read less.** `npm run -s status`, `git log --oneline`, `grep`/`sed -n`.
   No whole big files or drug records; no screenshots of unchanged pages.
8. **No AI where code will do.**

## Owner decisions on record
- 10 Nov: a drug's uses can sit in different therapeutic areas; asthma,
  COPD, nasal polyps and allergic fungal sinusitis are Respirology,
  eosinophilic esophagitis Gastroenterology, chronic urticaria and
  bullous pemphigoid Dermatology (filed by disease in
  `data/areas/areas.json`; a disease's own filing wins over its drugs').
- 3 Nov: short use names may be cut automatically from FDA wording;
  atopic dermatitis under Immunology (done); auto-merge on.
- 4 Nov: PRD agreed; a free, cookie-free visitor counter is wanted.
- 9 Nov: no "checked / not yet checked" wording next to medical content:
  how facts are checked lives on the About the data page only (done).
- 7 Nov: paywall and hosting as above; news is link-only, no paywalled
  sites (not STAT); explanations go behind (i) icons; Pasatru and Zycubo
  under Rare diseases by hand until the orphan-status rule exists.
- Not possible: FDA Drug Trials Snapshots (fda.gov blocks bots).

## Done (one line each)
- 7 Nov: page wording (#116), design and layout (#117), About page,
  Ledger look (#125), company news (#126, #128), real page addresses and
  sitemap, PDF split words fixed (#109, #111), Dupixent, Adbry, Cibinqo,
  Ebglyss (#127).
- 8 Nov: dating rules, Nemluvio and Protopic, Dupixent's full history
  (#129); side panel, disease lanes, source trail (#130); nightly checks
  (#131).
- 9 Nov: nightly checks (#132); handoff (#133); design rounds: every
  widening on the approved-use page (#134), precedent table, labelled
  lanes, new titles (#135), checking wording moved to About the data (#136);
  atopic dermatitis data: sibling applications, MeSH entry terms, full FDA
  wording (#139).
- Owner plan steps 1 (copy), 2 (design), 3 (news) and 5 (look) done;
  step 4 (new drugs, atopic dermatitis) has the gaps above.

- 10 Nov (branch `claude/precedent-markers-citations`, no PR yet): from a
  review of Drybench and Rhizome, on disease pages: **FDA review time**
  (median with the five-product rule, % accelerated, % expedited; per
  product NDA/BLA, priority, orphan, received and approved dates; job
  `npm run precedent` writes `data/precedent/`), **approval markers** above
  the timeline (merged circles, legend, "Data table"), **citation chips**
  with a right-hand source panel. Gaps: breakthrough and fast track are not
  in openFDA; receipt dates come only from letters the repo has text for
  (214 of 264 read), so products found by label search have none until the
  job runs where FDA documents download (GitHub Actions).

## 10 Nov data session
- **Stuck facts 26 → 18.** The checker took a registry record as the
  second source only when the trial's sponsor is the applicant; Dupixent's
  trials are Sanofi's, the application Regeneron's. Now a sponsor the
  drug's own label names ("Marketed by", "Distributed by", "Manufactured
  for"; not "Manufactured by") counts too. Dupixent's 8 re-checked and
  confirmed (`npm run verify -- queue --retry-stuck --drugs <slug>`).
  Left with a person: Adquey (Otsuka trials, no FDA document names Otsuka),
  Lynavoy (record cites no label), Phase 1 and 1/2 trials.
- **All-severity atopic dermatitis**: Eucrisa, Opzelura, Zoryve and Elidel
  ingested to `ingest/crisaborole`, `ingest/ruxolitinib`,
  `ingest/roflumilast`, `ingest/pimecrolimus` (Actions can't open PRs:
  repo setting). Opzelura listed "Limitations of Use" as a use: fixed in
  the section 1 reader (only Opzelura among 259 labels); re-run its ingest.
  Gaps: Eucrisa has no trials (code names not searched), Elidel (2001) no
  approval history, no label company for either.
- **New sources asked for (owner, 10 Nov)**: breakthrough therapy and
  fast track approval lists, orphan designations (OOPD), Orange Book.
  `designations-probe.yml` saves what each returns to `diag/designations`;
  write readers against that, then add them to `npm run precedent`.

## Next steps (in order, one chat each)
1. **Design: less text** (this week, several chats; see the top section).
2. **Data, one chat**: review the 15 Nov refresh; find why the nightly
   confirmations stopped; fix the readout reader's quotes.
3. **Precedent table** (PRD goal 3): merge the FDA review time work, then
   the table an analyst can build in ten minutes.
4. **Get ready to publish** (after the owner's domain and Cloudflare
   decision): cookie-free visitor counter, Cloudflare Pages, Search
   Console, then the paywall.
5. More drugs and areas once atopic dermatitis is complete.
- Later: readers for breakthrough, fast track, orphan and Orange Book
  (`diag/designations`); "Rare diseases" from orphan status; move
  workflow actions off Node 20.

## Design review (9 Nov)
Done: disease page "Every approval" table (one row per FDA letter: date,
drug, company, the FDA's words, pivotal trials, months after trials;
sortable; first approvals only; Excel has the same columns), labelled
trial lanes with approval guides; approved-use page titled by the use,
shows every widening, ends with a four-step "how this approval is backed
up" chain; trial panel's source cards replaced by a plain "Where this
comes from" list; letter paperwork and PDF page numbers cut from FDA text;
titles and subtitles rewritten. Later widenings show "Not yet matched" for
trials: the records don't say which trial each later letter rests on.

Still open, in order:
- Homepage makeover, trial panel and page, duplicate trial names (NCT
  number beside a shared name): done (#137). Log-in and paywall wait for
  Cloudflare; the homepage's "Log in" button is the place for them. On
  phones the disease timeline shows names and dates only (bars hidden),
  as on the disease page.
- Drug page order and empty Company news: done (#138). 10 Nov: Clinical
  pharmacology was indented and followed by a large gap because it shared
  the About page's `.about` class; renamed `.pharm`.

## Flow review (9 Nov, #138)
Owner walked the pages: too much on screen, some wrong words. Done:
- Industry terms for approval types: Original approval (ORIG), New
  indication (new use on a supplement), Label expansion (was "Widened"),
  Indication revised (was "Wording changed"). One place: `src/lib/copy.ts`.
- Drug page: the leaflet's description is the page's opening lines with a
  light "(source)" link, no heading, first 3 lines then "Show all";
  approved uses table has column headings; "How it works" is now
  "Clinical pharmacology" at full width; drug class shown with a capital
  and no source link; empty Company news is hidden; "Sources" (no "checks").
- Leaflet text was cut at 900 characters (Dupixent showed 2 of 9 uses).
  Now kept whole when the next leaflet heading marks its end; scored on all
  63 saved labels: only Dupixent changes. **Needs a data refresh of
  dupilumab** to show on the site.
- Approved-use page: one header (facts row only), trials split into
  "before the first approval / after", the repeated list of all uses
  removed, approval history shows type and the FDA letter's words for each
  change, each date linking to its letter.
- Disease page: uses split by severity read from FDA wording
  (moderate-to-severe / mild-to-moderate / not stated), shown one group at
  a time, never mixed (owner, 9 Nov: they can't be compared). Home shows
  the largest group. Generic: any disease whose approvals name two
  severities.
- Compare: opens on Ebglyss vs Adbry (atopic dermatitis); press releases
  linked by headline, never quoted; endpoints show up to 5 lines.

- Trial page and panel (#140): at a glance first (enrolled, design, age,
  primary completion) and a line saying whether primary completion came
  before or after the use's first approval; then primary endpoint with
  posted results (% shown for percentage units); then Dates | Design and
  Sources | Identifiers side by side on the full page. "Not written yet"
  note removed. Dupixent refreshed after #138 for its full leaflet text.

- Compare (#141): a use approved in steps (Dupixent, Adbry) now shows
  as a whole ("All N approvals of this use"): every trial the label cites,
  first approval filled, later ones hollow, and no month count (the records
  don't say which letter each trial backs). Picker and headers show the
  FDA wording cut at a word (full text on hover); the picker blocks a pair
  of different named severities, and a pair forced by URL gets a warning
  and no evidence table. Evidence table: Drug, Trial (NCT linked), N,
  primary endpoint, results by arm plus the registry's effect estimate
  (e.g. risk difference with CI); "FDA wording" column removed; long units
  ("Participants") shown once. Readouts section only when one is found,
  else one line. Sources as light "(source ↗)" links.
  Owner follow-up (9 Nov): picker rows are "Drug · therapeutic area" with
  the FDA wording small below (area left blank when a drug spans several
  and the use's disease isn't filed); pane header is drug + area, wording
  small; the month count is a small fact in the header line, not a big
  number; approvals are vertical lines through the chart (later ones
  dashed), no dashed gap lines; both charts start at the same height.
- A label name the registry gives to another trial is not shown (Ebglyss
  ADvocate 1 had been labelled "ADhere"); its NCT number shows instead.
  Label-name pairing fixed (#144, re-ingested #145): NCT04146363 is
  ADvocate 1; no label name in the data matches another trial's own name
  (checked 10 Nov across all drugs).

- Drugs and Diseases lists (10 Nov): each is one full-width table you can
  sort, with search, an area filter and a count (shared `ListTable`).
  Drugs: drug (brand, INN), company, area, approved for (disease names,
  oldest first), first FDA approval. Diseases: one row per disease (was
  grouped by MeSH category, so diseases repeated up to 4 times), with
  the site's own areas, approved drugs, first and latest approval. On
  phones the rows stack into cards.

- About the data (10 Nov): full width, two columns. Sources as a table
  (what the site takes from each), a Definitions table for every term
  the site uses (pivotal, supportive, primary completion, months to
  approval, approval types, FDA review time, severity, results
  announced), then how facts are checked and gaps. Fixed: it said
  therapeutic areas come from MeSH; they are the editor's, by disease.

Still open from the review:
- Atopic dermatitis is to cover all severities (owner, 9 Nov): add
  Eucrisa, Opzelura, Zoryve, Elidel through the add-drugs pipeline; match
  Protopic. (Nemluvio reads moderate-to-severe since #139.)
- Compare: count results ("95 Participants") can't show a % without
  each arm's size; store arm sizes from ClinicalTrials.gov in a data chat.
- Disease timeline (10 Nov): a pivotal trial whose primary completion
  is after the use's first approval is drawn hollow, with a legend line
  (dates only; the records don't say which later letter it backs).
- Site check (10 Nov) also opens one page of each kind and every disease
  page at 375px and fails on sideways scrolling.
- Dupixent's leaflet text still stops after 2 of its uses: re-ingest run
  10 Nov; check its `ingest/dupilumab` branch.

## Open owner questions
- Show a public "last updated" date on the site?
- Domain name and Cloudflare account (owner: by the end of the week of 16 Nov); Google Search Console; pricing.
- 18 stuck facts need a person to look (list in `npm run -s status`).
- Optional: delete ~110 old branches (keep `diag/raw-text-*`, `claude/prd`,
  unmerged `data/*`).
