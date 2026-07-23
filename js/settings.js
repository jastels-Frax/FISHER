// App-wide Settings panel: survey defaults that pre-fill every new survey
// (mirrors the "Metadata" settings drawer convention used in the sibling
// Watercourse Permitting App), plus a few app preferences. Stored in
// localStorage — small, synchronous, no IndexedDB ceremony needed for this.
import { escapeHtml, showToast } from './app.js';

export const SETTINGS_KEY = 'fisher-settings';

const SKY_OPTIONS = ['Clear', 'Partly cloudy', 'Overcast', 'Light precipitation', 'Heavy precipitation'];
const WIND_OPTIONS = ['Calm', 'Light', 'Moderate', 'Strong'];
const SURVEY_PURPOSE_OPTIONS = ['Index / monitoring station', 'Fish salvage', 'Habitat assessment', 'Baseline / pre-development survey', 'Other'];
const CAPTURE_METHODS = ['Electrofishing', 'Minnow trap', 'Seine', 'Angling', 'Fyke net', 'Gillnet', 'Dip net', 'Other trap', 'Other'];

function defaultSettings() {
  return {
    observerNames: '', projectId: '', watershed: '', waterbodyName: '', permitNumber: '',
    crewSize: '', gearEffort: '', surveyPurpose: '', defaultSky: '', defaultWind: '',
    defaultCaptureMethod: '', theme: 'auto', autoGps: false,
  };
}

export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaultSettings(), ...JSON.parse(raw) } : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

function persist(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function applyStoredTheme() {
  const { theme } = getSettings();
  if (theme && theme !== 'auto') document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
}

function opt(list, value) {
  return list.map((v) => `<option value="${escapeHtml(v)}" ${v === value ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

let overlayEl = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.className = 'modal-overlay';
  overlayEl.hidden = true;
  document.body.appendChild(overlayEl);
  return overlayEl;
}

function render(s) {
  return `
    <div class="modal-panel" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="modal-panel-header">
        <h2>Settings</h2>
        <button type="button" class="modal-close" data-role="close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-panel-body">
        <p class="field-hint">Survey defaults below pre-fill the metadata section every time you start a <strong>new</strong> survey &mdash; you can still edit any field per survey before saving. Nothing here changes surveys already logged.</p>

        <h3 style="margin-top:18px">Survey defaults</h3>
        <label>Observer(s) / technician name(s)</label>
        <input type="text" id="set-observerNames" value="${escapeHtml(s.observerNames)}" placeholder="e.g. J. Astle, T. Fraser">
        <label>Project ID</label>
        <input type="text" id="set-projectId" value="${escapeHtml(s.projectId)}" placeholder="e.g. 2026-087">
        <label>Watershed</label>
        <input type="text" id="set-watershed" value="${escapeHtml(s.watershed)}">
        <label>Water body name</label>
        <input type="text" id="set-waterbodyName" value="${escapeHtml(s.waterbodyName)}">
        <label>Licence / permit number</label>
        <input type="text" id="set-permitNumber" value="${escapeHtml(s.permitNumber)}">
        <label>Crew size</label>
        <input type="number" id="set-crewSize" value="${escapeHtml(s.crewSize)}" min="1">
        <label>Gear type / effort</label>
        <input type="text" id="set-gearEffort" value="${escapeHtml(s.gearEffort)}" placeholder="e.g. backpack electrofisher">
        <label>Survey purpose</label>
        <select id="set-surveyPurpose"><option value="">No default</option>${opt(SURVEY_PURPOSE_OPTIONS, s.surveyPurpose)}</select>
        <label>Default sky / precipitation</label>
        <select id="set-defaultSky"><option value="">No default</option>${opt(SKY_OPTIONS, s.defaultSky)}</select>
        <label>Default wind</label>
        <select id="set-defaultWind"><option value="">No default</option>${opt(WIND_OPTIONS, s.defaultWind)}</select>
        <p class="field-hint">Air temperature isn't presettable &mdash; it's a point-in-time reading, so that field always starts blank.</p>

        <h3 style="margin-top:22px">Fish record default</h3>
        <label>Default capture method</label>
        <select id="set-defaultCaptureMethod"><option value="">No default</option>${opt(CAPTURE_METHODS, s.defaultCaptureMethod)}</select>
        <p class="field-hint">Pre-selects the capture method on every new fish record &mdash; handy on a single-method day (e.g. electrofishing all day).</p>

        <h3 style="margin-top:22px">App preferences</h3>
        <label>Theme</label>
        <select id="set-theme">
          <option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Match device (auto)</option>
          <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option>
          <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option>
        </select>
        <label style="display:flex;align-items:center;gap:10px;text-transform:none;margin-top:16px">
          <input type="checkbox" id="set-autoGps" ${s.autoGps ? 'checked' : ''} style="width:24px;height:24px;flex-shrink:0;accent-color:var(--accent)">
          <span>Automatically capture GPS when starting a new survey</span>
        </label>
        <p class="field-hint">Triggers the device location prompt right away instead of waiting for you to tap Capture. Off by default.</p>

        <button type="button" class="btn btn-accent" data-role="save" style="margin-top:24px">Save Settings</button>

        <h3 style="margin-top:26px">Data</h3>
        <button type="button" class="btn btn-outline" data-role="reset">Clear saved presets</button>
        <p class="field-hint">Resets everything on this screen to blank. Logged surveys/fish records and export queue are not affected &mdash; see the Export page for that.</p>
      </div>
    </div>
  `;
}

function close(overlay) {
  overlay.hidden = true;
  document.body.style.overflow = '';
}

function wireEvents(overlay) {
  overlay.querySelector('[data-role="close"]').addEventListener('click', () => close(overlay));

  overlay.querySelector('[data-role="save"]').addEventListener('click', () => {
    const next = {
      observerNames: overlay.querySelector('#set-observerNames').value.trim(),
      projectId: overlay.querySelector('#set-projectId').value.trim(),
      watershed: overlay.querySelector('#set-watershed').value.trim(),
      waterbodyName: overlay.querySelector('#set-waterbodyName').value.trim(),
      permitNumber: overlay.querySelector('#set-permitNumber').value.trim(),
      crewSize: overlay.querySelector('#set-crewSize').value.trim(),
      gearEffort: overlay.querySelector('#set-gearEffort').value.trim(),
      surveyPurpose: overlay.querySelector('#set-surveyPurpose').value,
      defaultSky: overlay.querySelector('#set-defaultSky').value,
      defaultWind: overlay.querySelector('#set-defaultWind').value,
      defaultCaptureMethod: overlay.querySelector('#set-defaultCaptureMethod').value,
      theme: overlay.querySelector('#set-theme').value,
      autoGps: overlay.querySelector('#set-autoGps').checked,
    };
    persist(next);
    applyStoredTheme();
    showToast('Settings saved');
    close(overlay);
  });

  overlay.querySelector('[data-role="reset"]').addEventListener('click', () => {
    if (!confirm('Clear all saved presets? This only resets the defaults on this screen.')) return;
    localStorage.removeItem(SETTINGS_KEY);
    overlay.innerHTML = render(defaultSettings());
    wireEvents(overlay);
    showToast('Presets cleared');
  });
}

export function openSettingsPanel() {
  const overlay = ensureOverlay();
  overlay.innerHTML = render(getSettings());
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  overlay.onclick = (e) => { if (e.target === overlay) close(overlay); };
  wireEvents(overlay);
}

export function initSettingsButton() {
  const btn = document.querySelector('[data-settings-btn]');
  if (btn) btn.addEventListener('click', openSettingsPanel);
}
