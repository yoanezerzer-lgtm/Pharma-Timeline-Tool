import { useRoute } from './lib/router.js';
import { DrugIndex } from './pages/DrugIndex.js';
import { DrugPage } from './pages/DrugPage.js';

export function App() {
  const route = useRoute();
  if (route.name === 'drug') {
    return <DrugPage slug={route.slug} trialId={route.trialId} />;
  }
  return <DrugIndex />;
}
