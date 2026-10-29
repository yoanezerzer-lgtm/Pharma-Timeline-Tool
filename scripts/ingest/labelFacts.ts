import type { NamedFact } from '../../src/schema/index.js';
import { sameCompany } from '../../src/lib/company.js';
import { stripPageMarkers } from './docs.js';

/**
 * Two facts the site lists drugs by, each read from the FDA's own documents
 * and quoted: the FDA office that reviews the drug (from the signature of an
 * approval letter) and the company named on the label.
 */

interface Doc {
  url: string;
  submission: string;
  text: string;
}

/** "ORIG-1" before "SUPPL-3" before "SUPPL-40". */
function submissionOrder(submission: string): number {
  const m = submission.match(/SUPPL-(\d+)/i);
  return m ? Number(m[1]) : 0;
}

const newestFirst = <T extends Doc>(docs: T[]): T[] =>
  [...docs].sort((a, b) => submissionOrder(b.submission) - submissionOrder(a.submission));

const flat = (text: string) =>
  stripPageMarkers(text)
    .replace(/Reference ID:\s*\d+/g, ' ')
    .replace(/\s+/g, ' ');

/**
 * The clinical office that signed the letter: "Division of Gastroenterology
 * Office of Immunology and Inflammation Office of New Drugs Center for Drug
 * Evaluation and Research" gives "Office of Immunology and Inflammation".
 * Signed above the office level ("Office of New Drugs" alone, or a Center
 * deputy director) names none.
 */
export function signingOffice(text: string): { office: string; quote: string } | undefined {
  const pattern =
    /(?:Division of (?:(?!Division of|Office of)[A-Za-z,&\- ])+?\s+)?(Office of (?:(?!Office of|Center for)[A-Za-z0-9,&\- ])+?)\s+(?:Office of New Drugs?\s+)?Center for Drug Evaluation and Research/g;
  let found: { office: string; quote: string } | undefined;
  for (const m of flat(text).matchAll(pattern)) {
    const office = m[1].trim().replace(/,$/, '');
    if (/^Office of New Drugs?$/i.test(office)) continue;
    found = { office, quote: m[0].trim() };
  }
  return found;
}

/** The office on the newest approval letter that names one: the office that reviews the drug now. */
export function reviewOffice(letters: Doc[]): NamedFact | undefined {
  for (const letter of newestFirst(letters)) {
    const found = signingOffice(letter.text);
    if (found) {
      return {
        name: found.office,
        provenance: {
          sourceUrl: letter.url,
          sourceLabel: `Approval letter (${letter.submission}), signature`,
          quote: found.quote,
          extractedBy: 'regex',
          verified: false,
        },
      };
    }
  }
  return undefined;
}

// Ends at the company's legal suffix, so the address after it is left out.
// A name printed without one ("GlaxoSmithKline Durham, NC") can't be told
// apart from its city, so it isn't read.
const COMPANY_LINE =
  /\b(Marketed|Distributed|Manufactured)(?: and distributed)? (by|By|for|For)\s*:?\s*((?:(?!Marketed|Distributed|Manufactured)(?:[A-Z][\w&'.-]*,?|&|and) ){0,6}?(?:Inc\.?|Incorporated|LLC|L\.P\.|LP|Corporation|Corp\.?|Company|Ltd\.?|Limited|AB|A\/S|AG|GmbH|plc|S\.A\.|N\.V\.|B\.V\.))(?![\w])/g;

const ROLE_ORDER = ['Marketed by', 'Distributed by', 'Manufactured for', 'Manufactured by'];

/**
 * The company the newest label names, as printed ("Manufactured for: Merck
 * Sharp & Dohme LLC"), when it is the applicant FDA records for the
 * application. A label naming only a contract manufacturer or a partner
 * company gives nothing, rather than a name that isn't the applicant's.
 */
export function labelCompany(labels: Doc[], applicant: string | undefined): NamedFact | undefined {
  if (!applicant) return undefined;
  const [label] = newestFirst(labels);
  if (!label) return undefined;
  const candidates = [...flat(label.text).matchAll(COMPANY_LINE)]
    .map((m) => ({
      role: `${m[1]} ${m[2].toLowerCase()}`,
      name: m[3].replace(/\s+,/g, ',').trim(),
      quote: m[0].trim(),
    }))
    .filter((c) => sameCompany(c.name, applicant));
  candidates.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const best = candidates[0];
  if (!best) return undefined;
  return {
    name: best.name,
    provenance: {
      sourceUrl: label.url,
      sourceLabel: `Label (${label.submission})`,
      quote: best.quote,
      extractedBy: 'regex',
      verified: false,
    },
  };
}
