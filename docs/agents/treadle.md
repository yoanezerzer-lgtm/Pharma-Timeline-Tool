# Working on this project from Treadle

Treadle (the owner's task board) can send its agents to work here. Its
agents follow `CLAUDE.md` like any other session, with three limits:

- **No internet.** They can't run the pipeline, the refresh, or anything
  that reads openFDA, ClinicalTrials.gov, MeSH, MedlinePlus or NCI. Give
  those steps to a normal Claude Code session or a GitHub workflow.
- **Never pushed.** Each change stays on its own branch (Treadle →
  Dashboard → Needs you). A normal session then runs the checks in
  `CLAUDE.md`, pushes the branch and opens the pull request.
- **Only this folder.** The project lives at
  `/Users/yoanezerzer/Desktop/Projects/Pharma-Timeline-Tool`. In Treadle →
  Integrations → Projects, this must be the folder listed, not the old
  `~/Desktop/Pharma-Timeline-Tool`.

Good fits for an agent: site layout and wording, code-only rules, tests.
Not a fit: new data, anything that needs a fresh document from a source.

## Ready-to-paste goals

One goal per step from `docs/HANDOFF.md`. Each task description starts with
"Read CLAUDE.md and docs/HANDOFF.md first." Keep the owner's areas list
(`data/areas/areas.json`) unchanged unless the goal says otherwise.

### 1. Atopic dermatitis under immunology
**Description:** Owner decision (3 Nov): atopic dermatitis belongs under
immunology, not "Genetic diseases". Exclude it from the MeSH genetic-diseases
rule (C16.320, `scripts/ingest/diseases.ts`) and file it under the
immunology area.
**Done when:** atopic dermatitis drugs show under immunology on the home
page and not under "Genetic diseases"; a test covers the exclusion; all
checks in `CLAUDE.md` pass.
**Tasks:**
1. Make the change and add the test (agent: Builder).
2. Run the checks, push, open the PR (normal session: "ship the Treadle
   branch for atopic dermatitis").

### 2. Tiles and cards look the same everywhere
**Description:** Handoff step 2. Use one tile/card component on every page,
Compare included. No new data.
**Done when:** every page uses the same card; site check passes; the owner
has looked at it in a browser.
**Tasks:**
1. List every tile and card and where it's used (agent: Planner).
2. Merge them into one component (agent: Builder).
3. Checks, browser look, PR (normal session).

### 3. Shorter titles and descriptions
**Description:** Handoff step 3. Shorten page titles and descriptions
written by people. Never shorten FDA wording; short names for uses may be
cut automatically from the FDA's own wording (owner, 3 Nov).
**Done when:** every page title fits one line on a phone; no FDA quote is
changed; checks pass.
**Tasks:**
1. Propose the new wording as a list for the owner (agent: Planner).
2. Owner approves the list (owner).
3. Apply it (agent: Builder), then checks and PR (normal session).

### Not for Treadle agents
- "Rare diseases" from FDA orphan status, and "Further reading" links:
  both need the internet. Run them in a normal session.
