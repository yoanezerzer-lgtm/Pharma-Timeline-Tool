import { useEffect } from 'react';
import { applyMeta, type PageMeta } from './pageMeta.js';

/** The open page's title and description, the same as its built HTML file has. */
export function usePageMeta(meta: PageMeta): void {
  useEffect(() => applyMeta(meta), [meta.title, meta.description]);
}
