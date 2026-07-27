// Client-side PDF export: renders a branded, print-formatted HTML report for
// one survey/station (with all its fish records) in a new window, then relies
// on the browser's native print-to-PDF (window.print()) to produce the file.
// No PDF library, no network call — everything (fonts, logo) is same-origin
// and already cached by the service worker, so this works fully offline.
// Layout/format mirrors the existing Fraxinus survey report templates
// (see README "PDF export" section for exactly what was reused from where).
import { escapeHtml } from './app.js';

const LIFE_STAGE_LABELS = { egg: 'Egg', elver: 'Elver / glass eel', fry: 'Fry', parr: 'Parr', juvenile: 'Juvenile', adult: 'Adult' };

function abs(path) {
  return new URL(path, window.location.href).href;
}

function fmtDateTime(v) {
  if (!v) return '';
  return String(v).replace('T', ' ');
}

function fmtGps(gps) {
  if (!gps || typeof gps.lat !== 'number' || typeof gps.lon !== 'number') return '';
  return `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}`;
}

function metaRow(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<div class="ml">${escapeHtml(label)}</div><div class="mv">${escapeHtml(value)}</div>`;
}

function buildSurveyMetaGrid(s) {
  const weatherBits = [
    s.weather?.airTempC ? `${s.weather.airTempC}°C` : '',
    s.weather?.sky || '',
    s.weather?.wind ? `${s.weather.wind} wind` : '',
  ].filter(Boolean).join(' · ');

  const rows = [
    metaRow('Project ID', s.projectId),
    metaRow('Station ID', s.stationId),
    metaRow('Site name / description', s.siteId),
    metaRow('Observer(s) / technician(s)', s.observerNames),
    metaRow('Date & time', fmtDateTime(s.dateTime)),
    metaRow('GPS coordinates', fmtGps(s.gps)),
    metaRow('Water body', s.waterbodyName),
    metaRow('Watershed', s.watershed),
    metaRow('Weather', weatherBits),
    metaRow('Survey purpose', s.surveyPurpose),
    metaRow('Licence / permit number', s.permitNumber),
    metaRow('Crew size', s.crewSize),
    metaRow('Gear type / effort', s.gearEffort),
    metaRow('Water level / flow condition', s.waterLevel),
  ].join('');
  return rows;
}

// Every leaf field across all habitat sub-groups, with its display label —
// only fields with a real value are rendered, and a sub-group is skipped
// entirely if none of its fields have data. If nothing at all is filled in,
// the whole Habitat Characterization section is omitted from the report.
const VEGETATION_STRATA_LABELS = {
  canopy: 'Canopy / overstory', understory: 'Understory / shrub',
  herbaceous: 'Herbaceous / groundcover', aquatic: 'Aquatic / emergent (instream)',
};

function depthStats(measurements) {
  const nums = (measurements || []).map(Number).filter((n) => !isNaN(n));
  if (!nums.length) return null;
  return { avg: nums.reduce((a, b) => a + b, 0) / nums.length, max: Math.max(...nums), n: nums.length };
}

function buildHabitatSection(h) {
  if (!h) return '';
  const depths = depthStats(h.channelMorphology?.depthMeasurementsCm);
  const groups = [
    { title: 'Water Chemistry', fields: [
      ['Water temperature', h.waterChemistry?.tempC, '°C'],
      ['Dissolved oxygen', h.waterChemistry?.doMgL, 'mg/L'],
      ['pH', h.waterChemistry?.ph, ''],
      ['Conductivity', h.waterChemistry?.conductivityUsCm, 'µS/cm'],
    ] },
    { title: 'Channel Morphology', fields: [
      ['Wetted width', h.channelMorphology?.wettedWidthM, 'm'],
      ['Bankfull width', h.channelMorphology?.bankfullWidthM, 'm'],
      ['Depth — average', depths ? depths.avg.toFixed(1) : null, 'cm'],
      ['Depth — max', depths ? depths.max : null, 'cm'],
      ['Depth measurements taken', depths ? depths.n : null, ''],
      ['Gradient', h.channelMorphology?.gradientPct, '%'],
      ['Dominant channel unit', h.channelMorphology?.channelUnit, ''],
    ] },
    { title: 'Substrate & Embeddedness', fields: [
      ['Dominant substrate', h.substrate?.dominant, ''],
      ['Subdominant substrate', h.substrate?.subdominant, ''],
      ['Embeddedness', h.substrate?.embeddedness, ''],
    ] },
    { title: 'Instream Cover', fields: Object.entries(h.cover || {}).map(([k, v]) => [k, v, '']) },
    { title: 'Riparian Condition', fields: [
      ['Buffer width', h.riparian?.bufferWidthM, 'm'],
      ['Canopy cover', h.riparian?.canopyCoverPct, '%'],
      ['Bank stability', h.riparian?.bankStability, ''],
      ...Object.entries(VEGETATION_STRATA_LABELS).map(([key, label]) =>
        [`Dominant vegetation — ${label}`, h.riparian?.vegetationByStratum?.[key], '']),
    ] },
    { title: 'Flow', fields: [
      ['Discharge', h.flow?.discharge, ''],
      ['Flow regime notes', h.flow?.regimeNotes, ''],
    ] },
    { title: 'Barriers / Connectivity', fields: [
      ['Barrier type', h.barrier?.type, ''],
      ['Structure', h.barrier?.structure, ''],
      ['Notes', h.barrier?.notes, ''],
    ] },
    { title: 'Other', fields: [
      ['Benthic macroinvertebrates observed', h.benthicNotes, ''],
      ['Site photo reference', h.photoRef, ''],
    ] },
  ];

  const rendered = groups
    .map((g) => {
      const items = g.fields.filter(([, v]) => v !== null && v !== undefined && v !== '');
      if (!items.length) return '';
      const grid = items.map(([label, v, unit]) => metaRow(label, unit ? `${v} ${unit}` : v)).join('');
      return `<h3 class="sub">${escapeHtml(g.title)}</h3><div class="mg">${grid}</div>`;
    })
    .filter(Boolean)
    .join('');

  if (!rendered) return '';
  return `<h2>Habitat Characterization</h2>${rendered}`;
}

function buildFishTable(records) {
  if (!records.length) {
    return '<p class="empty">No fish were logged for this survey.</p>';
  }
  const rows = records.map((r) => {
    const species = r.unidentified ? 'Unidentified — see key' : (r.speciesCommonName || '');
    const stage = r.lifeStage ? (LIFE_STAGE_LABELS[r.lifeStage] || r.lifeStage) : '';
    const length = r.lengthMm != null ? `${r.lengthMm} mm` : '';
    const weight = r.weightG != null ? `${r.weightG} g` : '';
    const health = [ (r.conditionFlags || []).join(', '), r.conditionNotes ].filter(Boolean).join(' — ') || (r.unidentified ? '' : 'Healthy');
    const method = r.captureMethod || '';
    return `<tr>
      <td>${escapeHtml(species)}</td>
      <td>${escapeHtml(stage)}</td>
      <td>${escapeHtml(length)}</td>
      <td>${escapeHtml(weight)}</td>
      <td>${escapeHtml(health)}</td>
      <td>${escapeHtml(method)}</td>
    </tr>`;
  }).join('');

  return `
    <table>
      <thead><tr>
        <th>Species</th><th>Life stage</th><th>Length</th><th>Weight</th><th>Health notes</th><th>Capture method</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildReportHtml(survey, fishRecords) {
  const s = survey;
  const generatedAt = new Date();
  const generatedStr = generatedAt.toLocaleString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const docTitle = `Fish Catalogue Field Report — ${s.siteId || s.stationId || 'Unnamed site'}`;
  const logoSrc = abs('./icons/fraxinus-mark-report.png');
  const font400 = abs('./fonts/oswald-400.woff2');
  const font600 = abs('./fonts/oswald-600.woff2');
  const font700 = abs('./fonts/oswald-700.woff2');

  const habitatHtml = buildHabitatSection(s.habitat);
  const fishTableHtml = buildFishTable(fishRecords);
  const flagNote = s.flaggedForFollowUp
    ? `<p class="flag">One or more fish in this catalogue are flagged unidentified &mdash; see key, pending follow-up confirmation.</p>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(docTitle)}</title>
<style>
@font-face { font-family: "Oswald"; src: url("${font400}") format("woff2"); font-weight: 400; font-style: normal; }
@font-face { font-family: "Oswald"; src: url("${font600}") format("woff2"); font-weight: 600; font-style: normal; }
@font-face { font-family: "Oswald"; src: url("${font700}") format("woff2"); font-weight: 700; font-style: normal; }

:root { --ca: #2D6B2D; --cal: #3D8F3D; --ct: #EAF2EA; --cb: #CDE8CD; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: "Oswald", "Segoe UI", sans-serif; color: #1A1A1A; background: #f4f4f4; font-size: 10.5pt; line-height: 1.5; }

@page {
  size: A4;
  margin: 24mm 14mm 18mm 14mm;
  @top-left { content: "${escapeHtml(docTitle)}"; font-family: "Oswald", sans-serif; font-size: 8pt; color: #777; }
  @top-right { content: "Fraxinus Environmental & Geomatics"; font-family: "Oswald", sans-serif; font-size: 8pt; color: #777; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font-family: "Oswald", sans-serif; font-size: 8pt; color: #777; }
  @bottom-left { content: "Generated ${escapeHtml(generatedAt.toLocaleDateString('en-CA'))}"; font-family: "Oswald", sans-serif; font-size: 8pt; color: #777; }
}

@media print {
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .no-print { display: none !important; }
  body { background: #fff; }
  .page { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; }
}

.topbar { position: sticky; top: 0; background: #111; border-bottom: 3px solid var(--ca); padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; z-index: 10; }
.topbar span { color: #ccc; font-size: 0.82rem; }
.topbar button { background: var(--ca); color: #fff; border: 1px solid var(--cal); border-radius: 6px; padding: 10px 22px; font-family: "Oswald", sans-serif; font-weight: 600; font-size: 0.9rem; letter-spacing: 0.04em; text-transform: uppercase; cursor: pointer; }
.topbar button:hover { background: var(--cal); }

.page { max-width: 780px; margin: 24px auto 40px; padding: 28px 32px 36px; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.12); }

.hdr { display: flex; align-items: center; gap: 20px; padding-bottom: 14px; border-bottom: 3px solid var(--ca); margin-bottom: 22px; }
.hdr img { height: 64px; width: 64px; flex-shrink: 0; }
.hdr .doc-title { font-size: 1.25rem; font-weight: 700; color: #111; letter-spacing: 0.01em; }
.hdr .doc-sub { font-size: 0.78rem; color: #888; margin-top: 3px; }

h2 { font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ca); border-bottom: 1px solid var(--cb); padding-bottom: 4px; margin: 24px 0 10px; }
h3.sub { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #555; margin: 14px 0 6px; }

.mg { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; margin-bottom: 6px; padding: 12px 16px; background: var(--ct); border: 1px solid var(--cb); border-radius: 6px; }
.ml { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ca); font-weight: 600; align-self: start; }
.mv { font-size: 0.85rem; }

.flag { background: #FFF3E0; border: 1px solid #F5C990; color: #E8731A; border-radius: 6px; padding: 8px 12px; font-size: 0.82rem; margin: 10px 0; }
.empty { color: #888; font-size: 0.85rem; font-style: italic; margin: 8px 0; }

table { width: 100%; border-collapse: collapse; font-size: 0.78rem; margin-top: 6px; }
th { background: var(--ca); color: #fff; font-weight: 600; padding: 6px 8px; text-align: left; letter-spacing: 0.03em; font-size: 0.72rem; }
td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
tbody tr:nth-child(even) td { background: #f9fbf9; }

.ft { margin-top: 28px; padding-top: 10px; border-top: 1px solid var(--cb); display: flex; justify-content: space-between; font-size: 0.7rem; color: #999; }
</style>
</head>
<body>

<div class="topbar no-print">
  <span><strong>${escapeHtml(docTitle)}</strong> &mdash; preview before printing</span>
  <button onclick="window.print()">Print / Save as PDF</button>
</div>

<div class="page">
  <div class="hdr">
    <img src="${logoSrc}" alt="Fraxinus Environmental &amp; Geomatics" onerror="this.style.display='none'">
    <div>
      <div class="doc-title">Fish Catalogue Field Report</div>
      <div class="doc-sub">Generated ${escapeHtml(generatedStr)}</div>
    </div>
  </div>

  <h2>Survey / Station Metadata</h2>
  <div class="mg">${buildSurveyMetaGrid(s)}</div>
  ${s.notes ? `<h3 class="sub">General notes</h3><p>${escapeHtml(s.notes)}</p>` : ''}

  ${habitatHtml}

  <h2>Fish Catalogue (${fishRecords.length})</h2>
  ${flagNote}
  ${fishTableHtml}

  <div class="ft">
    <span>Fraxinus Environmental &amp; Geomatics</span>
    <span>NS Fish Field ID &amp; Catalogue</span>
    <span>${escapeHtml(s.siteId || s.stationId || '')} &middot; ${escapeHtml(generatedAt.toLocaleDateString('en-CA'))}</span>
  </div>
</div>

</body>
</html>`;
}

/**
 * Open a print-ready report for one survey/station in a new window.
 * @param {Object} survey
 * @param {Array} fishRecords
 */
export function openSurveyPdfReport(survey, fishRecords) {
  const w = window.open('', '_blank', 'width=980,height=800,scrollbars=yes');
  if (!w) {
    alert('Pop-up blocked — please allow pop-ups for this app, then try again.');
    return;
  }
  w.document.write(buildReportHtml(survey, fishRecords));
  w.document.close();
}
