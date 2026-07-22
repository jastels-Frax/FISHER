// Dichotomous key traversal engine. Renders one couplet at a time from a tree
// of nodes stored in data/key.json. Node shapes:
//   { id, type: "couplet", text (optional intro), options: [ { label, goTo } ] }
//   { id, type: "result", speciesId, note, lookalikeCheck: [{species, distinguishingNote}] }
//   { id, type: "uncertain" } — terminal "log as unidentified" escape node
import { escapeHtml } from './app.js';

/**
 * @param {HTMLElement} container
 * @param {{keyTree: Object, species: Array, images: Object, onResult: Function}} opts
 *   onResult receives { species: speciesObj|null, unidentified: bool }
 */
export function renderKey(container, opts) {
  const { keyTree, species, images, onResult } = opts;
  const speciesById = new Map(species.map((s) => [s.id, s]));
  const path = [keyTree.startId];

  function currentNode() {
    return keyTree.nodes[path[path.length - 1]];
  }

  function goTo(nodeId) {
    path.push(nodeId);
    render();
  }

  function goBack() {
    if (path.length > 1) path.pop();
    render();
  }

  function breadcrumbHtml() {
    if (path.length <= 1) return '';
    return `<div class="key-breadcrumb"><button type="button" data-role="back">&larr; Back one step</button> &middot; Step ${path.length}</div>`;
  }

  function render() {
    const node = currentNode();
    if (node.type === 'couplet') {
      container.innerHTML = `
        ${breadcrumbHtml()}
        <div class="key-couplet">
          ${node.text ? `<p>${escapeHtml(node.text)}</p>` : ''}
          ${node.options.map((opt, i) => `<button type="button" class="key-option" data-goto="${escapeHtml(opt.goTo)}">${String.fromCharCode(65 + i)}. ${escapeHtml(opt.label)}</button>`).join('')}
        </div>
        <button type="button" class="btn btn-outline" data-role="uncertain-anytime">Not sure &mdash; stop and mark unidentified</button>
      `;
      container.querySelectorAll('[data-goto]').forEach((btn) => btn.addEventListener('click', () => goTo(btn.getAttribute('data-goto'))));
    } else if (node.type === 'result') {
      const s = speciesById.get(node.speciesId);
      const img = images[node.speciesId] && (images[node.speciesId].adult);
      container.innerHTML = `
        ${breadcrumbHtml()}
        <div class="key-result-card card">
          ${img && img.status === 'verified' ? `<img src="${escapeHtml(img.localPath)}" alt="${escapeHtml(s ? s.commonName : '')}" style="width:100%;border-radius:10px;margin-bottom:8px">` : ''}
          <h2>${escapeHtml(s ? s.commonName : node.speciesId)}</h2>
          <p class="sci" style="font-style:italic">${escapeHtml(s ? s.scientificName : '')}</p>
          ${node.note ? `<p>${escapeHtml(node.note)}</p>` : ''}
          ${node.lookalikeCheck && node.lookalikeCheck.length ? `
            <div class="lookalike-box">
              <strong>Look-alike check &mdash; confirm before finalizing:</strong>
              <ul>${node.lookalikeCheck.map((l) => `<li><strong>${escapeHtml(l.species)}</strong>: ${escapeHtml(l.distinguishingNote)}</li>`).join('')}</ul>
            </div>` : ''}
          <button type="button" class="btn btn-accent" data-role="confirm">Confirm ID: ${escapeHtml(s ? s.commonName : node.speciesId)}</button>
          <button type="button" class="btn btn-outline" data-role="uncertain">Still not sure &mdash; mark unidentified &amp; photograph</button>
        </div>
      `;
      container.querySelector('[data-role="confirm"]').addEventListener('click', () => onResult && onResult({ species: s || null, lifeStage: node.lifeStage || null, unidentified: false }));
      container.querySelector('[data-role="uncertain"]').addEventListener('click', () => onResult && onResult({ species: null, lifeStage: null, unidentified: true }));
    } else if (node.type === 'uncertain') {
      container.innerHTML = `
        ${breadcrumbHtml()}
        <div class="card">
          <p class="flag-note">Log this catch as <strong>unidentified &mdash; see key</strong> and photograph it for later confirmation. Don't force an ID you're not confident in.</p>
          <button type="button" class="btn btn-accent" data-role="confirm">Use "unidentified &mdash; see key"</button>
        </div>
      `;
      container.querySelector('[data-role="confirm"]').addEventListener('click', () => onResult && onResult({ species: null, lifeStage: null, unidentified: true }));
    }

    const backBtn = container.querySelector('[data-role="back"]');
    if (backBtn) backBtn.addEventListener('click', goBack);
    const uncertainAnytime = container.querySelector('[data-role="uncertain-anytime"]');
    if (uncertainAnytime) uncertainAnytime.addEventListener('click', () => onResult && onResult({ species: null, lifeStage: null, unidentified: true }));
  }

  render();
  return {
    restart() { path.length = 1; path[0] = keyTree.startId; render(); },
  };
}
