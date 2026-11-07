# Handoff: where things stand (7 Nov 2026)

Read `CLAUDE.md` first: it holds the owner's standing rules. `docs/PRD.md`
holds the mission, the users and the goals, agreed 4 Nov. This note is
the current state and the next steps. Update it when they change, and start
a new session when a conversation gets long.

## Product direction (owner, 29 Oct 2026; changed 7 Nov, see below)
- ~~A free resource with no accounts, no paywall.~~ Replaced on 7 Nov: a
  paid site, published on Google this week (see "Owner decisions (7 Nov)"). Favour clear explanations, sources a reader can
  follow, and pages that teach (how a drug works, which trials led to which
  approval) over business features.
- Only quote public-domain sources (FDA, ClinicalTrials.gov, MeSH,
  MedlinePlus). Only *link* to StatPearls: its licence bars derivatives.

## The site (https://yoanezerzer-lgtm.github.io/Pharma-Timeline-Tool/)
- **52 drugs.** The 6 originals (Rinvoq, Skyrizi, Keytruda, Lexapro,
  Foundayo, Mimrylo) plus 46 from FDA's list of new-medicine approvals.
- **Home** (`src/pages/DrugIndex.tsx`): one search box, one area menu, a
  plain list grouped by **therapeutic area**. The areas and each drug's
  areas are the owner's (`data/areas/areas.json`, approved 31 Oct): change
  them only with the owner. "Genetic diseases" is filled by rule (a disease
  MeSH files under "Genetic Diseases, Inborn", C16.320); "Rare diseases" is
  meant to come from FDA orphan status (not built yet). Drugs with no area
  show under "Being sorted". No admin links, badges or extra views on the
  home page; the add-drug page is still at `/ingest/`.
- **Drug page** (`/drug/<slug>/`, `src/pages/DrugPage.tsx`): "What it's for"
  (the label's patient leaflet answer to "What is BRAND?", word for word,
  `patientSummary` in `scripts/ingest/pharmacology.ts`), approved uses, "How
  it works" (label sections 12.1–12.3), then "Sources and checks" (FDA
  application, review office, check status) at the bottom.
- **Approved-use page** (`/drug/<slug>/indication/<slug>/`): trials timeline.
- **Disease page** (`/disease/<MeSH id>/`, `src/pages/DiseasePage.tsx`):
  everyday name, first and latest approval, plain-language summary, one
  timeline row per approved use (filled dot = new approval, open dot =
  change), what each approval covers (the approval letter's sentence
  without its opening paperwork, `src/lib/plainText.ts`), and MeSH's
  medical definition at the end. Excel and PowerPoint downloads.
- **Page addresses** (7 Nov): every page has its own address, title and
  description. The build writes one HTML file per page plus `404.html`,
  `sitemap.xml` and `robots.txt` (`src/lib/sitePages.ts`, `pageMeta.ts`,
  plugin in `vite.config.ts`). Old `#/drug/...` links still open the right
  page. Set `SITE_ORIGIN` in the deploy when the site moves to its own
  domain, so the sitemap and canonical links use it.
- **Check status** on every drug: "Not yet checked", "Partly checked · N of
  M" or "Checked", counted from `data/reference/` at build time.

## Where facts come from (all read by code, never written by an AI)
- **Company:** the name printed on the label ("Manufactured for: …") when
  it is the FDA applicant; duplicates merged with `sameCompany()`
  (`src/lib/company.ts`, `scripts/ingest/labelFacts.ts`).
- **FDA review office:** signature of the newest approval letter (shown on
  the drug page only).
- **Disease of an approved use:** a MeSH term on one of its pivotal trials'
  ClinicalTrials.gov records that the FDA wording names; most specific
  wins; non-disease terms dropped (`scripts/ingest/diseases.ts`).
  **Therapeutic areas** are MeSH's top-level disease categories.
- **Plain-language disease summary** (`scripts/ingest/diseases.ts`,
  `plainSources.ts`), first found of: a MedlinePlus health topic, a
  MedlinePlus Genetics condition page, the NCI Dictionary of Cancer Terms.
  A page counts only when its *title* is the disease: the MeSH term or one
  of the names of its MeSH preferred concept. Never by a page's list of
  other names (they include broader or different diseases: garetosmab's
  heterotopic ossification once matched "Progressive osseous heteroplasia").
  Raw answers are kept on the `diag/raw-text-<slug>` branches.
- **Patient leaflet ("What it's for"):** from the newest label's Medication
  Guide or Patient Information. 37 of 52 labels have one.

## Known gaps (shown as blanks, not guessed)
- 59 of 90 approved uses have a disease. The others: recent trials not yet
  MeSH-tagged on ClinicalTrials.gov (Icotyde, Orzeyful), uses with no
  pivotal trial (Bysanti, Lexapro, imaging agents), or FDA wording that
  differs from MeSH (8 Keytruda uses, e.g. "Classical Hodgkin Lymphoma").
- About 45 of 51 diseases have a plain summary (peritoneal cancer and
  heterotopic ossification have none yet).
- Drug class missing for Awiqli and Xocova; Awiqli's label text is redacted.
- No review office for Mimrylo, Tauklarify, Veppanu; no label company for 5.
- Held back (no label in openFDA yet): zilurgisertib, iberdomide,
  daraxonrasib, pivekimab-sunirine.
- `npm run -s status` lists all of these, plus facts stuck in checking.

## Agents and automatic jobs
- **Nightly fact checker** (scheduled task "Nightly data verification",
  00:36 New York): starts a Sonnet session that follows
  `docs/agents/nightly-verify.md`. It takes unchecked drugs first; a fact
  unconfirmed 3 nights is "stuck" and waits for the owner.
- **Weekly refresh** (`.github/workflows/refresh-all.yml`, Saturdays 21:13
  New York, no AI): re-reads every drug. Routine changes publish themselves
  after the full checks. Others (approved uses, trial roles, new trials)
  wait on `data/refresh-<date>`: open a PR from it, check, merge. Run it by
  hand after a pipeline change, with `only` to try a few drugs first.
- **Site check** (`scripts/sitecheck.ts`, no AI): every page in a browser,
  on each pull request and after each deploy.
- **Weekly status** (`.github/workflows/weekly-status.yml`, Mondays, no
  AI): comments on the "Weekly status" issue; GitHub emails the owner.

## How to work: token and process rules (audit, 3 Nov 2026)

**Where the owner's tokens went.** Every message in a chat re-reads the
whole chat, so a chat gets more expensive with every turn. The 29 Oct chat
ran for five days and over 90 pull requests; late in it, each short reply
cost as much as an hour of fresh work. Waiting on CI inside a chat costs
tokens too, and so does re-running all 52 drugs to try out a guess.

Rules for every session:
1. **One chat per piece of work.** Start a fresh chat for each new step,
   and when a chat passes about 30 turns. End each chat by updating this
   note. The next chat reads `CLAUDE.md` and this note, nothing else.
2. **Don't wait inside a chat.** Push, open the PR, check CI once a few
   minutes later, merge. No repeated sleeps or polling. Ask the owner to
   turn on auto-merge (Settings → General → Pull Requests) so PRs merge
   themselves once checks pass.
3. **Batch.** One PR per step with code, tests and docs together; one data
   PR per refresh. Not a PR per fix.
4. **Look before parsing.** For any outside service (openFDA, ClinicalTrials.gov,
   MeSH, MedlinePlus, NCI), first capture a real response on the
   `diag/raw-text-<slug>` branch (one-drug run), then write the parser
   against it. Guessing the format cost three full re-runs for MedlinePlus.
5. **Try a few, then all.** Run `Refresh all drugs` with `only` = 2–5 drugs
   and `publish: false` before running all 52.
6. **Cheap model for routine work.** Sonnet for the nightly checker, data
   runs and small fixes. The stronger model only for design work.
7. **Read less.** Use `npm run -s status`, `git log --oneline`, and
   `grep`/`sed -n` on the needed lines. Don't read whole big files or whole
   drug records, and don't screenshot pages that didn't change.
8. **No AI where code will do.** Refresh, site check and status report are
   plain GitHub jobs and cost no tokens. Keep new automation that way.

Scheduled tasks on the owner's account (3 Nov) and what they cost:
- *Nightly data verification* (Sonnet, every night, ~5 minutes): needed
  until the catch-up is done (30 of 52 checked, 18 facts stuck). It also
  adds one chat per night to the list. **Plan:** once fewer than 5 drugs are
  unchecked, move it to once a week.
- *Pharma Timeline weekly digest* (Sonnet, Mondays): **runs but can't send**,
  because its Gmail connector was never attached. **Plan:** replace it with a
  free GitHub job that posts the status report to a pinned GitHub issue each
  week; GitHub emails the owner the update. No AI, no connector.
- Not this project, but the biggest regular users on the account: *Morning
  brief* runs on the stronger model every weekday, and *Job scout* runs
  twice a day. Moving the brief to Sonnet and the scout to once a day would
  save the most. Only the owner can decide that.

## Owner decisions (3 Nov 2026)
- Accounts: the site stays free with no sign-up, but keep the door open
  for accounts later (don't build anything that rules them out).
- Short names for uses: may be cut automatically from the FDA's own
  wording.
- Atopic dermatitis belongs under immunology, not "Genetic diseases":
  exclude it from the MeSH genetic-diseases rule and file it under the
  immunology area (still to do).
- Morning brief moved to Sonnet (done). Job scout to once a day: the owner
  must edit it (claude.ai/code/routines/trig_01RjhVp6w65gGm9krCvDUjnq);
  it was not created by an agent, so an agent can't change it.
- Auto-merge: wanted; a session can't change repo settings, so the owner
  turns it on (Settings > General > Pull Requests).
- Old branches: the owner said an agent may delete them, but the delete
  was blocked in-session. 30 branches whose PR is merged are safe to
  delete; keep `diag/raw-text-*`, `claude/prd` and unmerged `data/*`.
- Weekly status: done. A free workflow posts to the "Weekly status" issue
  every Monday (`.github/workflows/weekly-status.yml`).

## Owner decisions (7 Nov 2026)
- **Paywall.** The site goes behind a paywall and is published (on Google)
  this week; the owner's cousin advises on search and pricing. Agreed
  default until the owner says otherwise: home, drug pages and "What it's
  for" stay free so Google can read them; deeper parts (downloads,
  Compare, full trial detail) go behind the paywall. Payments need
  accounts and a host other than GitHub Pages.
- **Hosting:** Cloudflare Pages recommended (free, own domain, can add a
  login and Stripe later). Domain to buy: owner's call, not done.
- **News links:** link only, never copy, and only pages not behind a
  paywall: company websites and press releases, newswires, Fierce Pharma.
  (Not STAT: mostly paywalled.)
- **Copy on the site:** text explaining what a section is goes behind an
  (i) icon; text meant for the owner is removed (done, #110).

## Done 7 Nov
- Words split in PDF text ("JA Ks", "fun ction") fixed at the source:
  text pieces are joined the way they sit on the page (#109). All 52
  drugs re-read (#111). Confirmed facts filed under the old, split wording
  still match: wording is compared with spaces ignored (`src/lib/wording.ts`).
  The cleaner text found two new pivotal links for the checker to confirm:
  Rinvoq NCT03653026 and Skyrizi NCT03398135 (ulcerative colitis).
- (i) icons for section explanations, owner-only text removed (#110).

## Blocker (7 Nov): the site is not publishing
The repository is public again (7 Nov evening), but GitHub switched Pages
off while it was private: deploys still fail with "Ensure GitHub Pages has
been enabled". Owner: Settings → Pages → Source: "GitHub Actions". Then
re-run "Deploy to GitHub Pages" on main; its site check job confirms the
live site. Then submit `sitemap.xml` in Google Search Console.

## Next steps (in order, one chat each)
1. Unblock publishing (above, owner), then check the live Rinvoq page
   shows "point of JAKs" and the (i) icons.
2. Done 7 Nov: real page addresses, titles, descriptions, sitemap.
3. Move atopic dermatitis under immunology (3 Nov decision).
4. Hosting on Cloudflare Pages and the owner's domain.
5. News links (sources above), then the paywall.

## Owner decisions (4 Nov 2026)
- Mission, users and eight goals agreed: see `docs/PRD.md`.
- Students come first; analyst features (milestones, Compare) wait.
- Polish the 52 drugs first; no new drugs until PRD goals 1–3 are done.
- A free, cookie-free visitor counter is wanted (page counts only).
- Treadle is the project manager: one board goal per PRD goal, set up as
  in `docs/agents/treadle.md`. The old October goal on the board is Done.
- **Revised the same day after an outside review (office hours):
  professionals come first** (consultants, business-development and
  regulatory analysts building precedent tables), students second. One
  disease area made complete before any other; first area: atopic
  dermatitis, moderate to severe (owner confirmed). The visitor
  counter and real page addresses come first. This replaces "students come
  first" and "no new drugs until goals 1–3" above. See `docs/PRD.md` §2, §9.

## PRD goals (4 Nov)
Work the PRD goals in order (§9). Active now: 1 (see who comes: counter
and real page addresses), 2 (one area complete), 3 (precedent table in ten
minutes), plus the standing goal (owner only approves). The Treadle board
goals still follow the old numbering and need renaming to match.
Earlier first tasks are listed in `docs/agents/treadle.md`.

Not possible: the FDA's Drug Trials Snapshots. fda.gov doesn't serve those
pages to the pipeline, and working around its bot protection is not allowed.

Owner decisions on record: audience is professionals first, students
second, one area at a time (4 Nov, revised); company material is linked, never copied; atopic dermatitis moves
to immunology (3 Nov, PRD goal 3).

## Ideas not yet started
- More drugs once most are "Checked" (the `Add new drugs` workflow).
- Fill disease gaps: an FDA-wording-to-MeSH synonym step from MeSH's own
  entry terms (e.g. "Hodgkin Lymphoma" is an entry term of "Hodgkin Disease").
- Optional cleanup: ~110 old branches on GitHub (owner, branches page).
