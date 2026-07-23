// iNaturalist direct search — fallback/supplement to GBIF for real photos.
// Docs: https://api.inaturalist.org/v1/docs/#!/Observations/get_observations
// Filters to observations whose photos carry an explicit open license set by
// the uploader (server-side photo_license param, double-checked client-side).

const { fetchJson } = require('./http');
const { normalizeLicense } = require('./license');

const API = 'https://api.inaturalist.org/v1/observations';
const OPEN_LICENSES = 'cc0,cc-by,cc-by-nc'; // kept in sync with license.js ALLOWLISTS.inaturalist
const MAX_CANDIDATES = 20;

function toMediumUrl(url) {
  if (!url) return url;
  return url.replace(/\/(square|small|thumb)\./, '/medium.');
}
function toOriginalUrl(url) {
  if (!url) return url;
  return url.replace(/\/(square|small|thumb|medium)\./, '/original.');
}

/**
 * iNaturalist does expose a "Life Stage" observation-field/annotation in some
 * records, but reliably resolving its numeric controlled-term IDs needs a
 * live lookup against /v1/controlled_terms that this script can't verify
 * from a network-restricted dev environment. Rather than hardcode IDs that
 * might be wrong, every iNaturalist candidate is left as lifeStageGuess
 * 'unknown' (confidence 'assumed') — the reviewer assigns the stage by eye.
 * If you want this automated later, fetch /v1/controlled_terms once, find
 * the "Life Stage" term's id and its value ids/labels, and map
 * observation.annotations accordingly.
 */
/** Pure function: one iNaturalist observation -> zero or more candidates.
 * Exported separately so it's unit-testable against saved fixture JSON
 * without needing live network access. */
function candidatesFromObservation(obs) {
  const out = [];
  for (const photo of obs.photos || []) {
    const { code, label } = normalizeLicense(photo.license_code);
    out.push({
      source: 'inaturalist',
      sourceType: 'photo',
      observationId: obs.id,
      sourceUrl: obs.uri || `https://www.inaturalist.org/observations/${obs.id}`,
      imageUrl: toMediumUrl(photo.url),
      originalImageUrl: toOriginalUrl(photo.url),
      licenseCode: code,
      licenseLabel: label,
      author: obs.user?.name || obs.user?.login || 'Unknown',
      lifeStageGuess: 'unknown',
      lifeStageConfidence: 'assumed',
    });
  }
  return out;
}

async function searchPhotos(scientificName, { limit = MAX_CANDIDATES } = {}) {
  const url = `${API}?taxon_name=${encodeURIComponent(scientificName)}&photos=true` +
    `&photo_license=${OPEN_LICENSES}&per_page=${Math.min(limit, 50)}&order_by=votes`;
  let data;
  try {
    data = await fetchJson(url);
  } catch (err) {
    console.warn(`  [inaturalist] search failed for "${scientificName}": ${err.message}`);
    return [];
  }

  const candidates = [];
  for (const obs of data.results || []) {
    for (const cand of candidatesFromObservation(obs)) {
      candidates.push(cand);
      if (candidates.length >= limit) break;
    }
    if (candidates.length >= limit) break;
  }
  return candidates;
}

module.exports = { searchPhotos, candidatesFromObservation };
