import { drugs } from '../lib/drugs.js';
import { drugHref } from '../lib/router.js';
import { formatDate } from '../lib/dates.js';
import './DrugIndex.css';

export function DrugIndex() {
  return (
    <main className="index">
      <header className="index__head">
        <h1>Drug Development Timelines</h1>
        <p className="index__lede">
          How medicines actually got approved — every clinical trial behind a marketing
          application, traced from the FDA approval package and plotted from phase 1 to
          approval.
        </p>
      </header>

      <div className="index__grid">
        {drugs.map((d) => {
          const pivotal = d.trials.filter((t) => t.role === 'PIVOTAL').length;
          const approval = d.regulatory.us.originalApprovalDate;
          return (
            <a key={d.slug} className="tile" href={drugHref(d.slug)}>
              <div className="tile__head">
                <h2 className="tile__name">{d.brandName}</h2>
                <span className="tile__year">
                  {approval ? approval.value.slice(0, 4) : '—'}
                </span>
              </div>
              <div className="tile__inn">{d.inn}</div>
              <p className="tile__mechanism">{d.mechanism ?? d.modality}</p>
              <dl className="tile__stats">
                <div>
                  <dt>Trials</dt>
                  <dd>{d.trials.length}</dd>
                </div>
                <div>
                  <dt>Pivotal</dt>
                  <dd>{pivotal}</dd>
                </div>
                <div>
                  <dt>Approved</dt>
                  <dd>{formatDate(approval)}</dd>
                </div>
              </dl>
              <div className="tile__foot">
                <span className="tile__sponsor">{d.sponsor}</span>
                <span className="tile__app">
                  {d.regulatory.us.applicationType} {d.regulatory.us.applicationNumber}
                </span>
              </div>
            </a>
          );
        })}
      </div>

      <footer className="index__foot">
        <p>
          Built from public sources: openFDA Drugs@FDA, FDA approval packages, and
          ClinicalTrials.gov. No data is generated or inferred by a language model —
          structured fields come from the registries and approval documents, and narrative
          fields are written by hand.
        </p>
      </footer>
    </main>
  );
}
