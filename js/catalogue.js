import { initHeaderNav, showToast, nowLocalDatetimeValue, captureGeolocation, escapeHtml } from './app.js';
import { FisherDB, newId } from './db.js';
import { openIdentifyModal } from './identify-modal.js';

initHeaderNav();

// ---- Controlled vocabularies -------------------------------------------------
// Sourced where noted from: NS Fish Habitat Suitability Assessment Manual v2.1 (2018, NS
// Salmon Association / Adopt-A-Stream), DFO Guide to Fish Passage, BC RISC Fish Collection
// Methods & Standards v4.0, USGS Illustrated Field Guide for Assessing Anomalies in Fish.
// Fields marked "(convention)" are standard field-survey practice but could not be verified
// verbatim against a current NS/DFO document in this pass — see README for details.
const SKY_OPTIONS = ['Clear', 'Partly cloudy', 'Overcast', 'Light precipitation', 'Heavy precipitation'];
const WIND_OPTIONS = ['Calm', 'Light', 'Moderate', 'Strong'];
const SURVEY_PURPOSE_OPTIONS = ['Index / monitoring station', 'Fish salvage', 'Habitat assessment', 'Baseline / pre-development survey', 'Other'];
const WATER_LEVEL_OPTIONS = ['Low / base flow', 'Normal', 'High / freshet', 'Flood'];
const CHANNEL_UNIT_OPTIONS = ['Pool', 'Riffle', 'Run', 'Glide'];
const SUBSTRATE_CLASSES = ['Fines (silt/sand/clay)', 'Gravel', 'Cobble', 'Boulder', 'Bedrock / hardpan'];
const EMBEDDEDNESS_OPTIONS = ['<25%', '25-50%', '50-75%', '>75%'];
const COVER_TYPES = ['Large woody debris', 'Undercut banks', 'Overhanging vegetation', 'Aquatic vegetation', 'Boulders'];
const COVER_ABUNDANCE = ['None', 'Low', 'Moderate', 'High'];
const BANK_STABILITY = ['Stable', 'Moderately stable', 'Eroding', 'Severely eroding'];
const BARRIER_TYPE = ['None observed', 'Complete barrier', 'Partial barrier', 'Temporal barrier'];
const BARRIER_STRUCTURE = ['Culvert', 'Dam', 'Natural falls / cascade', 'Beaver dam', 'Debris jam', 'Other'];
const CAPTURE_METHODS = ['Electrofishing', 'Minnow trap', 'Seine', 'Angling', 'Fyke net', 'Gillnet', 'Dip net', 'Other trap', 'Other'];
const CONDITION_FLAGS = ['Healthy', 'Deformity', 'Eroded fin(s)', 'Lesion(s)', 'Tumor(s)', 'Parasites', 'Other anomaly'];
const DISPOSITION_OPTIONS = ['Released alive', 'Retained (voucher/sample)', 'Mortality'];
const LIFE_STAGE_LABELS = { egg: 'Egg', elver: 'Elver / glass eel', fry: 'Fry', parr: 'Parr', juvenile: 'Juvenile', adult: 'Adult' };

let refSpecies = [];
let refImages = {};
let refKeyTree = null;
let currentSurvey = null;
let currentFishRecords = [];
let addFishOpen = false;
let fishDraft = null;

const root = document.getElementById('catalogue-root');

function opt(list, value) {
  return list.map((v) => `<option value="${escapeHtml(v)}" ${v === value ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

function draftKey(surveyId) { return `fisher-draft-fish-${surveyId}`; }

// ---------------------------------------------------------------- List view --
async function renderSurveyList() {
  const surveys = await FisherDB.listSurveys();
  root.innerHTML = `
    <button type="button" class="btn btn-accent" id="new-survey-btn">+ New Survey / Station</button>
    <h2 style="margin-top:18px">Surveys on this device</h2>
    ${surveys.length ? surveys.map(surveyRowHtml).join('') : '<p class="empty-state">No surveys logged yet on this device.</p>'}
  `;
  document.getElementById('new-survey-btn').addEventListener('click', () => openSurvey(null));
  surveys.forEach((s) => {
    document.getElementById(`open-${s.id}`).addEventListener('click', () => openSurvey(s.id));
  });
}

function surveyRowHtml(s) {
  return `
    <button type="button" class="record-list-item" style="width:100%;text-align:left;border:none;cursor:pointer" id="open-${escapeHtml(s.id)}">
      <strong>${escapeHtml(s.siteId || s.stationId || 'Unnamed site')}</strong>
      ${s.flaggedForFollowUp ? '<span class="badge" style="background:var(--danger)">follow-up flagged</span>' : ''}
      <div class="meta">${escapeHtml((s.dateTime || '').replace('T', ' '))} &middot; ${escapeHtml(s.observerNames || 'no observer set')}</div>
    </button>
  `;
}

// --------------------------------------------------------------- Survey view --
async function openSurvey(surveyId) {
  if (surveyId) {
    currentSurvey = await FisherDB.get('surveys', surveyId);
    currentFishRecords = await FisherDB.listFishRecords(surveyId);
  } else {
    currentSurvey = {
      id: newId('survey'),
      dateTime: nowLocalDatetimeValue(),
      observerNames: '', stationId: '', siteId: '', waterbodyName: '', watershed: '',
      gps: null, gpsManualNote: '',
      weather: { airTempC: '', sky: '', wind: '', windSpeedKmh: '', notes: '' },
      surveyPurpose: '', permitNumber: '', crewSize: '', gearEffort: '', waterLevel: '',
      habitat: {},
      notes: '', flaggedForFollowUp: false,
      createdAt: new Date().toISOString(),
    };
    currentFishRecords = [];
    await FisherDB.put('surveys', currentSurvey);
  }
  addFishOpen = false;
  fishDraft = loadFishDraft();
  renderSurveyForm();
}

function loadFishDraft() {
  try {
    const raw = localStorage.getItem(draftKey(currentSurvey.id));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveFishDraft(draft) {
  try { localStorage.setItem(draftKey(currentSurvey.id), JSON.stringify(draft)); } catch { /* storage unavailable */ }
}
function clearFishDraft() {
  try { localStorage.removeItem(draftKey(currentSurvey.id)); } catch { /* storage unavailable */ }
}

async function persistSurvey() {
  currentSurvey.updatedAt = new Date().toISOString();
  await FisherDB.put('surveys', currentSurvey);
}

function renderSurveyForm() {
  const s = currentSurvey;
  root.innerHTML = `
    <button type="button" class="btn btn-outline btn-sm" id="back-to-list">&larr; All surveys</button>

    <h2 style="margin-top:12px">Survey / Station Metadata</h2>
    <p class="field-hint">Always required &mdash; every logged fish is nested under this record.</p>

    <label>Observer(s) / technician name(s) <span class="req">*</span></label>
    <input type="text" id="f-observerNames" value="${escapeHtml(s.observerNames)}" placeholder="e.g. J. Astle, T. Fraser">

    <label>Date &amp; time <span class="req">*</span></label>
    <input type="datetime-local" id="f-dateTime" value="${escapeHtml(s.dateTime)}">

    <label>Station ID</label>
    <input type="text" id="f-stationId" value="${escapeHtml(s.stationId || '')}" placeholder="Fixed station code, if this is a repeat-visit index site">
    <label>Site name / description <span class="req">*</span></label>
    <input type="text" id="f-siteId" value="${escapeHtml(s.siteId)}" placeholder="e.g. Nine Mile River at Hwy 14 crossing">

    <label>GPS coordinates</label>
    <div class="identify-row">
      <input type="text" id="f-gps" value="${s.gps ? `${s.gps.lat.toFixed(6)}, ${s.gps.lon.toFixed(6)}` : ''}" placeholder="Tap Capture, or enter manually as lat, lon">
      <button type="button" class="identify-btn" id="capture-gps-btn"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.3"/></svg>Capture</button>
    </div>
    <p class="field-hint">Decimal degrees, WGS84. Editable manually if capture fails or needs correcting.</p>

    <label>Water body name</label>
    <input type="text" id="f-waterbodyName" value="${escapeHtml(s.waterbodyName)}">
    <label>Watershed</label>
    <input type="text" id="f-watershed" value="${escapeHtml(s.watershed)}">

    <fieldset>
      <legend>Weather</legend>
      <label>Air temperature (°C)</label>
      <input type="number" id="f-airTempC" value="${escapeHtml(s.weather.airTempC)}" step="0.1">
      <label>Sky / precipitation</label>
      <select id="f-sky"><option value="">Select&hellip;</option>${opt(SKY_OPTIONS, s.weather.sky)}</select>
      <label>Wind</label>
      <select id="f-wind"><option value="">Select&hellip;</option>${opt(WIND_OPTIONS, s.weather.wind)}</select>
      <label>Weather notes</label>
      <textarea id="f-weatherNotes">${escapeHtml(s.weather.notes)}</textarea>
    </fieldset>

    <fieldset>
      <legend>Survey details</legend>
      <label>Survey purpose</label>
      <select id="f-purpose"><option value="">Select&hellip;</option>${opt(SURVEY_PURPOSE_OPTIONS, s.surveyPurpose)}</select>
      <label>Scientific licence / permit number</label>
      <input type="text" id="f-permit" value="${escapeHtml(s.permitNumber || '')}">
      <label>Crew size</label>
      <input type="number" id="f-crewSize" value="${escapeHtml(s.crewSize)}" min="1">
      <label>Gear type / effort</label>
      <input type="text" id="f-gearEffort" value="${escapeHtml(s.gearEffort || '')}" placeholder="e.g. backpack electrofisher, 3 passes, 20 min shocking time">
      <label>Water level / flow condition</label>
      <select id="f-waterLevel"><option value="">Select&hellip;</option>${opt(WATER_LEVEL_OPTIONS, s.waterLevel)}</select>
    </fieldset>

    ${habitatSectionHtml(s.habitat)}

    <label>General survey notes</label>
    <textarea id="f-notes">${escapeHtml(s.notes)}</textarea>

    <p class="field-hint" id="autosave-indicator">Changes autosave to this device.</p>

    <hr style="border-color:var(--line);margin:20px 0">
    <h2>Fish caught (${currentFishRecords.length})</h2>
    ${currentFishRecords.length ? currentFishRecords.map(fishRowHtml).join('') : '<p class="empty-state">No fish logged yet for this survey.</p>'}

    ${addFishOpen ? fishFormHtml(fishDraft) : `<button type="button" class="btn btn-accent" id="add-fish-btn">+ Add Fish Record</button>`}
  `;

  wireSurveyFormEvents();
  if (addFishOpen) wireFishFormEvents();
}

function habitatSectionHtml(h) {
  h = h || {};
  const wc = h.waterChemistry || {}; const cm = h.channelMorphology || {}; const sub = h.substrate || {};
  const cov = h.cover || {}; const rip = h.riparian || {}; const flow = h.flow || {}; const barrier = h.barrier || {};
  return `
    <details class="section-collapsible" id="habitat-details" style="margin-bottom:12px">
      <summary>
        <span class="summary-label">Habitat Characterization <span class="field-hint">(optional &mdash; expand only if not already on file)</span></span>
        <svg class="chevron-ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </summary>
      <div class="collapsible-body">
      <p class="field-hint">Every field below is independently optional. Skip anything already documented for this station.</p>

      <fieldset><legend>Water chemistry</legend>
        <label>Water temperature (°C)</label><input type="number" step="0.1" id="h-temp" value="${escapeHtml(wc.tempC || '')}">
        <label>Dissolved oxygen (mg/L)</label><input type="number" step="0.1" id="h-do" value="${escapeHtml(wc.doMgL || '')}">
        <label>pH</label><input type="number" step="0.1" id="h-ph" value="${escapeHtml(wc.ph || '')}">
        <label>Conductivity (µS/cm)</label><input type="number" step="1" id="h-cond" value="${escapeHtml(wc.conductivityUsCm || '')}">
      </fieldset>

      <fieldset><legend>Channel morphology</legend>
        <label>Wetted width (m)</label><input type="number" step="0.1" id="h-wettedWidth" value="${escapeHtml(cm.wettedWidthM || '')}">
        <label>Bankfull width (m)</label><input type="number" step="0.1" id="h-bankfullWidth" value="${escapeHtml(cm.bankfullWidthM || '')}">
        <label>Depth &mdash; average (cm)</label><input type="number" step="1" id="h-depthAvg" value="${escapeHtml(cm.depthAvgCm || '')}">
        <label>Depth &mdash; max (cm)</label><input type="number" step="1" id="h-depthMax" value="${escapeHtml(cm.depthMaxCm || '')}">
        <label>Gradient (%)</label><input type="number" step="0.1" id="h-gradient" value="${escapeHtml(cm.gradientPct || '')}">
        <label>Dominant channel unit type <span class="field-hint">(standard convention, not NS/DFO-verbatim)</span></label>
        <select id="h-channelUnit"><option value="">Select&hellip;</option>${opt(CHANNEL_UNIT_OPTIONS, cm.channelUnit || '')}</select>
      </fieldset>

      <fieldset><legend>Substrate &amp; embeddedness <span class="field-hint">(5-class scheme per NS Fish Habitat Suitability Assessment Manual)</span></legend>
        <label>Dominant substrate</label><select id="h-subDominant"><option value="">Select&hellip;</option>${opt(SUBSTRATE_CLASSES, sub.dominant || '')}</select>
        <label>Subdominant substrate</label><select id="h-subSubdominant"><option value="">Select&hellip;</option>${opt(SUBSTRATE_CLASSES, sub.subdominant || '')}</select>
        <label>Embeddedness</label><select id="h-embeddedness"><option value="">Select&hellip;</option>${opt(EMBEDDEDNESS_OPTIONS, sub.embeddedness || '')}</select>
      </fieldset>

      <fieldset><legend>Instream cover</legend>
        ${COVER_TYPES.map((c, i) => `
          <label>${escapeHtml(c)}</label>
          <select id="h-cover-${i}"><option value="">Select&hellip;</option>${opt(COVER_ABUNDANCE, (cov[c] || ''))}</select>
        `).join('')}
      </fieldset>

      <fieldset><legend>Riparian condition</legend>
        <label>Buffer width (m)</label><input type="number" step="0.5" id="h-bufferWidth" value="${escapeHtml(rip.bufferWidthM || '')}">
        <label>Canopy cover (%)</label><input type="number" step="1" id="h-canopy" value="${escapeHtml(rip.canopyCoverPct || '')}">
        <label>Bank stability</label><select id="h-bankStability"><option value="">Select&hellip;</option>${opt(BANK_STABILITY, rip.bankStability || '')}</select>
        <label>Dominant riparian vegetation</label><input type="text" id="h-vegType" value="${escapeHtml(rip.vegetationType || '')}">
      </fieldset>

      <fieldset><legend>Flow</legend>
        <label>Discharge, if measured</label><input type="text" id="h-discharge" value="${escapeHtml(flow.discharge || '')}" placeholder="value + unit, e.g. 0.4 m³/s">
        <label>Flow regime notes</label><input type="text" id="h-flowRegime" value="${escapeHtml(flow.regimeNotes || '')}" placeholder="e.g. base flow, freshet">
      </fieldset>

      <fieldset><legend>Barriers / connectivity <span class="field-hint">(DFO fish passage categories)</span></legend>
        <label>Barrier type</label><select id="h-barrierType"><option value="">Select&hellip;</option>${opt(BARRIER_TYPE, barrier.type || '')}</select>
        <label>Structure</label><select id="h-barrierStructure"><option value="">Select&hellip;</option>${opt(BARRIER_STRUCTURE, barrier.structure || '')}</select>
        <label>Notes</label><input type="text" id="h-barrierNotes" value="${escapeHtml(barrier.notes || '')}">
      </fieldset>

      <fieldset><legend>Other</legend>
        <label>Benthic macroinvertebrates observed (optional)</label>
        <textarea id="h-benthic">${escapeHtml(h.benthicNotes || '')}</textarea>
        <label>Site photo reference (filename/ID)</label>
        <input type="text" id="h-photoRef" value="${escapeHtml(h.photoRef || '')}" placeholder="e.g. IMG_0231-0234, facing downstream">
      </fieldset>
      </div>
    </details>
  `;
}

function fishRowHtml(r) {
  const name = r.unidentified ? 'Unidentified — see key' : r.speciesCommonName;
  return `
    <div class="record-list-item">
      <strong>${escapeHtml(name)}</strong> ${r.lifeStage ? `<span class="badge">${escapeHtml(LIFE_STAGE_LABELS[r.lifeStage] || r.lifeStage)}</span>` : ''}
      ${r.unidentified ? '<span class="badge" style="background:var(--danger)">follow-up</span>' : ''}
      <div class="meta">${r.lengthMm ? `${escapeHtml(r.lengthMm)} mm` : ''} ${r.weightG ? `&middot; ${escapeHtml(r.weightG)} g` : ''} &middot; ${escapeHtml(r.captureMethod || 'method n/a')}</div>
      <div class="meta">${(r.conditionFlags || []).map(escapeHtml).join(', ')}</div>
      <button type="button" class="btn btn-outline btn-sm" data-delete-fish="${escapeHtml(r.id)}" style="margin-top:6px">Delete</button>
    </div>
  `;
}

function fishFormHtml(draft) {
  draft = draft || defaultFishDraft();
  return `
    <div class="card" id="fish-form-card">
      <h3>New Fish Record</h3>
      <label>Species <span class="req">*</span></label>
      <div class="identify-row">
        <select id="ff-species">
          <option value="unidentified" ${draft.unidentified ? 'selected' : ''}>Unidentified — see key</option>
          ${refSpecies.map((s) => `<option value="${escapeHtml(s.id)}" ${draft.speciesId === s.id ? 'selected' : ''}>${escapeHtml(s.commonName)}</option>`).join('')}
        </select>
        <button type="button" class="identify-btn" id="ff-identify-btn"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15 20 20"/></svg>Identify</button>
      </div>
      ${draft.unidentified ? '<p class="flag-note">Flagged for follow-up. Photograph this fish if possible, then confirm the ID later via Species Reference or the Key.</p>' : ''}

      <label>Life stage</label>
      <select id="ff-lifeStage">
        <option value="">Select&hellip;</option>
        ${Object.keys(LIFE_STAGE_LABELS).map((k) => `<option value="${k}" ${draft.lifeStage === k ? 'selected' : ''}>${LIFE_STAGE_LABELS[k]}</option>`).join('')}
      </select>

      <label>Length (mm)</label>
      <input type="number" id="ff-length" value="${escapeHtml(draft.lengthMm)}" step="1" min="0">
      <label>Weight (g)</label>
      <input type="number" id="ff-weight" value="${escapeHtml(draft.weightG)}" step="0.1" min="0">

      <label>Condition / health flags</label>
      <div class="chip-group" id="ff-condition-chips">
        ${CONDITION_FLAGS.map((c) => `<button type="button" class="chip ${(draft.conditionFlags || []).includes(c) ? 'selected' : ''} ${c !== 'Healthy' ? 'flag-danger' : ''}" data-flag="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
      </div>
      <label>Condition notes</label>
      <textarea id="ff-conditionNotes">${escapeHtml(draft.conditionNotes || '')}</textarea>

      <label>Disposition</label>
      <select id="ff-disposition"><option value="">Select&hellip;</option>${opt(DISPOSITION_OPTIONS, draft.disposition || '')}</select>

      <label>Capture method <span class="req">*</span></label>
      <select id="ff-method"><option value="">Select&hellip;</option>${opt(CAPTURE_METHODS, draft.captureMethod || '')}</select>
      ${draft.captureMethod === 'Other' ? `<input type="text" id="ff-methodOther" value="${escapeHtml(draft.captureMethodOther || '')}" placeholder="Specify method">` : ''}

      <label>Technician name</label>
      <input type="text" id="ff-technician" value="${escapeHtml(draft.technicianName || '')}">

      <label>Photo (optional, stored on this device only)</label>
      <input type="file" id="ff-photo" accept="image/*" capture="environment">
      ${draft.photoName ? `<p class="field-hint">Attached: ${escapeHtml(draft.photoName)}</p>` : ''}

      <label>Notes</label>
      <textarea id="ff-notes">${escapeHtml(draft.notes || '')}</textarea>

      <button type="button" class="btn btn-accent" id="save-fish-btn">Save Fish Record</button>
      <button type="button" class="btn btn-outline" id="cancel-fish-btn">Cancel</button>
    </div>
  `;
}

function defaultFishDraft() {
  return {
    speciesId: null, speciesCommonName: '', unidentified: false, lifeStage: '',
    lengthMm: '', weightG: '', conditionFlags: [], conditionNotes: '', disposition: '',
    captureMethod: '', captureMethodOther: '', technicianName: currentSurvey.observerNames || '',
    notes: '', photoName: null, photoBlob: null,
  };
}

function readFishFormIntoDraft() {
  const d = fishDraft || defaultFishDraft();
  const speciesSel = document.getElementById('ff-species').value;
  if (speciesSel !== 'unidentified') {
    const sp = refSpecies.find((s) => s.id === speciesSel);
    d.speciesId = sp ? sp.id : null;
    d.speciesCommonName = sp ? sp.commonName : '';
    d.unidentified = false;
  }
  d.lifeStage = document.getElementById('ff-lifeStage').value;
  d.lengthMm = document.getElementById('ff-length').value;
  d.weightG = document.getElementById('ff-weight').value;
  d.conditionNotes = document.getElementById('ff-conditionNotes').value;
  d.disposition = document.getElementById('ff-disposition').value;
  d.captureMethod = document.getElementById('ff-method').value;
  const otherEl = document.getElementById('ff-methodOther');
  if (otherEl) d.captureMethodOther = otherEl.value;
  d.technicianName = document.getElementById('ff-technician').value;
  d.notes = document.getElementById('ff-notes').value;
  fishDraft = d;
  return d;
}

function wireFishFormEvents() {
  document.getElementById('ff-species').addEventListener('change', (e) => {
    readFishFormIntoDraft();
    fishDraft.unidentified = e.target.value === 'unidentified';
    saveFishDraft(fishDraft);
    renderSurveyForm();
  });
  document.getElementById('ff-method').addEventListener('change', () => { readFishFormIntoDraft(); saveFishDraft(fishDraft); renderSurveyForm(); });
  ['ff-lifeStage', 'ff-length', 'ff-weight', 'ff-conditionNotes', 'ff-disposition', 'ff-technician', 'ff-notes'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { readFishFormIntoDraft(); saveFishDraft(fishDraft); });
  });
  const methodOther = document.getElementById('ff-methodOther');
  if (methodOther) methodOther.addEventListener('input', () => { readFishFormIntoDraft(); saveFishDraft(fishDraft); });

  document.querySelectorAll('#ff-condition-chips [data-flag]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const flag = chip.getAttribute('data-flag');
      readFishFormIntoDraft();
      const flags = new Set(fishDraft.conditionFlags || []);
      if (flags.has(flag)) flags.delete(flag); else flags.add(flag);
      fishDraft.conditionFlags = Array.from(flags);
      saveFishDraft(fishDraft);
      chip.classList.toggle('selected');
    });
  });

  document.getElementById('ff-photo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readFishFormIntoDraft();
    fishDraft.photoName = file.name;
    fishDraft.photoBlob = file;
    showToast('Photo attached');
  });

  document.getElementById('ff-identify-btn').addEventListener('click', () => {
    readFishFormIntoDraft();
    openIdentifyModal({
      species: refSpecies, images: refImages, keyTree: refKeyTree,
      onConfirm: ({ species, lifeStage, unidentified }) => {
        readFishFormIntoDraft();
        if (unidentified) {
          fishDraft.speciesId = null; fishDraft.speciesCommonName = ''; fishDraft.unidentified = true;
        } else {
          fishDraft.speciesId = species.id; fishDraft.speciesCommonName = species.commonName; fishDraft.unidentified = false;
          if (lifeStage) fishDraft.lifeStage = lifeStage;
        }
        saveFishDraft(fishDraft);
        renderSurveyForm();
        showToast(unidentified ? 'Marked unidentified — see key' : `Species set: ${species.commonName}`);
      },
    });
  });

  document.getElementById('save-fish-btn').addEventListener('click', async () => {
    const d = readFishFormIntoDraft();
    if (!d.unidentified && !d.speciesId) { showToast('Pick a species, or choose "Unidentified — see key"'); return; }
    if (!d.captureMethod) { showToast('Capture method is required'); return; }
    const record = {
      id: newId('fish'),
      surveyId: currentSurvey.id,
      createdAt: new Date().toISOString(),
      dateTime: currentSurvey.dateTime,
      siteId: currentSurvey.siteId,
      gps: currentSurvey.gps,
      speciesId: d.speciesId,
      speciesCommonName: d.unidentified ? 'Unidentified — see key' : d.speciesCommonName,
      unidentified: !!d.unidentified,
      lifeStage: d.lifeStage || null,
      lengthMm: d.lengthMm ? Number(d.lengthMm) : null,
      weightG: d.weightG ? Number(d.weightG) : null,
      conditionFlags: d.conditionFlags || [],
      conditionNotes: d.conditionNotes || '',
      disposition: d.disposition || '',
      captureMethod: d.captureMethod === 'Other' ? (d.captureMethodOther || 'Other') : d.captureMethod,
      technicianName: d.technicianName || '',
      notes: d.notes || '',
      photo: d.photoBlob ? { blob: d.photoBlob, name: d.photoName, mimeType: d.photoBlob.type } : null,
    };
    await FisherDB.put('fishRecords', record);
    currentFishRecords.push(record);
    if (record.unidentified) {
      currentSurvey.flaggedForFollowUp = true;
      await persistSurvey();
    }
    clearFishDraft();
    fishDraft = null;
    addFishOpen = false;
    showToast('Fish record saved');
    renderSurveyForm();
  });

  document.getElementById('cancel-fish-btn').addEventListener('click', () => {
    clearFishDraft();
    fishDraft = null;
    addFishOpen = false;
    renderSurveyForm();
  });
}

function wireSurveyFormEvents() {
  document.getElementById('back-to-list').addEventListener('click', () => { currentSurvey = null; renderSurveyList(); });
  document.getElementById('add-fish-btn')?.addEventListener('click', () => { addFishOpen = true; fishDraft = loadFishDraft() || defaultFishDraft(); renderSurveyForm(); });

  document.querySelectorAll('[data-delete-fish]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete-fish');
      await FisherDB.delete('fishRecords', id);
      currentFishRecords = currentFishRecords.filter((r) => r.id !== id);
      renderSurveyForm();
    });
  });

  document.getElementById('capture-gps-btn').addEventListener('click', () => {
    captureGeolocation(
      (loc) => {
        currentSurvey.gps = loc;
        document.getElementById('f-gps').value = `${loc.lat.toFixed(6)}, ${loc.lon.toFixed(6)}`;
        persistSurvey();
        showToast('GPS captured');
      },
      (err) => showToast('Could not get GPS: ' + err.message)
    );
  });

  const bindings = [
    ['f-observerNames', 'observerNames'], ['f-dateTime', 'dateTime'], ['f-stationId', 'stationId'],
    ['f-siteId', 'siteId'], ['f-waterbodyName', 'waterbodyName'], ['f-watershed', 'watershed'],
    ['f-purpose', 'surveyPurpose'], ['f-permit', 'permitNumber'], ['f-crewSize', 'crewSize'],
    ['f-gearEffort', 'gearEffort'], ['f-waterLevel', 'waterLevel'], ['f-notes', 'notes'],
  ];
  bindings.forEach(([id, key]) => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => { currentSurvey[key] = el.value; autosave(); });
    el.addEventListener('change', () => { currentSurvey[key] = el.value; autosave(); });
  });

  const weatherBindings = [['f-airTempC', 'airTempC'], ['f-sky', 'sky'], ['f-wind', 'wind'], ['f-weatherNotes', 'notes']];
  weatherBindings.forEach(([id, key]) => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => { currentSurvey.weather[key] = el.value; autosave(); });
    el.addEventListener('change', () => { currentSurvey.weather[key] = el.value; autosave(); });
  });

  document.getElementById('f-gps').addEventListener('change', (e) => {
    const parts = e.target.value.split(',').map((v) => parseFloat(v.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      currentSurvey.gps = { lat: parts[0], lon: parts[1], accuracyM: null, manual: true };
      autosave();
    }
  });

  wireHabitatEvents();
}

function habitatPath(key) {
  currentSurvey.habitat = currentSurvey.habitat || {};
  return currentSurvey.habitat;
}

function wireHabitatEvents() {
  const h = currentSurvey.habitat = currentSurvey.habitat || {};
  h.waterChemistry = h.waterChemistry || {}; h.channelMorphology = h.channelMorphology || {};
  h.substrate = h.substrate || {}; h.cover = h.cover || {}; h.riparian = h.riparian || {};
  h.flow = h.flow || {}; h.barrier = h.barrier || {};

  const simple = [
    ['h-temp', h.waterChemistry, 'tempC'], ['h-do', h.waterChemistry, 'doMgL'], ['h-ph', h.waterChemistry, 'ph'], ['h-cond', h.waterChemistry, 'conductivityUsCm'],
    ['h-wettedWidth', h.channelMorphology, 'wettedWidthM'], ['h-bankfullWidth', h.channelMorphology, 'bankfullWidthM'],
    ['h-depthAvg', h.channelMorphology, 'depthAvgCm'], ['h-depthMax', h.channelMorphology, 'depthMaxCm'],
    ['h-gradient', h.channelMorphology, 'gradientPct'], ['h-channelUnit', h.channelMorphology, 'channelUnit'],
    ['h-subDominant', h.substrate, 'dominant'], ['h-subSubdominant', h.substrate, 'subdominant'], ['h-embeddedness', h.substrate, 'embeddedness'],
    ['h-bufferWidth', h.riparian, 'bufferWidthM'], ['h-canopy', h.riparian, 'canopyCoverPct'],
    ['h-bankStability', h.riparian, 'bankStability'], ['h-vegType', h.riparian, 'vegetationType'],
    ['h-discharge', h.flow, 'discharge'], ['h-flowRegime', h.flow, 'regimeNotes'],
    ['h-barrierType', h.barrier, 'type'], ['h-barrierStructure', h.barrier, 'structure'], ['h-barrierNotes', h.barrier, 'notes'],
  ];
  simple.forEach(([id, obj, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const handler = () => { obj[key] = el.value; autosave(); };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });

  COVER_TYPES.forEach((c, i) => {
    const el = document.getElementById(`h-cover-${i}`);
    if (!el) return;
    el.addEventListener('change', () => { h.cover[c] = el.value; autosave(); });
  });

  const benthic = document.getElementById('h-benthic');
  if (benthic) benthic.addEventListener('input', () => { h.benthicNotes = benthic.value; autosave(); });
  const photoRef = document.getElementById('h-photoRef');
  if (photoRef) photoRef.addEventListener('input', () => { h.photoRef = photoRef.value; autosave(); });
}

let autosaveTimer = null;
function autosave() {
  clearTimeout(autosaveTimer);
  const indicator = document.getElementById('autosave-indicator');
  if (indicator) indicator.textContent = 'Saving…';
  autosaveTimer = setTimeout(async () => {
    await persistSurvey();
    const el = document.getElementById('autosave-indicator');
    if (el) el.textContent = 'Autosaved to this device.';
  }, 500);
}

// ---------------------------------------------------------------------- Boot --
async function boot() {
  try { await FisherDB.seedReferenceData(); } catch (e) { console.warn('Reference data seed failed, using cache if present', e); }
  [refSpecies, refImages, refKeyTree] = await Promise.all([
    FisherDB.getSpeciesList(), FisherDB.getImageManifest(), FisherDB.getKeyTree(),
  ]);

  const params = new URLSearchParams(location.search);
  const surveyParam = params.get('survey');
  if (surveyParam) {
    await openSurvey(surveyParam);
  } else {
    renderSurveyList();
  }
}
boot();
