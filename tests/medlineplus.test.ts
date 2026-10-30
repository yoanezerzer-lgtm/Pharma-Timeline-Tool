import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { medlinePlusTopic, parseResults, summaryParagraphs } from '../scripts/ingest/medlineplus.js';
import { makeContext } from '../scripts/ingest/context.js';

// The shape of a wsearch.nlm.nih.gov healthTopics response: content values
// are escaped HTML, with search terms wrapped in highlight spans.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<nlmSearchResult><term>Arthritis, Rheumatoid</term><count>2</count>
<list num="2" start="0" per="5">
<document rank="0" url="https://medlineplus.gov/rheumatoidarthritis.html">
<content name="title">&lt;span class="qt0"&gt;Rheumatoid&lt;/span&gt; &lt;span class="qt1"&gt;Arthritis&lt;/span&gt;</content>
<content name="altTitle">RA</content>
<content name="FullSummary">&lt;h3&gt;What is rheumatoid arthritis?&lt;/h3&gt;&lt;p&gt;Rheumatoid arthritis (RA) is a type of arthritis that causes pain, swelling, and stiffness in your joints.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Fatigue&lt;/li&gt;&lt;li&gt;Fever&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;No one knows what causes RA.&lt;/p&gt;</content>
</document>
<document rank="1" url="https://medlineplus.gov/dwarfism.html">
<content name="title">Dwarfism</content>
<content name="altTitle">Achondroplasia</content>
<content name="mesh">Achondroplasia</content>
<content name="FullSummary">&lt;p&gt;People with dwarfism have short stature.&lt;/p&gt;</content>
</document>
<document rank="2" url="https://medlineplus.gov/arthritis.html">
<content name="title">&lt;span class="qt1"&gt;Arthritis&lt;/span&gt;</content>
<content name="FullSummary">&lt;p&gt;Arthritis means inflammation or swelling of one or more joints.&lt;/p&gt;</content>
</document>
</list></nlmSearchResult>`;

describe('MedlinePlus summaries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads each topic, without the search highlights', () => {
    const [ra, , arthritis] = parseResults(XML);
    expect(ra).toMatchObject({ title: 'Rheumatoid Arthritis', names: ['Rheumatoid Arthritis', 'RA'], url: 'https://medlineplus.gov/rheumatoidarthritis.html' });
    expect(arthritis.title).toBe('Arthritis');
  });

  it('keeps the summary word for word, as paragraphs and list items', () => {
    expect(summaryParagraphs(parseResults(XML)[0].summary)).toEqual([
      'What is rheumatoid arthritis?',
      'Rheumatoid arthritis (RA) is a type of arthritis that causes pain, swelling, and stiffness in your joints.',
      '• Fatigue',
      '• Fever',
      'No one knows what causes RA.',
    ]);
  });

  async function topic(term: string) {
    vi.stubGlobal('fetch', async () => new Response(XML, { status: 200 }));
    return medlinePlusTopic(makeContext('t', { rawDir: mkdtempSync(join(tmpdir(), 'mlp-')) }), term);
  }

  it('takes a topic only when it is the same disease as the MeSH term', async () => {
    expect((await topic('Arthritis, Rheumatoid'))?.title).toBe('Rheumatoid Arthritis');
    expect((await topic('Arthritis'))?.title).toBe('Arthritis');
    expect(await topic('Arthritis, Psoriatic')).toBeUndefined();
    // Lists Achondroplasia as another name and as a MeSH heading, but is about dwarfism in general.
    expect(await topic('RA')).toBeUndefined();
    expect(await topic('Achondroplasia')).toBeUndefined();
  });
});
