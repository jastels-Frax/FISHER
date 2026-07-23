// GBIF occurrence search — real photos linked to occurrence records, largely
// re-published from iNaturalist. Docs: https://techdocs.gbif.org/en/openapi/v1/occurrence

const { fetchJson } = require('./http');
const { normalizeLicense } = require('./license');

const API = 'https://api.gbif.org/v1/occurrence/search';
const PAGE_SIZE = 100;
const MAX_OCCURRENCES_SCANNED = 300; // hard cap so one species can't run away
const MAX_CANDIDATES = 25;

// Darwin Core lifeStage free-text -> this app's stage vocabulary. GBIF's
// lifeStage field is provider-supplied free text, so this is best-effort;
// anything unrecognized is left as 'unknown' rather than guessed.
const STAGE_MAP = [
  [/\begg\b/i, 'egg'],
  [/\bfry\b/i, 'fry'],
  [/\bparr\b/i, 'parr'],
  [/\belver\b|glass eel/i, 'elver'],
  [/\bjuvenile\b|\byoung\b|\bsubadult\b|\bimmature\b/i, 'juvenile'],
  [/\badult\b|\bmature\b/i, 'adult'],
  [/\blarva\b|\blarvae\b/i, 'fry'],
];

function guessStage(raw) {
  if (!raw) return 'unknown';
  const hit = STAGE_MAP.find(([re]) => re.test(raw));
  return hit ? hit[1] : 'unknown';
}

/** Pure function: one GBIF occurrence record -> zero or more candidates.
 * Exported separately so it's unit-testable against saved fixture JSON
 * without needing live network access. */
function candidatesFromOccurrence(occ) {
  const stageGuess = guessStage(occ.lifeStage);
  const out = [];
  for (const media of occ.media || []) {
    if (media.type !== 'StillImage' || !media.identifier) continue;
    const { code, label } = normalizeLicense(media.license || occ.license);
    out.push({
      source: 'gbif',
      sourceType: 'photo',
      occurrenceKey: occ.key,
      sourceUrl: `https://www.gbif.org/occurrence/${occ.key}`,
      imageUrl: media.identifier,
      originalImageUrl: media.identifier,
      licenseCode: code,
      licenseLabel: label,
      author: media.rightsHolder || media.creator || occ.recordedBy || 'Unknown',
      lifeStageGuess: stageGuess,
      lifeStageConfidence: stageGuess === 'unknown' ? 'assumed' : 'confirmed',
    });
  }
  return out;
}

async function searchPhotos(scientificName, { limit = MAX_CANDIDATES } = {}) {
  const candidates = [];
  let offset = 0;
  let scanned = 0;
  let totalAvailable = Infinity;

  while (candidates.length < limit && scanned < MAX_OCCURRENCES_SCANNED && offset < totalAvailable) {
    const url = `${API}?scientificName=${encodeURIComponent(scientificName)}&mediaType=StillImage&limit=${PAGE_SIZE}&offset=${offset}`;
    let data;
    try {
      data = await fetchJson(url);
    } catch (err) {
      console.warn(`  [gbif] search failed at offset ${offset}: ${err.message}`);
      break;
    }
    totalAvailable = data.count ?? 0;
    const results = data.results || [];
    if (!results.length) break;

    for (const occ of results) {
      scanned++;
      for (const cand of candidatesFromOccurrence(occ)) {
        candidates.push(cand);
        if (candidates.length >= limit) break;
      }
      if (candidates.length >= limit) break;
    }
    offset += PAGE_SIZE;
  }
  return candidates;
}

module.exports = { searchPhotos, candidatesFromOccurrence, guessStage };
