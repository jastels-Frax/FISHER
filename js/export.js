import { initHeaderNav, showToast, escapeHtml } from './app.js';
import { FisherDB } from './db.js';

initHeaderNav();

const CSV_COLUMNS = [
  ['surveyId', (s, f) => s.id],
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
  if (!rows.length) return '<p class="empty-state">Nothing logged yet on this device.</p>';
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

async function boot() {
  const root = document.getElementById('export-root');
  const { surveys, fishBySurvey } = await loadAll();
  const totalFish = Array.from(fishBySurvey.values()).reduce((n, arr) => n + arr.length, 0);
  const flaggedSurveys = surveys.filter((s) => s.flaggedForFollowUp);

  root.innerHTML = `
    <div class="card">
      <strong>${surveys.length}</strong> survey(s) &middot; <strong>${totalFish}</strong> fish record(s) queued on this device.
      ${flaggedSurveys.length ? `<p class="flag-note">${flaggedSurveys.length} survey(s) have unidentified catches flagged for follow-up.</p>` : ''}
    </div>
    <button type="button" class="btn btn-accent" id="export-csv-btn">Export CSV</button>
    <button type="button" class="btn" id="export-json-btn">Export JSON</button>
    <button type="button" class="btn btn-danger" id="clear-btn">Clear exported records from this device</button>

    <h2 style="margin-top:20px">Preview</h2>
    ${previewTable(surveys, fishBySurvey)}
  `;

  document.getElementById('export-csv-btn').addEventListener('click', () => {
    download(`fisher-catch-records-${timestampSlug()}.csv`, buildCsv(surveys, fishBySurvey), 'text/csv');
    showToast('CSV downloaded');
  });
  document.getElementById('export-json-btn').addEventListener('click', () => {
    download(`fisher-catch-records-${timestampSlug()}.json`, buildJson(surveys, fishBySurvey), 'application/json');
    showToast('JSON downloaded');
  });
  document.getElementById('clear-btn').addEventListener('click', async () => {
    if (!surveys.length) return;
    if (!confirm(`Delete all ${surveys.length} survey(s) and ${totalFish} fish record(s) from this device? Make sure you already exported them.`)) return;
    for (const s of surveys) {
      for (const f of (fishBySurvey.get(s.id) || [])) await FisherDB.delete('fishRecords', f.id);
      await FisherDB.delete('surveys', s.id);
    }
    showToast('Cleared');
    boot();
  });
}
boot();
