import { lazy, Suspense } from 'react';
import { useRoute } from './lib/router.js';
import { DrugIndex } from './pages/DrugIndex.js';
import { IndicationPage } from './pages/IndicationPage.js';

// Tooling pages most visitors never open — split out of the main bundle.
const ReviewPage = lazy(() => import('./pages/ReviewPage.js').then((m) => ({ default: m.ReviewPage })));
const IngestPage = lazy(() => import('./pages/IngestPage.js').then((m) => ({ default: m.IngestPage })));

export function App() {
  const route = useRoute();
  if (route.name === 'indication') {
    return (
      <IndicationPage
        slug={route.slug}
        indicationSlug={route.indicationSlug}
        trialId={route.trialId}
      />
    );
  }
  if (route.name === 'index') return <DrugIndex />;
  return (
    <Suspense fallback={null}>
      {route.name === 'ingest' ? <IngestPage /> : <ReviewPage slug={route.name === 'review-drug' ? route.slug : undefined} />}
    </Suspense>
  );
}
