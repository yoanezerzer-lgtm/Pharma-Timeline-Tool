/**
 * Display clean-ups for the wording disease pages quote. Each one only
 * reorders, re-cases or shortens the source's own words; none adds any.
 */

/**
 * MeSH files headings inverted for its index ("Carcinoma, Non-Small-Cell
 * Lung"); read in natural order ("Non-Small-Cell Lung Carcinoma"). Headings
 * with more than one comma are left as MeSH writes them.
 */
export function naturalTerm(term: string): string {
  const parts = term.split(', ');
  if (parts.length !== 2) return term;
  return `${parts[1]} ${parts[0]}`;
}

/** Capitalised words in MeSH scope notes that are abbreviations, not cross-references. */
const ABBREVIATIONS = new Set(['GFAP', 'NIDDM', 'SARS']);
const SMALL_WORDS = new Set(['OF', 'AND', 'THE', 'IN', 'OR', 'TO']);

/**
 * A MeSH scope note without its indexer's markings: cross-referenced terms
 * set in capitals ("deficiency of the hepatic enzyme ARGINASE") are
 * lower-cased, and a closing source citation ("(From Adams et al.,
 * Principles of Neurology, 6th ed)") is dropped. Abbreviations ("DNA",
 * "HLA-B27", "BMI") keep their capitals.
 */
export function readableDefinition(text: string): string {
  const noCitation = text.replace(/\s*\(((?:[^()]|\([^()]*\))*)\)\s*$/, (whole, inner: string) =>
    /\bet al\b|\b\d+(?:st|nd|rd|th|d) ed\b|https?:|^From\b|^Dorland\b|^Stedman\b/i.test(inner) ? '' : whole
  );
  const lowered = noCitation.replace(/\b[A-Z][A-Z0-9-]*(?:\s+[A-Z][A-Z0-9-]*)*/g, (run) => {
    const words = run.split(/(\s+)/);
    const isTerm = (w: string) => /^[A-Z]{4,}(?:-[A-Z]{2,})*-?$/.test(w) && !ABBREVIATIONS.has(w.replace(/-$/, ''));
    if (!words.some(isTerm)) return run;
    return words.map((w) => (isTerm(w) || SMALL_WORDS.has(w) ? w.toLowerCase() : w)).join('');
  });
  // A sentence that opened on a cross-reference ("INFLAMMATION of the liver …") starts with a capital again.
  return lowered.replace(/(^|[.;]\s+)([a-z])/g, (_, lead: string, c: string) => (lead.startsWith(';') ? lead + c : lead + c.toUpperCase())).trim();
}

/**
 * The part of an approval letter's sentence that says what the use is,
 * without the paperwork it opens with ("This Prior Approval supplemental
 * biologics application provides for a new indication for …"). Returns the
 * sentence unchanged when no known opening is found, so nothing is lost.
 * The result is always a contiguous run of the letter's own words.
 */
export function letterCore(statement: string, names: string[] = []): string {
  const s = statement.replace(/\s+/g, ' ').trim();
  const name = names.length > 0 ? `(?:${names.map(escapeRegExp).join('|')})` : '(?!)';
  const bullet = '[\\s\\uf0b7•]+';
  const openings: RegExp[] = [
    // "... antibody indicated as a single agent, for adjuvant treatment ..." / "Loargys is indicated for the treatment of ..."
    new RegExp(`^.*?\\bindicated${bullet}(?=(?:for|as|in|to)\\b)(?!for the following\\b)`, 'i'),
    // "... adds a new indication for the treatment of ..." / "... provides for the addition of a new indication of Keytruda, as ..."
    /^.*?\b(?:adds?|provides? for(?: the addition of)?)\s+(?:an?\s+|the\s+)?(?:following\s+)?new\s+indication(?:\s*:\s*|\s+of\s+|\s*(?=,)|\s+(?=for\b|in\b|as\b))/i,
    // "... provides for the addition of the indication of treatment of ..."
    /^.*?\bprovides? for the addition of (?:an?|the) indication of\s+/i,
    // "... provides for the new indication of the treatment of ..."
    /^.*?\bprovides? for the new indication of\s+/i,
    // "This NDA provides for the use of Zanvastro (zilganersen) injection for the treatment of ..."
    /^.*?\bprovides? for (?:the )?use of .*?\s+(?=(?:for|in|to|as an?)\b)(?!for injection\b)/i,
    // "... provides for the treatment of adult patients with ..."
    /^.*?\bprovides? for (?=(?:the )?treatment of\b)/i,
    // "... provides for modifications of the approved indication for the treatment of ..."
    /^.*?\bprovides? for modifications of the approved indication\s+(?=for\b)/i,
  ];
  for (const re of openings) {
    const m = s.match(re);
    if (!m || m[0].length >= s.length - 20) continue;
    let rest = s.slice(m[0].length).replace(/^[:,\s]+/, '');
    // "for KEYTRUDA, as a single agent, for …" / "for the use of pembrolizumab, in combination …": the drug is named above.
    rest = rest.replace(new RegExp(`^(?:for )?(?:the use of )?${name}(?:\\s*\\([^)]*\\))?,?\\s+(?=(?:as|in|for|followed)\\b)`, 'i'), '');
    // A revision restates the use, then the paperwork: "… approved on September 4, 2014, under the provisions of 21 CFR 601.70, to remove …".
    rest = rest.replace(/,?\s+approved on [A-Z][a-z]+ \d{1,2}, \d{4}, under the provisions of 21 CFR\b.*$/, '.');
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return s;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
