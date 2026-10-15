// Controlled vocabularies and small calculations shared between the live
// survey form (catalogue.js), its Settings defaults (settings.js), and the
// PDF report (pdf-report.js) — kept in one place so the three can't drift
// out of sync with each other.

export const SKY_OPTIONS = ['Clear', 'Partly cloudy', 'Overcast', 'Light precipitation', 'Heavy precipitation'];
export const WIND_OPTIONS = ['Calm', 'Light', 'Moderate', 'Strong'];
export const SURVEY_PURPOSE_OPTIONS = ['Index / monitoring station', 'Fish salvage', 'Habitat assessment', 'Baseline / pre-development survey', 'Other'];
export const CAPTURE_METHODS = ['Electrofishing', 'Minnow trap', 'Seine', 'Angling', 'Fyke net', 'Gillnet', 'Dip net', 'Other trap', 'Other'];
export const LIFE_STAGE_LABELS = { egg: 'Egg', elver: 'Elver / glass eel', fry: 'Fry', parr: 'Parr', juvenile: 'Juvenile', adult: 'Adult' };
export const VEGETATION_STRATA = [
  { key: 'canopy', label: 'Canopy / overstory' },
  { key: 'understory', label: 'Understory / shrub' },
  { key: 'herbaceous', label: 'Herbaceous / groundcover' },
  { key: 'aquatic', label: 'Aquatic / emergent (instream)' },
];

// Depth measurements (array of raw string/number inputs) -> {avg, max, n}, or null if none are valid numbers.
export function depthStats(measurements) {
  const nums = (measurements || []).map(Number).filter((n) => !isNaN(n));
  if (!nums.length) return null;
  return { avg: nums.reduce((a, b) => a + b, 0) / nums.length, max: Math.max(...nums), n: nums.length };
}

// Trap deploy/retrieve datetime-local strings -> duration in ms, or null if either is missing/unparseable.
// A negative result means retrieval was entered before deployment — callers decide how to flag that.
export function trapSoakMs(deployed, retrieved) {
  if (!deployed || !retrieved) return null;
  const ms = new Date(retrieved) - new Date(deployed);
  return isNaN(ms) ? null : ms;
}

export function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
