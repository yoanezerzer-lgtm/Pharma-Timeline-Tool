/**
 * Company names as openFDA, ClinicalTrials.gov and the labels print them
 * ("ABBVIE", "AbbVie Inc.", "MSD", "Merck Sharp & Dohme LLC"), and when two
 * of them are the same company. Used by the ingest pipeline to tell a
 * sponsor's own trials apart, and by the site to list each company once.
 */

const CORPORATE_SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|gmbh|sa)\b/g;

// "&" and "and" are dropped because openFDA and the registry disagree on
// them: Drugs@FDA lists Keytruda's applicant as "MERCK SHARP DOHME" while
// ClinicalTrials.gov says "Merck Sharp & Dohme LLC". Keeping the "&" made
// every Merck trial look like someone else's, so none could be pivotal.
export function normalizeSponsor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,&]/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(CORPORATE_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words that say what kind of company it is, not which. openFDA abbreviates
// them ("VANDA PHARMS INC", "JANSSEN BIOTECH") and the registry spells out a
// different one ("Vanda Pharmaceuticals", "Janssen Research & Development").
const GENERIC_COMPANY_WORD =
  /\b(pharms?|pharma|pharmaceuticals?|biotech|biotechnology|biopharma|biosciences?|therapeutics|labs?|laboratories|research|development|healthcare|holdings|international|operations|us|usa)\b/g;

/** Whether two company names are the same company: the same distinctive first word, or one is the other's initials ("MSD"). */
export function sameCompany(x: string, y: string): boolean {
  const a = normalizeSponsor(x);
  const b = normalizeSponsor(y);
  if (a.length === 0 || b.length === 0) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const core = (s: string) => s.replace(GENERIC_COMPANY_WORD, ' ').split(/\s+/).filter(Boolean);
  const [ca, cb] = [core(a), core(b)];
  if (ca.length === 0 || cb.length === 0) return false;
  if (ca[0] === cb[0] && ca[0].length >= 3) return true;
  const initials = (words: string[]) => words.map((w) => w[0]).join('');
  return (ca.length === 1 && ca[0] === initials(cb)) || (cb.length === 1 && cb[0] === initials(ca));
}
