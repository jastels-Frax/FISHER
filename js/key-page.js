import { initHeaderNav, showToast } from './app.js';
import { FisherDB } from './db.js';
import { renderKey } from './key-engine.js';

initHeaderNav();

async function boot() {
  const container = document.getElementById('key-root');
  const restartBtn = document.getElementById('restart-key-btn');
  try {
    await FisherDB.seedReferenceData();
  } catch (e) {
    console.warn('Could not refresh reference data, using cached copy if available', e);
  }
  const [keyTree, species, images] = await Promise.all([
    FisherDB.getKeyTree(), FisherDB.getSpeciesList(), FisherDB.getImageManifest(),
  ]);
  if (!keyTree) {
    container.innerHTML = '<p class="empty-state">The key isn\'t available yet. Connect once to download it, then it will work offline.</p>';
    return;
  }
  const key = renderKey(container, {
    keyTree, species, images,
    onResult: ({ species: s, unidentified }) => {
      showToast(unidentified ? 'Marked unidentified — remember to photograph the catch.' : `Identified: ${s.commonName}`);
    },
  });
  restartBtn.addEventListener('click', () => key.restart());
}
boot();
