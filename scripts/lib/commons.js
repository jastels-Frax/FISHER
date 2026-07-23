// Wikimedia Commons search: Duane Raver / USFWS illustrations (for the one
// clean reference illustration per species) + general species-category
// photos (for real per-life-stage photos).
//
// Uses the Commons MediaWiki API (api.php) — public, unauthenticated, JSON.
// Docs: https://www.mediawiki.org/wiki/API:Search, API:Imageinfo

const { fetchJson } = require('./http');
const { normalizeLicense } = require('./license');

const API = 'https://commons.wikimedia.org/w/api.php';

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}

async function searchTitles(query, limit) {
  const url = `${API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=${limit}&format=json&origin=*`;
  const data = await fetchJson(url);
  return (data.query?.search || []).map((r) => r.title);
}

// Batched imageinfo lookup (MediaWiki allows up to 50 titles per request).
async function getImageInfo(titles) {
  if (!titles.length) return {};
  const out = {};
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const url = `${API}?action=query&titles=${encodeURIComponent(batch.join('|'))}` +
      `&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1000&format=json&origin=*`;
    const data = await fetchJson(url);
    const pages = data.query?.pages || {};
    for (const page of Object.values(pages)) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      out[page.title] = info;
    }
  }
  return out;
}

function toCandidate({ title, info, sourceType, lifeStageGuess }) {
  const meta = info.extmetadata || {};
  const licenseRaw = meta.LicenseShortName?.value || meta.License?.value || '';
  const { code, label } = normalizeLicense(licenseRaw);
  const author = stripHtml(meta.Artist?.value || meta.Credit?.value || 'Unknown');
  return {
    source: 'wikimedia-commons',
    sourceType, // 'illustration' | 'photo'
    title,
    sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    imageUrl: info.thumburl || info.url,
    originalImageUrl: info.url,
    mime: info.mime,
    licenseCode: code,
    licenseLabel: label,
    author,
    lifeStageGuess, // caller decides confidence; commons rarely tags life stage explicitly
  };
}

/**
 * Duane Raver / USFWS reference illustration search — combines free-text
 * search terms rather than relying on exact category titles (which we can't
 * verify from a network-restricted environment; adjust CATEGORY_HINTS below
 * if you find the exact category names differ once you can browse Commons).
 */
async function searchIllustrations(scientificName, { limit = 6 } = {}) {
  const queries = [
    `"${scientificName}" Duane Raver`,
    `"${scientificName}" USFWS illustration`,
    `"${scientificName}" fish and wildlife service illustration`,
  ];
  const titleSet = new Set();
  for (const q of queries) {
    try {
      const titles = await searchTitles(q, limit);
      titles.forEach((t) => titleSet.add(t));
    } catch (err) {
      console.warn(`  [commons] illustration search failed for "${q}": ${err.message}`);
    }
  }
  if (!titleSet.size) return [];
  const infoByTitle = await getImageInfo([...titleSet]);
  return Object.entries(infoByTitle).map(([title, info]) =>
    toCandidate({ title, info, sourceType: 'illustration', lifeStageGuess: 'adult' }));
}

/**
 * General real-photo search by scientific name, for per-life-stage photos.
 */
async function searchPhotos(scientificName, { limit = 15 } = {}) {
  let titles;
  try {
    titles = await searchTitles(`"${scientificName}"`, limit);
  } catch (err) {
    console.warn(`  [commons] photo search failed for "${scientificName}": ${err.message}`);
    return [];
  }
  if (!titles.length) return [];
  const infoByTitle = await getImageInfo(titles);
  return Object.entries(infoByTitle)
    // Illustrations often show up in general search too; anything whose author
    // credits Duane Raver/USFWS is already covered by searchIllustrations, so
    // treat everything here as a candidate "photo" and let the caller/reviewer
    // judge — Commons doesn't reliably expose life-stage as metadata.
    .map(([title, info]) => toCandidate({ title, info, sourceType: 'photo', lifeStageGuess: 'unknown' }));
}

module.exports = { searchIllustrations, searchPhotos, toCandidate };
