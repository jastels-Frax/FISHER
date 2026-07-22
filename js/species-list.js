// Filterable species reference list + detail view. Reusable inside species.html
// (standalone browse) and inside the Identify modal (selection mode).
import { escapeHtml } from './app.js';

const STAGE_ORDER = ['egg', 'elver', 'fry', 'parr', 'juvenile', 'adult'];

function stageLabel(stage) {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

function nativeBadge(status) {
  const cls = status === 'native' ? 'native' : (status === 'unknown' ? '' : 'non-native');
  return `<span class="badge ${cls}">${escapeHtml(status || 'unknown')}</span>`;
}

function habitatBadgeLabel(type) {
  const map = {
    freshwater: 'Freshwater', anadromous: 'Anadromous', catadromous: 'Catadromous',
    estuarine: 'Estuarine', 'marine-visitor': 'Marine visitor',
  };
  return map[type] || type;
}

function findImage(images, speciesId, stage) {
  const entry = images[speciesId];
  if (!entry) return null;
  return entry[stage] || entry.adult || null;
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

/**
 * @param {HTMLElement} container
 * @param {{species: Array, images: Object, mode: 'browse'|'select', onSelect?: Function}} opts
 */
export function renderSpeciesBrowser(container, opts) {
  const { species, images, mode = 'browse', onSelect } = opts;
  const state = { search: '', region: '', native: '', habitat: '', stage: '', lookalikeGroup: '', detailId: null, detailStage: 'adult' };

  const regions = uniqueSorted(species.flatMap((s) => s.regions || []));
  const habitats = uniqueSorted(species.map((s) => s.habitatType));
  const stages = STAGE_ORDER.filter((st) => species.some((s) => s.lifeStages && s.lifeStages[st]));
  const groups = uniqueSorted(species.map((s) => s.lookalikeGroup));

  function matches(s) {
    if (state.search) {
      const q = state.search.toLowerCase();
      if (!(s.commonName.toLowerCase().includes(q) || s.scientificName.toLowerCase().includes(q))) return false;
    }
    if (state.region && !(s.regions || []).includes(state.region)) return false;
    if (state.native) {
      const isNative = s.nativeStatus === 'native';
      if (state.native === 'native' && !isNative) return false;
      if (state.native === 'non-native' && isNative) return false;
    }
    if (state.habitat && s.habitatType !== state.habitat) return false;
    if (state.stage && !(s.lifeStages && s.lifeStages[state.stage])) return false;
    if (state.lookalikeGroup && s.lookalikeGroup !== state.lookalikeGroup) return false;
    return true;
  }

  function renderList() {
    const filtered = species.filter(matches).sort((a, b) => a.commonName.localeCompare(b.commonName));
    const opt = (v, label) => `<option value="${escapeHtml(v)}">${escapeHtml(label)}</option>`;
    container.innerHTML = `
      <input type="search" class="search-box" placeholder="Search common or scientific name" value="${escapeHtml(state.search)}" data-role="search">
      <div class="filter-bar">
        <select data-role="region"><option value="">All regions</option>${regions.map((r) => opt(r, r)).join('')}</select>
        <select data-role="native"><option value="">Native + non-native</option><option value="native">Native only</option><option value="non-native">Non-native only</option></select>
        <select data-role="habitat"><option value="">Any habitat type</option>${habitats.map((h) => opt(h, habitatBadgeLabel(h))).join('')}</select>
        <select data-role="stage"><option value="">Any life stage</option>${stages.map((s) => opt(s, stageLabel(s))).join('')}</select>
        <select data-role="lookalike"><option value="">Any look-alike group</option>${groups.map((g) => opt(g, g)).join('')}</select>
      </div>
      <p class="field-hint">${filtered.length} of ${species.length} species</p>
      <div data-role="results">
        ${filtered.length ? filtered.map((s) => cardHtml(s)).join('') : '<p class="empty-state">No species match these filters.</p>'}
      </div>
    `;

    container.querySelector('[data-role="search"]').addEventListener('input', (e) => { state.search = e.target.value; renderList(); });
    container.querySelector('[data-role="region"]').value = state.region;
    container.querySelector('[data-role="region"]').addEventListener('change', (e) => { state.region = e.target.value; renderList(); });
    container.querySelector('[data-role="native"]').value = state.native;
    container.querySelector('[data-role="native"]').addEventListener('change', (e) => { state.native = e.target.value; renderList(); });
    container.querySelector('[data-role="habitat"]').value = state.habitat;
    container.querySelector('[data-role="habitat"]').addEventListener('change', (e) => { state.habitat = e.target.value; renderList(); });
    container.querySelector('[data-role="stage"]').value = state.stage;
    container.querySelector('[data-role="stage"]').addEventListener('change', (e) => { state.stage = e.target.value; renderList(); });
    container.querySelector('[data-role="lookalike"]').value = state.lookalikeGroup;
    container.querySelector('[data-role="lookalike"]').addEventListener('change', (e) => { state.lookalikeGroup = e.target.value; renderList(); });

    container.querySelectorAll('[data-species-id]').forEach((card) => {
      card.addEventListener('click', () => { state.detailId = card.getAttribute('data-species-id'); state.detailStage = 'adult'; renderDetail(); });
    });
  }

  function cardHtml(s) {
    const img = findImage(images, s.id, 'adult');
    const thumb = img && img.status === 'verified'
      ? `<img src="${escapeHtml(img.localPath)}" alt="${escapeHtml(s.commonName)}" loading="lazy">`
      : '🐟';
    return `
      <button type="button" class="species-card" data-species-id="${escapeHtml(s.id)}">
        <span class="species-thumb">${thumb}</span>
        <span class="names">
          <span class="common">${escapeHtml(s.commonName)}</span><br>
          <span class="sci">${escapeHtml(s.scientificName)}</span>
          <div class="badge-row">
            ${nativeBadge(s.nativeStatus)}
            <span class="badge">${escapeHtml(habitatBadgeLabel(s.habitatType))}</span>
            ${s.sRank ? `<span class="badge srank">${escapeHtml(s.sRank)}</span>` : ''}
          </div>
        </span>
      </button>
    `;
  }

  function renderDetail() {
    const s = species.find((sp) => sp.id === state.detailId);
    if (!s) { renderList(); return; }
    const availableStages = STAGE_ORDER.filter((st) => s.lifeStages && s.lifeStages[st]);
    if (!availableStages.includes(state.detailStage)) state.detailStage = availableStages[availableStages.length - 1] || 'adult';
    const stageData = (s.lifeStages && s.lifeStages[state.detailStage]) || {};
    const img = findImage(images, s.id, state.detailStage);

    container.innerHTML = `
      <button type="button" class="btn btn-outline btn-sm" data-role="back">&larr; Back to list</button>
      <h2 style="margin-top:10px">${escapeHtml(s.commonName)}</h2>
      <p class="sci" style="font-style:italic;margin:0 0 8px">${escapeHtml(s.scientificName)}</p>
      <div class="badge-row" style="margin-bottom:10px">
        ${nativeBadge(s.nativeStatus)}
        <span class="badge">${escapeHtml(habitatBadgeLabel(s.habitatType))}</span>
        ${s.sRank ? `<span class="badge srank">S-rank: ${escapeHtml(s.sRank)}</span>` : ''}
      </div>

      <div class="stage-tabs">
        ${availableStages.map((st) => `<button type="button" data-stage="${st}" class="${st === state.detailStage ? 'active' : ''}">${stageLabel(st)}</button>`).join('')}
      </div>

      ${img && img.status === 'verified'
        ? `<img src="${escapeHtml(img.localPath)}" alt="${escapeHtml(s.commonName)} (${state.detailStage})" style="width:100%;border-radius:10px" loading="lazy">
           <p class="img-credit">${escapeHtml(img.credit || '')}</p>`
        : `<div class="placeholder-img">No open-licensed image available yet for this life stage.<br>${img && img.candidateNote ? escapeHtml(img.candidateNote) : ''}</div>`
      }

      <h3>Diagnostic characters &mdash; ${stageLabel(state.detailStage)}</h3>
      <p>${escapeHtml(stageData.diagnostics || 'Not documented for this life stage.')}</p>
      ${stageData.sizeRange ? `<p class="field-hint">Typical size: ${escapeHtml(stageData.sizeRange)}</p>` : ''}
      ${stageData.notes ? `<p class="field-hint">${escapeHtml(stageData.notes)}</p>` : ''}

      ${s.lookalikeSpecies && s.lookalikeSpecies.length ? `
        <div class="lookalike-box">
          <strong>Commonly confused with:</strong>
          <ul>${s.lookalikeSpecies.map((l) => `<li><strong>${escapeHtml(l.species)}</strong> &mdash; ${escapeHtml(l.distinguishingNote)}</li>`).join('')}</ul>
          <p class="field-hint">If uncertain, log as <em>unidentified &mdash; see key</em> and photograph for later confirmation rather than forcing an ID.</p>
        </div>` : ''}

      <h3>Habitat notes</h3>
      <p>${escapeHtml(s.habitatNotes || 'Not documented.')}</p>

      <details class="section-collapsible">
        <summary>Sources / citations</summary>
        <ul>${(s.citations || []).map((c) => `<li>${escapeHtml(c.source)}${c.url ? ` &mdash; <a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.url)}</a>` : ''}${c.accessedNote ? `<br><span class="field-hint">${escapeHtml(c.accessedNote)}</span>` : ''}</li>`).join('') || '<li>No citation on file.</li>'}</ul>
      </details>

      ${mode === 'select' ? `
        <button type="button" class="btn btn-accent" data-role="confirm">Confirm ID: ${escapeHtml(s.commonName)} (${stageLabel(state.detailStage)})</button>
        <button type="button" class="btn btn-outline" data-role="uncertain">Not sure &mdash; mark unidentified &amp; photograph later</button>
      ` : ''}
    `;

    container.querySelector('[data-role="back"]').addEventListener('click', () => { state.detailId = null; renderList(); });
    container.querySelectorAll('[data-stage]').forEach((btn) => btn.addEventListener('click', () => { state.detailStage = btn.getAttribute('data-stage'); renderDetail(); }));
    if (mode === 'select') {
      container.querySelector('[data-role="confirm"]').addEventListener('click', () => onSelect && onSelect({ species: s, lifeStage: state.detailStage, unidentified: false }));
      container.querySelector('[data-role="uncertain"]').addEventListener('click', () => onSelect && onSelect({ species: null, lifeStage: null, unidentified: true }));
    }
  }

  renderList();
  return {
    showDetail(speciesId) { state.detailId = speciesId; state.detailStage = 'adult'; renderDetail(); },
    reset() { state.detailId = null; renderList(); },
  };
}
