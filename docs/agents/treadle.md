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

## Goals on the board

The board's goals are the eight in `docs/PRD.md` §9, one Treadle goal each,
with this folder as the project. Goals 1, 2, 3 and 7 are active; the others
are paused until an earlier one is done. The Planner breaks each goal into
tasks and labels each one:

- **Treadle agent:** code, layout, wording, tests (Builder; Eye for pages).
- **Normal session:** anything that needs the internet, plus checks, push
  and pull request ("ship the Treadle branch for <goal>").
- **Owner:** approvals and decisions, gathered into one short list.

Every task description starts with "Read CLAUDE.md, docs/PRD.md and
docs/HANDOFF.md first." Keep the owner's areas list
(`data/areas/areas.json`) unchanged unless the goal says otherwise.

Known first tasks:
- Goal 1: one tile/card component on every page, Compare included
  (Planner lists them, Builder merges, Eye reviews); shorter titles and
  descriptions as a list for the owner, then applied.
- Goal 3: atopic dermatitis under immunology: exclude it from the MeSH
  genetic-diseases rule (C16.320, `scripts/ingest/diseases.ts`), with a
  test (Builder).
- Goal 3: "Rare diseases" from FDA orphan status (normal session: needs the
  internet).
- Goal 5: "Further reading" links (normal session: needs the internet).
