import { describe, it, expect } from 'vitest';
import { allowedSource, drugNames, isCompanySite, namesDrug, sortLinks, type NewsLink } from '../src/lib/news.js';
import { parseFeed, unwrapLink } from '../scripts/news/feeds.js';
import { cleanUrl, headlineOf, summaryOf } from '../scripts/news/cli.js';

describe('allowed sites', () => {
  it('takes newswires and Fierce, not paywalled outlets', () => {
    expect(allowedSource('https://www.prnewswire.com/news-releases/x-302.html', [])).toBe('PR Newswire');
    expect(allowedSource('https://www.businesswire.com/news/home/2025/en/', [])).toBe('Business Wire');
    expect(allowedSource('https://www.globenewswire.com/news-release/2025/01/01/1/0/en/x.html', [])).toBe('GlobeNewswire');
    expect(allowedSource('https://www.fiercepharma.com/pharma/x', [])).toBe('Fierce Pharma');
    expect(allowedSource('https://www.fiercebiotech.com/biotech/x', [])).toBe('Fierce Biotech');
    expect(allowedSource('https://www.statnews.com/2025/x', ['AbbVie Inc.'])).toBeUndefined();
    expect(allowedSource('https://www.reuters.com/x', ['AbbVie Inc.'])).toBeUndefined();
    expect(allowedSource('https://endpts.com/x', ['AbbVie Inc.'])).toBeUndefined();
  });

  it("takes the company's own site, by its first distinctive word or all of them together", () => {
    expect(allowedSource('https://news.abbvie.com/2025-x', ['AbbVie Inc.'])).toBe('abbvie.com');
    expect(isCompanySite('ir.cytokinetics.com', ['CYTOKINETICS'])).toBe(true);
    expect(isCompanySite('investor.lilly.com', ['ELI LILLY AND CO'])).toBe(true);
    expect(isCompanySite('www.novonordisk.com', ['NOVO NORDISK INC'])).toBe(true);
    expect(isCompanySite('www.merck.com', ['MSD', 'Merck Sharp & Dohme LLC'])).toBe(true);
    expect(isCompanySite('www.astrazeneca.com', ['ASTRAZENECA AB'])).toBe(true);
    expect(isCompanySite('www.takeda.com', ['TAKEDA PHARMS USA'])).toBe(true);
    // Another company, or a generic word of the name, is not the company's site.
    expect(isCompanySite('www.pfizer.com', ['AbbVie Inc.'])).toBe(false);
    expect(isCompanySite('www.sciences.com', ['GILEAD SCIENCES INC'])).toBe(false);
    expect(isCompanySite('www.pharma.com', ['VANDA PHARMS INC'])).toBe(false);
    expect(isCompanySite('www.merckgroup.com', ['Merck Sharp & Dohme LLC'])).toBe(false);
  });

  it('refuses anything that is not a web address', () => {
    expect(allowedSource('javascript:alert(1)', [])).toBeUndefined();
    expect(allowedSource('not a url', [])).toBeUndefined();
  });
});

describe('a page about the drug', () => {
  const names = drugNames('Rinvoq', 'upadacitinib');
  it("names the drug in the page's own headline or one-line summary", () => {
    expect(namesDrug({ title: 'AbbVie results', summary: 'RINVOQ® met its endpoints' }, names)).toBe(true);
    expect(namesDrug({ title: 'Upadacitinib wins in GCA', summary: '' }, names)).toBe(true);
    expect(namesDrug({ title: 'AMGEN REPORTS THIRD QUARTER 2026 FINANCIAL RESULTS', summary: 'Revenue rose' }, names)).toBe(false);
    expect(namesDrug({ title: 'Rinvoqx', summary: '' }, names)).toBe(false);
  });

  it('drops "(copackaged)" and pen names from the brand', () => {
    expect(drugNames('Lifyorli (copackaged)', 'relacorilant').brand).toBe('Lifyorli');
    expect(drugNames('Awiqli flextouch', 'insulin icodec').brand).toBe('Awiqli');
    expect(drugNames('Rybrevant faspro', 'amivantamab and hyaluronidase-lpuj (human recombinant)')).toEqual({
      brand: 'Rybrevant faspro',
      inn: 'amivantamab and hyaluronidase-lpuj',
    });
  });
});

describe('feeds', () => {
  it('reads RSS items and unwraps Bing click links', () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>x</title>
      <item><title>AbbVie&#39;s Rinvoq &amp; more</title>
        <link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=1&amp;url=https%3a%2f%2fwww.fiercepharma.com%2fpharma%2frinvoq-x&amp;c=1&amp;mkt=en-us</link>
        <description>Rinvoq summary</description></item>
      <item><title><![CDATA[GlobeNewswire release]]></title><link>https://www.globenewswire.com/news-release/2025/x.html</link></item>
    </channel></rss>`;
    const items = parseFeed(xml, 'test');
    expect(items.map((i) => i.url)).toEqual([
      'https://www.fiercepharma.com/pharma/rinvoq-x',
      'https://www.globenewswire.com/news-release/2025/x.html',
    ]);
    expect(items[0].title).toBe("AbbVie's Rinvoq & more");
  });

  it('reads Atom entries', () => {
    const xml = `<feed><entry><title>T</title><link rel="alternate" href="https://www.fiercebiotech.com/a"/></entry></feed>`;
    expect(parseFeed(xml, 'atom')[0].url).toBe('https://www.fiercebiotech.com/a');
  });

  it('leaves ordinary links alone', () => {
    expect(unwrapLink('https://news.abbvie.com/x')).toBe('https://news.abbvie.com/x');
  });
});

describe('pages', () => {
  it("takes the page's own headline without the site name", () => {
    expect(headlineOf('<meta property="og:title" content="FDA approves Rinvoq for GCA"><title>other</title>')).toBe(
      'FDA approves Rinvoq for GCA'
    );
    expect(headlineOf('<title>Lilly wins | Fierce Pharma</title>')).toBe('Lilly wins');
    // An apostrophe inside double quotes is part of the headline (PR Newswire, trial run 7 Nov).
    expect(headlineOf(`<meta property="og:title" content="Takeda's ENTYVIO Continues Growth">`)).toBe("Takeda's ENTYVIO Continues Growth");
    expect(headlineOf(`<meta content='A "quoted" word' property='og:title'>`)).toBe('A "quoted" word');
  });

  it("reads the page's own summary", () => {
    expect(summaryOf('<meta name="description" content="/PRNewswire/ -- Lilly &amp; Hims">')).toBe('/PRNewswire/ -- Lilly & Hims');
    expect(summaryOf('<meta property="og:description" content="First"><meta name="description" content="Second">')).toBe('First');
    expect(summaryOf('<p>none</p>')).toBe('');
  });

  it('drops tracking parameters but keeps the ones that pick the page', () => {
    expect(cleanUrl('https://news.x.com/a?id=12&utm_source=rss#top')).toBe('https://news.x.com/a?id=12');
  });

  it('sorts newest first, one link per address', () => {
    const l = (url: string, date: string, checkedAt = '2026-01-01'): NewsLink => ({ url, source: 's', title: url, date, checkedAt });
    const out = sortLinks([l('https://a', '2024-01-01'), l('https://b', '2025-06-01'), l('https://a', '2024-01-01', '2026-02-01')]);
    expect(out.map((x) => x.url)).toEqual(['https://b', 'https://a']);
    expect(out[1].checkedAt).toBe('2026-02-01');
  });
});
