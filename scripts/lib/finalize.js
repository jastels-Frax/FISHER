// Finalize step: turns curated decisions (staging/decisions.json) into the
// app's real, committed assets — images/species/<id>/<stage>.<ext> and
// data/images.json — plus a durable attribution manifest and gap log.
//
// planFinalize() is pure (no fs) so it can be unit-tested against fixture
// data; runFinalize() is the thin I/O wrapper the review server and the
// scripts/finalize-images.js CLI both call.

const fs = require('fs');
const path = require('path');
const staging = require('./staging');

const ROOT = staging.ROOT;
const SPECIES_PATH = path.join(ROOT, 'data', 'species.json');
const IMAGES_JSON_PATH = path.join(ROOT, 'data', 'images.json');
const MANIFEST_JSON_PATH = path.join(ROOT, 'data', 'image-attribution-manifest.json');
const MANIFEST_CSV_PATH = path.join(ROOT, 'data', 'image-attribution-manifest.csv');
const GAPS_LOG_PATH = path.join(ROOT, 'data', 'image-sourcing-gaps.json');

/**
 * Among a slot's (speciesId + effective stage) approved candidates, pick the
 * one that becomes the app's actual image for that stage. The reference
 * illustration wins when present (per spec: "prefer Duane Raver/USFWS where
 * available"); otherwise the earliest-approved candidate wins. Everything
 * else in the slot is kept out of images.json but still recorded in the
 * manifest as a non-active alternate, so it's not lost — the user can swap
 * it in later by re-running finalize after changing decisions.
 */
function pickWinner(approvedForSlot) {
  if (!approvedForSlot.length) return null;
  return approvedForSlot.find((c) => c.isReferenceIllustration) || approvedForSlot[0];
}

function extOf(localPath) {
  const ext = path.extname(localPath || '').replace(/^\./, '');
  return ext || 'jpg';
}

function creditLine(candidate) {
  const sourceLabel = { 'wikimedia-commons': 'Wikimedia Commons', gbif: 'GBIF', inaturalist: 'iNaturalist' }[candidate.source] || candidate.source;
  const author = candidate.author && candidate.author !== 'Unknown' ? candidate.author : 'Unknown photographer/illustrator';
  return `${author} — ${candidate.licenseLabel || candidate.licenseCode}, via ${sourceLabel}`;
}

function toManifestRow(candidate, { used, destPath = null, reason = null }) {
  return {
    candidateId: candidate.id,
    speciesId: candidate.speciesId,
    commonName: candidate.commonName,
    scientificName: candidate.scientificName,
    stage: candidate.effectiveStage,
    used,
    reason,
    isReferenceIllustration: !!candidate.isReferenceIllustration,
    localPath: used ? `./${destPath}` : null,
    stagingPath: candidate.localPath || null,
    source: candidate.source,
    sourceUrl: candidate.sourceUrl,
    imageUrl: candidate.imageUrl || null,
    license: candidate.licenseLabel || candidate.licenseCode,
    author: candidate.author || 'Unknown',
    retrievedAt: candidate.retrievedAt || null,
    approvedAt: candidate.decidedAt || null,
  };
}

/**
 * Pure planning function: given the full species list, every staged
 * candidate, and the current decisions map, work out exactly what finalize
 * would do — without touching the filesystem. Unit tests exercise this
 * directly against fixtures.
 *
 * @param {object} params
 * @param {Array} params.speciesList - data/species.json's `species` array
 * @param {Array} params.candidates - staging/candidates.json
 * @param {object} params.decisions - staging/decisions.json,
 *   `{ [candidateId]: { decision: 'approved'|'rejected'|'needs-different', stage?: string, decidedAt?: string } }`
 */
function planFinalize({ speciesList, candidates, decisions }) {
  const decided = candidates.map((c) => {
    const d = decisions[c.id];
    return {
      ...c,
      decision: d ? d.decision : null,
      effectiveStage: (d && d.stage) || c.stage,
      decidedAt: d ? d.decidedAt : null,
    };
  });

  const approved = decided.filter((c) => c.decision === 'approved');

  const slots = new Map(); // `${speciesId}::${stage}` -> approved candidates for that slot
  for (const c of approved) {
    const key = `${c.speciesId}::${c.effectiveStage}`;
    if (!slots.has(key)) slots.set(key, []);
    slots.get(key).push(c);
  }

  const imagesJsonUpdates = {};
  const copyOps = [];
  const manifestRows = [];
  let unassignedCount = 0;

  for (const [key, list] of slots) {
    const [speciesId, stage] = key.split('::');

    // Approved but never assigned a real life stage (still sitting in the
    // "unknown" bucket) — per spec, never silently substitute; skip using it
    // and just record it as unassigned in the manifest so it's traceable.
    if (stage === 'unknown') {
      unassignedCount += list.length;
      for (const c of list) manifestRows.push(toManifestRow(c, { used: false, reason: 'approved but no life stage assigned yet — re-review and set a stage' }));
      continue;
    }

    const winner = pickWinner(list);
    const destRel = path.posix.join('images', 'species', speciesId, `${stage}.${extOf(winner.localPath)}`);
    imagesJsonUpdates[speciesId] = imagesJsonUpdates[speciesId] || {};
    imagesJsonUpdates[speciesId][stage] = {
      status: 'verified',
      localPath: `./${destRel}`,
      credit: creditLine(winner),
    };
    copyOps.push({ from: winner.localPath, to: destRel });
    manifestRows.push(toManifestRow(winner, { used: true, destPath: destRel }));

    for (const alt of list) {
      if (alt.id === winner.id) continue;
      manifestRows.push(toManifestRow(alt, { used: false, reason: 'alternate candidate for this stage — not selected as the primary image' }));
    }
  }

  const gapsRemaining = [];
  for (const s of speciesList) {
    const tracked = Object.keys(s.lifeStages || {});
    for (const stage of tracked) {
      if (!(imagesJsonUpdates[s.id] && imagesJsonUpdates[s.id][stage])) {
        gapsRemaining.push({ speciesId: s.id, commonName: s.commonName, scientificName: s.scientificName, stage });
      }
    }
  }

  return { imagesJsonUpdates, copyOps, manifestRows, gapsRemaining, unassignedCount };
}

function manifestToCsv(rows) {
  const cols = ['candidateId', 'speciesId', 'commonName', 'scientificName', 'stage', 'used', 'reason', 'isReferenceIllustration', 'localPath', 'stagingPath', 'source', 'sourceUrl', 'imageUrl', 'license', 'author', 'retrievedAt', 'approvedAt'];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

/**
 * I/O wrapper: loads real staging/species/images.json state, plans, and
 * (unless dryRun) applies it — copies winning images into images/species/,
 * merges verified entries into data/images.json (placeholders elsewhere are
 * left untouched), and writes the attribution manifest + gap log.
 */
function runFinalize({ dryRun = false } = {}) {
  const speciesList = JSON.parse(fs.readFileSync(SPECIES_PATH, 'utf8')).species;
  const candidates = staging.loadCandidates();
  const decisions = staging.loadDecisions();

  const plan = planFinalize({ speciesList, candidates, decisions });
  if (!dryRun) {
    applyPlan(plan, {
      copyBaseDir: ROOT,
      imagesJsonPath: IMAGES_JSON_PATH,
      manifestJsonPath: MANIFEST_JSON_PATH,
      manifestCsvPath: MANIFEST_CSV_PATH,
      gapsLogPath: GAPS_LOG_PATH,
    });
  }
  return plan;
}

/**
 * Applies a plan's file effects. Split out from runFinalize so integration
 * tests can point every path at a throwaway temp directory instead of the
 * real repo — see scripts/test/finalize.test.js.
 */
function applyPlan(plan, { copyBaseDir, imagesJsonPath, manifestJsonPath, manifestCsvPath, gapsLogPath }) {
  for (const op of plan.copyOps) {
    const fromAbs = path.join(copyBaseDir, op.from);
    const toAbs = path.join(copyBaseDir, op.to);
    staging.ensureDir(path.dirname(toAbs));
    fs.copyFileSync(fromAbs, toAbs);
  }

  const existingImages = JSON.parse(fs.readFileSync(imagesJsonPath, 'utf8'));
  for (const [speciesId, stages] of Object.entries(plan.imagesJsonUpdates)) {
    existingImages[speciesId] = existingImages[speciesId] || {};
    for (const [stage, entry] of Object.entries(stages)) {
      existingImages[speciesId][stage] = entry;
    }
  }
  fs.writeFileSync(imagesJsonPath, JSON.stringify(existingImages, null, 2) + '\n');

  fs.writeFileSync(manifestJsonPath, JSON.stringify(plan.manifestRows, null, 2) + '\n');
  fs.writeFileSync(manifestCsvPath, manifestToCsv(plan.manifestRows));
  fs.writeFileSync(gapsLogPath, JSON.stringify(plan.gapsRemaining, null, 2) + '\n');
}

module.exports = {
  planFinalize, runFinalize, applyPlan, pickWinner, creditLine, manifestToCsv,
  IMAGES_JSON_PATH, MANIFEST_JSON_PATH, MANIFEST_CSV_PATH, GAPS_LOG_PATH,
};
