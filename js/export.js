import { initHeaderNav, showToast, escapeHtml } from './app.js';
import { FisherDB } from './db.js';
import { openSurveyPdfReport } from './pdf-report.js';
import { initSettingsButton } from './settings.js';

initHeaderNav();
initSettingsButton();

const CSV_COLUMNS = [
  ['surveyId', (s, f) => s.id],
  ['projectId', (s, f) => s.projectId || ''],
  ['stationId', (s, f) => s.stationId || ''],
  ['siteId', (s, f) => s.siteId || ''],
  ['surveyDateTime', (s, f) => s.dateTime || ''],
  ['observerNames', (s, f) => s.observerNames || ''],
  ['waterbodyName', (s, f) => s.waterbodyName || ''],
  ['watershed', (s, f) => s.watershed || ''],
  ['gpsLat', (s, f) => (f.gps ? f.gps.lat : (s.gps ? s.gps.lat : ''))],
  ['gpsLon', (s, f) => (f.gps ? f.gps.lon : (s.gps ? s.gps.lon : ''))],
  ['airTempC', (s, f) => s.weather?.airTempC || ''],
  ['sky', (s, f) => s.weather?.sky || ''],
  ['wind', (s, f) => s.weather?.wind || ''],
  ['waterLevel', (s, f) => s.waterLevel || ''],
  ['fishRecordId', (s, f) => f.id],
  ['species', (s, f) => f.speciesCommonName || ''],
  ['unidentifiedFlag', (s, f) => (f.unidentified ? 'Y' : 'N')],
  ['lifeStage', (s, f) => f.lifeStage || ''],
  ['lengthMm', (s, f) => (f.lengthMm ?? '')],
  ['weightG', (s, f) => (f.weightG ?? '')],
  ['conditionFlags', (s, f) => (f.conditionFlags || []).join('; ')],
  ['conditionNotes', (s, f) => f.conditionNotes || ''],
  ['disposition', (s, f) => f.disposition || ''],
  ['captureMethod', (s, f) => f.captureMethod || ''],
  ['trapLabel', (s, f) => (f.trapId ? ((s.traps || []).find((t) => t.id === f.trapId)?.label || '') : '')],
  ['technicianName', (s, f) => f.technicianName || ''],
  ['photoAttached', (s, f) => (f.photo ? 'Y' : 'N')],
  ['fishNotes', (s, f) => f.notes || ''],
  ['surveyNotes', (s, f) => s.notes || ''],
];

function csvEscape(val) {
  const str = String(val ?? '');
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function buildCsv(surveys, fishBySurvey) {
  const rows = [CSV_COLUMNS.map(([name]) => name).join(',')];
  surveys.forEach((s) => {
    const fish = fishBySurvey.get(s.id) || [];
    if (!fish.length) return;
    fish.forEach((f) => {
      rows.push(CSV_COLUMNS.map(([, fn]) => csvEscape(fn(s, f))).join(','));
    });
  });
  return rows.join('\n');
}

function buildJson(surveys, fishBySurvey) {
  return JSON.stringify(
    surveys.map((s) => ({ ...s, fishRecords: (fishBySurvey.get(s.id) || []).map(stripBlob) })),
    null, 2
  );
}

function stripBlob(f) {
  const { photo, ...rest } = f;
  return { ...rest, photoAttached: !!photo, photoName: photo ? photo.name : null };
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function timestampSlug() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function loadAll() {
  const surveys = await FisherDB.listSurveys();
  const fishBySurvey = new Map();
  for (const s of surveys) {
    fishBySurvey.set(s.id, await FisherDB.listFishRecords(s.id));
  }
  return { surveys, fishBySurvey };
}

function previewTable(surveys, fishBySurvey) {
  const rows = [];
  surveys.forEach((s) => (fishBySurvey.get(s.id) || []).forEach((f) => rows.push([s, f])));
  if (!rows.length) return '<p class="empty-state">Nothing selected, or nothing logged yet on this device.</p>';
  return `
    <div class="table-scroll">
    <table class="export-preview">
      <thead><tr>${CSV_COLUMNS.map(([name]) => `<th>${escapeHtml(name)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map(([s, f]) => `<tr>${CSV_COLUMNS.map(([, fn]) => `<td>${escapeHtml(fn(s, f))}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
    </div>
  `;
}

function surveyRowHtml(s, fishCount, checked) {
  return `
    <div class="record-list-item survey-select-row">
      <label class="survey-select-row-main" for="sel-${escapeHtml(s.id)}">
        <input type="checkbox" class="survey-checkbox" id="sel-${escapeHtml(s.id)}" data-survey-checkbox="${escapeHtml(s.id)}" ${checked ? 'checked' : ''}>
        <span>
          <strong>${escapeHtml(s.siteId || s.stationId || 'Unnamed site')}</strong>
          ${s.flaggedForFollowUp ? '<span class="badge" style="background:var(--status-danger-text);color:#fff">follow-up</span>' : ''}
          <div class="meta">${escapeHtml((s.dateTime || '').replace('T', ' '))} &middot; ${escapeHtml(s.observerNames || 'no observer set')} &middot; ${fishCount} fish</div>
        </span>
      </label>
      <button type="button" class="btn btn-outline btn-sm" data-pdf-btn="${escapeHtml(s.id)}">PDF</button>
    </div>
  `;
}

let state = { surveys: [], fishBySurvey: new Map(), selected: new Set() };

async function boot() {
  const root = document.getElementById('export-root');
  const { surveys, fishBySurvey } = await loadAll();
  // Preserve prior selection where possible; default to "all selected" on first load.
  const prevSelected = state.selected;
  state = { surveys, fishBySurvey, selected: new Set(surveys.map((s) => s.id).filter((id) => !prevSelected.size || prevSelected.has(id))) };
  if (!prevSelected.size) state.selected = new Set(surveys.map((s) => s.id));
  render();
}

function selectedSurveys() {
  return state.surveys.filter((s) => state.selected.has(s.id));
}

function render() {
  const root = document.getElementById('export-root');
  const { surveys, fishBySurvey } = state;
  const totalFish = Array.from(fishBySurvey.values()).reduce((n, arr) => n + arr.length, 0);
  const sel = selectedSurveys();
  const selFishCount = sel.reduce((n, s) => n + (fishBySurvey.get(s.id) || []).length, 0);
  const allSelected = surveys.length > 0 && state.selected.size === surveys.length;

  root.innerHTML = `
    <div class="card">
      <strong>${surveys.length}</strong> survey(s) &middot; <strong>${totalFish}</strong> fish record(s) queued on this device.
    </div>

    ${surveys.length ? `
      <div class="identify-row" style="margin-bottom:10px">
        <button type="button" class="btn btn-outline btn-sm" id="select-all-btn" style="width:auto">${allSelected ? 'Deselect all' : 'Select all'}</button>
        <span class="field-hint" style="align-self:center">${state.selected.size} of ${surveys.length} selected for CSV/JSON export</span>
      </div>
      <div id="survey-select-list">
        ${surveys.map((s) => surveyRowHtml(s, (fishBySurvey.get(s.id) || []).length, state.selected.has(s.id))).join('')}
      </div>
    ` : '<p class="empty-state">No surveys logged yet on this device.</p>'}

    <button type="button" class="btn btn-accent" id="export-csv-btn" ${sel.length ? '' : 'disabled'}>Export CSV (${sel.length} survey${sel.length === 1 ? '' : 's'}, ${selFishCount} fish)</button>
    <button type="button" class="btn" id="export-json-btn" ${sel.length ? '' : 'disabled'}>Export JSON (${sel.length} survey${sel.length === 1 ? '' : 's'})</button>
    <button type="button" class="btn btn-danger" id="clear-btn" ${sel.length ? '' : 'disabled'}>Clear ${sel.length} selected survey${sel.length === 1 ? '' : 's'} from this device</button>

    <h2 style="margin-top:20px">Preview &mdash; selected surveys</h2>
    ${previewTable(sel, fishBySurvey)}
  `;

  wireEvents();
}

function wireEvents() {
  const { surveys, fishBySurvey } = state;

  document.getElementById('select-all-btn')?.addEventListener('click', () => {
    if (state.selected.size === surveys.length) state.selected.clear();
    else state.selected = new Set(surveys.map((s) => s.id));
    render();
  });

  document.querySelectorAll('[data-survey-checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.getAttribute('data-survey-checkbox');
      if (cb.checked) state.selected.add(id); else state.selected.delete(id);
      render();
    });
  });

  document.querySelectorAll('[data-pdf-btn]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = btn.getAttribute('data-pdf-btn');
      const survey = surveys.find((s) => s.id === id);
      if (!survey) return;
      openSurveyPdfReport(survey, fishBySurvey.get(id) || []);
    });
  });

  document.getElementById('export-csv-btn')?.addEventListener('click', () => {
    const sel = selectedSurveys();
    download(`fisher-catch-records-${timestampSlug()}.csv`, buildCsv(sel, state.fishBySurvey), 'text/csv');
    showToast('CSV downloaded');
  });
  document.getElementById('export-json-btn')?.addEventListener('click', () => {
    const sel = selectedSurveys();
    download(`fisher-catch-records-${timestampSlug()}.json`, buildJson(sel, state.fishBySurvey), 'application/json');
    showToast('JSON downloaded');
  });
  document.getElementById('clear-btn')?.addEventListener('click', async () => {
    const sel = selectedSurveys();
    if (!sel.length) return;
    const fishCount = sel.reduce((n, s) => n + (state.fishBySurvey.get(s.id) || []).length, 0);
    if (!confirm(`Delete ${sel.length} selected survey(s) and ${fishCount} fish record(s) from this device? Make sure you already exported them.`)) return;
    for (const s of sel) {
      for (const f of (state.fishBySurvey.get(s.id) || [])) await FisherDB.delete('fishRecords', f.id);
      await FisherDB.delete('surveys', s.id);
    }
    showToast('Cleared');
    await boot();
  });
}

boot();
