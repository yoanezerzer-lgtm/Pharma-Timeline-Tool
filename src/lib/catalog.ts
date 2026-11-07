import { useEffect, useState } from 'react';
import rawIndex from 'virtual:drug-index';
import rawDiseases from 'virtual:disease-index';
import { Drug } from '../schema/index.js';
import { NewsFile, sortLinks, type NewsLink } from './news.js';
import type { DrugSummary } from './summary.js';
import type { DiseaseSummary } from './diseases.js';

export const drugIndex = rawIndex as DrugSummary[];
export const diseaseIndex = rawDiseases as DiseaseSummary[];

// Not eager: each record becomes its own chunk, fetched only when a page
// needs it. The build-time index has already validated every file.
const loaders = import.meta.glob<{ default: unknown }>('../../data/drugs/*.json');
const cache = new Map<string, Promise<Drug | undefined>>();

function loadDrug(slug: string): Promise<Drug | undefined> {
  let pending = cache.get(slug);
  if (!pending) {
    const loader = loaders[`../../data/drugs/${slug}.json`];
    // Parsed rather than cast so schema defaults (e.g. an absent changeLog) are filled in.
    pending = loader ? loader().then((m) => Drug.parse(m.default)) : Promise.resolve(undefined);
    pending.catch(() => cache.delete(slug));
    cache.set(slug, pending);
  }
  return pending;
}

export type DrugState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; drug: Drug };

export function useDrug(slug: string): DrugState {
  const [state, setState] = useState<DrugState & { slug: string }>({ slug, status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadDrug(slug).then(
      (drug) => !cancelled && setState(drug ? { slug, status: 'ready', drug } : { slug, status: 'missing' }),
      () => !cancelled && setState({ slug, status: 'error' })
    );
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // A slug change renders once before the effect runs — don't show the old drug for it.
  return state.slug === slug ? state : { status: 'loading' };
}

// News links (data/news/<slug>.json), one small chunk per drug, fetched with its page.
const newsLoaders = import.meta.glob<{ default: unknown }>('../../data/news/*.json');

/** The drug's news links, newest first; an empty list when none have been found, undefined while loading. */
export function useNews(slug: string): NewsLink[] | undefined {
  const [state, setState] = useState<{ slug: string; links: NewsLink[] } | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const loader = newsLoaders[`../../data/news/${slug}.json`];
    (loader ? loader().then((m) => sortLinks(NewsFile.parse(m.default).links)) : Promise.resolve([])).then(
      (links) => !cancelled && setState({ slug, links }),
      () => !cancelled && setState({ slug, links: [] })
    );
    return () => {
      cancelled = true;
    };
  }, [slug]);
  return state?.slug === slug ? state.links : undefined;
}
