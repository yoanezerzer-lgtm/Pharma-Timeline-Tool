import { describe, expect, it } from 'vitest';
import { parseSnapshot, snapshotSlugs } from '../scripts/ingest/snapshot.js';

describe('Drug Trials Snapshot', () => {
  it('names the page after the brand', () => {
    expect(snapshotSlugs('Rybrevant faspro')).toEqual(['rybrevant-faspro', 'rybrevant']);
    expect(snapshotSlugs('Myqorzo')).toEqual(['myqorzo']);
  });
  it('reads question headings and their paragraphs, leaving tables and navigation out', () => {
    const html = `<nav><a>Home</a></nav><main>
      <h2>MYQORZO (aficamten)</h2>
      <p><strong>What is the drug for?</strong></p>
      <p>MYQORZO is a cardiac myosin inhibitor used for treatment of adults with symptomatic obstructive hypertrophic cardiomyopathy (oHCM).</p>
      <h3>How is this drug used?</h3><p>MYQORZO is a capsule taken by mouth once daily.</p>
      <table><tr><td>Hispanic 9 (3%)</td></tr></table>
      <h3>What are the possible side effects?</h3><ul><li>high blood pressure</li></ul>
    </main>`;
    expect(parseSnapshot(html)).toEqual([
      {
        heading: 'What is the drug for?',
        paragraphs: ['MYQORZO is a cardiac myosin inhibitor used for treatment of adults with symptomatic obstructive hypertrophic cardiomyopathy (oHCM).'],
      },
      { heading: 'How is this drug used?', paragraphs: ['MYQORZO is a capsule taken by mouth once daily.'] },
      { heading: 'What are the possible side effects?', paragraphs: ['• high blood pressure'] },
    ]);
  });
});
