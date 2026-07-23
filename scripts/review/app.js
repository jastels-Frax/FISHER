// Client-side logic for the local image review UI. No build step, no
// framework — plain DOM + fetch against the server.js API in this folder.

const state = { data: null, search: '', onlyUndecided: false, onlyGaps: false };

const el = {
  list: document.getElementById('species-list'),
  headerSub: document.getElementById('header-sub'),
  status: document.getElementById('status-bar'),
  finalizeResult: document.getElementById('finalize-result'),
  search: document.getElementById('filter-search'),
  undecided: document.getElementById('filter-undecided'),
  gaps: document.getElementById('filter-gaps'),
};

function showStatus(msg, ms = 2500) {
  el.status.textContent = msg;
  el.status.classList.add('visible');
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => el.status.classList.remove('visible'), ms);
}

function imageUrlFor(candidate) {
  // candidate.localPath is ROOT-relative, e.g. "staging/images/<species>/<stage>/<file>".
  if (!candidate.localPath) return '';
  return '/staging-images/' + candidate.localPath.replace(/^staging\/images\//, '');
}

function stageLabel(stage) {
  return stage === 'unknown' ? 'Unassigned / unknown stage' : stage.charAt(0).toUpperCase() + stage.slice(1);
}

async function loadState() {
  const res = await fetch('/api/state');
  state.data = await res.json();
  el.headerSub.textContent = `${state.data.species.length} species, ${state.data.totalCandidates} staged candidates`;
  render();
}

async function decide(candidateId, decision, stage) {
  const res = await fetch('/api/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidateId, decision, stage: stage || null }),
  });
  if (!res.ok) { showStatus('Failed to save decision.'); return; }
  await loadState();
}

function candidateCardHtml(c, trackedStages) {
  const decisionClass = c.decision ? `decision-${c.decision}` : '';
  const badges = [];
  if (c.isReferenceIllustration) badges.push('<span class="pill badge-illustration">Reference illustration</span>');
  if (c.lifeStageConfidence === 'assumed') badges.push('<span class="pill badge-assumed">Stage assumed</span>');
  badges.push(`<span class="pill">${escapeHtml(c.source)}</span>`);

  const stageOptions = ['unknown', ...trackedStages]
    .map((s) => `<option value="${s}" ${(c.stageOverride || c.stage) === s ? 'selected' : ''}>${stageLabel(s)}</option>`)
    .join('');

  return `
    <div class="candidate-card ${decisionClass}" data-candidate-id="${escapeHtml(c.id)}">
      <img class="candidate-thumb" src="${escapeHtml(imageUrlFor(c))}" alt="${escapeHtml(c.title || '')}" loading="lazy" onerror="this.style.opacity=0.2">
      <div class="candidate-body">
        <div class="badge-row">${badges.join('')}</div>
        <div class="license">${escapeHtml(c.licenseLabel || c.licenseCode)}</div>
        <div class="author">${escapeHtml(c.author || 'Unknown')}</div>
        <a href="${escapeHtml(c.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>
        <label style="display:flex;align-items:center;gap:6px;">
          Stage:
          <select class="stage-select" data-role="stage-select">${stageOptions}</select>
        </label>
      </div>
      <div class="action-row">
        <button class="btn action-approve ${c.decision === 'approved' ? 'active' : ''}" data-action="approved">Approve</button>
        <button class="btn action-swap ${c.decision === 'needs-different' ? 'active' : ''}" data-action="needs-different">Needs different</button>
        <button class="btn action-reject ${c.decision === 'rejected' ? 'active' : ''}" data-action="rejected">Reject</button>
      </div>
    </div>
  `;
}

function speciesBlockHtml(sp) {
  const stageOrder = ['adult', 'juvenile', 'parr', 'fry', 'elver', 'egg', 'unknown'];
  const stageKeys = Object.keys(sp.stages).sort((a, b) => {
    const ia = stageOrder.indexOf(a), ib = stageOrder.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const sections = stageKeys.map((stage) => {
    let candidates = sp.stages[stage];
    if (state.onlyUndecided) candidates = candidates.filter((c) => !c.decision);
    if (!candidates.length && stage === 'unknown') return ''; // hide empty "unknown" bucket
    const isGap = sp.trackedStages.includes(stage) && sp.searchGaps.includes(stage);
    const gapPill = isGap ? '<span class="pill pill-gap">No confirmed candidate found during search</span>' : '';
    const body = candidates.length
      ? `<div class="candidate-grid">${candidates.map((c) => candidateCardHtml(c, sp.trackedStages)).join('')}</div>`
      : '<div class="pill pill-empty">No candidates</div>';
    return `
      <div class="stage-section">
        <div class="stage-title">${stageLabel(stage)} ${gapPill}</div>
        ${body}
      </div>
    `;
  }).join('');

  return `
    <div class="species-block" data-species-id="${escapeHtml(sp.id)}">
      <div class="species-header">
        <div class="names"><strong>${escapeHtml(sp.commonName)}</strong><span class="sci">${escapeHtml(sp.scientificName)}</span></div>
        <div class="meta">${sp.candidateCount} candidate(s)${sp.searchGaps.length ? ` · ${sp.searchGaps.length} stage gap(s)` : ''}</div>
      </div>
      ${sections}
    </div>
  `;
}

function render() {
  if (!state.data) return;
  let species = state.data.species;
  if (state.search) {
    const q = state.search.toLowerCase();
    species = species.filter((s) => s.commonName.toLowerCase().includes(q) || s.scientificName.toLowerCase().includes(q));
  }
  if (state.onlyGaps) species = species.filter((s) => s.searchGaps.length);
  if (state.onlyUndecided) species = species.filter((s) => Object.values(s.stages).some((list) => list.some((c) => !c.decision)));

  el.list.innerHTML = species.length
    ? species.map(speciesBlockHtml).join('')
    : '<div class="empty-state">No species match the current filters. If staging/candidates.json is empty, run node scripts/fetch-images.js first.</div>';
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

el.list.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const card = btn.closest('.candidate-card');
  const candidateId = card.getAttribute('data-candidate-id');
  const already = btn.classList.contains('active');
  const stageSelect = card.querySelector('[data-role="stage-select"]');
  decide(candidateId, already ? null : btn.getAttribute('data-action'), stageSelect ? stageSelect.value : null);
});

el.list.addEventListener('change', (e) => {
  const select = e.target.closest('[data-role="stage-select"]');
  if (!select) return;
  const card = select.closest('.candidate-card');
  const candidateId = card.getAttribute('data-candidate-id');
  const activeBtn = card.querySelector('.action-row .active');
  const decision = activeBtn ? activeBtn.getAttribute('data-action') : null;
  decide(candidateId, decision, select.value);
});

el.search.addEventListener('input', (e) => { state.search = e.target.value; render(); });
el.undecided.addEventListener('change', (e) => { state.onlyUndecided = e.target.checked; render(); });
el.gaps.addEventListener('change', (e) => { state.onlyGaps = e.target.checked; render(); });
document.getElementById('btn-refresh').addEventListener('click', loadState);

async function runFinalize(dryRun) {
  el.finalizeResult.style.display = 'block';
  el.finalizeResult.textContent = dryRun ? 'Previewing…' : 'Finalizing…';
  const res = await fetch('/api/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun }),
  });
  const data = await res.json();
  if (!res.ok) { el.finalizeResult.textContent = 'Error: ' + (data.error || 'unknown'); return; }
  const lines = [
    dryRun ? 'PREVIEW (nothing written):' : 'Finalize complete:',
    `  Images set/updated in data/images.json: ${data.imagesUpdated}`,
    `  Manifest rows: ${data.manifestRows}`,
    `  Species/stage gaps still remaining: ${data.gapsRemaining}`,
    data.unassignedCount ? `  Approved candidates with no stage assigned yet: ${data.unassignedCount} (set a stage above and re-run)` : '',
  ].filter(Boolean);
  el.finalizeResult.textContent = lines.join('\n');
  if (!dryRun) { showStatus('Finalized — images/ and data/images.json updated.'); loadState(); }
}

document.getElementById('btn-dry-run').addEventListener('click', () => runFinalize(true));
document.getElementById('btn-finalize').addEventListener('click', () => {
  if (confirm('This will copy approved images into images/species/ and overwrite matching entries in data/images.json. Continue?')) {
    runFinalize(false);
  }
});

loadState();
