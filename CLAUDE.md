# Working on this repo

The owner's standing rules. Every session, including the overnight agent,
follows them without being told again.

## Where things live (one place each)
- **This file**: how to work. Rules that don't change week to week.
- **`docs/PRD.md`**: what the product is, who it's for, what each page
  must answer, the goals, and the owner's product decisions. Change only
  with the owner.
- **`docs/HANDOFF.md`**: the current state and the next steps only. Read
  it at the start of every chat; update it at the end. History lives in
  git and pull requests, not there.
- **`docs/agents/`**: runbooks for the overnight agent and Treadle agents.
- **`data/reference/README.md`**: how facts get confirmed.

When two of these disagree, the owner's newest dated decision wins; fix the
older text in the same pull request.

## Data
- **No data is written by an AI.** Values come from FDA documents and
  ClinicalTrials.gov through the pipeline. An AI may only check a value
  against its source and cite the passage; code verifies every quote.
- **Use the FDA's exact wording** for indications and approvals ("adjuvant",
  not "after surgery"). Short use names may be cut automatically from the
  FDA's own wording; any other plain-language label is written by a person.
- **Leave a gap rather than guess.** When the documents don't settle it,
  show "Not yet matched" or "unclear", never a best guess.
- **A quote must prove the value.** A readout's quote must state the
  trial's primary result; a title or an endpoint description is not
  enough. If the quote doesn't prove it, don't merge it.
- Never edit `data/drugs/*.json` by hand (a `git` revert to an earlier
  pipeline output is fine); never change a confirmed entry in
  `data/reference/`.

## Working style
- **Decide, don't ask.** Make the call, then say what you chose and why.
  Ask only for things that are truly the owner's: spending money, accounts
  or secrets, product direction. Gather those into one short list.
- **Check a capability before asking the owner to change a setting for it.**
- **Explain in plain language**, short, no jargon. Say what changed for
  the site's users, not how the code works.
- **Stay at $0 to build and run.** No paid services or API tokens outside
  the owner's plan; free tiers only (GitHub, Cloudflare Pages). Charging
  users is the owner's product decision (`docs/PRD.md`), not a cost.
- **No AI where code will do.**
- **Read a pull request's description before acting on it.** The overnight
  agent writes there why it held something back.

## Keeping chats cheap
Every message re-reads the whole chat.
1. One chat per piece of work; start a fresh one past ~30 turns.
2. Don't wait inside a chat: push, open the pull request, turn on
   auto-merge. No sleeps or polling.
3. One pull request per step (code, tests and docs together).
4. Look before parsing: save a real response on a `diag/` branch before
   writing a parser for an outside service.
5. Try a few, then all: `Refresh all drugs` with `only` = 2–5 drugs and
   `publish: false` first.
6. Read less: `npm run -s status`, `git log --oneline`, `grep`, `sed -n`.
   Not whole drug records; no screenshots of unchanged pages.
7. Cheaper model for routine work (nightly checks, data runs, small
   fixes); the stronger one for design.

## Before merging
- Run `npm run typecheck`, `npm test`, `npm run validate`, `npm run qc` and
  `npm run build`.
- Try new extraction or matching rules on the real documents (the
  `diag/raw-text-<slug>` branches) and score them against `data/reference/`,
  not just hand-picked cases.
- After a change to the site, look at it in a browser, at desktop width and
  at 375px, before calling it done.
- Work goes through pull requests; merge once CI passes. Exception: the
  overnight agent's pipeline fixes wait for the owner. Commit and pull
  request messages carry no model names.
- **Treadle agents** have no internet and never push: see
  `docs/agents/treadle.md`.
