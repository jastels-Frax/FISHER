import { initHeaderNav } from './app.js';
import { FisherDB } from './db.js';
import { renderSpeciesBrowser } from './species-list.js';

initHeaderNav();

async function boot() {
  const container = document.getElementById('species-root');
  try {
    await FisherDB.seedReferenceData();
  } catch (e) {
    console.warn('Could not refresh reference data, using cached copy if available', e);
  }
  const [species, images] = await Promise.all([FisherDB.getSpeciesList(), FisherDB.getImageManifest()]);
  if (!species.length) {
    container.innerHTML = '<p class="empty-state">Species reference data isn\'t available yet. Connect once to download it, then it will work offline.</p>';
    return;
  }
  renderSpeciesBrowser(container, { species, images, mode: 'browse' });
}
boot();
