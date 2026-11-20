import type { Drug, Indication, Trial } from '../../src/schema/index.js';
import { runByApplicant } from '../ingest/roles.js';
import { getSpec } from '../ingest/registry.js';
import type { Finding } from './checks.js';

/**
 * Cross-checks between parts of one record that should agree: a trial and
 * the use it is pivotal for, a trial and the product's form, a role and the
 * name it was found by, a brand and how labels write it. Each catches a kind
 * of error a person found by reading pages (19–20 Nov 2026), so a refresh or
 * a pipeline change shows it without anyone reading pages again.
 *
 * Plain rules on committed data only; no AI, nothing fetched.
 */

// --- 1. A pivotal trial's disease and its use --------------------------------

// Words too general to say two diseases are the same one.
const GENERIC = new Set([
  'a', 'an', 'and', 'or', 'of', 'the', 'in', 'with', 'for', 'to', 'who', 'on', 'by', 'at', 'as', 'is', 'are', 'not', 'from', 'after',
  'patients', 'patient', 'adult', 'adults', 'pediatric', 'children', 'adolescents', 'years', 'older', 'aged', 'age', 'healthy', 'volunteers',
  'treatment', 'treated', 'previously', 'first', 'line', 'therapy', 'prior', 'least', 'one', 'two', 'more', 'other', 'than',
  'disease', 'diseases', 'disorder', 'disorders', 'syndrome', 'syndromes', 'condition', 'conditions', 'infection', 'infections',
  'cancer', 'cancers', 'carcinoma', 'carcinomas', 'neoplasm', 'neoplasms', 'tumor', 'tumors', 'tumour', 'tumours', 'malignant', 'malignancy',
  'solid', 'cell', 'cells', 'metastasis', 'lesion', 'lesions', 'malignancies', 'squamous', 'type', 'stage', 'grade', 'high', 'low', 'risk',
  'chronic', 'acute', 'severe', 'moderate', 'moderately', 'severely', 'mild', 'active', 'advanced', 'metastatic', 'recurrent',
  'refractory', 'relapsed', 'resectable', 'unresectable', 'locally', 'early', 'primary', 'secondary', 'positive', 'negative',
  'mutation', 'mutations', 'expressing', 'expression', 'deficiency', 'deficient', 'inadequate', 'response', 'responders', 'controlled',
  'uncontrolled', 'chemotherapy', 'combination', 'monotherapy', 'adjuvant', 'neoadjuvant', 'maintenance', 'indicated', 'use',
]);

// Different words MeSH and labels use for one disease: Keytruda's label says
// "urothelial" where its trials registered "bladder"; Dupixent's prurigo
// nodularis trials are filed under MeSH's "Neurodermatitis".
const SAME_DISEASE: Record<string, string> = { bladde: 'urothe', neurod: 'prurig' };

// Words that name a tumour's markers, not where it grew: a use made only of
// these ("MSI-H or dMMR Cancer", "TMB-H Cancer") is for any solid tumour, and
// its trials must be about the marker instead.
const MARKER_WORDS = new Set([
  'microsatellite', 'instability', 'mismatch', 'repair', 'mutational', 'burden', 'msi', 'dmmr', 'mmr', 'tmb',
  'fusion', 'ntrk', 'braf', 'v600e', 'ret', 'her2', 'tissue', 'agnostic',
].map((w) => w.slice(0, 6)));

// The short forms trials write for the same markers ("MSI-H", "TMB-H"), and
// the word a trial testing several markers uses ("Predictive Biomarkers", KEYNOTE-158).
const MARKER_ALIASES: Record<string, string[]> = {
  micros: ['msi'], instab: ['msi'], mismat: ['dmmr', 'mmr'], repair: ['dmmr', 'mmr'], mutati: ['tmb'], burden: ['tmb'],
};

/** The words naming a disease, each cut to its first six letters so "psoriatic" meets "psoriasis". */
function diseaseWords(texts: (string | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const raw of t.toLowerCase().replace(/[‘’']/g, '').split(/[^a-z0-9]+/)) {
      if (raw.length < 3 || GENERIC.has(raw) || /^\d+$/.test(raw)) continue;
      const w = raw.slice(0, 6);
      out.add(SAME_DISEASE[w] ?? w);
    }
  }
  return out;
}

function indicationTexts(ind: Indication): string[] {
  return [ind.name, ind.displayName, ind.wording?.text, ...(ind.diseases ?? []).map((d) => d.term)].filter((s): s is string => !!s);
}

/**
 * Whether a pivotal trial could be for this use:
 * - `fits`: its registered disease (or, for a basket trial registered only as
 *   "Advanced Solid Tumors", the disease its title or arms name) appears in
 *   the use's name, full FDA wording or matched disease; for a use defined by
 *   a tumour marker, the trial names that marker.
 * - `wrong`: it names a disease or marker, and not this one.
 * - `unnamed`: a basket trial whose title and arms don't name the use either;
 *   nothing confirms it.
 * Undefined when the trial registers no condition at all.
 */
export type Fit = 'fits' | 'wrong' | 'unnamed';

export function trialFitsUse(t: Trial, ind: Indication): Fit | undefined {
  const conditions = [...(t.conditions ?? []), ...(t.conditionMesh ?? []).map((m) => m.term)];
  const described = [t.title, t.briefTitle, ...t.arms.flatMap((a) => [a.label, a.description])].filter((s): s is string => !!s);
  // Nothing registered (an old trial, or one known only from the label).
  if (conditions.length === 0) return undefined;
  const meshIds = new Set((ind.diseases ?? []).map((d) => d.meshId));
  if ((t.conditionMesh ?? []).some((m) => meshIds.has(m.id))) return 'fits';

  const nameWords = diseaseWords([ind.name]);
  if (nameWords.size > 0 && [...nameWords].every((w) => MARKER_WORDS.has(w))) {
    const wanted = new Set(['biomar', ...[...nameWords].flatMap((w) => [w, ...(MARKER_ALIASES[w] ?? [])])]);
    return [...diseaseWords([...conditions, ...described])].some((w) => wanted.has(w)) ? 'fits' : 'wrong';
  }

  // A basket trial registered only as "Cancer" or "Advanced Solid Tumors"
  // names its diseases in its title or cohorts ("Cohort B: Head & Neck Cancer").
  const basket = diseaseWords(conditions).size === 0;
  const texts = basket ? described : conditions;
  const trialWords = diseaseWords(texts);
  const useWords = diseaseWords(indicationTexts(ind));
  // Abbreviations in the use's name ("HNSCC", "NSCLC") stand for words the
  // trial spells out; compare initials both ways.
  const useInitials = new Set(indicationTexts(ind).flatMap((s) => s.match(/\b[A-Z][A-Za-z]*[A-Z]\b/g) ?? []).map((a) => a.toLowerCase()));
  const trialInitials = new Set(texts.flatMap((s) => s.match(/\b[A-Z][A-Za-z]*[A-Z]\b/g) ?? []).map((a) => a.toLowerCase()));
  for (const w of trialWords) if (useWords.has(w)) return 'fits';
  for (const c of texts) if (useInitials.has(initials(c))) return 'fits';
  for (const c of indicationTexts(ind)) if (trialInitials.has(initials(c))) return 'fits';
  // A title that doesn't name the use is no proof the trial isn't for it.
  return basket ? 'unnamed' : 'wrong';
}

/** "Head and Neck Squamous Cell Carcinoma" → "hnscc"; "Chronic Rhinosinusitis with Nasal Polyps" → "crswnp". */
export function initials(name: string): string {
  return name
    .split(/[^A-Za-z]+/)
    .filter((w) => w.length > 0 && !/^(?:and|of|the|in)$/i.test(w))
    .map((w) => (/^(?:with|w)$/i.test(w) ? 'w' : w[0]))
    .join('')
    .toLowerCase();
}

const isSubsequence = (short: string, long: string) => {
  let i = 0;
  for (const ch of long) if (ch === short[i]) i++;
  return i === short.length;
};

/**
 * "mdd" for "Major Depressive Disorder", "crswnp" for "Chronic Rhinosinusitis
 * With Nasal Polyps": the words' initials, give or take a letter or two taken
 * from inside a word, in order.
 */
export function isAbbreviationOf(acronym: string, name: string): boolean {
  const a = acronym.toLowerCase();
  name = name.replace(/\([^)]*\)/g, ' ');
  const init = initials(name);
  if (init.length < 2 || a.length > init.length + 2) return false;
  return isSubsequence(init, a) && a[0] === init[0] && isSubsequence(a, name.toLowerCase().replace(/[^a-z]/g, ''));
}

// --- 2. The product's form and the trial's ----------------------------------

const TOPICAL_WORDS = /\b(?:creams?|ointments?|foams?|lotions?|topical(?:ly)?)\b/i;
const ORAL_WORDS = /\b(?:oral(?:ly)?(?!\s+(?:lichen|mucosa|mucositis|cavity|ulcers?|lesions?|cancer|carcinoma|candidiasis))|tablets?|capsules?|by mouth)\b/i;
const INJECTED_WORDS = /\b(?:intravenous(?:ly)?|subcutaneous(?:ly)?|infusions?|injections?|injected|i\.v\.)\b/i;

type Form = 'topical' | 'oral' | 'injected';

/** The forms the approved products come in, from Drugs@FDA's routes (TOPICAL, ORAL, SUBCUTANEOUS…). */
export function productForms(routes: string[]): Set<Form> {
  const forms = new Set<Form>();
  for (const r of routes) {
    if (/intravenous|subcutaneous|intramuscular|intrathecal|injection/i.test(r)) forms.add('injected');
    else if (/\btopical|\bcutaneous|transdermal/i.test(r)) forms.add('topical');
    else if (/\boral/i.test(r)) forms.add('oral');
  }
  return forms;
}

/** The forms a trial says it gives the drug in, from its titles and arms. */
export function trialForms(t: Trial): Set<Form> {
  const text = [t.title, t.briefTitle, ...t.arms.flatMap((a) => [a.label, a.description])].filter(Boolean).join(' \n ');
  const forms = new Set<Form>();
  if (TOPICAL_WORDS.test(text)) forms.add('topical');
  if (ORAL_WORDS.test(text)) forms.add('oral');
  if (INJECTED_WORDS.test(text)) forms.add('injected');
  return forms;
}

/**
 * Whether a trial puts this drug itself on the skin: its name next to a
 * topical form or a percent strength ("ruxolitinib cream", "crisaborole 2%
 * ointment", "topical ruxolitinib"). Steroid creams allowed alongside an
 * injection ("dupilumab + topical corticosteroids") don't count.
 */
export function trialGivesDrugTopically(t: Trial, drugNames: string[]): boolean {
  const text = [t.title, t.briefTitle, ...t.arms.flatMap((a) => [a.label, a.description])].filter(Boolean).join(' \n ');
  return drugNames.some((n) => {
    const name = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `\\b${name}\\b(?:\\s+(?:phosphate|hydrochloride|\\(\\w+\\)))?\\s+(?:\\d+(?:\\.\\d+)?\\s?%|(?:topical\\s+)?(?:creams?|ointments?|foams?|lotions?|gels?)\\b)|\\btopical(?:ly applied)?\\s+${name}\\b`,
      'i'
    ).test(text);
  });
}

// --- 4. A review role found by a word -----------------------------------------

/**
 * Whether an acronym is really the name of a disease or drug: the drug's own
 * name ("DUPILUMAB"), a word of the trial's condition ("eczema"), or its
 * initials ("CRSwNP", "MDD", "NSCLC"). A review that names the disease or the
 * drug doesn't name the trial.
 */
export function acronymIsName(acronym: string, t: Trial, drug: Drug): string | undefined {
  const a = acronym.toLowerCase();
  const drugNames = [drug.inn, drug.brandName, ...drug.inn.split(/[\s-]+/)].map((s) => s.toLowerCase());
  if (drugNames.includes(a) || drugNames.some((n) => n.length >= 5 && n.startsWith(a) && a.length >= 4)) return 'the drug';
  const conditions = [...(t.conditions ?? []), ...(t.conditionMesh ?? []).map((m) => m.term), ...drug.indications.map((i) => i.name)];
  for (const c of conditions) {
    if (isAbbreviationOf(a, c)) return `"${c}"`;
    if (c.toLowerCase().split(/[^a-z]+/).includes(a) && a.length >= 4) return `"${c}"`;
    const abbrevs = c.match(/\b[A-Z][A-Za-z]*[A-Z]\b/g) ?? [];
    if (abbrevs.some((x) => x.toLowerCase() === a)) return `"${c}"`;
  }
  return undefined;
}

/** One word of letters and nothing else, the kind a review also uses as prose ("PATHWAY", "RAPID"). */
const WORD_ACRONYM = /^[A-Za-z]{2,}$/;

// --- 5. Brand casing ----------------------------------------------------------

/**
 * A brand as labels print it: every word capitalised ("Rybrevant Faspro",
 * "Awiqli FlexTouch"), no FDA product tag such as "(copackaged)".
 */
export function brandProblem(brand: string): string | undefined {
  if (/\(.*\)/.test(brand)) return `"${brand}" still carries an FDA product tag.`;
  const lower = brand.split(/[\s/-]+/).find((w) => /^\p{Ll}/u.test(w));
  if (lower) return `"${brand}": "${lower}" is not capitalised as labels print the brand.`;
  return undefined;
}

/**
 * Section 1 notes that aren't uses: antibacterial labels' "Usage" note ("To
 * reduce the development of drug-resistant bacteria…") and "Limitations of Use".
 */
const NOT_A_USE = /^(?:usage\b.*\bdrug[- ]resistant bacteria|(?:important\s+)?limitations?\s+of\s+use$)/i;

// --- Running them -------------------------------------------------------------

export function crossCheckDrug(drug: Drug): Finding[] {
  const out: Finding[] = [];
  const byName = new Map(drug.indications.map((i) => [i.name, i]));
  const applicant = drug.regulatory.us.sponsor ?? drug.sponsor;
  const knownSponsors = getSpec(drug.slug)?.knownTrialSponsors;
  const forms = productForms(drug.regulatory.us.routes ?? []);
  const drugNames = [drug.inn.split(/[\s,]+/)[0], drug.brandName.split(/\s+/)[0]].filter((n) => n.length >= 5);

  const brand = brandProblem(drug.brandName);
  if (brand) out.push({ severity: 'error', code: 'brand-casing', path: 'brandName', message: brand });

  drug.indications.forEach((ind) => {
    if (NOT_A_USE.test(ind.name)) {
      out.push({ severity: 'error', code: 'not-a-use', path: `indications[${ind.slug}]`, message: `"${ind.name}" is a note in section 1, not an approved use.` });
    }
  });

  for (const t of drug.trials) {
    const path = `trials[${t.id}]`;
    const name = t.acronym ?? t.labelName ?? t.nctId ?? t.id;

    // A product put on the skin and a trial giving the drug by mouth or by
    // injection; or a pill or injection and a trial putting the drug itself
    // on the skin (not the steroid creams its trials allow alongside).
    if (forms.size > 0 && !forms.has('topical') && trialGivesDrugTopically(t, drugNames)) {
      out.push({
        severity: 'error',
        code: 'trial-form-mismatch',
        path,
        message: `${name} puts the drug on the skin, but the product is ${[...forms].join(' or ')}: another product's trial.`,
      });
    }
    if (forms.size === 1 && forms.has('topical')) {
      const given = trialForms(t);
      if (!given.has('topical') && given.size > 0) {
        out.push({
          severity: 'error',
          code: 'trial-form-mismatch',
          path,
          message: `${name} gives the drug ${[...given].join(' or ')}, but the product is applied to the skin: another product's trial.`,
        });
      }
    }

    t.roles.forEach((r, k) => {
      const rpath = `${path}.roles[${k}]`;
      const ind = r.indication ? byName.get(r.indication) : undefined;
      if (r.role === 'PIVOTAL' && !t.acronym && !t.labelName && t.protocolNumber && /^\d{1,4}$/.test(t.protocolNumber)) {
        out.push({
          severity: 'error',
          code: 'pivotal-by-number',
          path: rpath,
          message: `${t.nctId ?? t.id} is pivotal for "${r.indication}" with only a bare protocol number ("${t.protocolNumber}"), which a label also prints as page, table or study counts; check section 14 names it.`,
        });
      }
      const fit = r.role === 'PIVOTAL' && ind && !NOT_A_USE.test(ind.name) ? trialFitsUse(t, ind) : undefined;
      if (fit === 'unnamed') {
        // Someone else's basket trial that never names the use: nothing ties it to this approval.
        const outsider = !runByApplicant(t, applicant, knownSponsors);
        out.push({
          severity: outsider ? 'error' : 'warn',
          code: outsider ? 'pivotal-outsider-basket' : 'pivotal-disease-unnamed',
          path: rpath,
          message: outsider
            ? `${name}, run by ${t.sponsor}, not the applicant, is registered for any solid tumour and never names "${r.indication}": nothing ties it to this approval.`
            : `${name} is registered for any solid tumour and its title and arms don't name "${r.indication}"; check section 14 names the trial.`,
        });
      }
      if (fit === 'wrong' && ind) {
        out.push({
          severity: 'error',
          code: 'pivotal-wrong-disease',
          path: rpath,
          message: `${name} is registered for ${(t.conditions ?? []).join('; ') || t.briefTitle || t.title}, which shares nothing with "${ind.name}".`,
        });
      }
      const fromReview = r.role !== 'PIVOTAL' && /^FDA review/.test(r.provenance.sourceLabel ?? '');
      if (fromReview && t.acronym && WORD_ACRONYM.test(t.acronym)) {
        const named = acronymIsName(t.acronym, t, drug);
        const outsider = !runByApplicant(t, applicant, knownSponsors);
        if (named) {
          out.push({
            severity: 'error',
            code: 'review-role-by-name',
            path: rpath,
            message: `${t.acronym} is the name of ${named}, not a trial's; an FDA review using that name is no sign it cites ${t.nctId ?? 'this trial'}.`,
          });
        } else {
          out.push({
            severity: 'warn',
            code: 'review-role-by-word',
            path: rpath,
            message: outsider
              ? `${t.acronym}, run by ${t.sponsor}, not the applicant, has a ${r.role} role from the FDA review by an acronym that is a plain word; check the review cites its NCT number.`
              : `${t.acronym} has a ${r.role} role from the FDA review by an acronym that may be a plain word; check the review names the trial, not the word.`,
          });
        }
      }
    });
  }
  return out;
}
