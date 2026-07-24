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
  // No fallback to the adult entry here: per the "flag clearly rather than
  // substitute a photo silently" rule this app follows for images, a stage
  // with no entry of its own should show the placeholder, not another
  // stage's photo passed off as this one.
  return entry[stage] || null;
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

// A single shared full-screen viewer, created once and reused for every
// "tap to enlarge" click across any renderSpeciesBrowser instance on the
// page (standalone browse page, or the Identify modal's species browser).
let sharedLightbox = null;
function getLightbox() {
  if (sharedLightbox) return sharedLightbox;
  const el = document.createElement('div');
  el.className = 'img-lightbox-overlay';
  el.hidden = true;
  el.innerHTML = `
    <button type="button" class="img-lightbox-close" aria-label="Close enlarged photo">&times;</button>
    <img class="img-lightbox-img" alt="">
    <p class="img-lightbox-credit"></p>
  `;
  document.body.appendChild(el);
  const imgEl = el.querySelector('.img-lightbox-img');
  const creditEl = el.querySelector('.img-lightbox-credit');
  const close = () => { el.hidden = true; };
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  el.querySelector('.img-lightbox-close').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) close(); });
  sharedLightbox = {
    open(src, alt, credit) {
      imgEl.src = src;
      imgEl.alt = alt || '';
      creditEl.textContent = credit || '';
      el.hidden = false;
    },
  };
  return sharedLightbox;
}

function carouselHtml(images, commonName, stage) {
  if (images.length === 1) {
    const img = images[0];
    return `
      <img class="detail-photo-single" data-role="single-photo" src="${escapeHtml(img.localPath)}" alt="${escapeHtml(commonName)} (${escapeHtml(stage)})" style="width:100%;border-radius:10px" loading="lazy">
      <p class="img-credit">${escapeHtml(img.credit || '')}</p>
    `;
  }
  const first = images[0];
  return `
    <div class="img-carousel" data-role="img-carousel" data-total="${images.length}" data-index="0">
      <div class="img-carousel-viewport">
        <img class="img-carousel-img" data-role="carousel-img" src="${escapeHtml(first.localPath)}" alt="${escapeHtml(commonName)} (${escapeHtml(stage)}) photo 1 of ${images.length}" loading="lazy">
        <button type="button" class="img-carousel-arrow img-carousel-prev" data-role="carousel-prev" aria-label="Previous photo">&lsaquo;</button>
        <button type="button" class="img-carousel-arrow img-carousel-next" data-role="carousel-next" aria-label="Next photo">&rsaquo;</button>
      </div>
      <p class="img-credit" data-role="carousel-credit">${escapeHtml(first.credit || '')}</p>
      <div class="img-carousel-dots" data-role="carousel-dots">
        ${images.map((_, i) => `<span class="img-carousel-dot ${i === 0 ? 'active' : ''}"></span>`).join('')}
      </div>
    </div>
  `;
}

/**
 * Wires up click/swipe navigation for a rendered carousel — one image
 * visible at a time, looping in both directions. Called after innerHTML is
 * set; does its own small DOM updates on nav rather than a full re-render so
 * swiping stays snappy and doesn't reset scroll position.
 */
function bindCarousel(container, images, commonName, stage) {
  const carousel = container.querySelector('[data-role="img-carousel"]');
  if (!carousel) return;
  const total = images.length;
  const imgEl = carousel.querySelector('[data-role="carousel-img"]');
  const creditEl = carousel.querySelector('[data-role="carousel-credit"]');
  const dots = carousel.querySelectorAll('.img-carousel-dot');
  let index = 0;

  function show(i) {
    index = ((i % total) + total) % total; // wraps both directions
    const img = images[index];
    imgEl.src = img.localPath;
    imgEl.alt = `${commonName} (${stage}) photo ${index + 1} of ${total}`;
    creditEl.textContent = img.credit || '';
    dots.forEach((dot, di) => dot.classList.toggle('active', di === index));
  }

  carousel.querySelector('[data-role="carousel-prev"]').addEventListener('click', () => show(index - 1));
  carousel.querySelector('[data-role="carousel-next"]').addEventListener('click', () => show(index + 1));
  imgEl.addEventListener('click', () => {
    const img = images[index];
    getLightbox().open(img.localPath, imgEl.alt, img.credit);
  });

  const viewport = carousel.querySelector('.img-carousel-viewport');
  let touchStartX = null;
  viewport.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  viewport.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
    touchStartX = null;
  }, { passive: true });
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
    const primary = img && img.status === 'verified' && img.images && img.images.length ? img.images[0] : null;
    const thumb = primary
      ? `<img src="${escapeHtml(primary.localPath)}" alt="${escapeHtml(s.commonName)}" loading="lazy">`
      : '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13c2.8-3.6 6.8-5.5 11-5.5 3 0 5.3 1.7 7 5.5-1.7 3.8-4 5.5-7 5.5-4.2 0-8.2-1.9-11-5.5Z"/><path d="M18.5 10.3 21 8.2m-2.5 9.5 2.5-2.1"/><circle cx="9.3" cy="11.6" r=".55" fill="currentColor" stroke="none"/></svg>';
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

      ${img && img.status === 'verified' && img.images && img.images.length
        ? carouselHtml(img.images, s.commonName, state.detailStage)
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
    if (img && img.status === 'verified' && img.images && img.images.length > 1) {
      bindCarousel(container, img.images, s.commonName, state.detailStage);
    } else if (img && img.status === 'verified' && img.images && img.images.length === 1) {
      const photoEl = container.querySelector('[data-role="single-photo"]');
      photoEl.addEventListener('click', () => getLightbox().open(img.images[0].localPath, photoEl.alt, img.images[0].credit));
    }
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
