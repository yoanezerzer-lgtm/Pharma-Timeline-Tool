import { lazy, Suspense } from 'react';
import { useRoute } from './lib/router.js';
import { DrugIndex } from './pages/DrugIndex.js';
import { IndicationPage } from './pages/IndicationPage.js';
import { DrugPage } from './pages/DrugPage.js';
import { DiseasePage, DiseasesPage } from './pages/DiseasePage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';

// Tooling pages most visitors never open — split out of the main bundle.
const ReviewPage = lazy(() => import('./pages/ReviewPage.js').then((m) => ({ default: m.ReviewPage })));
const ComparePage = lazy(() => import('./pages/ComparePage.js').then((m) => ({ default: m.ComparePage })));
const IngestPage = lazy(() => import('./pages/IngestPage.js').then((m) => ({ default: m.IngestPage })));

export function App() {
  const route = useRoute();
  if (route.name === 'drug') return <DrugPage slug={route.slug} />;
  if (route.name === 'diseases') return <DiseasesPage />;
  if (route.name === 'disease') return <DiseasePage meshId={route.meshId} />;
  if (route.name === 'indication') {
    return (
      <IndicationPage
        slug={route.slug}
        indicationSlug={route.indicationSlug}
        trialId={route.trialId}
      />
    );
  }
  // Keyed by the query so opening a different filtered link ("/?area=oncology")
  // while already on the page starts from that link's filters. Typing in the
  // filters uses replaceState, which doesn't re-render App, so no remount then.
  if (route.name === 'index') return <DrugIndex key={window.location.search} />;
  if (route.name === 'not-found') return <NotFoundPage />;
  if (route.name === 'compare') {
    return (
      <Suspense fallback={null}>
        <ComparePage />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={null}>
      {route.name === 'ingest' ? <IngestPage /> : <ReviewPage slug={route.name === 'review-drug' ? route.slug : undefined} />}
    </Suspense>
  );
}
