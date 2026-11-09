import type { Provenance, Trial } from '../../schema/index.js';
import { ROLE_LABEL } from '../../lib/drugs.js';

/** How each link was made, in plain words. */
const METHOD: Record<Provenance['extractedBy'], string> = {
  api: 'read from the source’s data feed',
  regex: 'found in the document’s text',
  rule: 'matched by a written rule',
  seed: 'entered by hand before the first data run',
  human: 'entered by a person',
};

interface Card {
  /** Colour band at the card's head, one per kind of source. */
  kind: 'fda' | 'doc' | 'registry';
  source: string;
  rows: [string, string | undefined][];
  link?: string;
  quote?: string;
  page?: number;
}

/**
 * The three records that tie a trial to an approval, drawn as linked cards:
 * the FDA approval, the document that names the trial, and the registry
 * record. Each line between them says how the two were joined. Built only
 * from stored provenance; a card with nothing stored is left out.
 */
export function SourceTrail({ trial, indication }: { trial: Trial; indication?: string }) {
  const role = indication
    ? trial.roles.find((r) => r.indication === indication)
    : trial.roles.find((r) => r.approval) ?? trial.roles[0];
  if (!role) return null;

  const cards: { card: Card; join?: string }[] = [];
  if (role.approval) {
    const a = role.approval.provenance;
    cards.push({
      card: {
        kind: 'fda',
        source: a.sourceLabel?.split(':')[0] ?? 'FDA approval',
        rows: [['Submission', role.approval.submission]],
        link: a.sourceUrl,
        quote: a.quote,
        page: a.page,
      },
    });
  }
  const r = role.provenance;
  cards.push({
    card: {
      kind: 'doc',
      source: r.sourceLabel?.split(' (')[0] ?? 'Document naming the trial',
      rows: [
        ['Trial named as', trial.labelName ?? trial.protocolNumber ?? trial.nctId],
        ['Role', ROLE_LABEL[role.role]],
      ],
      link: r.sourceUrl,
      quote: r.extractedBy === 'rule' ? undefined : r.quote,
      page: r.page,
    },
    join: role.approval ? 'Same approval' : undefined,
  });
  if (trial.nctId) {
    cards.push({
      card: {
        kind: 'registry',
        source: 'ClinicalTrials.gov',
        rows: [
          ['Registry ID', trial.nctId],
          ['Sponsor’s ID', trial.protocolNumber],
          ['Name', trial.acronym],
        ],
        link: `https://clinicaltrials.gov/study/${trial.nctId}`,
      },
      join: `Same trial · ${METHOD[r.extractedBy]}`,
    });
  }

  return (
    <section className="drawer__section" aria-labelledby="trail-head">
      <h3 id="trail-head">
        Sources
      </h3>
      <dl className="trail">
        {cards.map(({ card }) => (
          <div key={card.kind} className="trail__row">
            <dt>{TRAIL_ROW[card.kind]}</dt>
            <dd>
              {card.link ? (
                <a href={card.link} target="_blank" rel="noopener noreferrer">
                  {card.source}
                  {card.page ? `, page ${card.page}` : ''} ↗
                </a>
              ) : (
                card.source
              )}
              {card.quote && <q className="trail__quote">{card.quote}</q>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** What each source is to the trial, in a word or two. */
const TRAIL_ROW: Record<Card['kind'], string> = {
  fda: 'Approval',
  doc: 'Named in',
  registry: 'Registry record',
};
