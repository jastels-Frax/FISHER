// Inline "Identify" modal: opens the filterable species list or dichotomous key
// as an overlay on top of the in-progress catalogue form, without navigating away
// (so length/weight/notes already entered are untouched). Selecting a species
// (or backing out via "uncertain") calls onConfirm and closes the modal.
import { renderSpeciesBrowser } from './species-list.js';
import { renderKey } from './key-engine.js';

let overlayEl = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.className = 'modal-overlay';
  overlayEl.hidden = true;
  overlayEl.innerHTML = `
    <div class="modal-panel" role="dialog" aria-modal="true" aria-label="Identify species">
      <div class="modal-panel-header">
        <h2>Identify</h2>
        <button type="button" class="modal-close" data-role="close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-tabs">
        <button type="button" data-tab="list" class="active">Species List</button>
        <button type="button" data-tab="key">Dichotomous Key</button>
      </div>
      <div class="modal-panel-body" data-role="body"></div>
    </div>
  `;
  document.body.appendChild(overlayEl);
  return overlayEl;
}

/**
 * @param {{species: Array, images: Object, keyTree: Object, onConfirm: Function}} opts
 *   onConfirm receives { species: speciesObj|null, lifeStage: string|null, unidentified: bool }
 */
export function openIdentifyModal(opts) {
  const { species, images, keyTree, onConfirm } = opts;
  const overlay = ensureOverlay();
  const body = overlay.querySelector('[data-role="body"]');
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';

  function close() {
    overlay.hidden = true;
    document.body.style.overflow = '';
  }

  function handlePick(result) {
    close();
    onConfirm && onConfirm(result);
  }

  function showList() {
    overlay.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === 'list'));
    renderSpeciesBrowser(body, { species, images, mode: 'select', onSelect: handlePick });
  }
  function showKey() {
    overlay.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === 'key'));
    if (!keyTree) {
      body.innerHTML = '<p class="empty-state">Key data not available offline yet.</p>';
      return;
    }
    renderKey(body, { keyTree, species, images, onResult: handlePick });
  }

  overlay.querySelector('[data-role="close"]').onclick = () => handlePick({ species: null, lifeStage: null, unidentified: true, backedOut: true });
  overlay.querySelector('[data-tab="list"]').onclick = showList;
  overlay.querySelector('[data-tab="key"]').onclick = showKey;

  showList();
}
