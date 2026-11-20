/**
 * What a pipeline rule change does to the site's data, drug by drug.
 *
 * Both sides re-derive the same facts from the same saved FDA text (the
 * `diag/raw-text-<slug>` branches) and the same committed record (its trials,
 * milestones and source list); only the rule modules differ. The wiring below
 * mirrors scripts/ingest/run.ts (label choice, review text, aliases), so a
 * change there is not compared: only roles.ts, indicationDates.ts and what
 * they import.
 *
 * Left out, because they need the network: the ClinicalTrials.gov search
 * (which trials a drug has) and the topical-form filter. A trial a new rule
 * would newly find is therefore not shown; a trial whose roles change is.
 */
import type { Milestone, Trial } from '../../src/schema/index.js';

/** The rule functions compared. Each side loads its own copies. */
export interface RuleModules {
  roles: {
    extractLabelSection14(text: string): string | null;
    extractIndicationList(text: string): { number?: string; name: string }[];
    extractLegacyIndicationList?(text: string): { number?: string; name: string }[];
    splitSection14ByIndication(section: string, list: never[]): { indication: string; text: string }[];
    extractTrialAliases(text: string): Map<string, string[]>;
    classifyTrialRoles(trial: Trial, ctx: unknown): { roles: { indication?: string; role: string }[] };
  };
  dates: {
    dateIndications(
      names: string[],
      labels: SourceDoc[],
      milestones: Milestone[],
      letters?: SourceDoc[]
    ): Map<string, { date: { value: string }; submission: string }>;
  };
  knownTrialSponsors(slug: string): string[] | undefined;
}

/** One saved FDA document, typed and dated the way the ingest run sees it. */
export interface SourceDoc {
  type: string;
  submission: string;
  url: string;
  text: string;
}

export interface DrugInput {
  slug: string;
  name: string;
  sponsor?: string;
  /** Ingredient, brand and development codes, for the check that a trial gives this drug. */
  drugNames?: string[];
  trials: Trial[];
  milestones: Milestone[];
  docs: SourceDoc[];
}

export interface Facts {
  /** The label the roles were read from, e.g. "SUPPL-2". */
  label?: string;
  /** Each listed use and the approval it is dated to ("2026-11-05 SUPPL-2"), or "undated". */
  uses: Record<string, string>;
  /** Each trial's roles: "pivotal for <use>", "supportive (review)". */
  roles: Record<string, string[]>;
}

const UNDATED = 'undated';

export function deriveFacts(m: RuleModules, drug: DrugInput): Facts {
  const dateOf = (sub: string) => drug.milestones.find((x) => x.submissionNumber === sub)?.date.value ?? '';
  const labels = drug.docs.filter((d) => /label/i.test(d.type));
  const letters = drug.docs.filter((d) => /letter/i.test(d.type));
  const byRecency = [...labels].sort((a, b) => dateOf(b.submission).localeCompare(dateOf(a.submission)));

  // As run.ts: the newest label whose section 14 splits into every listed use.
  let section: string | null = null;
  let chosen: SourceDoc | undefined;
  let list: { name: string }[] = [];
  let spans: { indication: string; text: string }[] = [];
  for (const candidate of byRecency) {
    const s = m.roles.extractLabelSection14(candidate.text);
    if (!s) continue;
    const l = m.roles.extractIndicationList(candidate.text);
    const sp = l.length > 0 ? m.roles.splitSection14ByIndication(s, l as never[]) : [];
    if (section === null || sp.length > spans.length) {
      section = s;
      chosen = candidate;
      list = l;
      spans = sp;
    }
    if (l.length > 0 && sp.length === l.length) break;
  }
  if (list.length === 0 && m.roles.extractLegacyIndicationList) {
    for (const candidate of byRecency) {
      const l = m.roles.extractLegacyIndicationList(candidate.text);
      if (l.length > 0) {
        list = l;
        break;
      }
    }
  }

  const names = list.map((e) => e.name);
  const dated = m.dates.dateIndications(names, labels, drug.milestones, letters);
  const uses: Record<string, string> = {};
  for (const name of names) {
    const a = dated.get(name);
    uses[name] = a ? `${a.date.value} ${a.submission}` : UNDATED;
  }

  const ctx = {
    indicationSections: spans,
    reviewText: drug.docs.filter((d) => /review/i.test(d.type)).map((d) => d.text).join('\n'),
    labelUrl: chosen?.url,
    reviewUrl: drug.docs.find((d) => /review/i.test(d.type))?.url,
    sponsorName: drug.sponsor,
    knownTrialSponsors: m.knownTrialSponsors(drug.slug),
    trialAliases: m.roles.extractTrialAliases(drug.docs.map((d) => d.text).join('\n')),
    drugNames: drug.drugNames,
  };
  const roles: Record<string, string[]> = {};
  const names2 = trialNames(drug.trials);
  drug.trials.forEach((t, i) => {
    const { roles: r } = m.roles.classifyTrialRoles(t, ctx);
    roles[names2[i]] = r.map((x) => `${x.role.toLowerCase().replace(/_/g, ' ')} ${x.indication ? `for ${x.indication}` : '(review)'}`).sort();
  });

  return { label: chosen?.submission, uses, roles };
}

/** A readable name per trial: its acronym, or its NCT number; both when an acronym repeats. */
export function trialNames(trials: Trial[]): string[] {
  const base = trials.map((t) => t.acronym || t.nctId || t.id);
  return base.map((b, i) =>
    base.indexOf(b) !== base.lastIndexOf(b) && trials[i].nctId && b !== trials[i].nctId ? `${b} (${trials[i].nctId})` : b
  );
}

/** One line per changed fact, in the order a reader checks them: label, dates, roles. */
export function diffFacts(drug: string, before: Facts, after: Facts): string[] {
  const out: string[] = [];
  if (before.label !== after.label) {
    out.push(`${drug}: roles read from label ${after.label ?? 'none'} (was ${before.label ?? 'none'})`);
  }
  for (const use of union(Object.keys(before.uses), Object.keys(after.uses))) {
    const b = before.uses[use];
    const a = after.uses[use];
    if (b === a) continue;
    if (b === undefined) out.push(`${drug}: use "${use}": added, ${a}`);
    else if (a === undefined) out.push(`${drug}: use "${use}": removed (was ${b})`);
    else out.push(`${drug}: use "${use}": ${a} (was ${b})`);
  }
  for (const trial of union(Object.keys(before.roles), Object.keys(after.roles))) {
    const b = new Set(before.roles[trial] ?? []);
    const a = new Set(after.roles[trial] ?? []);
    for (const r of a) if (!b.has(r)) out.push(`${drug}: ${trial} ${r}: added`);
    for (const r of b) if (!a.has(r)) out.push(`${drug}: ${trial} ${r}: removed`);
  }
  return out;
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

/** Lets the workflow find its own comment and update it in place. */
export const REPORT_MARKER = '<!-- compare-rules -->';

export interface DrugResult {
  name: string;
  lines: string[];
  /** Set when one side could not run on this drug. */
  error?: string;
}

/** Markdown for the job summary and the pull request comment. */
export function formatReport(results: DrugResult[], header: { base: string; head: string; missing: string[] }): string {
  const changed = results.filter((r) => r.lines.length > 0 || r.error);
  const same = results.filter((r) => r.lines.length === 0 && !r.error);
  const out: string[] = [];
  out.push(REPORT_MARKER);
  out.push('## Pipeline rule comparison');
  out.push('');
  out.push(
    `Old rules: \`${header.base}\`. New rules: \`${header.head}\`. Both sides read the same saved FDA text ` +
      '(`diag/raw-text-<slug>`) and the record of the run that saved it, with every trial the site shows. ' +
      'Compared: the date of each approved use, and each trial\'s roles. Not compared: the ClinicalTrials.gov search and ' +
      'the topical-form filter (they need the network), and wiring in `run.ts`.'
  );
  out.push('');
  if (changed.length === 0) {
    out.push(`**No change** on ${results.length} drugs.`);
  } else {
    out.push(`**${changed.length} of ${results.length} drugs change.**`);
    for (const r of changed) {
      out.push('');
      out.push(`### ${r.name} (${r.error ? 'error' : `${r.lines.length} change${r.lines.length === 1 ? '' : 's'}`})`);
      if (r.error) out.push(`- ${r.error}`);
      for (const l of r.lines) out.push(`- ${l.slice(r.name.length + 2)}`);
    }
  }
  if (same.length > 0 && changed.length > 0) {
    out.push('');
    out.push(`No change (${same.length}): ${same.map((r) => r.name).join(', ')}.`);
  }
  if (header.missing.length > 0) {
    out.push('');
    out.push(`No saved text, not compared (${header.missing.length}): ${header.missing.join(', ')}.`);
  }
  return out.join('\n') + '\n';
}
