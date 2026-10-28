import { useEffect, useState } from 'react';
import { z } from 'zod';

/**
 * Pivotal-trial facts confirmed against FDA documents (data/reference), so a
 * page can show which trials are verified and the sentence that confirms
 * each. Only what the site displays is parsed; scripts/qc/reference.ts owns
 * the full schema.
 */
const Evidence = z.object({ sourceUrl: z.string(), quote: z.string(), page: z.number().optional() });
const Pivotal = z.object({
  indication: z.string(),
  trial: z.string(),
  pivotal: z.boolean(),
  status: z.enum(['confirmed', 'baseline']),
  checkedBy: z.string().optional(),
  evidence: z.array(Evidence).optional(),
});
const ReferenceFile = z.object({ pivotal: z.array(Pivotal).default([]) });
export type Confirmation = z.infer<typeof Pivotal>;

const loaders = import.meta.glob<{ default: unknown }>('../../data/reference/*.json');
const cache = new Map<string, Promise<Confirmation[]>>();

function loadConfirmations(slug: string): Promise<Confirmation[]> {
  let pending = cache.get(slug);
  if (!pending) {
    const loader = loaders[`../../data/reference/${slug}.json`];
    pending = loader
      ? loader().then((m) => ReferenceFile.parse(m.default).pivotal.filter((p) => p.status === 'confirmed' && p.pivotal))
      : Promise.resolve([]);
    pending.catch(() => cache.delete(slug));
    cache.set(slug, pending);
  }
  return pending;
}

/** Confirmed pivotal facts for a drug, keyed `${indication}|${trial}` (trial = NCT number, else id). */
export function useConfirmations(slug: string | undefined): Map<string, Confirmation> {
  const [map, setMap] = useState<Map<string, Confirmation>>(new Map());
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    loadConfirmations(slug).then(
      (list) => !cancelled && setMap(new Map(list.map((c) => [`${c.indication}|${c.trial}`, c]))),
      () => !cancelled && setMap(new Map())
    );
    return () => {
      cancelled = true;
    };
  }, [slug]);
  return map;
}
