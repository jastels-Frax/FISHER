// Shared staging-area helpers: candidates.json / gaps.json read-write, a
// stable dedupe key so re-runs don't re-download or duplicate entries, and
// the actual image download-to-disk logic.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchBinary, extFromContentType } = require('./http');

const ROOT = path.join(__dirname, '..', '..');
const STAGING_DIR = path.join(ROOT, 'staging');
const IMAGES_DIR = path.join(STAGING_DIR, 'images');
const CANDIDATES_PATH = path.join(STAGING_DIR, 'candidates.json');
const GAPS_PATH = path.join(STAGING_DIR, 'gaps.json');
const DECISIONS_PATH = path.join(STAGING_DIR, 'decisions.json');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadCandidates() {
  return readJsonSafe(CANDIDATES_PATH, []);
}
function saveCandidates(list) {
  ensureDir(STAGING_DIR);
  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(list, null, 2) + '\n');
}

function loadGaps() {
  return readJsonSafe(GAPS_PATH, []);
}
function saveGaps(list) {
  ensureDir(STAGING_DIR);
  fs.writeFileSync(GAPS_PATH, JSON.stringify(list, null, 2) + '\n');
}

function loadDecisions() {
  return readJsonSafe(DECISIONS_PATH, {});
}
function saveDecisions(decisions) {
  ensureDir(STAGING_DIR);
  fs.writeFileSync(DECISIONS_PATH, JSON.stringify(decisions, null, 2) + '\n');
}

/** Stable identity for a candidate, independent of run order — used to skip
 * re-downloading/duplicating on a re-run. */
function dedupeKey(candidate) {
  const basis = candidate.sourceUrl + '|' + (candidate.imageUrl || '');
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

function shortHash(str) {
  return crypto.createHash('sha1').update(str).digest('hex').slice(0, 10);
}

/**
 * Downloads one candidate's image into staging/images/<speciesId>/<stage>/
 * and returns the candidate enriched with id/localPath. Returns null (and
 * logs a warning) if the download fails — callers should just skip it.
 */
async function downloadCandidateImage(candidate, speciesId, stage) {
  const id = `${candidate.source}-${shortHash(candidate.sourceUrl + candidate.imageUrl)}`;
  const dir = path.join(IMAGES_DIR, speciesId, stage);
  ensureDir(dir);

  let buffer, contentType;
  try {
    ({ buffer, contentType } = await fetchBinary(candidate.imageUrl));
  } catch (err) {
    console.warn(`    ! image download failed (${candidate.source}): ${err.message}`);
    return null;
  }
  const ext = candidate.mime ? extFromContentType(candidate.mime) : extFromContentType(contentType);
  const filename = `${id}.${ext}`;
  const absPath = path.join(dir, filename);
  fs.writeFileSync(absPath, buffer);

  const localPath = path
    .relative(ROOT, absPath)
    .split(path.sep)
    .join('/'); // POSIX-style path even on Windows, for the JSON manifest

  return {
    id,
    localPath,
    fileSizeBytes: buffer.length,
    ...candidate,
  };
}

module.exports = {
  ROOT, STAGING_DIR, IMAGES_DIR, CANDIDATES_PATH, GAPS_PATH, DECISIONS_PATH,
  ensureDir, loadCandidates, saveCandidates, loadGaps, saveGaps,
  loadDecisions, saveDecisions, dedupeKey, downloadCandidateImage,
};
