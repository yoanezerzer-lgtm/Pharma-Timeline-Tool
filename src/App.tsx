import { useRoute } from './lib/router.js';
import { DrugIndex } from './pages/DrugIndex.js';
import { IndicationPage } from './pages/IndicationPage.js';
import { ReviewPage } from './pages/ReviewPage.js';

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
  if (route.name === 'review') return <ReviewPage />;
  if (route.name === 'review-drug') return <ReviewPage slug={route.slug} />;
  return <DrugIndex />;
}
