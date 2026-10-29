# Working on this repo

The owner's standing preferences. Every session, including the overnight
agent, follows them without being told again.

## Data
- **No data is written by an AI.** Values come from FDA documents and
  ClinicalTrials.gov through the pipeline. An AI may only check a value
  against its source and cite the passage; code verifies every quote.
- **Use the FDA's exact wording** for indications and approvals ("adjuvant",
  not "after surgery"). Plain-language labels are written by a person.
- **Leave a gap rather than guess.** When the documents don't settle it,
  show "not yet matched" or "unclear", never a best guess.
- Never edit `data/drugs/*.json` by hand; never change a confirmed entry in
  `data/reference/` (see `data/reference/README.md`).

## Working style
- **Decide, don't ask.** Make the call, then say what you chose and why.
  Ask only for things that are truly the owner's: spending money, accounts
  or secrets, product direction. Gather those into one short list.
- **Check a capability before asking the owner to change a setting for it.**
- **Explain in plain language**, short, no jargon. Say what changed for
  the site's users, not how the code works.
- **Stay at $0.** No paid services or API tokens outside the owner's plan.

## Before merging
- Run `npm run typecheck`, `npm test`, `npm run validate`, `npm run qc` and
  `npm run build`.
- Try new extraction or matching rules on the real documents (the
  `diag/raw-text-<slug>` branches) and score them against `data/reference/`,
  not just hand-picked cases.
- After a change to the site, look at it in a browser before calling it done.
- Work goes through pull requests; merge once CI passes. Commit and pull
  request messages carry no model names.
