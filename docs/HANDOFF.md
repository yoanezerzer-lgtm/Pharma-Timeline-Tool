# Handoff: where things stand (9 Nov 2026)

Read `CLAUDE.md` first: it holds the owner's standing rules. `docs/PRD.md`
holds the mission, the users and the goals (4 Nov). This note is the
current state and the next steps. Update it when they change, and start a
new session when a conversation gets long.

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
- **Drug page**: "What it's for" (patient leaflet, word for word), approved
  uses one row each, "How it works" (label 12.1–12.3), Company news links,
  then "Sources and checks" with "Sources last read".
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
  record that the FDA wording names (`scripts/ingest/diseases.ts`).
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
- 22 drugs have an approved use with no disease matched (recent trials
  not yet MeSH-tagged, uses with no pivotal trial, or FDA wording that
  differs from MeSH, e.g. 8 Keytruda uses).
- 18 facts **stuck** (unconfirmed 3 nights; need a person), listed by
  status. Includes Adquey's 3 trials (mild-to-moderate atopic dermatitis).
- Missing label company for 8, drug class for 4, review office for 3.
- Held back (no label in openFDA yet): zilurgisertib, iberdomide,
  daraxonrasib, pivekimab-sunirine.
- News: companies whose web name differs (GSK, Janssen) get no
  company-site links.

### Atopic dermatitis area (plan step 4): open gaps
- **Nemluvio** atopic dermatitis has no date: approved under a sibling
  application, BLA 761391 (13 Dec 2024), merged into BLA 761390's label.
  Needs the pipeline to read a sibling application named in the letter.
- **Protopic** has no disease link (trials too old for MeSH terms), so it
  is missing from the atopic dermatitis disease page. Fixed by the
  FDA-wording-to-MeSH step below. Also no company, class or 12.1–12.3.
- **Dupixent** and Nemluvio use names are the label's short headings, not
  the FDA's full wording; Dupixent has a use with no disease and its
  disease has no MedlinePlus summary.
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
  lanes, new titles (#135), checking wording moved to About the data (#136).
- Owner plan steps 1 (copy), 2 (design), 3 (news) and 5 (look) done;
  step 4 (new drugs, atopic dermatitis) has the gaps above.

## Next steps (in order, one chat each)
The owner wants a strong focus on **design** (9 Nov): every data chat
should leave the pages it touches looking right, and design gets its own
chats.
1. **Design**: two rounds done 9 Nov (#134, #135); homepage makeover and
   the trial page are next (see "Design review" below).
2. **Finish atopic dermatitis data** (step 4): read sibling applications so
   Nemluvio's use gets its date; add the FDA-wording-to-MeSH step (from
   MeSH entry terms, e.g. "Hodgkin Lymphoma" → "Hodgkin Disease") so
   Protopic joins the disease page and Keytruda's 8 uses get diseases;
   use the FDA's full wording for Dupixent and Nemluvio uses.
3. **Get ready to publish**: visitor counter (cookie-free), then Cloudflare
   Pages and domain (owner), Search Console (owner), then the paywall.
4. **Precedent table** (PRD goal 3): a table an analyst can build in ten
   minutes for the area.
- Maintenance, any chat: move workflow actions off deprecated Node 20.
- Later: "Rare diseases" from FDA orphan status; more areas once atopic
  dermatitis is complete.

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
- Drug page: long "What it's for" and "How it works" come before the
  approved uses table. Empty "Company news" for Dupixent looks unfinished.

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

- Trial page and panel (#139): at a glance first (enrolled, design, age,
  primary completion) and a line saying whether primary completion came
  before or after the use's first approval; then primary endpoint with
  posted results (% shown for percentage units); then Dates | Design and
  Sources | Identifiers side by side on the full page. "Not written yet"
  note removed. Dupixent refreshed after #138 for its full leaflet text.

Still open from the review:
- Atopic dermatitis is to cover all severities (owner, 9 Nov): add
  Eucrisa, Opzelura, Zoryve, Elidel through the add-drugs pipeline; match
  Protopic. Nemluvio shows "Severity not stated" until its full FDA
  wording is read (data session).
- Compare can't tie Dupixent's atopic dermatitis trials to one letter
  (its use was approved in steps), so it shows "Not yet matched".
- The Dupixent lane on the disease timeline still draws later trials on
  the first approval's line.

## Open owner questions
- Areas for Dupixent's other uses (asthma, COPD, nasal polyps, etc.).
- Show a public "last updated" date on the site?
- Domain name; Cloudflare account; Google Search Console; pricing.
- 18 stuck facts need a person to look (list in `npm run -s status`).
- Optional: delete ~110 old branches (keep `diag/raw-text-*`, `claude/prd`,
  unmerged `data/*`).
