import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { mergeSources, type CiteSource } from '../../lib/citations.js';
import './Citations.css';

interface Registry {
  number: (s: CiteSource) => number;
  open: (s: CiteSource, from: HTMLElement) => void;
  get: (id: string) => { n: number; source: CiteSource } | undefined;
}

const Ctx = createContext<Registry | null>(null);

/**
 * Numbers the sources cited on a page (first cited, first numbered; one
 * document keeps one number) and holds the source panel. Keyed by the page
 * address in App, so each page starts again at [1].
 */
export function CitationProvider({ children }: { children: ReactNode }) {
  const map = useRef(new Map<string, { n: number; source: CiteSource }>());
  const [open, setOpen] = useState<CiteSource | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const number = useCallback((s: CiteSource) => {
    let e = map.current.get(s.id);
    if (!e) {
      e = { n: map.current.size + 1, source: s };
      map.current.set(s.id, e);
    } else if (e.source !== s) {
      e.source = mergeSources(e.source, s);
    }
    return e.n;
  }, []);
  const show = useCallback((s: CiteSource, from: HTMLElement) => {
    opener.current = from;
    setOpen(s);
  }, []);
  const get = useCallback((id: string) => map.current.get(id), []);
  const close = useCallback(() => {
    setOpen(null);
    opener.current?.focus();
  }, []);

  // Split view on wide screens: the page narrows to make room for the panel.
  useEffect(() => {
    document.documentElement.classList.toggle('sources-open', !!open);
    return () => document.documentElement.classList.remove('sources-open');
  }, [open]);

  return (
    <Ctx.Provider value={{ number, open: show, get }}>
      {children}
      {open && <SourcePanel source={open} onClose={close} onPick={(s) => setOpen(s)} />}
    </Ctx.Provider>
  );
}

/**
 * Boxed citation numbers sitting on a claim, grouped: [3][7]. Each opens the
 * source panel on its source. Renders nothing outside a CitationProvider.
 */
export function Cite({ sources }: { sources: (CiteSource | undefined)[] }) {
  const reg = useContext(Ctx);
  if (!reg) return null;
  const unique = [...new Map(sources.filter((s): s is CiteSource => !!s).map((s) => [s.id, s])).values()];
  if (unique.length === 0) return null;
  const numbered = unique.map((s) => ({ s, n: reg.number(s) })).sort((a, b) => a.n - b.n);
  return (
    <span className="cite-group">
      {numbered.map(({ s, n }) => (
        <button
          key={s.id}
          type="button"
          className="cite"
          data-source={s.id}
          aria-label={`Source ${n}: ${s.title}`}
          title={s.title}
          onClick={(e) => reg.open(s, e.currentTarget)}
        >
          {n}
        </button>
      ))}
    </span>
  );
}

function SourcePanel({ source: picked, onClose, onPick }: { source: CiteSource; onClose: () => void; onPick: (s: CiteSource) => void }) {
  const reg = useContext(Ctx)!;
  // Everything the page cites from this document, not only what this chip passed.
  const source = reg.get(picked.id)?.source ?? picked;
  const heading = useRef<HTMLHeadingElement>(null);
  const [all, setAll] = useState<{ n: number; source: CiteSource }[]>([]);
  const n = reg.get(source.id)?.n;

  // "Sources (N)": every source cited on the page as it is now, read from
  // the chips in the document, so a section that is hidden doesn't count.
  useLayoutEffect(() => {
    const ids = new Set([...document.querySelectorAll<HTMLElement>('.cite[data-source]')].map((el) => el.dataset.source!));
    setAll([...ids].flatMap((id) => reg.get(id) ?? []).sort((a, b) => a.n - b.n));
  }, [source, reg]);

  useEffect(() => {
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source, onClose]);

  return (
    <aside className="sources" aria-labelledby="sources-title">
      <div className="sources__bar">
        <span className="sources__kicker">Source</span>
        <button type="button" className="sources__close" onClick={onClose} aria-label="Close the source panel">
          ×
        </button>
      </div>
      <div className="sources__body">
        <h2 id="sources-title" ref={heading} tabIndex={-1}>
          {n !== undefined && <span className="cite cite--static">{n}</span>} {source.title}
        </h2>
        <dl className="sources__meta">
          <dt>Agency</dt>
          <dd>{source.agency}</dd>
          <dt>Document</dt>
          <dd>{source.docType}</dd>
          {source.date && (
            <>
              <dt>Date</dt>
              <dd className="sources__mono">{source.date}</dd>
            </>
          )}
        </dl>
        <a className="sources__link" href={source.url} target="_blank" rel="noopener noreferrer">
          Open the original ↗
        </a>
        {source.excerpt && (
          <blockquote className="sources__excerpt">
            {source.excerpt.split('\n\n').map((t, k) => (
              <p key={k}>{t}</p>
            ))}
          </blockquote>
        )}
        {source.fields && source.fields.length > 0 && (
          <dl className="sources__fields">
            {source.fields.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <h3 className="sources__all-head">Sources ({all.length})</h3>
        <ol className="sources__all">
          {all.map((e) => (
            <li key={e.source.id}>
              <button type="button" aria-current={e.source.id === source.id ? 'true' : undefined} onClick={() => onPick(e.source)}>
                <span className="cite cite--static">{e.n}</span>
                <span>
                  {e.source.title}
                  <span className="sources__sub">
                    {e.source.docType}
                    {e.source.date && ` · ${e.source.date}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
