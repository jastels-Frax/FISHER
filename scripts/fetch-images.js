#!/usr/bin/env node
// Standalone reference-image fetcher for the NS Fish Field ID & Catalogue app.
//
// RUN THIS YOURSELF on a machine with normal internet access:
//   node scripts/fetch-images.js
//
// See scripts/README.md for full details, requirements, and re-run examples.
// Requires Node 18+ (uses the built-in global `fetch`). No npm install needed.

const fs = require('fs');
const path = require('path');
const commons = require('./lib/commons');
const gbif = require('./lib/gbif');
const inaturalist = require('./lib/inaturalist');
const { isLicenseAllowed } = require('./lib/license');
const staging = require('./lib/staging');

const ROOT = path.join(__dirname, '..');
const SPECIES_PATH = path.join(ROOT, 'data', 'species.json');

function parseArgs(argv) {
  const args = { species: null, stage: null, dryRun: false, maxPerStage: 10 };
  for (const raw of argv) {
    if (raw === '--dry-run') args.dryRun = true;
    else if (raw === '--help' || raw === '-h') args.help = true;
    else if (raw.startsWith('--species=')) args.species = raw.slice(10).split(',').map((s) => s.trim());
    else if (raw.startsWith('--stage=')) args.stage = raw.slice(8).split(',').map((s) => s.trim());
    else if (raw.startsWith('--max-per-stage=')) args.maxPerStage = Number(raw.slice(16)) || 10;
  }
  return args;
}

function printHelp() {
  console.log(`
Fetch candidate reference images (illustrations + photos) for the species in
data/species.json, from Wikimedia Commons, GBIF, and iNaturalist.

Usage:
  node scripts/fetch-images.js [options]

Options:
  --species=id1,id2      Only these species IDs (see data/species.json "id" field).
                          Handy for re-running one species after adjusting terms.
  --stage=adult,juvenile  Only consider these life stages (still fetches the one
                          reference illustration regardless, since that's adult-only).
  --max-per-stage=N       Cap real photos kept per species per stage (default 10).
  --dry-run               Search and log only — skip image downloads.
  --help                  Show this help.

Output (all under staging/, re-run-safe — existing entries are kept, new ones appended):
  staging/images/<speciesId>/<stage>/<source>-<hash>.<ext>   downloaded candidate images
  staging/candidates.json                                     full metadata for every candidate
  staging/gaps.json                                            species/stage pairs with no confirmed candidate

Next step after running this: node scripts/review/server.js — opens the local
review UI at http://localhost:5183 to approve/reject candidates.
`);
}

async function processSpecies(species, { existingKeys, args }) {
  const { id: speciesId, commonName, scientificName } = species;
  const trackedStages = Object.keys(species.lifeStages || {});
  const stageFilter = args.stage ? new Set(args.stage) : null;

  console.log(`\n=== ${commonName} (${scientificName}) [${speciesId}] ===`);
  const newCandidates = [];
  const confirmedByStage = new Set(); // stages with >=1 confirmed candidate this run or before

  // 1. Reference illustration (Duane Raver / USFWS), always adult, regardless of --stage.
  console.log('  searching Commons for a Duane Raver / USFWS illustration...');
  let illustrations = [];
  try {
    illustrations = await commons.searchIllustrations(scientificName);
  } catch (err) {
    console.warn(`  ! illustration search errored: ${err.message}`);
  }
  console.log(`  -> ${illustrations.length} illustration candidate(s) found`);

  // 2. Commons general photos.
  console.log('  searching Commons for photos...');
  let commonsPhotos = [];
  try {
    commonsPhotos = await commons.searchPhotos(scientificName);
  } catch (err) {
    console.warn(`  ! Commons photo search errored: ${err.message}`);
  }
  console.log(`  -> ${commonsPhotos.length} Commons photo candidate(s) found`);

  // 3. GBIF photos (largely re-published iNaturalist media).
  console.log('  searching GBIF occurrence media...');
  let gbifPhotos = [];
  try {
    gbifPhotos = await gbif.searchPhotos(scientificName);
  } catch (err) {
    console.warn(`  ! GBIF search errored: ${err.message}`);
  }
  console.log(`  -> ${gbifPhotos.length} GBIF photo candidate(s) found`);

  // 4. iNaturalist direct.
  console.log('  searching iNaturalist observations...');
  let inatPhotos = [];
  try {
    inatPhotos = await inaturalist.searchPhotos(scientificName);
  } catch (err) {
    console.warn(`  ! iNaturalist search errored: ${err.message}`);
  }
  console.log(`  -> ${inatPhotos.length} iNaturalist photo candidate(s) found`);

  const allFound = [
    ...illustrations.map((c) => ({ ...c, stage: 'adult', isReferenceIllustration: true, lifeStageConfidence: 'confirmed' })),
    ...commonsPhotos.map((c) => ({ ...c, stage: c.lifeStageGuess === 'unknown' ? 'unknown' : c.lifeStageGuess, lifeStageConfidence: c.lifeStageConfidence || 'assumed' })),
    ...gbifPhotos.map((c) => ({ ...c, stage: c.lifeStageConfidence === 'confirmed' ? c.lifeStageGuess : 'unknown' })),
    ...inatPhotos.map((c) => ({ ...c, stage: 'unknown' })),
  ];

  let licenseRejected = 0;
  let alreadyHave = 0;
  let stageSkipped = 0;

  for (const [idx, cand] of allFound.entries()) {
    if (!isLicenseAllowed(cand.source, cand.licenseCode)) {
      licenseRejected++;
      continue;
    }
    if (stageFilter && cand.stage !== 'unknown' && !stageFilter.has(cand.stage) && !cand.isReferenceIllustration) {
      stageSkipped++;
      continue;
    }
    const key = staging.dedupeKey(cand);
    if (existingKeys.has(key)) {
      alreadyHave++;
      if (cand.lifeStageConfidence === 'confirmed') confirmedByStage.add(cand.stage);
      continue;
    }

    const full = { ...cand, speciesId, commonName, scientificName, retrievedAt: new Date().toISOString() };

    if (args.dryRun) {
      newCandidates.push({ ...full, id: `dry-run-${key}`, localPath: null });
    } else {
      // One line per download attempt — this is often the slowest step (image
      // hosts rate-limit harder than the search APIs), so without a line here
      // a long retry/backoff sleep looks identical to the script having hung.
      console.log(`  downloading ${idx + 1}/${allFound.length} (${cand.source}, stage=${full.stage})...`);
      const saved = await staging.downloadCandidateImage(full, speciesId, full.stage);
      if (saved) {
        newCandidates.push(saved);
        existingKeys.add(key);
      }
    }
    if (cand.lifeStageConfidence === 'confirmed') confirmedByStage.add(cand.stage);
  }

  console.log(`  license-rejected: ${licenseRejected}, already staged: ${alreadyHave}, stage-filtered: ${stageSkipped}, new: ${newCandidates.length}`);

  // Per-stage caps: trim newCandidates so no stage explodes past --max-per-stage
  // (illustration is exempt — there's only ever the one reference illustration).
  const perStageCount = {};
  const capped = newCandidates.filter((c) => {
    if (c.isReferenceIllustration) return true;
    perStageCount[c.stage] = (perStageCount[c.stage] || 0) + 1;
    return perStageCount[c.stage] <= args.maxPerStage;
  });

  const gapsForSpecies = trackedStages.filter((s) => !confirmedByStage.has(s));
  return { newCandidates: capped, gapsForSpecies, trackedStages };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  const speciesList = JSON.parse(fs.readFileSync(SPECIES_PATH, 'utf8')).species;
  const targetSpecies = args.species
    ? speciesList.filter((s) => args.species.includes(s.id))
    : speciesList;

  if (args.species && targetSpecies.length !== args.species.length) {
    const found = new Set(targetSpecies.map((s) => s.id));
    const missing = args.species.filter((id) => !found.has(id));
    console.warn(`! Unknown species id(s), skipping: ${missing.join(', ')}`);
  }

  console.log(`Fetching candidate images for ${targetSpecies.length} species${args.dryRun ? ' (DRY RUN — no downloads)' : ''}...`);

  // existingCandidates/allGaps are persisted after EVERY species, not just
  // once at the end — a long run over many species can take a while (image
  // hosts rate-limit harder than the search APIs, see scripts/lib/http.js),
  // so if it's interrupted or crashes partway, everything up to that point
  // is already safely on disk instead of being silently lost.
  let allCandidates = staging.loadCandidates();
  const existingKeys = new Set(allCandidates.map((c) => staging.dedupeKey(c)));
  const processedIds = new Set(targetSpecies.map((s) => s.id));
  let allGaps = staging.loadGaps().filter((g) => !processedIds.has(g.speciesId));
  let newCandidateCount = 0;

  for (const species of targetSpecies) {
    const { newCandidates, gapsForSpecies, trackedStages } = await processSpecies(species, { existingKeys, args });
    newCandidateCount += newCandidates.length;

    if (!args.dryRun && newCandidates.length) {
      allCandidates = [...allCandidates, ...newCandidates];
      staging.saveCandidates(allCandidates);
    }

    allGaps = allGaps.filter((g) => g.speciesId !== species.id);
    if (gapsForSpecies.length) {
      allGaps.push({
        speciesId: species.id, commonName: species.commonName, scientificName: species.scientificName,
        stagesWithoutConfirmedImage: gapsForSpecies, allTrackedStages: trackedStages,
      });
    }
    if (!args.dryRun) staging.saveGaps([...allGaps].sort((a, b) => a.speciesId.localeCompare(b.speciesId)));
  }

  console.log(`\n=== Done ===`);
  console.log(`Species processed: ${targetSpecies.length}`);
  console.log(`New candidates ${args.dryRun ? 'found' : 'downloaded'}: ${newCandidateCount}`);
  console.log(`Species with at least one stage gap: ${allGaps.filter((g) => processedIds.has(g.speciesId)).length}`);
  if (!args.dryRun) {
    console.log(`\nCandidates manifest: staging/candidates.json`);
    console.log(`Gaps log: staging/gaps.json`);
    console.log(`\nNext: node scripts/review/server.js`);
  }
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exitCode = 1;
});
