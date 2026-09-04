import { useRoute } from './lib/router.js';
import { DrugIndex } from './pages/DrugIndex.js';
import { IndicationPage } from './pages/IndicationPage.js';

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
  return <DrugIndex />;
}
