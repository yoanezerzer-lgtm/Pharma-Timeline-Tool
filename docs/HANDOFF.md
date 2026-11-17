# Handoff: where things stand (17 Nov 2026)

The current state and the next steps, nothing else. Rules are in
`CLAUDE.md`; the product, the goals and the owner's decisions are in
`docs/PRD.md`. Update this note at the end of every chat; history belongs
in git and pull requests, not here.

## This week: less text on every page
The owner's biggest problem now, after adding drugs, is that pages are too
dense (PRD §5, "Answer first, detail one click away"). This week is design
and shorter copy, one page per chat, in this order: home, drug, approved
use, disease, trial, Compare. The FDA's wording stays word for word; only
the site's own copy (`src/lib/copy.ts`) gets shorter. Domain and
Cloudflare: owner, by the end of the week.

## Next steps (in order, one chat each)
1. **Design: less text** (several chats, above).
2. **Data, one chat:**
   - Review the 15 Nov refresh on `data/refresh-2026-11-15` (22 drugs,
     first run with the 8 Nov dating rules) before Saturday's run.
   - Find why the nightly checker has opened no
     `nightly/<date>-confirmations` pull request since 11 Nov (it runs,
     but only readouts come out). Read its latest summary first.
   - Readout reader (`readouts.yml`): it saves quotes that don't state a
     result (a page title, an endpoint description), so every readout is
     held. Make it pick a sentence with a result in it, or record nothing.
     Held so far: Dupixent SINUS-24/52, Cibinqo JADE TEEN and MONO-2
     (links kept in `data/readouts/candidates/`).
3. **Precedent table** (PRD goal 3): bring
   `claude/precedent-markers-citations` (FDA review time, approval
   markers, citation chips; 10 Nov, no pull request) up to date with main
   and merge it, then the table itself.
4. **Get ready to publish** (after the owner's decision): cookie-free
   visitor counter, Cloudflare Pages, `SITE_ORIGIN`, Search Console, then
   accounts and the paywall (the home page's disabled "Log in" is the
   place for them).
5. **Required on every page, not built yet** (PRD §4): a "report a
   mistake" link and a "not medical advice" line.
- Later: a separate page for regulatory measures across diseases (FDA
  review time and the like, compared side by side; owner, 17 Nov). Until
  then review time stays on each disease page.
- Later: readers for the designation sources saved on
  `diag/designations` (then add them to `npm run precedent`); "Rare
  diseases" from orphan status; Compare percentages for count results
  (needs each arm's size from ClinicalTrials.gov); move workflow actions
  off Node 20; more areas once atopic dermatitis is complete.

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
