# Handoff: where things stand (19 Nov 2026)

The current state and the next steps, nothing else. Rules are in
`CLAUDE.md`; the product, the goals and the owner's decisions are in
`docs/PRD.md`. Update this note at the end of every chat; history belongs
in git and pull requests, not here.

## The order of work (owner, 19 Nov)
Three phases. Monetization and go-to-market wait until a few real
professionals have used the site: the ten-minute test (PRD §10) answers
most of those questions for free.

**Phase 1: make it worth showing (now)**
1. **Accuracy** (PRD goal 4). Done 19 Nov: the readout reader quotes only
   a sentence stating the primary result (#175); the nightly checker
   queues every pivotal trial the site shows (#176: it had run out of
   facts it could see, while 21 pairings had no reference entry); brands
   are cased word by word, lose FDA's "(copackaged)" tag, and trials no
   run returns any more are removed unless curated (#177, tried on 4
   drugs); the clean part of the 15 Nov refresh is published (#178).
   Then (19–20 Nov): Opzelura keeps only its own cream trials and
   word-like acronyms ("PATHWAY", "SEQUENCE") no longer earn review roles
   (#180); Rybrevant Faspro's five uses get the documents' dates and
   ORIGAMI-4 counts for head and neck, not lung cancer (#183): both reach
   the site on Saturday's refresh. Readouts for Dupixent SINUS-24/52 and
   Cibinqo JADE TEEN/MONO-2 are in (#181, #182).
   **Rule changes now show their effect before merging** (19 Nov): a pull
   request touching `scripts/ingest/` gets a "Pipeline rule comparison"
   comment listing, per drug, each use whose approval date changes and each
   trial role gained or lost, from the saved text on `diag/raw-text-*`.
   Locally: `bash scripts/compare-rules/fetch-raw.sh` once, then
   `npm run compare-rules [-- --base <ref> --head <ref> --only a,b]`. Not
   covered yet: the ClinicalTrials.gov search and topical filter (network),
   and `run.ts` wiring. Run on #180 it also shows 47 Keytruda review-only
   roles dropped (investigator studies like PEMBRO-RT, KELLY); check them
   when Keytruda's next refresh is reviewed. Next: QC cross-checks (a pivotal
   trial's disease vs its use, oral trials on topical products, uses dated
   to a label lacking them), then the nightly checker confirming dates.
   Left:
   - **Saturday's refresh (22 Nov) drops many old trials**: since #177 a
     trial no run returns is removed unless it has a pivotal or checked
     role. Expect about 69 on Rinvoq, 50 on Opzelura, 6 on Dupixent,
     waiting on `data/refresh-2026-11-22` as "needs a look". Merge them
     unless a pivotal trial is among them.
   - Cibinqo JADE MONO-1 has no readout: its release names it only as
     B7451012. The overnight agent should look for another release.
   - The first nightly run after #176 opens a confirmations pull request
     with the new unchecked entries; check it went through.
   - The nightly checker now also confirms each use's approval date: the
     submission's letter must name the use, its label must add it, and the
     date must be that submission's. Tried on the real documents: Rybrevant
     Faspro's four lung uses (ORIG-1) and head and neck (SUPPL-2) and all
     nine Dupixent uses pass; head and neck dated to ORIG-1 can't. Its
     first run also replaces stale unchecked dates with the site's (e.g.
     Dupixent's nasal polyps: SUPPL-66, 2024, becomes SUPPL-14, 2019).
     Still on pivotal trials only: the site's "checked" badge and
     `npm run -s status`'s checked count.
   - **Keytruda's wrong pivotal roles are fixed** (20 Nov): bare-number
     protocol ids, capitals words in lower case ("clear cell") and phrases
     ("Solid Tumors") no longer name a trial; another company's trial of
     another drug ("PD-1", a nivolumab study) gets no role; and a re-run no
     longer keeps an old pivotal role for a trial it found and gave none.
     Keytruda refreshed: 13 wrong pivotal roles and 42 outside trials with
     word-matched review roles gone, every date unchanged.
   - **Errors the new QC cross-checks found on the site** (20 Nov; listed
     in `scripts/qc/known-errors.json`, reported by `npm run qc` but not
     blocking; take each out once a pipeline fix and refresh clear it):
     - Supporting roles from the FDA review by a drug or disease name:
       Dupixent (DUPILUMAB, CRSwNP), Lexapro (Escitalopram, MDD), Keytruda
       (Pembro), Rinvoq (ACUTE, CD). The #180 rule (outside
       trials only by NCT number) should clear them on the next refresh.
     - Brands: "Rybrevant faspro", "Awiqli flextouch", "Lifyorli
       (copackaged)"; #177 should fix them on the next refresh.
     - Cefepime and tebipenem list "Usage to Reduce Development of
       Drug-Resistant Bacteria" as a use; skip it like "Limitations of Use".
     - Opzelura: 19 oral ruxolitinib trials (Jakafi's) still in the record.
       Shown once the next refresh stores products' routes; #180 should
       drop them. Same then for Hovilpri (pritelivir tablets): LipP1, a
       pritelivir ointment trial.
   - **Label check**: `npm run qc` checks each dated use against its
     approval's label wherever the saved text is present: pull request CI
     fetches it (`npm run qc:fetch-raw`), the weekly refresh has it from its
     own run. Clean on all 62 drugs; catches Rybrevant Faspro's head and
     neck dating on the 15 Nov refresh, and caught 42 of 42 uses re-dated
     to their drug's first approval on purpose.
2. **New drugs: atopic dermatitis only** (PRD goal 2), until its list
   matches the FDA's own records. No other areas until then.
3. **Design and legibility: finish, then stop.** Home, drug, approved
   use, disease and trial pages are done; Compare is the last one. The
   FDA's wording stays word for word; only the site's own copy
   (`src/lib/copy.ts`) gets shorter.

**Phase 2: put it in front of people**
4. **Precedent table** (PRD goal 3): bring
   `claude/precedent-markers-citations` (FDA review time, approval
   markers, citation chips; 10 Nov, no pull request) up to date with main
   and merge it, then the table itself.
5. **Required on every page, not built yet** (PRD §4): a "report a
   mistake" link and a "not medical advice" line.
6. **Publish** (after the owner's domain and Cloudflare decision, now due
   26 Nov): cookie-free visitor counter, Cloudflare Pages, `SITE_ORIGIN`,
   Search Console.
7. **Go-to-market, first step:** the ten-minute test with three
   consultants or BD/regulatory analysts on atopic dermatitis. Their
   answers (would they use it at work, what's missing, would they pay) go
   on the owner's list.

**Phase 3: charge and keep them (after the test)**
8. **Monetization:** accounts and the paywall (7 Nov plan; the home
   page's disabled "Log in" is the place for them), priced from the test.
9. **Stickiness:** "tell me when something new is approved in my area",
   an email digest built on the weekly refresh.

**Deferred:** new therapeutic areas; a page for regulatory measures across
diseases (owner, 17 Nov; until then review time stays on each disease
page); readers for the designation sources saved on `diag/designations`
(then add them to `npm run precedent`); "Rare diseases" from orphan
status; Compare percentages for count results (needs each arm's size from
ClinicalTrials.gov); move workflow actions off Node 20.

## The site
https://yoanezerzer-lgtm.github.io/Pharma-Timeline-Tool/ (GitHub Pages
until Cloudflare). 62 drugs; checks: 37 checked, 7 partly, 18 not yet
(`npm run -s status`). Pages: home, Drugs and Diseases lists, drug,
approved use, disease, trial (side panel or full page), Compare, About the
data. Each page has its own address, title and description; the build
writes `sitemap.xml`, `robots.txt` and `404.html`. The site check
(`scripts/sitecheck.ts`) opens every page in a browser on each pull
request and deploy, and fails on sideways scrolling at 375px.

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
- Therapeutic areas: the owner's, filed by disease
  (`data/areas/areas.json`), not MeSH categories.
- Plain summary: MedlinePlus, MedlinePlus Genetics, or NCI, matched only
  by page *title* (`plainSources.ts`).
- Approval dating (#129, 8 Nov): a use the original label lacks is no
  longer dated to the original approval; the letter that first lists a use
  reads "New indication", not "Label expansion"; "provides for the treatment of" counts
  as widened only when it names a wider group; old one-sentence labels
  give their indication.
- Company news: links only (headline, date, publisher), allowed sites only
  (PR Newswire, Business Wire, GlobeNewswire, Fierce, company site);
  `npm run validate` enforces it. Rules in `src/lib/news.ts`, job in
  `scripts/news/`, raw reads on `diag/news`.
- Raw source text for any drug: `diag/raw-text-<slug>` branches.

## Known gaps (shown as blanks, not guessed)
`npm run -s status` lists them all. Main ones:
- 18 facts **stuck** (unconfirmed after 3 nights; need a person).
  Includes Adquey's 3 trials (Otsuka's; no FDA document names Otsuka) and
  Lynavoy (its record cites no label).
- Approved uses with no disease matched: uses with no pivotal trial and no
  disease name MeSH knows (imaging agents, "reduce drug-resistant
  bacteria"), or trials whose MeSH terms disagree with the wording (4
  Keytruda uses: PMBCL, urothelial, biliary tract, TMB-H).
- No label company for 10 drugs, drug class for 4, review office for 3.
- Held back (no label in openFDA yet): zilurgisertib, iberdomide,
  daraxonrasib, pivekimab-sunirine.
- News: companies whose web name differs (GSK, Janssen) get no
  company-site links.

### Atopic dermatitis (the first area)
Drugs: Dupixent, Adbry, Cibinqo, Ebglyss, Nemluvio, Protopic, Adquey,
Eucrisa, Opzelura, Zoryve, Elidel. Open:
- Protopic: no company, class or 12.1–12.3 (old label); no pivotal trials
  (before the registry).
- Eucrisa: no trials (its code names aren't searched); no label company,
  nor for Elidel.
- Dupixent's prurigo nodularis use has no disease (its trials are filed
  under "Neurodermatitis", which the wording doesn't name).

## Automatic jobs
- **Nightly checker** (scheduled task, 00:36 New York, cheaper model,
  `docs/agents/nightly-verify.md`): checks facts, unchecked drugs first,
  and looks for trial readouts. Move it to weekly once fewer than 5 drugs
  are unchecked.
- **Weekly refresh** (`refresh-all.yml`, Saturdays, no AI): re-reads every
  drug; routine changes publish themselves, the rest wait on
  `data/refresh-<date>` for review.
- **News links** (`news.yml`, Sundays, no AI).
- **Weekly status** issue every Monday (`weekly-status.yml`; GitHub emails
  the owner).
- Actions can't open pull requests (repository setting), so ingest runs
  leave `ingest/<slug>` branches to open by hand.

## Open owner questions
- Domain and Cloudflare account (this week); Search Console; pricing.
- Show a public "last updated" date on the site?
- 18 stuck facts need a person to look (`npm run -s status`).
- Optional: delete ~110 old branches (keep `diag/*`, `claude/prd`,
  `claude/precedent-markers-citations`, unmerged `data/*`).
